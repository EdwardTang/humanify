import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import * as fileStore from '../db/file-store.js';

// 这是我们要创建的适配器，使file-store的API看起来像dbHelpers的API
const dbAdapter = {
  // 初始化数据库
  async initializeDatabase() {
    return fileStore.initializeDataStore();
  },
  
  // 开始处理运行
  async startProcessingRun(configJson, totalFiles, projectId) {
    return fileStore.saveProcessingRun({
      status: 'running',
      config: configJson,
      total_files: totalFiles,
      processed_files: 0,
      failed_files: 0,
      project_id: projectId || '',
      start_time: new Date().toISOString()
    });
  },
  
  // 完成处理运行
  async completeProcessingRun(runId, options) {
    const run = await fileStore.getProcessingRunById(runId);
    if (!run) {
      throw new Error(`处理运行不存在: ${runId}`);
    }
    
    return fileStore.saveProcessingRun({
      ...run,
      status: options.status,
      end_time: new Date().toISOString(),
      error: options.error
    });
  },
  
  // 同步文件到数据库
  async syncFilesToDatabase(fileObjects, projectId) {
    const results = [];
    for (const fileObj of fileObjects) {
      // 确定文件类别
      let category = 'small';
      if (fileObj.size > 500000) {
        category = fileObj.size > 2000000 ? 'ultra_large' : 'large';
      }
      
      // 从路径中提取文件名和类型
      const fileName = path.basename(fileObj.path);
      const fileType = path.extname(fileObj.path).slice(1);
      
      // 保存文件
      const savedFile = await fileStore.saveFile({
        path: fileObj.path,
        file_name: fileName,
        file_type: fileType,
        size: fileObj.size,
        status: 'pending',
        category,
        project_id: projectId || ''
      });
      
      results.push(savedFile);
    }
    
    return { success: true, files: results };
  },
  
  // 按类别获取待处理文件
  async getPendingFilesByCategory(projectId) {
    // 获取所有属于项目的文件
    const allFiles = projectId ? 
      await fileStore.getFilesByProjectId(projectId) : 
      await fileStore.getProjects().then(projects => {
        const activeProject = projects.find(p => p.is_active);
        return activeProject ? fileStore.getFilesByProjectId(activeProject.id) : [];
      });
    
    // 按状态过滤
    const pendingFiles = allFiles.filter(file => file.status === 'pending');
    
    // 按类别分组
    const result = {
      small: pendingFiles.filter(file => file.category === 'small'),
      large: pendingFiles.filter(file => file.category === 'large'),
      ultra_large: pendingFiles.filter(file => file.category === 'ultra_large')
    };
    
    return { success: true, files: result };
  },
  
  // 获取批处理的标识符
  async getIdentifiersForBatching(batchSize, skipCompleted, projectId) {
    // 获取所有待处理的标识符
    let allFiles = [];
    if (projectId) {
      allFiles = await fileStore.getFilesByProjectId(projectId);
    } else {
      const activeProject = await fileStore.getActiveProject();
      if (activeProject) {
        allFiles = await fileStore.getFilesByProjectId(activeProject.id);
      }
    }
    
    // 收集所有标识符
    let allIdentifiers = [];
    for (const file of allFiles) {
      const fileIdentifiers = await fileStore.getIdentifiersByFileId(file.id);
      allIdentifiers = [...allIdentifiers, ...fileIdentifiers.filter(id => id.status === 'pending')];
    }
    
    // 如果需要跳过已完成的标识符
    if (skipCompleted) {
      // 获取所有已完成标识符
      const completedIdentifiers = new Set();
      for (const file of allFiles) {
        const fileIdentifiers = await fileStore.getIdentifiersByFileId(file.id);
        fileIdentifiers
          .filter(id => id.status === 'completed')
          .forEach(id => completedIdentifiers.add(id.original_name));
      }
      
      // 过滤掉原始名称已经处理过的标识符
      allIdentifiers = allIdentifiers.filter(id => !completedIdentifiers.has(id.original_name));
    }
    
    // 按批次大小分组
    const batches = [];
    for (let i = 0; i < allIdentifiers.length; i += batchSize) {
      const batchIdentifiers = allIdentifiers.slice(i, i + batchSize);
      batches.push({
        id: `batch-${i / batchSize}`,
        identifiers: batchIdentifiers
      });
    }
    
    return { success: true, batches, total: allIdentifiers.length };
  },
  
  // 创建批处理作业
  async createBatchJob(batchId, jobId, projectId) {
    return fileStore.saveLocalBatchTracker({
      openai_batch_id: jobId,
      type: 'small',
      file_ids: [],
      identifier_count: 0,
      tasks_file_path: '',
      processing_run_id: batchId,
      processing_start: new Date().toISOString(),
      status: 'processing',
      project_id: projectId || ''
    });
  },
  
  // 获取已处理文件
  async getProcessedFilesByRunId(runId, projectId) {
    // 根据运行ID获取批处理跟踪
    const trackers = await fileStore.getLocalBatchTrackersByRunId(runId);
    
    // 获取所有涉及的文件ID
    const fileIds = new Set();
    trackers.forEach(tracker => {
      tracker.file_ids.forEach(id => fileIds.add(id));
    });
    
    // 获取所有文件
    const files = [];
    for (const fileId of fileIds) {
      const file = await fileStore.getFileById(fileId);
      if (file && (!projectId || file.project_id === projectId)) {
        files.push(file);
      }
    }
    
    return { success: true, files };
  },
  
  // 获取文件标识符
  async getFileIdentifiers(fileId, projectId) {
    const identifiers = await fileStore.getIdentifiersByFileId(fileId);
    
    // 过滤特定项目的标识符（如果指定了项目ID）
    const filteredIdentifiers = projectId
      ? identifiers.filter(id => id.project_id === projectId)
      : identifiers;
    
    return { success: true, identifiers: filteredIdentifiers };
  }
};

// 临时测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-adapter-test');

describe('DB Adapter for File Store', async () => {
  before(async () => {
    // 确保测试目录存在
    await fs.ensureDir(TEST_DIR);
    
    // 修改文件存储的数据目录为测试目录
    process.env.DATA_DIR = TEST_DIR;
    
    // 初始化存储
    await dbAdapter.initializeDatabase();
  });
  
  after(async () => {
    // 清理测试目录
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
  
  it('should initialize database', async () => {
    const result = await dbAdapter.initializeDatabase();
    assert.ok(result, '初始化数据库应成功');
  });
  
  it('should start and complete a processing run', async () => {
    // 启动处理运行
    const config = JSON.stringify({ test: true });
    const run = await dbAdapter.startProcessingRun(config, 10, 'test-project');
    
    assert.ok(run.id, '处理运行ID应存在');
    assert.equal(run.status, 'running', '初始状态应为running');
    assert.equal(run.total_files, 10, '总文件数应匹配');
    
    // 完成处理运行
    const completedRun = await dbAdapter.completeProcessingRun(run.id, { status: 'completed' });
    
    assert.equal(completedRun.id, run.id, '处理运行ID应保持不变');
    assert.equal(completedRun.status, 'completed', '状态应更新为completed');
    assert.ok(completedRun.end_time, '完成时间应存在');
  });
  
  it('should sync files to database and get them by category', async () => {
    const projectId = 'test-sync-project';
    
    // 同步文件
    const fileObjects = [
      { path: '/test/small1.js', size: 1000 },
      { path: '/test/small2.js', size: 2000 },
      { path: '/test/large1.js', size: 600000 },
      { path: '/test/ultra1.js', size: 3000000 }
    ];
    
    const syncResult = await dbAdapter.syncFilesToDatabase(fileObjects, projectId);
    assert.ok(syncResult.success, '同步文件应成功');
    assert.equal(syncResult.files.length, 4, '应同步4个文件');
    
    // 获取分类文件
    const categoryResult = await dbAdapter.getPendingFilesByCategory(projectId);
    assert.ok(categoryResult.success, '获取分类文件应成功');
    assert.equal(categoryResult.files.small.length, 2, '应有2个小文件');
    assert.equal(categoryResult.files.large.length, 1, '应有1个大文件');
    assert.equal(categoryResult.files.ultra_large.length, 1, '应有1个超大文件');
  });
  
  it('should batch identifiers and create batch jobs', async () => {
    const projectId = 'test-batch-project';
    
    // 创建文件
    const file = await fileStore.saveFile({
      path: '/test/batch-test.js',
      file_name: 'batch-test.js',
      file_type: 'js',
      size: 1000,
      status: 'pending',
      category: 'small',
      project_id: projectId
    });
    
    // 创建标识符
    for (let i = 0; i < 25; i++) {
      await fileStore.saveIdentifier({
        file_id: file.id,
        original_name: `var${i}`,
        surrounding_code: `const var${i} = ${i};`,
        status: 'pending',
        custom_id: `id-${i}`,
        project_id: projectId
      });
    }
    
    // 获取批处理标识符
    const batchResult = await dbAdapter.getIdentifiersForBatching(10, false, projectId);
    assert.ok(batchResult.success, '获取批处理标识符应成功');
    assert.equal(batchResult.total, 25, '总标识符数应为25');
    assert.equal(batchResult.batches.length, 3, '应有3个批次');
    assert.equal(batchResult.batches[0].identifiers.length, 10, '第一批次应有10个标识符');
    
    // 创建批处理作业
    const job = await dbAdapter.createBatchJob('test-batch', 'openai-job-123', projectId);
    assert.ok(job.id, '批处理作业ID应存在');
    assert.equal(job.openai_batch_id, 'openai-job-123', 'OpenAI作业ID应匹配');
    assert.equal(job.status, 'processing', '状态应为processing');
  });
  
  it('should get processed files and file identifiers', async () => {
    const projectId = 'test-processed-project';
    
    // 创建文件
    const file = await fileStore.saveFile({
      path: '/test/processed-test.js',
      file_name: 'processed-test.js',
      file_type: 'js',
      size: 1000,
      status: 'completed',
      category: 'small',
      project_id: projectId
    });
    
    // 创建批处理跟踪
    const tracker = await fileStore.saveLocalBatchTracker({
      openai_batch_id: 'openai-job-456',
      type: 'small',
      file_ids: [file.id],
      identifier_count: 5,
      tasks_file_path: '/test/tasks.jsonl',
      processing_run_id: 'test-run',
      processing_start: new Date().toISOString(),
      status: 'completed',
      processing_end: new Date().toISOString(),
      project_id: projectId
    });
    
    // 创建标识符
    for (let i = 0; i < 5; i++) {
      await fileStore.saveIdentifier({
        file_id: file.id,
        original_name: `var${i}`,
        new_name: `variable${i}`,
        surrounding_code: `const var${i} = ${i};`,
        status: 'completed',
        custom_id: `id-${i}`,
        project_id: projectId
      });
    }
    
    // 获取已处理文件
    const filesResult = await dbAdapter.getProcessedFilesByRunId('test-run', projectId);
    assert.ok(filesResult.success, '获取已处理文件应成功');
    assert.equal(filesResult.files.length, 1, '应有1个已处理文件');
    
    // 获取文件标识符
    const identifiersResult = await dbAdapter.getFileIdentifiers(file.id, projectId);
    assert.ok(identifiersResult.success, '获取文件标识符应成功');
    assert.equal(identifiersResult.identifiers.length, 5, '应有5个标识符');
    assert.equal(identifiersResult.identifiers[0].status, 'completed', '标识符状态应为completed');
    assert.ok(identifiersResult.identifiers[0].new_name, '标识符应有新名称');
  });
}); 