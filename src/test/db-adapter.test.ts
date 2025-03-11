import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import * as fileStore from '../db/file-store.js';
import { describe as vitestDescribe, it as vitestIt, expect } from 'vitest';

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
      return { success: false, error: `Processing run with ID ${runId} not found` };
    }
    
    return fileStore.updateProcessingRun(runId, {
      status: options.status || 'completed',
      end_time: new Date().toISOString(),
      error: options.error
    });
  },
  
  // 将文件同步到数据库
  async syncFilesToDatabase(fileObjects, projectId) {
    // 转换文件对象为file-store格式
    const files = fileObjects.map(file => ({
      ...file,
      file_name: path.basename(file.path),
      file_type: path.extname(file.path).replace('.', ''),
      status: 'pending',
      category: file.size < 10000 ? 'small' : file.size < 100000 ? 'large' : 'ultra_large',
      project_id: projectId || ''
    }));
    
    return fileStore.saveFiles(files);
  },
  
  // 获取按类别分类的待处理文件
  async getPendingFilesByCategory(projectId) {
    // 获取所有待处理文件
    const result = await fileStore.getFilesByStatus('pending', projectId);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // 按类别分类
    const small = result.files.filter(file => file.category === 'small');
    const large = result.files.filter(file => file.category === 'large');
    const ultraLarge = result.files.filter(file => file.category === 'ultra_large');
    
    return {
      success: true,
      files: result.files,
      categories: {
        small,
        large,
        ultraLarge
      }
    };
  },
  
  // 获取用于批处理的标识符
  async getIdentifiersForBatching(batchSize, skipCompleted, projectId) {
    // 获取待处理标识符
    const status = skipCompleted ? 'pending' : null;
    const result = await fileStore.getIdentifiers(status, projectId);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // 创建批次
    const identifiers = result.identifiers;
    const batches = [];
    
    for (let i = 0; i < identifiers.length; i += batchSize) {
      const batchIdentifiers = identifiers.slice(i, i + batchSize);
      const batchId = `batch-${i / batchSize}`;
      
      batches.push({
        id: batchId,
        identifiers: batchIdentifiers
      });
    }
    
    return {
      success: true,
      total: identifiers.length,
      batches
    };
  },
  
  // 创建批处理作业
  async createBatchJob(batchId, jobId, projectId) {
    return fileStore.saveBatchJob({
      id: jobId,
      batch_id: batchId,
      status: 'submitted',
      project_id: projectId || '',
      created_at: new Date().toISOString()
    });
  },
  
  // 获取按运行ID处理的文件
  async getProcessedFilesByRunId(runId, projectId) {
    // 获取处理完成的文件
    const result = await fileStore.getFilesByStatus('completed', projectId);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // 过滤出与运行ID相关的文件
    // 注意：这里假设运行ID以某种方式关联到文件，实际实现可能需要调整
    const files = result.files.filter(file => file.processing_run_id === runId);
    
    return {
      success: true,
      files
    };
  },
  
  // 获取文件标识符
  async getFileIdentifiers(fileId, projectId) {
    const result = await fileStore.getIdentifiersByFileId(fileId, projectId);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    return {
      success: true,
      identifiers: result.identifiers
    };
  }
};

// Import test implementation from db-adapter.test.js
// 测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-adapter-test');

describe('DB Adapter Tests (Node.js)', async () => {
  before(async () => {
    // 创建测试目录
    await fs.ensureDir(TEST_DIR);
    
    // 设置数据目录
    process.env.DATA_DIR = TEST_DIR;
    
    // 初始化数据库
    await dbAdapter.initializeDatabase();
  });
  
  after(async () => {
    // 清理测试数据
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
  
  it('should initialize database', async () => {
    const result = await dbAdapter.initializeDatabase();
    assert.ok(result === undefined || result, '初始化数据库应成功');
  });

  it('should start processing run', async () => {
    const config = JSON.stringify({ test: true });
    const result = await dbAdapter.startProcessingRun(config, 10);
    assert.ok(result.success, '开始处理运行应成功');
    assert.ok(result.id, '应返回运行ID');
  });

  it('should complete processing run', async () => {
    // 先创建一个处理运行
    const config = JSON.stringify({ test: true });
    const startResult = await dbAdapter.startProcessingRun(config, 10);
    
    // 然后完成它
    const result = await dbAdapter.completeProcessingRun(startResult.id, { status: 'completed' });
    assert.ok(result.success, '完成处理运行应成功');
  });

  it('should sync files to database', async () => {
    const files = [
      { path: '/test/file1.js', size: 1024 },
      { path: '/test/file2.js', size: 2048 }
    ];
    const result = await dbAdapter.syncFilesToDatabase(files);
    assert.ok(result.success, '同步文件到数据库应成功');
    assert.equal(result.savedCount, 2, '应保存2个文件');
  });
});

// Vitest compatible test for IDE integration
vitestDescribe('DB Adapter Tests (Vitest)', () => {
  vitestIt('should have database adapter functionality', () => {
    expect(dbAdapter).toBeDefined();
    expect(typeof dbAdapter.initializeDatabase).toBe('function');
    expect(typeof dbAdapter.startProcessingRun).toBe('function');
    expect(typeof dbAdapter.completeProcessingRun).toBe('function');
  });
}); 