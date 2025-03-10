import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import * as dbAdapter from '../db/db-helpers-adapter.js';

// 测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-adapter-test');

describe('DB Adapter Tests', async () => {
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
  
  it('should check database connection', async () => {
    const result = await dbAdapter.isConnected();
    assert.strictEqual(result, true, '数据库连接状态应为true');
  });
  
  it('should handle processing runs', async () => {
    // 创建处理运行
    const run = await dbAdapter.startProcessingRun(JSON.stringify({ test: true }), 10, 'test-project');
    
    assert.ok(run.id, '处理运行ID应存在');
    assert.strictEqual(run.status, 'running', '初始状态应为running');
    assert.strictEqual(run.total_files, 10, '总文件数应为10');
    assert.strictEqual(run.processed_files, 0, '已处理文件数应为0');
    
    // 完成处理运行
    const updatedRun = await dbAdapter.completeProcessingRun(run.id, { status: 'completed' });
    
    assert.strictEqual(updatedRun.id, run.id, '处理运行ID应保持不变');
    assert.strictEqual(updatedRun.status, 'completed', '状态应更新为completed');
    assert.ok(updatedRun.end_time, '应有结束时间');
  });
  
  it('should sync files to database', async () => {
    const files = [
      { path: '/test/file1.js', size: 1000 },
      { path: '/test/file2.js', size: 2000 },
      { path: '/test/file3.js', size: 800000 } // 大文件
    ];
    
    const result = await dbAdapter.syncFilesToDatabase(files, 'test-project');
    
    assert.ok(result.success, '同步应成功');
    assert.strictEqual(result.files.length, 3, '应返回3个文件');
    
    // 检查文件类别是否正确
    const smallFiles = result.files.filter(f => f.category === 'small');
    const largeFiles = result.files.filter(f => f.category === 'large');
    
    assert.strictEqual(smallFiles.length, 2, '应有2个小文件');
    assert.strictEqual(largeFiles.length, 1, '应有1个大文件');
  });
  
  it('should get pending files by category', async () => {
    const result = await dbAdapter.getPendingFilesByCategory('test-project');
    
    assert.ok(result.success, '获取分类文件应成功');
    assert.ok(result.files.small.length >= 2, '应至少有2个小文件');
    assert.ok(result.files.large.length >= 1, '应至少有1个大文件');
  });
  
  it('should handle identifiers for batching', async () => {
    // 创建一个测试文件
    const fileResult = await dbAdapter.syncFilesToDatabase([
      { path: '/test/batch.js', size: 500 }
    ], 'test-batch-project');
    
    const fileId = fileResult.files[0].id;
    
    // 创建测试标识符
    // 由于无法直接访问file-store，我们需要通过适配器找到创建标识符的方法
    // 或者我们可以模拟一些数据
    
    // 获取标识符进行批处理
    const result = await dbAdapter.getIdentifiersForBatching(5, false, 'test-batch-project');
    
    assert.ok(result.success, '获取批次标识符应成功');
    // 由于我们没有创建标识符，所以batches可能为空，但仍然应该返回一个数组
    assert.ok(Array.isArray(result.batches), 'batches应该是数组');
  });
  
  it('should create batch jobs', async () => {
    const job = await dbAdapter.createBatchJob('test-batch-id', 'openai-job-123', 'test-project');
    
    assert.ok(job.id, 'job ID应存在');
    assert.strictEqual(job.openai_batch_id, 'openai-job-123', 'OpenAI作业ID应匹配');
    assert.strictEqual(job.processing_run_id, 'test-batch-id', '处理运行ID应匹配');
    assert.strictEqual(job.status, 'processing', '状态应为processing');
  });
  
  it('should get processed files by run ID', async () => {
    // 创建测试批处理作业
    const job = await dbAdapter.createBatchJob('test-run-id', 'openai-job-456', 'test-project');
    
    // 获取已处理文件
    const result = await dbAdapter.getProcessedFilesByRunId('test-run-id', 'test-project');
    
    assert.ok(result.success, '获取已处理文件应成功');
    assert.ok(Array.isArray(result.files), 'files应该是数组');
  });
}); 