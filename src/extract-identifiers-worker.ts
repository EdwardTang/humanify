#!/usr/bin/env node
// extract-identifiers-worker.ts - 子进程工作脚本，用于处理超大文件

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import { ChildProcess } from 'child_process';

// 声明全局垃圾回收函数类型
declare global {
  namespace NodeJS {
    interface Global {
      gc?: () => void;
    }
  }
}

// 进度信息接口
interface ProgressInfo {
  type: 'progress';
  lineCount: number;
  totalLines: number;
  percent: string;
  identifierCount: number;
  memoryUsage: number;
  peakMemoryUsage: number;
  elapsedSeconds: number;
  linesPerSecond: number;
  bytesPerSecond: number;
  estimatedTotalSeconds: number;
}

// 处理结果接口
interface ProcessResult {
  type: 'result';
  identifiers: string[];
  stats: {
    totalLines: number;
    processedLines: number;
    identifierCount: number;
    fileSizeMB: string;
    processingTimeSeconds: number;
    memoryPeakMB: number;
  };
}

// 错误信息接口
interface ErrorInfo {
  type: 'error';
  error: string;
  stack?: string;
}

// 进度统计信息接口
interface ProgressStats {
  totalBytes: number;
  processedBytes: number;
  bytesPerSecond: number;
  startTime: number;
  lineStartTime: number;
}

// 优化：添加缓存以减少重复处理
const keywordCache = new Set<string>();
const identifierCache = new Map<string, string[]>();

// 记录内存使用情况
const MEMORY_CHECK_INTERVAL = 5000; // 5秒检查一次内存
let lastMemoryCheck = Date.now();
let peakMemoryUsage = 0;

// 从行中提取标识符的辅助函数
function extractIdentifiersFromLine(line: string): string[] {
  // 缓存整行结果
  if (identifierCache.has(line)) {
    return identifierCache.get(line) || [];
  }
  
  const identifiers = new Set<string>();
  // 使用正则表达式提取标识符
  const regex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const word = match[0];
    
    // 使用缓存检查关键字
    if (!keywordCache.has(word) && !isJavaScriptKeyword(word)) {
      identifiers.add(word);
    }
  }
  
  const result = Array.from(identifiers);
  // 只缓存短行，避免内存占用过大
  if (line.length < 200) {
    identifierCache.set(line, result);
  }
  
  return result;
}

// 检查是否为JavaScript关键字
function isJavaScriptKeyword(word: string): boolean {
  // 如果已经在缓存中，直接返回
  if (keywordCache.has(word)) {
    return true;
  }
  
  const keywords = [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 
    'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 
    'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'let', 'static', 'enum', 'await', 'implements', 'package', 
    'protected', 'interface', 'private', 'public',
    // 常见的内置对象和函数
    'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Math', 
    'Number', 'Object', 'RegExp', 'String', 'Symbol', 'console', 'document',
    'window', 'global', 'process', 'require', 'module', 'exports'
  ];
  
  const isKeyword = keywords.includes(word);
  if (isKeyword) {
    keywordCache.add(word);
  }
  
  return isKeyword;
}

// 处理文件的主函数
async function processFile(filePath: string): Promise<void> {
  try {
    console.log(`[Worker] 开始处理文件: ${filePath}`);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    // 获取文件信息
    const stats = fs.statSync(filePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Worker] 文件大小: ${fileSizeMB}MB`);
    
    const startTime = Date.now();
    const identifiers = new Set<string>();
    const memoryUsage = { initial: process.memoryUsage().heapUsed / 1024 / 1024 };
    
    // 统计信息
    const progressStats: ProgressStats = {
      totalBytes: stats.size,
      processedBytes: 0,
      bytesPerSecond: 0,
      startTime: startTime,
      lineStartTime: startTime
    };
    
    // 异步计算总行数
    console.log(`[Worker] 计算文件总行数...`);
    const totalLines = await countFileLines(filePath);
    console.log(`[Worker] 文件共有 ${totalLines} 行`);
    
    // 发送开始消息
    process.send?.({ 
      type: 'start', 
      totalLines,
      fileSize: stats.size
    });
    
    // 创建读取流
    const fileStream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 1024 * 1024 // 使用1MB的缓冲区改善性能
    });
    
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let lineCount = 0;
    let lastReportTime = Date.now();
    let lineBytes = 0;
    
    // 检查内存使用的间隔函数
    const checkMemory = (): number => {
      const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      if (currentMemory > peakMemoryUsage) {
        peakMemoryUsage = currentMemory;
      }
      
      return currentMemory;
    };
    
    // 逐行处理文件
    for await (const line of rl) {
      lineBytes += line.length + 1; // +1 表示换行符
      progressStats.processedBytes += line.length + 1;
      
      // 提取当前行的标识符
      const lineIdentifiers = extractIdentifiersFromLine(line);
      for (const id of lineIdentifiers) {
        identifiers.add(id);
      }
      
      lineCount++;
      
      const now = Date.now();
      
      // 检查内存使用情况
      if (now - lastMemoryCheck > MEMORY_CHECK_INTERVAL) {
        checkMemory();
        lastMemoryCheck = now;
        
        // 如果内存过高，尝试手动触发垃圾回收
        if (peakMemoryUsage > 1500) { // 超过1.5GB
          if (global.gc) {
            console.log(`[Worker] 内存使用过高 (${peakMemoryUsage.toFixed(2)}MB)，触发垃圾回收`);
            global.gc();
          }
        }
      }
      
      // 每500行或每3秒报告一次进度
      if (lineCount % 500 === 0 || now - lastReportTime > 3000) {
        // 计算进度百分比
        const percent = ((lineCount / totalLines) * 100).toFixed(2);
        
        // 计算处理速度
        const elapsedSeconds = (now - progressStats.startTime) / 1000;
        const linesPerSecond = lineCount / elapsedSeconds;
        progressStats.bytesPerSecond = progressStats.processedBytes / elapsedSeconds;
        
        // 发送进度信息
        process.send?.({ 
          type: 'progress', 
          lineCount,
          totalLines,
          percent,
          identifierCount: identifiers.size,
          memoryUsage: checkMemory(),
          peakMemoryUsage,
          elapsedSeconds,
          linesPerSecond,
          bytesPerSecond: progressStats.bytesPerSecond,
          estimatedTotalSeconds: totalLines / linesPerSecond
        } as ProgressInfo);
        
        lastReportTime = now;
      }
    }
    
    // 计算处理时间
    const totalTime = (Date.now() - startTime) / 1000;
    
    // 发送最终的进度更新
    process.send?.({ 
      type: 'progress', 
      lineCount,
      totalLines,
      percent: 100,
      identifierCount: identifiers.size,
      memoryUsage: checkMemory(),
      peakMemoryUsage,
      elapsedSeconds: totalTime,
      linesPerSecond: lineCount / totalTime,
      bytesPerSecond: progressStats.processedBytes / totalTime,
      estimatedTotalSeconds: totalTime
    } as ProgressInfo);
    
    // 返回结果
    process.send?.({ 
      type: 'result', 
      identifiers: Array.from(identifiers),
      stats: {
        totalLines,
        processedLines: lineCount,
        identifierCount: identifiers.size,
        fileSizeMB: fileSizeMB,
        processingTimeSeconds: totalTime,
        memoryPeakMB: peakMemoryUsage
      }
    } as ProcessResult);
    
    console.log(`[Worker] 处理完成，清理资源...`);
    
    // 清理缓存，减少内存使用
    identifierCache.clear();
    keywordCache.clear();
    
    // 手动触发垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }
    
  } catch (error) {
    console.error(`[Worker] 错误: ${error instanceof Error ? error.message : String(error)}`);
    process.send?.({ 
      type: 'error', 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    } as ErrorInfo);
  }
}

// 计算文件总行数
async function countFileLines(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`[Worker] 开始计算文件行数: ${filePath}`);
    const startTime = Date.now();
    let lineCount = 0;
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 1024 * 1024 // 使用1MB的缓冲区
    });
    
    stream.on('error', reject);
    
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });
    
    rl.on('line', () => {
      lineCount++;
      
      // 每百万行打印一次进度
      if (lineCount % 1000000 === 0) {
        console.log(`[Worker] 已计数 ${(lineCount / 1000000).toFixed(1)}M 行...`);
      }
    });
    
    rl.on('close', () => {
      const duration = (Date.now() - startTime) / 1000;
      console.log(`[Worker] 文件行数计算完成: ${lineCount} 行，耗时 ${duration.toFixed(2)} 秒`);
      resolve(lineCount);
    });
  });
}

// 监听来自父进程的消息
process.on('message', (message: { type: string; filePath: string }) => {
  if (message.type === 'process') {
    const filePath = message.filePath;
    console.log(`[Worker] 收到处理文件请求: ${filePath}`);
    processFile(filePath);
  }
});

// 汇报工作进程准备就绪
console.log(`[Worker] 工作进程已启动`);
process.send?.({ type: 'ready' }); 