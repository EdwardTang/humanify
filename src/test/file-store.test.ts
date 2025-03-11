import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as fileStore from '../db/file-store.js';
import { describe as vitestDescribe, it as vitestIt, expect } from 'vitest';

// 测试数据
const testFile = {
  path: '/test/path/file.js',
  file_name: 'file.js',
  file_type: 'js',
  size: 1024,
  status: 'pending' as const,
  category: 'small' as const,
  project_id: 'test-project'
};

const testIdentifier = {
  file_id: 'test-file-id',
  original_name: 'a',
  surrounding_code: 'function a() { return 1; }',
  status: 'pending' as const,
  custom_id: 'test-id-1',
  project_id: 'test-project'
};

const testProject = {
  name: 'Test Project',
  version: '1.0.0',
  description: 'Test project for file store',
  is_active: true
};

const testBatch = {
  openai_batch_id: 'openai-batch-123',
  type: 'small' as const,
  file_ids: ['file-1', 'file-2'],
  identifier_count: 10,
  tasks_file_path: '/path/to/tasks.jsonl',
  processing_run_id: 'run-123',
  processing_start: new Date().toISOString(),
  status: 'preparing' as const,
  project_id: 'test-project'
};

// 测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-test');

// Node.js Tests
describe('File Store Tests (Node.js)', () => {
  before(async () => {
    // 创建测试目录
    await fs.ensureDir(TEST_DIR);
    
    // 设置数据目录
    process.env.DATA_DIR = TEST_DIR;
    
    // 初始化数据存储
    await fileStore.initializeDataStore();
  });
  
  after(async () => {
    // 清理测试数据
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
  
  beforeEach(async () => {
    // 清空测试数据
    await fs.emptyDir(TEST_DIR);
    
    // 重新初始化数据存储
    await fileStore.initializeDataStore();
  });
  
  it('should initialize data store', async () => {
    const result = await fileStore.initializeDataStore();
    assert.ok(result, '初始化数据存储应成功');
  });
  
  it('should save and get a file', async () => {
    // 保存文件
    const file = { ...testFile, id: uuidv4() };
    const savedFile = await fileStore.saveFile(file);
    
    assert.equal(savedFile.path, file.path, '文件路径应匹配');
    assert.equal(savedFile.file_name, file.file_name, '文件名应匹配');
    
    // 获取文件
    const retrievedFile = await fileStore.getFileById(savedFile.id);
    assert.equal(retrievedFile.id, savedFile.id, '文件ID应匹配');
  });
  
  it('should save and get multiple files', async () => {
    // 保存多个文件
    const files = [
      { ...testFile, id: uuidv4(), path: '/test/file1.js', file_name: 'file1.js' },
      { ...testFile, id: uuidv4(), path: '/test/file2.js', file_name: 'file2.js' }
    ];
    
    const result = await fileStore.saveFiles(files);
    assert.ok(result.success, '保存多个文件应成功');
    assert.equal(result.savedCount, 2, '应保存2个文件');
    
    // 获取所有文件
    const allFiles = await fileStore.getFiles();
    assert.ok(Array.isArray(allFiles), '应返回文件数组');
    assert.equal(allFiles.length, 2, '应返回2个文件');
  });
  
  it('should get files by status', async () => {
    // 保存不同状态的文件
    const files = [
      { ...testFile, id: uuidv4(), status: 'pending' as const },
      { ...testFile, id: uuidv4(), status: 'processing' as const },
      { ...testFile, id: uuidv4(), status: 'completed' as const }
    ];
    
    await fileStore.saveFiles(files);
    
    // 获取特定状态的文件
    const pendingResult = await fileStore.getFilesByStatus('pending');
    assert.ok(pendingResult.success, '获取待处理文件应成功');
    assert.equal(pendingResult.files.length, 1, '应有1个待处理文件');
    
    const completedResult = await fileStore.getFilesByStatus('completed');
    assert.ok(completedResult.success, '获取已完成文件应成功');
    assert.equal(completedResult.files.length, 1, '应有1个已完成文件');
  });
  
  it('should save and get an identifier', async () => {
    // 保存标识符
    const identifier = { ...testIdentifier, id: uuidv4() };
    const savedIdentifier = await fileStore.saveIdentifier(identifier);
    
    assert.equal(savedIdentifier.original_name, identifier.original_name, '原始名称应匹配');
    assert.equal(savedIdentifier.status, identifier.status, '状态应匹配');
    
    // 获取标识符
    const retrievedIdentifier = await fileStore.getIdentifierById(savedIdentifier.id);
    assert.equal(retrievedIdentifier.id, savedIdentifier.id, '标识符ID应匹配');
  });
  
  it('should save and get identifiers by file id', async () => {
    // 创建文件
    const file = { ...testFile, id: uuidv4() };
    const savedFile = await fileStore.saveFile(file);
    
    // 创建关联的标识符
    const identifiers = [
      { ...testIdentifier, id: uuidv4(), file_id: savedFile.id, original_name: 'a' },
      { ...testIdentifier, id: uuidv4(), file_id: savedFile.id, original_name: 'b' }
    ];
    
    for (const identifier of identifiers) {
      await fileStore.saveIdentifier(identifier);
    }
    
    // 获取文件标识符
    const result = await fileStore.getIdentifiersByFileId(savedFile.id);
    assert.ok(result.success, '获取文件标识符应成功');
    assert.equal(result.identifiers.length, 2, '应有2个标识符');
  });
  
  it('should save and get a project', async () => {
    // 保存项目
    const project = { ...testProject, id: uuidv4() };
    const savedProject = await fileStore.saveProject(project);
    
    assert.equal(savedProject.name, project.name, '项目名称应匹配');
    assert.equal(savedProject.is_active, project.is_active, '活动状态应匹配');
    
    // 获取项目
    const retrievedProject = await fileStore.getProjectById(savedProject.id);
    assert.equal(retrievedProject.id, savedProject.id, '项目ID应匹配');
  });
  
  it('should save and get a processing run', async () => {
    // 保存处理运行
    const run = {
      id: uuidv4(),
      status: 'running' as const,
      config: JSON.stringify({ test: true }),
      total_files: 10,
      processed_files: 0,
      failed_files: 0,
      start_time: new Date().toISOString(),
      project_id: 'test-project'
    };
    
    const savedRun = await fileStore.saveProcessingRun(run);
    assert.equal(savedRun.id, run.id, '处理运行ID应匹配');
    assert.equal(savedRun.status, run.status, '状态应匹配');
    
    // 获取处理运行
    const retrievedRun = await fileStore.getProcessingRunById(savedRun.id);
    assert.equal(retrievedRun.id, savedRun.id, '处理运行ID应匹配');
  });
  
  it('should save and get a batch job', async () => {
    // 保存批处理作业
    const batch = { ...testBatch, id: uuidv4() };
    const savedBatch = await fileStore.saveLocalBatchTracker(batch);
    
    assert.equal(savedBatch.openai_batch_id, batch.openai_batch_id, 'OpenAI批处理ID应匹配');
    assert.equal(savedBatch.status, batch.status, '状态应匹配');
    
    // 获取批处理作业
    const retrievedBatch = await fileStore.getLocalBatchTrackerById(savedBatch.id);
    assert.equal(retrievedBatch.id, savedBatch.id, '批处理作业ID应匹配');
  });
  
  it('should update a file status', async () => {
    // 创建文件
    const file = { ...testFile, id: uuidv4() };
    const savedFile = await fileStore.saveFile(file);
    
    // 更新状态
    const updatedFile = await fileStore.updateFileStatus(savedFile.id, 'processing');
    assert.equal(updatedFile.status, 'processing', '状态应更新为processing');
    
    // 获取文件
    const retrievedFile = await fileStore.getFileById(savedFile.id);
    assert.equal(retrievedFile.status, 'processing', '状态应保持为processing');
  });
  
  it('should update an identifier with a new name', async () => {
    // 创建标识符
    const identifier = { ...testIdentifier, id: uuidv4() };
    const savedIdentifier = await fileStore.saveIdentifier(identifier);
    
    // 更新名称
    const updatedIdentifier = await fileStore.updateIdentifier(savedIdentifier.id, {
      new_name: 'renamed',
      status: 'completed'
    });
    
    assert.equal(updatedIdentifier.new_name, 'renamed', '新名称应匹配');
    assert.equal(updatedIdentifier.status, 'completed', '状态应更新为completed');
    
    // 获取标识符
    const retrievedIdentifier = await fileStore.getIdentifierById(savedIdentifier.id);
    assert.equal(retrievedIdentifier.new_name, 'renamed', '新名称应保持不变');
  });
});

// Vitest compatible tests
vitestDescribe('File Store Tests (Vitest)', () => {
  vitestIt('should have file store functionality available', () => {
    expect(fileStore).toBeDefined();
    expect(typeof fileStore.initializeDataStore).toBe('function');
    expect(typeof fileStore.saveFile).toBe('function');
    expect(typeof fileStore.getFileById).toBe('function');
  });
}); 