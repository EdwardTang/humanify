import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import * as fileStore from '../db/file-store.js';
import * as dbAdapter from '../db/db-helpers-adapter.js';

// 模拟模块以避免真实API调用
jest.mock('../rename/batch-optimizer.js', () => ({
  BatchOptimizer: jest.fn().mockImplementation(() => ({
    processBatch: jest.fn().mockResolvedValue({ processed: 5, total: 5 }),
    submitBatchJob: jest.fn().mockResolvedValue({ 
      jobId: 'mock-job-123', 
      tasksFilePath: '/mock/tasks.jsonl' 
    })
  }))
}));

jest.mock('../unminify/webcrack-unminifier.js', () => ({
  unminifyWithWebCrack: jest.fn().mockImplementation(async (code, outputDir) => {
    // 模拟解混淆过程
    await fs.ensureDir(outputDir);
    await fs.writeFile(
      path.join(outputDir, 'module1.js'), 
      'function test() { const a = 1; return a; }'
    );
    return [{ path: path.join(outputDir, 'module1.js'), size: 100 }];
  })
}));

// 测试目录和文件
const TEST_DIR = path.join(process.cwd(), '.tmp-full-cycle-test');
const SOURCE_FILE = path.join(TEST_DIR, 'source.min.js');
const OUTPUT_DIR = path.join(TEST_DIR, 'output');

describe('Full Cycle Unminify Integration Test', async () => {
  before(async () => {
    // 创建测试目录结构
    await fs.ensureDir(TEST_DIR);
    await fs.ensureDir(OUTPUT_DIR);
    
    // 创建测试源文件
    await fs.writeFile(SOURCE_FILE, 'function a(){var b=1;return b}');
    
    // 设置数据目录
    process.env.DATA_DIR = path.join(TEST_DIR, 'data');
    await fs.ensureDir(process.env.DATA_DIR);
    
    // 初始化数据存储
    await fileStore.initializeDataStore();
    
    // 创建测试项目
    await fileStore.saveProject({
      name: 'Test Project',
      version: '1.0.0',
      distro: 'test',
      author: 'Tester',
      is_active: true
    });
  });
  
  after(async () => {
    // 清理测试目录
    await fs.remove(TEST_DIR);
    process.env.DATA_DIR = '';
  });
  
  it('should run base command successfully', async () => {
    // 运行命令
    const result = await runCommand('node', [
      'bin/index.js',
      'full-cycle',
      `--sourceFile=${SOURCE_FILE}`,
      `--outputDir=${OUTPUT_DIR}`,
      '--apiKey=test-api-key',
      '--batchSize=10',
      '--concurrency=2'
    ]);
    
    // 验证命令输出
    assert.ok(
      result.stdout.includes('全周期处理完成') || 
      result.stdout.includes('processing completed'),
      '输出应包含成功信息'
    );
    
    // 验证输出文件是否存在
    const outputFiles = await fs.readdir(OUTPUT_DIR);
    assert.ok(outputFiles.length > 0, '输出目录应有文件');
  });
  
  it('should run individual phases correctly', async () => {
    // 导入full-cycle-unminify模块
    const { 
      unminifyPhase, 
      identifierAnalysisPhase, 
      identifierRenamingPhase,
      codeGenerationPhase
    } = await import('../commands/full-cycle-unminify.js');
    
    // 1. 解混淆阶段
    const extractedFiles = await unminifyPhase(SOURCE_FILE, OUTPUT_DIR);
    assert.ok(Array.isArray(extractedFiles), '解混淆应返回文件数组');
    assert.ok(extractedFiles.length > 0, '应至少有一个提取的文件');
    
    // 2. 标识符分析阶段
    const options = {
      sourceFile: SOURCE_FILE,
      outputDir: OUTPUT_DIR,
      apiKey: 'test-api-key',
      batchSize: 10,
      concurrency: 2
    };
    
    const runId = 'test-run-id';
    await identifierAnalysisPhase(extractedFiles, options, runId);
    
    // 检查是否创建了标识符
    const files = await fileStore.getFilesByProjectId('');
    assert.ok(files.length > 0, '应有文件记录');
    
    // 添加一些测试标识符
    const file = files[0];
    await fileStore.saveIdentifier({
      file_id: file.id,
      original_name: 'a',
      surrounding_code: 'function test() { const a = 1; return a; }',
      status: 'pending',
      custom_id: 'test-id-1',
      project_id: ''
    });
    
    await fileStore.saveIdentifier({
      file_id: file.id,
      original_name: 'b',
      surrounding_code: 'const b = 2;',
      status: 'pending',
      custom_id: 'test-id-2',
      project_id: ''
    });
    
    // 3. 标识符重命名阶段
    await identifierRenamingPhase(options, runId);
    
    // 4. 代码生成阶段
    await codeGenerationPhase(OUTPUT_DIR, runId);
    
    // 验证输出结果
    assert.ok(await fs.pathExists(path.join(OUTPUT_DIR, 'module1.js')), '输出文件应存在');
  });
  
  it('should submit long-running batch jobs', async () => {
    // 导入需要的函数
    const { submitBatchJobsPhase } = await import('../commands/full-cycle-unminify.js');
    
    // 创建测试环境
    const options = {
      sourceFile: SOURCE_FILE,
      outputDir: OUTPUT_DIR,
      apiKey: 'test-api-key',
      batchSize: 10,
      concurrency: 2,
      longRunning: true
    };
    
    const runId = 'test-long-run-id';
    
    // 创建文件
    const file = await fileStore.saveFile({
      path: path.join(OUTPUT_DIR, 'long-test.js'),
      file_name: 'long-test.js',
      file_type: 'js',
      size: 1000,
      status: 'pending',
      category: 'small',
      project_id: ''
    });
    
    // 创建测试标识符
    for (let i = 0; i < 15; i++) {
      await fileStore.saveIdentifier({
        file_id: file.id,
        original_name: `var${i}`,
        surrounding_code: `const var${i} = ${i};`,
        status: 'pending',
        custom_id: `long-id-${i}`,
        project_id: ''
      });
    }
    
    // 执行长时间运行的批处理提交
    await submitBatchJobsPhase(options, runId);
    
    // 验证批处理跟踪记录
    const trackers = await fileStore.getLocalBatchTrackersByStatus('processing');
    assert.ok(trackers.length > 0, '应创建批处理跟踪记录');
    assert.equal(trackers[0].status, 'processing', '批处理状态应为processing');
  });
});

/**
 * 运行命令并返回结果
 * @param {string} command - 命令
 * @param {string[]} args - 参数
 * @returns {Promise<{stdout: string, stderr: string, code: number}>} 命令结果
 */
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: true });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        code
      });
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
} 