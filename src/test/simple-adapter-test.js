import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import * as dbAdapter from '../db/db-helpers-adapter.js';

// 测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-adapter-test');

// 清理测试目录（如果存在）
test('setup', async (t) => {
  try {
    await fs.remove(TEST_DIR);
  } catch (error) {
    // 忽略错误
  }
  
  // 创建测试目录
  await fs.ensureDir(TEST_DIR);
  
  // 设置数据目录
  process.env.DATA_DIR = TEST_DIR;
});

// 测试初始化数据库
test('should initialize database', async (t) => {
  const result = await dbAdapter.initializeDatabase();
  assert.ok(result === undefined || result, '初始化数据库应成功');
});

// 测试数据库连接状态
test('should check database connection', async (t) => {
  const result = await dbAdapter.isConnected();
  assert.strictEqual(result, true, '数据库连接状态应为true');
});

// 测试处理运行
test('should handle processing runs', async (t) => {
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

// 测试同步文件
test('should sync files to database', async (t) => {
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

// 测试获取分类文件
test('should get pending files by category', async (t) => {
  const result = await dbAdapter.getPendingFilesByCategory('test-project');
  
  assert.ok(result.success, '获取分类文件应成功');
  assert.ok(result.files.small.length >= 2, '应至少有2个小文件');
  assert.ok(result.files.large.length >= 1, '应至少有1个大文件');
});

// 测试创建批处理作业
test('should create batch jobs', async (t) => {
  const job = await dbAdapter.createBatchJob('test-batch-id', 'openai-job-123', 'test-project');
  
  assert.ok(job.id, 'job ID应存在');
  assert.strictEqual(job.openai_batch_id, 'openai-job-123', 'OpenAI作业ID应匹配');
  assert.strictEqual(job.processing_run_id, 'test-batch-id', '处理运行ID应匹配');
  assert.strictEqual(job.status, 'processing', '状态应为processing');
});

// 清理测试数据
test('cleanup', async (t) => {
  await fs.remove(TEST_DIR);
  process.env.DATA_DIR = '';
}); 