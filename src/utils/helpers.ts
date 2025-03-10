import * as fs from 'fs';
import * as path from 'path';

/**
 * 确保文件存在
 */
export function ensureFileExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 格式化时间（秒）
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(2)}秒`;
  }
  
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs.toFixed(0)}秒`;
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}小时${minutes}分${secs.toFixed(0)}秒`;
}

/**
 * 确保目录存在
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * 拆分路径
 */
export function splitPath(filePath: string): { dir: string, base: string, name: string, ext: string } {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ext = path.extname(filePath);
  const name = path.basename(filePath, ext);
  
  return { dir, base, name, ext };
}

/**
 * 解析文件大小字符串
 */
export function parseFileSize(sizeStr: string): number {
  const units = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };
  
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Z]+)$/i);
  if (!match) {
    throw new Error(`无效的文件大小格式: ${sizeStr}`);
  }
  
  const size = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  
  if (!units[unit]) {
    throw new Error(`未知的文件大小单位: ${unit}`);
  }
  
  return size * units[unit];
}

/**
 * 等待指定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 批处理数组
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const result = [];
  for (let i = 0; i < array.length; i += batchSize) {
    result.push(array.slice(i, i + batchSize));
  }
  return result;
}

/**
 * 截断字符串到指定长度
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
} 