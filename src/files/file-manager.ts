import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as globLib from 'glob';
import { promisify } from 'util';
import { verbose } from '../utils/logger';

const glob = promisify(globLib.glob);

export interface FileManagerOptions {
  sourceDir: string;
  outputDir: string;
  filePattern?: string;
  excludePatterns?: string[];
  largeFileSizeThreshold?: number;
  ultraLargeFileSizeThreshold?: number;
}

export interface FileMeta {
  path: string;
  size: number;
  category: 'small' | 'large' | 'ultra_large';
}

/**
 * FileManager类负责文件分类、大型文件分块和输出管理
 */
export class FileManager extends EventEmitter {
  private sourceDir: string;
  private outputDir: string;
  private filePattern: string;
  private excludePatterns: string[];
  private largeFileSizeThreshold: number;
  private ultraLargeFileSizeThreshold: number;

  constructor(options: FileManagerOptions) {
    super();
    this.sourceDir = options.sourceDir;
    this.outputDir = options.outputDir;
    this.filePattern = options.filePattern || "**/*.{js,ts,jsx,tsx}";
    this.excludePatterns = options.excludePatterns || [];
    this.largeFileSizeThreshold = options.largeFileSizeThreshold || 100000; // 100KB
    this.ultraLargeFileSizeThreshold = options.ultraLargeFileSizeThreshold || 500000; // 500KB
  }

  /**
   * 查找匹配的文件并进行分类
   */
  async findMatchingFiles(): Promise<FileMeta[]> {
    const matches = await glob(this.filePattern, {
      cwd: this.sourceDir,
      ignore: this.excludePatterns,
      nodir: true,
      absolute: false
    });

    const files: FileMeta[] = [];
    
    for (const match of matches) {
      const fullPath = path.join(this.sourceDir, match);
      try {
        const stats = await fs.stat(fullPath);
        const fileSize = stats.size;
        
        let category: 'small' | 'large' | 'ultra_large' = 'small';
        if (fileSize >= this.ultraLargeFileSizeThreshold) {
          category = 'ultra_large';
        } else if (fileSize >= this.largeFileSizeThreshold) {
          category = 'large';
        }
        
        files.push({
          path: fullPath,
          size: fileSize,
          category
        });
      } catch (error) {
        verbose.log(`Error reading file stats for ${fullPath}: ${error}`);
      }
    }

    return files;
  }

  /**
   * 将大文件分块
   */
  async chunkLargeFile(filePath: string, chunkSize: number = 50000): Promise<{ chunks: string[], fullContent: string }> {
    const content = await fs.readFile(filePath, 'utf-8');
    
    // 如果文件小于块大小，直接返回整个内容
    if (content.length <= chunkSize) {
      return { chunks: [content], fullContent: content };
    }
    
    const chunks: string[] = [];
    
    // 尝试在合理的边界（如行尾）分割文件
    let startPos = 0;
    while (startPos < content.length) {
      let endPos = Math.min(startPos + chunkSize, content.length);
      
      // 如果不是文件末尾，尝试找到行尾位置
      if (endPos < content.length) {
        const nextNewline = content.indexOf('\n', endPos);
        if (nextNewline !== -1 && nextNewline < endPos + 1000) { // 不要搜索太远
          endPos = nextNewline + 1;
        }
      }
      
      chunks.push(content.substring(startPos, endPos));
      startPos = endPos;
    }
    
    verbose.log(`文件 ${path.basename(filePath)} 已分为 ${chunks.length} 个块`);
    return { chunks, fullContent: content };
  }

  /**
   * 应用重命名到文件
   */
  async applyRenamesToFile(filePath: string, identifiers: { original_name: string, new_name: string }[]): Promise<boolean> {
    try {
      // 读取文件内容
      let content = await fs.readFile(filePath, 'utf-8');
      let modified = false;
      
      // 按原始名称长度排序（从长到短），避免替换子串
      identifiers.sort((a, b) => b.original_name.length - a.original_name.length);
      
      // 应用重命名
      for (const identifier of identifiers) {
        if (identifier.new_name && identifier.new_name !== identifier.original_name) {
          const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapeRegExp(identifier.original_name)}\\b`, 'g');
          const newContent = content.replace(regex, identifier.new_name);
          
          if (newContent !== content) {
            content = newContent;
            modified = true;
          }
        }
      }
      
      // 如果有修改，写回文件
      if (modified) {
        await fs.writeFile(filePath, content, 'utf-8');
        verbose.log(`应用了重命名到 ${path.basename(filePath)}`);
      } else {
        verbose.log(`没有对 ${path.basename(filePath)} 应用重命名`);
      }
      
      return modified;
    } catch (error) {
      verbose.log(`应用重命名到 ${filePath} 时出错: ${error}`);
      return false;
    }
  }

  /**
   * 确保输出目录存在
   */
  async ensureOutputDir(): Promise<string> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      return this.outputDir;
    } catch (error) {
      throw new Error(`创建输出目录失败: ${error}`);
    }
  }
} 