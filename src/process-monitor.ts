#!/usr/bin/env node
// process-monitor.ts - 监控进程和子进程的性能和资源使用情况

import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec, ChildProcess } from 'child_process';
import * as readline from 'readline';

// 配置选项接口
interface Config {
  // 检查间隔（毫秒）
  checkInterval: number;
  // 输出日志文件
  logFilePath: string;
  // 是否在控制台输出
  consoleOutput: boolean;
  // 是否以彩色输出
  colorOutput: boolean;
  // 进程ID
  pid: string | null;
  // 监控内存阈值 (MB)
  memoryThreshold: number;
  // 是否在超过阈值时发出警告
  warnOnThreshold: boolean;
}

// 进程信息接口
interface ProcessInfo {
  pid?: string;
  ppid?: string;
  cmd?: string;
  '%cpu'?: string;
  '%mem'?: string;
  rss?: string;
  rssMB: number;
  [key: string]: any;
}

// 彩色输出工具类型
type ColorName = 'reset' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'bold';

// 配置选项
const CONFIG: Config = {
  // 检查间隔（毫秒）
  checkInterval: 3000,
  // 输出日志文件
  logFilePath: 'process-monitor.log',
  // 是否在控制台输出
  consoleOutput: true,
  // 是否以彩色输出
  colorOutput: true,
  // 进程ID
  pid: process.argv[2] || null,
  // 监控内存阈值 (MB)
  memoryThreshold: 7000,
  // 是否在超过阈值时发出警告
  warnOnThreshold: true
};

// 彩色输出工具
const colors: Record<ColorName, string> = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

// 应用颜色
function colorize(text: string, color: ColorName): string {
  return CONFIG.colorOutput ? `${colors[color]}${text}${colors.reset}` : text;
}

// 格式化日期时间
function formatDateTime(): string {
  const now = new Date();
  return now.toISOString();
}

// 写入日志
function writeLog(message: string): void {
  const timestamp = formatDateTime();
  const logMessage = `[${timestamp}] ${message}`;
  
  // 输出到控制台
  if (CONFIG.consoleOutput) {
    console.log(logMessage);
  }
  
  // 写入日志文件
  fs.appendFileSync(CONFIG.logFilePath, `${logMessage}\n`);
}

// 获取进程信息
async function getProcessInfo(pid: string): Promise<ProcessInfo> {
  return new Promise((resolve, reject) => {
    // 在Linux上使用ps命令获取进程信息
    exec(`ps -p ${pid} -o pid,ppid,cmd,%cpu,%mem,rss`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        reject(new Error(`无法找到进程 ${pid}`));
        return;
      }
      
      // 解析输出
      const headers = lines[0].trim().split(/\s+/);
      const values = lines[1].trim().split(/\s+/);
      
      // 将头部与值配对
      const info: ProcessInfo = { rssMB: 0 };
      let cmdIndex = -1;
      
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (header === 'cmd') {
          cmdIndex = i;
          continue;
        }
        
        if (cmdIndex >= 0 && i > cmdIndex) {
          // cmd 参数可能包含空格，跳过
          continue;
        }
        
        info[header] = values[i];
      }
      
      // 手动提取命令字段（可能包含空格）
      if (cmdIndex >= 0) {
        const cmdParts = [];
        for (let i = cmdIndex; i < values.length - 3; i++) {
          cmdParts.push(values[i]);
        }
        info['cmd'] = cmdParts.join(' ');
      } else {
        info['cmd'] = 'unknown';
      }
      
      // 转换 RSS 为 MB，添加安全检查
      if (info.rss && !isNaN(parseInt(info.rss))) {
        info.rssMB = parseInt(info.rss) / 1024;
      } else {
        // 设置默认值，避免undefined
        info.rssMB = 0;
      }
      
      resolve(info);
    });
  });
}

// 获取进程的子进程
async function getChildProcesses(ppid: string): Promise<ProcessInfo[]> {
  return new Promise((resolve, reject) => {
    exec(`ps -o pid,ppid,cmd,%cpu,%mem,rss --ppid ${ppid}`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        // 没有子进程
        resolve([]);
        return;
      }
      
      const children: ProcessInfo[] = [];
      const headers = lines[0].trim().split(/\s+/);
      
      // 从索引1开始跳过标题行
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].trim().split(/\s+/);
        const info: ProcessInfo = { rssMB: 0 };
        let cmdIndex = -1;
        
        for (let j = 0; j < headers.length; j++) {
          const header = headers[j].toLowerCase();
          if (header === 'cmd') {
            cmdIndex = j;
            continue;
          }
          
          if (cmdIndex >= 0 && j > cmdIndex) {
            // cmd 参数可能包含空格，跳过
            continue;
          }
          
          info[header] = values[j];
        }
        
        // 手动提取命令字段（可能包含空格）
        if (cmdIndex >= 0) {
          const cmdParts = [];
          for (let j = cmdIndex; j < values.length - 3; j++) {
            cmdParts.push(values[j]);
          }
          info['cmd'] = cmdParts.join(' ');
        }
        
        // 转换 RSS 为 MB
        if (info.rss) {
          info.rssMB = parseInt(info.rss) / 1024;
        }
        
        children.push(info);
      }
      
      resolve(children);
    });
  });
}

// 获取Node.js进程的堆使用情况
async function getNodeHeapUsage(pid: string): Promise<any | null> {
  return new Promise((resolve, reject) => {
    // 使用指定PID启动Node.js进程
    const command = `node -e "process._debugProcess(${pid})"`;
    
    try {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve(null); // 无法获取堆使用情况
          return;
        }
        
        // 尝试通过后续命令获取内存使用
        // 注意：这是一种尝试性的方法，可能不是所有环境都支持
        resolve(null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

// 打印进程树
function printProcessTree(mainProcess: ProcessInfo | null, childProcesses: ProcessInfo[], indent: number = 0): void {
  const indentStr = ' '.repeat(indent);
  
  if (mainProcess) {
    // 添加安全检查，确保所有属性都存在，否则使用默认值
    const cpuUsage = mainProcess['%cpu'] ? parseFloat(mainProcess['%cpu']).toFixed(1) : '0.0';
    const memUsage = mainProcess['%mem'] ? parseFloat(mainProcess['%mem']).toFixed(1) : '0.0';
    const memoryMB = mainProcess.rssMB !== undefined ? mainProcess.rssMB.toFixed(1) : '0.0';
    
    let statusColor: ColorName = 'green';
    if (mainProcess.rssMB > CONFIG.memoryThreshold) {
      statusColor = 'red';
    } else if (mainProcess.rssMB > CONFIG.memoryThreshold * 0.8) {
      statusColor = 'yellow';
    }
    
    const processInfo = colorize(
      `${indentStr}PID ${mainProcess.pid} (CPU: ${cpuUsage}%, MEM: ${memUsage}%, RAM: ${memoryMB}MB) - ${mainProcess.cmd || 'unknown command'}`,
      statusColor
    );
    
    writeLog(processInfo);
    
    if (CONFIG.warnOnThreshold && mainProcess.rssMB > CONFIG.memoryThreshold) {
      writeLog(colorize(`${indentStr}⚠️ 警告: 进程内存使用超过阈值 ${CONFIG.memoryThreshold}MB!`, 'red'));
    }
  }
  
  // 打印子进程
  for (const child of childProcesses) {
    // 同样添加安全检查
    const cpuUsage = child['%cpu'] ? parseFloat(child['%cpu']).toFixed(1) : '0.0';
    const memUsage = child['%mem'] ? parseFloat(child['%mem']).toFixed(1) : '0.0';
    const memoryMB = child.rssMB !== undefined ? child.rssMB.toFixed(1) : '0.0';
    
    let statusColor: ColorName = 'cyan';
    if (child.rssMB > CONFIG.memoryThreshold) {
      statusColor = 'red';
    } else if (child.rssMB > CONFIG.memoryThreshold * 0.8) {
      statusColor = 'yellow';
    }
    
    const childInfo = colorize(
      `${indentStr}  └─ PID ${child.pid} (CPU: ${cpuUsage}%, MEM: ${memUsage}%, RAM: ${memoryMB}MB) - ${child.cmd || 'unknown command'}`,
      statusColor
    );
    
    writeLog(childInfo);
    
    if (CONFIG.warnOnThreshold && child.rssMB > CONFIG.memoryThreshold) {
      writeLog(colorize(`${indentStr}    ⚠️ 警告: 子进程内存使用超过阈值 ${CONFIG.memoryThreshold}MB!`, 'red'));
    }
  }
}

// 附加到现有进程
async function attachToProcess(pid: string): Promise<void> {
  writeLog(colorize(`🔍 附加到进程 PID ${pid}`, 'blue'));
  
  // 初始化日志文件
  fs.writeFileSync(CONFIG.logFilePath, `## 进程监控开始 - PID ${pid} - ${formatDateTime()} ##\n`);
  
  try {
    // 检查进程是否存在
    const initialInfo = await getProcessInfo(pid);
    writeLog(colorize(`✅ 找到进程 PID ${pid}: ${initialInfo.cmd}`, 'green'));
    
    // 开始监控循环
    const monitorInterval = setInterval(async () => {
      try {
        // 获取主进程信息
        const processInfo = await getProcessInfo(pid);
        
        // 获取子进程信息
        const childProcesses = await getChildProcesses(pid);
        
        // 计算总内存使用，添加安全检查
        let totalMemoryMB = processInfo.rssMB || 0;
        childProcesses.forEach(child => {
          totalMemoryMB += (child.rssMB || 0);
        });
        
        // 打印标题
        writeLog(colorize(`\n===== 进程监控 ${formatDateTime()} =====`, 'magenta'));
        writeLog(colorize(`📊 总进程数: ${1 + childProcesses.length}, 总内存使用: ${totalMemoryMB.toFixed(1)}MB`, 'blue'));
        
        // 打印进程树
        printProcessTree(processInfo, childProcesses);
        
      } catch (error) {
        // 进程可能已结束
        if (error instanceof Error && error.message.includes('无法找到进程')) {
          writeLog(colorize(`❌ 进程 ${pid} 已结束或不存在`, 'red'));
          clearInterval(monitorInterval);
          writeLog(colorize(`## 进程监控结束 - PID ${pid} - ${formatDateTime()} ##`, 'magenta'));
          process.exit(0);
        } else {
          writeLog(colorize(`❌ 监控错误: ${error instanceof Error ? error.message : String(error)}`, 'red'));
        }
      }
    }, CONFIG.checkInterval);
    
    // 处理监控进程的退出
    process.on('SIGINT', () => {
      writeLog(colorize(`\n💡 监控已手动停止 - ${formatDateTime()}`, 'yellow'));
      clearInterval(monitorInterval);
      process.exit(0);
    });
    
  } catch (error) {
    writeLog(colorize(`❌ 无法附加到进程 ${pid}: ${error instanceof Error ? error.message : String(error)}`, 'red'));
    process.exit(1);
  }
}

// 启动新进程并监控
async function startAndMonitor(command: string, args: string[]): Promise<void> {
  writeLog(colorize(`🚀 启动并监控命令: ${command} ${args.join(' ')}`, 'blue'));
  
  // 初始化日志文件
  fs.writeFileSync(CONFIG.logFilePath, `## 进程监控开始 - 命令: ${command} ${args.join(' ')} - ${formatDateTime()} ##\n`);
  
  // 启动子进程
  const childProcess = spawn(command, args, {
    stdio: 'inherit',
    shell: true
  });
  
  const pid = childProcess.pid?.toString() || '';
  writeLog(colorize(`✅ 进程已启动, PID: ${pid}`, 'green'));
  
  // 开始监控循环
  const monitorInterval = setInterval(async () => {
    try {
      // 获取进程信息
      const processInfo = await getProcessInfo(pid);
      
      // 获取子进程信息
      const childProcesses = await getChildProcesses(pid);
      
      // 计算总内存使用，添加安全检查
      let totalMemoryMB = processInfo.rssMB || 0;
      childProcesses.forEach(child => {
        totalMemoryMB += (child.rssMB || 0);
      });
      
      // 打印标题
      writeLog(colorize(`\n===== 进程监控 ${formatDateTime()} =====`, 'magenta'));
      writeLog(colorize(`📊 总进程数: ${1 + childProcesses.length}, 总内存使用: ${totalMemoryMB.toFixed(1)}MB`, 'blue'));
      
      // 打印进程树
      printProcessTree(processInfo, childProcesses);
      
    } catch (error) {
      // 进程可能已结束
      if (error instanceof Error && error.message.includes('无法找到进程')) {
        writeLog(colorize(`🏁 进程 ${pid} 已结束`, 'yellow'));
        clearInterval(monitorInterval);
        writeLog(colorize(`## 进程监控结束 - PID ${pid} - ${formatDateTime()} ##`, 'magenta'));
        process.exit(0);
      } else {
        writeLog(colorize(`❌ 监控错误: ${error instanceof Error ? error.message : String(error)}`, 'red'));
      }
    }
  }, CONFIG.checkInterval);
  
  // 处理子进程退出
  childProcess.on('exit', (code, signal) => {
    writeLog(colorize(`🏁 被监控进程已退出，代码: ${code}, 信号: ${signal || 'none'}`, 'yellow'));
    clearInterval(monitorInterval);
    writeLog(colorize(`## 进程监控结束 - PID ${pid} - ${formatDateTime()} ##`, 'magenta'));
    process.exit(0);
  });
  
  // 处理监控进程的退出
  process.on('SIGINT', () => {
    writeLog(colorize(`\n💡 监控已手动停止，正在结束被监控进程...`, 'yellow'));
    try {
      process.kill(parseInt(pid), 'SIGTERM');
      childProcess.kill('SIGTERM');
    } catch (error) {
      // 忽略错误
    }
    clearInterval(monitorInterval);
    process.exit(0);
  });
}

// 显示使用帮助
function showHelp(): void {
  console.log(`
进程监控工具 - 用于监控Node.js进程及其子进程

使用方法:
  1) 监控现有进程:
     node process-monitor.js <pid>
     
  2) 启动并监控新进程:
     node process-monitor.js --cmd "node script.js arg1 arg2"
     
  3) 配置参数:
     node process-monitor.js <pid> --interval 5000 --log monitor.log --threshold 4000
     
选项:
  --help              显示此帮助信息
  --cmd <command>     要启动并监控的命令
  --interval <ms>     监控检查间隔 (毫秒), 默认: 3000
  --log <path>        日志文件路径, 默认: process-monitor.log
  --no-console        禁用控制台输出
  --no-color          禁用彩色输出
  --threshold <MB>    内存警告阈值 (MB), 默认: 7000
  
示例:
  node process-monitor.js 1234
  node process-monitor.js --cmd "node staged-humanify.js --source-dir=test" --interval 2000
  node process-monitor.js 1234 --log memory.log --threshold 5000
`);
  process.exit(0);
}

// 解析命令行参数
function parseArgs(): { command: string | null; commandArgs: string[] } {
  const args = process.argv.slice(2);
  let i = 0;
  let command: string | null = null;
  let commandArgs: string[] = [];
  
  if (args.length === 0) {
    showHelp();
  }
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
    } else if (arg === '--cmd' && i + 1 < args.length) {
      // 解析命令字符串
      const cmdString = args[i + 1];
      const parts = cmdString.split(' ');
      command = parts[0];
      commandArgs = parts.slice(1);
      i += 2;
    } else if (arg === '--interval' && i + 1 < args.length) {
      CONFIG.checkInterval = parseInt(args[i + 1]);
      i += 2;
    } else if (arg === '--log' && i + 1 < args.length) {
      CONFIG.logFilePath = args[i + 1];
      i += 2;
    } else if (arg === '--no-console') {
      CONFIG.consoleOutput = false;
      i += 1;
    } else if (arg === '--no-color') {
      CONFIG.colorOutput = false;
      i += 1;
    } else if (arg === '--threshold' && i + 1 < args.length) {
      CONFIG.memoryThreshold = parseInt(args[i + 1]);
      i += 2;
    } else if (!isNaN(parseInt(arg)) && CONFIG.pid === null) {
      CONFIG.pid = arg;
      i += 1;
    } else {
      console.error(`未知参数: ${arg}`);
      showHelp();
    }
  }
  
  return { command, commandArgs };
}

// 主函数
async function main(): Promise<void> {
  const { command, commandArgs } = parseArgs();
  
  if (command) {
    // 启动并监控新进程
    await startAndMonitor(command, commandArgs);
  } else if (CONFIG.pid) {
    // 附加到现有进程
    await attachToProcess(CONFIG.pid);
  } else {
    console.error('必须提供进程ID或要启动的命令');
    showHelp();
  }
}

// 运行主函数
main().catch(error => {
  console.error(`运行时错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}); 