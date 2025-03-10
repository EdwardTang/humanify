import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as fileStore from '../db/file-store.ts';

// 测试数据
const testFile = {
  path: '/test/path/file.js',
  file_name: 'file.js',
  file_type: 'js',
  size: 1024,
  status: 'pending', // 使用准确的状态字符串
  category: 'small', // 使用准确的类别字符串
  project_id: 'test-project'
};

const testIdentifier = {
  file_id: 'test-file-id',
  original_name: 'a',
  surrounding_code: 'function a() { return 1; }',
  status: 'pending', // 使用准确的状态字符串
  custom_id: 'test-id-1',
  project_id: 'test-project'
};

const testProject = {
  name: 'Test Project',
  version: '1.0.0',
  distro: 'test',
  author: 'Tester',
  is_active: true
};

// 临时测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-test');

describe('File Store API', async () => {
  // 在所有测试之前设置临时目录
  before(async () => {
    // 确保测试目录存在
    await fs.ensureDir(TEST_DIR);
    
    // 修改文件存储的数据目录为测试目录
    process.env.DATA_DIR = TEST_DIR;
    
    // 初始化存储
    await fileStore.initializeDataStore();
  });
  
  // 在所有测试之后清理
  after(async () => {
    // 清理测试目录
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
  
  // 测试项目操作
  describe('Project Operations', async () => {
    it('should save and retrieve a project', async () => {
      // 保存项目
      const savedProject = await fileStore.saveProject(testProject);
      
      // 验证项目已保存
      assert.ok(savedProject.id, '项目ID应存在');
      assert.equal(savedProject.name, testProject.name, '项目名称应匹配');
      
      // 根据ID获取项目
      const retrievedProject = await fileStore.getProjectById(savedProject.id);
      
      // 验证获取的项目
      assert.ok(retrievedProject, '应能获取到项目');
      if (retrievedProject) {
        assert.equal(retrievedProject.name, testProject.name, '获取的项目名称应匹配');
      }
    });
    
    it('should set a project as active', async () => {
      // 保存项目
      const savedProject = await fileStore.saveProject({
        ...testProject,
        name: 'Active Project'
      });
      
      // 设置为活动项目
      const result = await fileStore.setActiveProject(savedProject.id);
      assert.ok(result, '设置活动项目应成功');
      
      // 获取活动项目
      const activeProject = await fileStore.getActiveProject();
      assert.ok(activeProject, '应能获取到活动项目');
      if (activeProject) {
        assert.equal(activeProject.id, savedProject.id, '活动项目ID应匹配');
      }
    });
  });
  
  // 测试文件操作
  describe('File Operations', async () => {
    let projectId;
    
    // 在文件测试前创建一个项目
    before(async () => {
      const project = await fileStore.saveProject({
        ...testProject,
        name: 'File Test Project'
      });
      projectId = project.id;
    });
    
    it('should save and retrieve a file', async () => {
      // 保存文件
      const savedFile = await fileStore.saveFile({
        ...testFile,
        project_id: projectId
      });
      
      // 验证文件已保存
      assert.ok(savedFile.id, '文件ID应存在');
      assert.equal(savedFile.path, testFile.path, '文件路径应匹配');
      
      // 根据ID获取文件
      const retrievedFile = await fileStore.getFileById(savedFile.id);
      
      // 验证获取的文件
      assert.ok(retrievedFile, '应能获取到文件');
      if (retrievedFile) {
        assert.equal(retrievedFile.path, testFile.path, '获取的文件路径应匹配');
      }
    });
    
    it('should get files by project ID', async () => {
      // 再保存几个文件
      await fileStore.saveFile({
        ...testFile,
        path: '/test/path/file2.js',
        file_name: 'file2.js',
        project_id: projectId
      });
      
      await fileStore.saveFile({
        ...testFile,
        path: '/test/path/file3.js',
        file_name: 'file3.js',
        project_id: projectId
      });
      
      // 获取项目的所有文件
      const files = await fileStore.getFilesByProjectId(projectId);
      
      // 验证文件列表
      assert.ok(Array.isArray(files), '文件列表应为数组');
      assert.ok(files.length >= 3, '应至少有3个文件');
      
      // 确认所有文件都属于该项目
      files.forEach(file => {
        assert.equal(file.project_id, projectId, '所有文件都应属于项目');
      });
    });
  });
  
  // 测试标识符操作
  describe('Identifier Operations', async () => {
    let fileId;
    let projectId;
    
    // 在标识符测试前创建一个项目和文件
    before(async () => {
      const project = await fileStore.saveProject({
        ...testProject,
        name: 'Identifier Test Project'
      });
      projectId = project.id;
      
      const file = await fileStore.saveFile({
        ...testFile,
        project_id: projectId
      });
      fileId = file.id;
    });
    
    it('should save and retrieve identifiers', async () => {
      // 保存标识符
      const savedIdentifier = await fileStore.saveIdentifier({
        ...testIdentifier,
        file_id: fileId,
        project_id: projectId
      });
      
      // 验证标识符已保存
      assert.ok(savedIdentifier.id, '标识符ID应存在');
      assert.equal(savedIdentifier.original_name, testIdentifier.original_name, '标识符原始名称应匹配');
      
      // 根据文件ID获取标识符
      const identifiers = await fileStore.getIdentifiersByFileId(fileId);
      
      // 验证获取的标识符
      assert.ok(Array.isArray(identifiers), '标识符列表应为数组');
      assert.ok(identifiers.length > 0, '应有标识符');
      assert.equal(identifiers[0].original_name, testIdentifier.original_name, '获取的标识符原始名称应匹配');
    });
    
    it('should update an identifier with a new name', async () => {
      // 先获取一个标识符
      const identifiers = await fileStore.getIdentifiersByFileId(fileId);
      const testId = identifiers[0].id;
      
      // 更新标识符，添加新名称
      const updatedIdentifier = await fileStore.saveIdentifier({
        ...identifiers[0],
        new_name: 'renamedFunction',
        status: 'completed'
      });
      
      // 验证更新
      assert.equal(updatedIdentifier.id, testId, '标识符ID应保持不变');
      assert.equal(updatedIdentifier.new_name, 'renamedFunction', '新名称应更新');
      assert.equal(updatedIdentifier.status, 'completed', '状态应更新');
      
      // 再次获取标识符验证
      const refreshedIdentifier = await fileStore.getIdentifierById(testId);
      assert.ok(refreshedIdentifier, '应能找到标识符');
      if (refreshedIdentifier) {
        assert.equal(refreshedIdentifier.new_name, 'renamedFunction', '新名称应持久保存');
      }
    });
  });
  
  // 测试批处理跟踪
  describe('Batch Tracking Operations', async () => {
    let projectId;
    
    before(async () => {
      const project = await fileStore.saveProject({
        ...testProject,
        name: 'Batch Test Project'
      });
      projectId = project.id;
    });
    
    it('should save and retrieve batch tracking information', async () => {
      const batchTracker = {
        openai_batch_id: 'openai-batch-123',
        type: 'small',
        file_ids: ['file-1', 'file-2'],
        identifier_count: 20,
        tasks_file_path: '/path/to/tasks.jsonl',
        processing_run_id: 'run-123',
        processing_start: new Date().toISOString(),
        status: 'processing',
        project_id: projectId
      };
      
      // 保存批处理跟踪
      const savedTracker = await fileStore.saveLocalBatchTracker(batchTracker);
      
      // 验证跟踪信息已保存
      assert.ok(savedTracker.id, '批处理跟踪ID应存在');
      assert.equal(savedTracker.openai_batch_id, batchTracker.openai_batch_id, 'OpenAI批处理ID应匹配');
      
      // 根据状态获取跟踪信息
      const trackers = await fileStore.getLocalBatchTrackersByStatus('processing');
      
      // 验证获取的跟踪信息
      assert.ok(Array.isArray(trackers), '跟踪信息列表应为数组');
      assert.ok(trackers.length > 0, '应有跟踪信息');
      assert.equal(trackers[0].openai_batch_id, batchTracker.openai_batch_id, '获取的OpenAI批处理ID应匹配');
    });
    
    it('should update batch tracking status', async () => {
      // 获取所有处理中的批处理
      const processingTrackers = await fileStore.getLocalBatchTrackersByStatus('processing');
      const trackerId = processingTrackers[0].id;
      
      // 更新状态为已完成
      const updatedTracker = await fileStore.saveLocalBatchTracker({
        ...processingTrackers[0],
        status: 'completed',
        processing_end: new Date().toISOString()
      });
      
      // 验证更新
      assert.equal(updatedTracker.id, trackerId, '批处理跟踪ID应保持不变');
      assert.equal(updatedTracker.status, 'completed', '状态应更新为已完成');
      assert.ok(updatedTracker.processing_end, '处理结束时间应存在');
      
      // 获取已完成的批处理验证
      const completedTrackers = await fileStore.getLocalBatchTrackersByStatus('completed');
      const found = completedTrackers.some(t => t.id === trackerId);
      assert.ok(found, '应能在已完成列表中找到更新的批处理');
    });
  });
}); 