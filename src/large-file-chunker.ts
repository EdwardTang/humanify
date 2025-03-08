#!/usr/bin/env node
// large-file-chunker.ts - 将超大文件分割成可管理的小块

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

// 块文件元数据接口
interface ChunkMetadata {
  originalFile: string;
  originalSize: number;
  chunkSize: number;
  chunkCount: number;
  chunks: {
    path: string;
    size: number;
  }[];
  preserveStructure: boolean;
  timestamp: string;
}

// 分块结果接口
interface ChunkResult {
  chunkFiles: string[];
  listFilePath: string;
  metaFilePath: string;
  metadata: ChunkMetadata;
}

// 命令行参数接口
interface ChunkArgs {
  file: string;
  'output-dir': string;
  'chunk-size': number;
  'preserve-structure': boolean;
}

/**
 * 将大文件分割成多个小块
 * @param {string} filePath 文件路径
 * @param {string} outputDir 输出目录
 * @param {number} chunkSize 块大小（字节）
 * @param {boolean} preserveStructure 是否保留AST结构完整性
 * @returns {Promise<ChunkResult>} 分块文件路径列表
 */
async function chunkLargeFile(
  filePath: string, 
  outputDir: string, 
  chunkSize: number = 50 * 1024, 
  preserveStructure: boolean = true
): Promise<ChunkResult> {
  console.log(`🔪 开始对超大文件进行分块: ${filePath} (块大小: ${chunkSize / 1024}KB)`);
  
  // 确保输出目录存在
  const chunksDir = path.join(outputDir, 'chunks');
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }
  
  const filename = path.basename(filePath);
  const chunkFiles: string[] = [];
  
  // 创建读取流
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let chunkIndex = 0;
  let currentChunk: string[] = [];
  let currentSize = 0;
  let bracketBalance = 0; // 跟踪花括号平衡
  let scopeComplete = true;
  
  // 逐行读取文件
  for await (const line of rl) {
    // 如果启用结构保留，跟踪花括号平衡
    if (preserveStructure) {
      // 计算当前行的花括号平衡
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '{') bracketBalance++;
        if (line[i] === '}') bracketBalance--;
      }
      
      // 如果当前在一个不完整的作用域内
      if (bracketBalance !== 0) {
        scopeComplete = false;
      } else {
        scopeComplete = true;
      }
    }
    
    // 当块大小超过限制且作用域完整（如果启用结构保留）时，写入当前块
    if (currentSize + line.length > chunkSize && currentChunk.length > 0 && 
        (!preserveStructure || scopeComplete)) {
      
      // 写入当前块
      const chunkFilePath = path.join(chunksDir, `${filename}.chunk${chunkIndex}.js`);
      fs.writeFileSync(chunkFilePath, currentChunk.join('\n'));
      chunkFiles.push(chunkFilePath);
      
      console.log(`✅ 创建文件块 ${chunkIndex + 1}: ${chunkFilePath} (${currentSize} 字节)`);
      
      currentChunk = [];
      currentSize = 0;
      chunkIndex++;
    }
    
    // 添加当前行到当前块
    currentChunk.push(line);
    currentSize += line.length + 1; // +1 表示换行符
  }
  
  // 写入最后一个块
  if (currentChunk.length > 0) {
    const chunkFilePath = path.join(chunksDir, `${filename}.chunk${chunkIndex}.js`);
    fs.writeFileSync(chunkFilePath, currentChunk.join('\n'));
    chunkFiles.push(chunkFilePath);
    
    console.log(`✅ 创建文件块 ${chunkIndex + 1}: ${chunkFilePath} (${currentSize} 字节)`);
  }
  
  // 创建块文件列表
  const listFilePath = path.join(outputDir, `${filename}.chunks.list`);
  fs.writeFileSync(listFilePath, chunkFiles.join('\n'));
  
  console.log(`📋 创建文件块列表: ${listFilePath} (共 ${chunkFiles.length} 个块)`);
  
  // 创建元数据文件，记录分块信息
  const metaFilePath = path.join(outputDir, `${filename}.meta.json`);
  const metadata: ChunkMetadata = {
    originalFile: filePath,
    originalSize: fs.statSync(filePath).size,
    chunkSize: chunkSize,
    chunkCount: chunkFiles.length,
    chunks: chunkFiles.map((chunkPath) => {
      return {
        path: chunkPath,
        size: fs.statSync(chunkPath).size
      };
    }),
    preserveStructure: preserveStructure,
    timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync(metaFilePath, JSON.stringify(metadata, null, 2));
  console.log(`📝 创建元数据文件: ${metaFilePath}`);
  
  return {
    chunkFiles,
    listFilePath,
    metaFilePath,
    metadata
  };
}

// 如果直接运行此脚本
if (require.main === module) {
  const argv = yargs(hideBin(process.argv))
    .option('file', {
      alias: 'f',
      describe: '要分块的文件路径',
      type: 'string',
      demandOption: true
    })
    .option('output-dir', {
      alias: 'o',
      describe: '输出目录',
      type: 'string',
      default: './output'
    })
    .option('chunk-size', {
      alias: 'c',
      describe: '块大小(KB)',
      type: 'number',
      default: 50
    })
    .option('preserve-structure', {
      alias: 'p',
      describe: '保留JavaScript作用域结构完整性',
      type: 'boolean',
      default: true
    })
    .help()
    .argv as unknown as ChunkArgs;
  
  // 运行分块函数
  chunkLargeFile(
    argv.file,
    argv['output-dir'],
    argv['chunk-size'] * 1024,
    argv['preserve-structure']
  ).catch((error: Error) => {
    console.error(`❌ 错误: ${error.message}`);
    process.exit(1);
  });
} else {
  // 导出为模块使用
  export { chunkLargeFile }; 