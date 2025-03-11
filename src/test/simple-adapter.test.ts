import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import * as dbAdapter from '../db/db-helpers-adapter.js';

// 测试目录
const TEST_DIR: string = path.join(process.cwd(), '.tmp-adapter-test');

// 定义类型接口
interface ProcessingRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  total_files: number;
  processed_files: number;
  end_time?: Date;
}

interface DatabaseFile {
  id: string;
  path: string;
  size: number;
  category: 'small' | 'large' | 'ultra_large';
}

interface FileInput {
  path: string;
  size: number;
}

interface BatchJob {
  id: string;
  openai_batch_id: string;
  processing_run_id: string;
  status: 'processing' | 'completed' | 'failed';
}

interface DatabaseResult<T> {
  success: boolean;
  error?: string;
  files: T[];
}

interface CategoryResult {
  success: boolean;
  error?: string;
  files: {
    small: DatabaseFile[];
    large: DatabaseFile[];
    ultra_large: DatabaseFile[];
  };
}

describe('DB Adapter Tests', () => {
  // 清理测试目录（如果存在）
  beforeAll(async () => {
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
  it('should initialize database', async () => {
    const result = await dbAdapter.initializeDatabase();
    expect(result === undefined || result).toBeTruthy();
  });

  // 测试数据库连接状态
  it('should check database connection', async () => {
    const result: boolean = await dbAdapter.isConnected();
    expect(result).toBe(true);
  });

  // 测试处理运行
  it('should handle processing runs', async () => {
    // 创建处理运行
    const run: ProcessingRun = await dbAdapter.startProcessingRun(JSON.stringify({ test: true }), 10, 'test-project');
    
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('running');
    expect(run.total_files).toBe(10);
    expect(run.processed_files).toBe(0);
    
    // 完成处理运行
    const updatedRun: ProcessingRun = await dbAdapter.completeProcessingRun(run.id, { status: 'completed' });
    
    expect(updatedRun.id).toBe(run.id);
    expect(updatedRun.status).toBe('completed');
    expect(updatedRun.end_time).toBeTruthy();
  });

  // 测试同步文件
  it('should sync files to database', async () => {
    const files: FileInput[] = [
      { path: '/test/file1.js', size: 1000 },
      { path: '/test/file2.js', size: 2000 },
      { path: '/test/file3.js', size: 800000 } // 大文件
    ];
    
    const result: DatabaseResult<DatabaseFile> = await dbAdapter.syncFilesToDatabase(files, 'test-project');
    
    expect(result.success).toBeTruthy();
    expect(result.files.length).toBe(3);
    
    // 检查文件类别是否正确
    const smallFiles = result.files.filter(f => f.category === 'small');
    const largeFiles = result.files.filter(f => f.category === 'large');
    
    expect(smallFiles.length).toBe(2);
    expect(largeFiles.length).toBe(1);
  });

  // 测试获取分类文件
  it('should get pending files by category', async () => {
    const result: CategoryResult = await dbAdapter.getPendingFilesByCategory('test-project');
    
    expect(result.success).toBeTruthy();
    expect(result.files.small.length).toBeGreaterThanOrEqual(2);
    expect(result.files.large.length).toBeGreaterThanOrEqual(1);
  });

  // 测试创建批处理作业
  it('should create batch jobs', async () => {
    const job: BatchJob = await dbAdapter.createBatchJob('test-batch-id', 'openai-job-123', 'test-project');
    
    expect(job.id).toBeTruthy();
    expect(job.openai_batch_id).toBe('openai-job-123');
    expect(job.processing_run_id).toBe('test-batch-id');
    expect(job.status).toBe('processing');
  });

  // 清理测试数据
  afterAll(async () => {
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
}); 