#!/usr/bin/env node
// staged-humanify-db.ts - 数据库集成版分阶段增量处理大型代码库

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import { fork } from 'child_process';
import * as glob from 'glob';
import * as readline from 'readline';

// 导入数据库助手
import * as dbHelpers from '../db/helpers';
import { File, Batch, Identifier, ProcessingRun, db } from '../db/models';

// 导入文件分块处理器
interface ChunkLargeFileModule {
  chunkLargeFile: (
    filePath: string, 
    outputDir: string, 
    chunkSize?: number, 
    preserveStructure?: boolean
  ) => Promise<{
    chunkFiles: string[],
    listFilePath: string,
    metaFilePath: string,
    metadata: any
  }>;
}

let chunkLargeFile: ChunkLargeFileModule['chunkLargeFile'] | null;
try {
  const largeFileChunker = require('../large-file-chunker') as ChunkLargeFileModule;
  chunkLargeFile = largeFileChunker.chunkLargeFile;
} catch (error) {
  console.log('⚠️ 文件分块器模块未找到，将使用内置功能');
  chunkLargeFile = null;
}

/**
 * 数据库集成分阶段增量处理器 (Database-Integrated Staged Incremental Processor)
 * 
 * 这个脚本实现以下改进：
 * 1. 分阶段处理：
 *   - 先处理较小的文件集合
 *   - 为大型文件单独运行处理，使用更低的并行度和更小的批处理大小
 * 2. 增量处理：
 *   - 分批处理文件，避免一次加载所有文件到内存
 * 3. 数据库集成：
 *   - 使用SQLite存储文件和处理状态
 *   - 跟踪批次和处理进度
 *   - 存储标识符和处理结果
 */

// 配置接口
interface Config {
  sourceDir: string;
  outputDir: string;
  largeFileSizeThreshold: number;
  ultraLargeFileSizeThreshold: number;
  smallFileBatchSize: number;
  smallFileParallelism: number;
  largeFileBatchSize: number;
  largeFileParallelism: number;
  dryRun: boolean;
  filePattern: string;
  excludePatterns: string[];
  maxBatchSize: number;
  verbose: boolean;
}

// 文件对象接口
interface FileObject {
  path: string;
  size: number;
  id?: string;
}

// 配置
const CONFIG: Config = {
  sourceDir: 'test-cursor-large',
  outputDir: 'output-staged',
  largeFileSizeThreshold: 200 * 1024, // 200KB
  ultraLargeFileSizeThreshold: 1024 * 1024, // 1MB
  smallFileBatchSize: 5,
  smallFileParallelism: 4,
  largeFileBatchSize: 2,
  largeFileParallelism: 2,
  dryRun: false,
  filePattern: '**/*.js',
  excludePatterns: ['**/node_modules/**', '**/build/**'],
  maxBatchSize: 50,
  verbose: true
};

// 处理计时器
const timer = {
  startTime: null as number | null,
  start() {
    this.startTime = Date.now();
  },
  getElapsedSeconds() {
    if (!this.startTime) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  },
  formatElapsed() {
    return formatTime(this.getElapsedSeconds());
  }
};

/**
 * 查找匹配的文件
 * @returns {Promise<FileObject[]>} 匹配的文件数组，每个对象包含path和size属性
 */
async function findMatchingFiles(): Promise<FileObject[]> {
  console.log(`🔍 搜索目录: ${CONFIG.sourceDir}`);
  const files = glob.sync(CONFIG.filePattern, {
    cwd: CONFIG.sourceDir,
    ignore: CONFIG.excludePatterns,
    absolute: true
  });

  const fileObjects: FileObject[] = [];
  for (const file of files) {
    const stats = fs.statSync(file);
    fileObjects.push({
      path: file,
      size: stats.size
    });
  }

  console.log(`📁 找到 ${fileObjects.length} 个匹配文件`);
  return fileObjects;
}

/**
 * 根据文件大小对文件进行分类
 * @param {FileObject[]} files - 文件对象数组
 * @returns {Promise<Record<string, FileObject[]>>} 分类结果，包含small、large和ultra_large三类文件
 */
async function categorizeFilesBySize(files: FileObject[]): Promise<Record<string, FileObject[]>> {
  // 同步文件到数据库
  console.log(`🔄 同步文件到数据库...`);
  const syncResult = await dbHelpers.syncFilesToDatabase(files);
  
  console.log(`✅ 文件同步完成: 总共 ${syncResult.total} 个文件, 新建 ${syncResult.created} 个记录`);
  
  // 从数据库获取待处理文件，按类别分组
  console.log(`🔍 获取待处理文件...`);
  const pendingFiles = await dbHelpers.getPendingFilesByCategory();
  
  if (pendingFiles.success) {
    console.log(`📊 待处理文件统计:`);
    console.log(`  - 小文件: ${pendingFiles.categories.small} 个`);
    console.log(`  - 大文件: ${pendingFiles.categories.large} 个`);
    console.log(`  - 超大文件: ${pendingFiles.categories.ultra_large} 个`);
  } else {
    console.error(`❌ 获取待处理文件失败: ${pendingFiles.error}`);
    process.exit(1);
  }
  
  return pendingFiles.files;
}

/**
 * 将文件列表分块为批次
 * @param {FileObject[]} files - 文件对象数组
 * @param {number} batchSize - 每批次的文件数量
 * @returns {FileObject[][]} 分块后的文件批次数组
 */
function chunkFiles(files: FileObject[], batchSize: number): FileObject[][] {
  const chunks: FileObject[][] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    chunks.push(files.slice(i, i + batchSize));
  }
  return chunks;
}

/**
 * 为批次创建命令
 * @param {FileObject[]} files - 批次中的文件对象数组
 * @param {boolean} isLargeFiles - 是否为大文件
 * @param {boolean} isUltraLargeFiles - 是否为超大文件
 * @returns {string} 命令字符串
 */
function buildCommand(files: FileObject[], isLargeFiles = false, isUltraLargeFiles = false): string {
  // 根据文件类型选择配置
  let parallelism = CONFIG.smallFileParallelism;
  let batchSize = CONFIG.smallFileBatchSize;
  
  if (isUltraLargeFiles) {
    parallelism = 1;
    batchSize = 1;
  } else if (isLargeFiles) {
    parallelism = CONFIG.largeFileParallelism;
    batchSize = CONFIG.largeFileBatchSize;
  }
  
  // 构建文件ID列表
  const fileIds = files.map(file => file.id).join(',');
  
  // 构建命令
  return `node process-files.js --parallelism ${parallelism} --batch-size ${batchSize} --file-ids ${fileIds}`;
}

/**
 * 处理文件批次
 * @param {FileObject[]} files - 批次中的文件对象数组
 * @param {number} index - 批次索引
 * @param {boolean} isLargeFiles - 是否为大文件
 * @param {boolean} isUltraLargeFiles - 是否为超大文件
 * @returns {Promise<void>}
 */
async function processFileBatch(files: FileObject[], index: number, isLargeFiles = false, isUltraLargeFiles = false): Promise<void> {
  // 确定批次类型
  const batchType = isUltraLargeFiles ? 'ultra_large' : (isLargeFiles ? 'large' : 'small');
  
  // 构建命令
  const command = buildCommand(files, isLargeFiles, isUltraLargeFiles);
  
  // 打印批次信息
  console.log(`\n📦 批次 #${index + 1} (${batchType}): 处理 ${files.length} 个文件`);
  
  // 创建批次记录
  console.log(`🔄 创建批次记录...`);
  const batchResult = await dbHelpers.createBatch(batchType, files, command);
  
  if (!batchResult.success) {
    console.error(`❌ 创建批次失败: ${batchResult.error}`);
    return;
  }
  
  const batchId = batchResult.batch.id;
  console.log(`✅ 批次创建成功，ID: ${batchId}`);
  
  // 如果是演示模式，打印命令并返回
  if (CONFIG.dryRun) {
    console.log(`🔍 演示模式，将执行命令: ${command}`);
    
    // 更新运行进度
    await dbHelpers.updateProcessingRunProgress(currentRunId, 0, 0);
    
    return;
  }
  
  // 更新批次状态为处理中
  await dbHelpers.updateBatchStatus(batchId, 'processing');
  
  // 开始计时
  const batchStartTime = Date.now();
  
  // 执行命令
  try {
    console.log(`🚀 执行命令: ${command}`);
    
    // TODO: 实际执行命令的逻辑
    // 这里模拟执行命令，实际项目中应替换为真实的执行逻辑
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 计算处理时间
    const processingTime = Math.floor((Date.now() - batchStartTime) / 1000);
    
    // 更新批次状态为已完成
    await dbHelpers.updateBatchStatus(batchId, 'completed');
    
    // 标记文件为已处理
    for (const file of files) {
      await dbHelpers.markFileAsProcessed(file.id!, processingTime);
    }
    
    // 更新运行进度
    await dbHelpers.updateProcessingRunProgress(currentRunId, files.length, 0);
    
    console.log(`✅ 批次处理完成，耗时: ${formatTime(processingTime)}`);
  } catch (error) {
    console.error(`❌ 批次处理失败: ${error instanceof Error ? error.message : String(error)}`);
    
    // 更新批次状态为失败
    await dbHelpers.updateBatchStatus(batchId, 'failed', error instanceof Error ? error.message : String(error));
    
    // 标记文件为失败
    for (const file of files) {
      await dbHelpers.markFileAsProcessed(file.id!, null, error instanceof Error ? error.message : String(error));
    }
    
    // 更新运行进度
    await dbHelpers.updateProcessingRunProgress(currentRunId, 0, files.length);
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(): void {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--source-dir' && i + 1 < args.length) {
      CONFIG.sourceDir = args[++i];
    } else if (arg === '--output-dir' && i + 1 < args.length) {
      CONFIG.outputDir = args[++i];
    } else if (arg === '--dry-run') {
      CONFIG.dryRun = true;
    } else if (arg === '--verbose') {
      CONFIG.verbose = true;
    } else if (arg === '--file-pattern' && i + 1 < args.length) {
      CONFIG.filePattern = args[++i];
    } else if (arg === '--small-batch-size' && i + 1 < args.length) {
      CONFIG.smallFileBatchSize = parseInt(args[++i], 10);
    } else if (arg === '--large-batch-size' && i + 1 < args.length) {
      CONFIG.largeFileBatchSize = parseInt(args[++i], 10);
    } else if (arg === '--small-parallelism' && i + 1 < args.length) {
      CONFIG.smallFileParallelism = parseInt(args[++i], 10);
    } else if (arg === '--large-parallelism' && i + 1 < args.length) {
      CONFIG.largeFileParallelism = parseInt(args[++i], 10);
    } else if (arg === '--large-threshold' && i + 1 < args.length) {
      CONFIG.largeFileSizeThreshold = parseInt(args[++i], 10) * 1024; // 转换为字节
    } else if (arg === '--ultra-large-threshold' && i + 1 < args.length) {
      CONFIG.ultraLargeFileSizeThreshold = parseInt(args[++i], 10) * 1024; // 转换为字节
    } else if (arg === '--help') {
      console.log(`
使用方法: node staged-humanify-db.js [选项]

选项:
  --source-dir <目录>            源代码目录，默认: test-cursor-large
  --output-dir <目录>            输出目录，默认: output-staged
  --file-pattern <模式>          文件匹配模式，默认: **/*.js
  --small-batch-size <数字>      小文件批次大小，默认: 5
  --large-batch-size <数字>      大文件批次大小，默认: 2
  --small-parallelism <数字>     小文件并行度，默认: 4
  --large-parallelism <数字>     大文件并行度，默认: 2
  --large-threshold <KB>         大文件阈值(KB)，默认: 200
  --ultra-large-threshold <KB>   超大文件阈值(KB)，默认: 1024
  --dry-run                      仅输出命令，不执行
  --verbose                      详细输出
  --help                         显示帮助信息
      `);
      process.exit(0);
    }
  }
}

// 当前处理运行ID
let currentRunId: string | null = null;

/**
 * 主函数
 */
async function main(): Promise<void> {
  parseArgs();
  
  try {
    console.log(`
🚀 数据库集成分阶段增量处理器 (Database-Integrated Staged Incremental Processor)
配置:
  源目录: ${CONFIG.sourceDir}
  输出目录: ${CONFIG.outputDir}
  大文件阈值: ${CONFIG.largeFileSizeThreshold / 1024}KB
  超大文件阈值: ${CONFIG.ultraLargeFileSizeThreshold / 1024}KB
  小文件批次大小: ${CONFIG.smallFileBatchSize}
  大文件批次大小: ${CONFIG.largeFileBatchSize}
  小文件并行度: ${CONFIG.smallFileParallelism}
  大文件并行度: ${CONFIG.largeFileParallelism}
  演示模式: ${CONFIG.dryRun ? '是' : '否'}
  详细输出: ${CONFIG.verbose ? '是' : '否'}
    `);
    
    // 初始化数据库
    console.log(`🔄 初始化数据库...`);
    const dbStatus = await dbHelpers.initializeDatabase();
    
    if (!dbStatus.initialized) {
      console.error(`❌ 数据库初始化失败: ${dbStatus.error}`);
      process.exit(1);
    }
    
    console.log(`✅ 数据库初始化成功`);
    
    // 确保输出目录存在
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    
    // 开始整体计时
    timer.start();
    
    // 查找匹配的文件
    const files = await findMatchingFiles();
    
    if (files.length === 0) {
      console.log(`⚠️ 未找到匹配的文件`);
      return;
    }
    
    // 创建处理运行记录
    console.log(`🔄 创建处理运行记录...`);
    const runResult = await dbHelpers.startProcessingRun(CONFIG, files.length);
    
    if (!runResult.success) {
      console.error(`❌ 创建处理运行记录失败: ${runResult.error}`);
      process.exit(1);
    }
    
    currentRunId = runResult.run_id;
    console.log(`✅ 处理运行记录创建成功，ID: ${currentRunId}`);
    
    // 根据文件大小进行分类
    const filesByCategory = await categorizeFilesBySize(files);
    
    // 记录性能指标 - 内存使用
    await dbHelpers.recordPerformanceMetric(
      currentRunId,
      'initial_memory',
      process.memoryUsage().heapUsed / 1024 / 1024,
      'MB',
      { timestamp: new Date().toISOString() }
    );
    
    // 先处理小文件
    if (filesByCategory.small.length > 0) {
      console.log(`\n🔄 第1阶段: 处理小文件 (${filesByCategory.small.length} 个文件)`);
      
      const smallFileBatches = chunkFiles(filesByCategory.small, CONFIG.maxBatchSize);
      
      for (let i = 0; i < smallFileBatches.length; i++) {
        await processFileBatch(smallFileBatches[i], i, false, false);
      }
      
      console.log(`✅ 小文件处理完成`);
    }
    
    // 然后处理大文件
    if (filesByCategory.large.length > 0) {
      console.log(`\n🔄 第2阶段: 处理大文件 (${filesByCategory.large.length} 个文件)`);
      
      const largeFileBatches = chunkFiles(filesByCategory.large, CONFIG.maxBatchSize);
      
      for (let i = 0; i < largeFileBatches.length; i++) {
        await processFileBatch(largeFileBatches[i], i, true, false);
      }
      
      console.log(`✅ 大文件处理完成`);
    }
    
    // 最后处理超大文件
    if (filesByCategory.ultra_large.length > 0) {
      console.log(`\n🔄 第3阶段: 处理超大文件 (${filesByCategory.ultra_large.length} 个文件)`);
      
      // 超大文件单独处理
      for (let i = 0; i < filesByCategory.ultra_large.length; i++) {
        await processFileBatch([filesByCategory.ultra_large[i]], i, false, true);
      }
      
      console.log(`✅ 超大文件处理完成`);
    }
    
    // 获取处理统计信息
    const stats = await dbHelpers.getProcessingStats();
    
    // 完成处理运行
    await dbHelpers.completeProcessingRun(currentRunId, {
      processed_files: stats.files.processed,
      failed_files: stats.files.total - stats.files.processed
    });
    
    // 记录最终内存使用
    await dbHelpers.recordPerformanceMetric(
      currentRunId,
      'final_memory',
      process.memoryUsage().heapUsed / 1024 / 1024,
      'MB',
      { timestamp: new Date().toISOString() }
    );
    
    // 打印总结信息
    console.log(`\n📊 处理摘要:`);
    console.log(`  - 总文件数: ${stats.files.total}`);
    console.log(`  - 已处理文件: ${stats.files.processed}`);
    console.log(`  - 批次数: ${stats.batches.total}`);
    console.log(`  - 总处理时间: ${timer.formatElapsed()}`);
    
    if (CONFIG.dryRun) {
      console.log(`\n⚠️ 这是演示模式，未实际执行处理。`);
    }
    
    console.log(`\n✅ 处理完成！`);
  } catch (error) {
    console.error(`\n❌ 处理过程中出错:`, error);
    
    // 如果有当前运行ID，标记运行为失败
    if (currentRunId) {
      await dbHelpers.completeProcessingRun(currentRunId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        processed_files: 0,
        failed_files: 0
      });
    }
    
    process.exit(1);
  } finally {
    // 关闭数据库连接
    await db.getDbInstance().destroy();
  }
}

/**
 * 格式化时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  
  return [
    hours > 0 ? `${hours}小时` : '',
    minutes > 0 ? `${minutes}分钟` : '',
    `${remainingSeconds}秒`
  ].filter(Boolean).join(' ');
}

// 执行主函数
main(); 