import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs/promises';
import { verbose } from '../utils/logger';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 工作器脚本路径
const WORKER_SCRIPT = path.join(__dirname, '../extract-identifiers-worker.js');

export interface ParallelExtractorOptions {
  concurrency: number;
  runId: string;
  projectId?: string;
}

export interface ExtractorTaskResult {
  fileId: string;
  identifiers: any[];
  error?: string;
}

/**
 * ParallelExtractor类负责并行提取文件中的标识符
 */
export class ParallelExtractor extends EventEmitter {
  private concurrency: number;
  private runId: string;
  private projectId?: string;
  private workers: Worker[];
  private activeWorkers: number = 0;
  private taskQueue: any[] = [];
  private results: Map<string, ExtractorTaskResult> = new Map();
  private isProcessing: boolean = false;

  constructor(options: ParallelExtractorOptions) {
    super();
    this.concurrency = options.concurrency;
    this.runId = options.runId;
    this.projectId = options.projectId;
    this.workers = [];
  }

  /**
   * 提取文件中的标识符
   */
  async extractIdentifiers(file: any): Promise<ExtractorTaskResult> {
    return new Promise((resolve, reject) => {
      if (this.results.has(file.id)) {
        resolve(this.results.get(file.id)!);
        return;
      }

      // 创建任务对象
      const task = {
        id: file.id,
        file,
        resolve,
        reject
      };

      // 添加到队列并开始处理
      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * 处理队列中的任务
   */
  private processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // 创建所需的工作器
    this.ensureWorkers();

    // 处理队列中的任务
    this.processNextTask();
  }

  /**
   * 确保有足够的工作器
   */
  private ensureWorkers(): void {
    while (this.workers.length < this.concurrency) {
      try {
        const worker = new Worker(WORKER_SCRIPT);
        
        worker.on('message', (result) => {
          this.handleWorkerResult(result);
        });
        
        worker.on('error', (error) => {
          verbose.log(`工作器错误: ${error}`);
          this.replaceWorker(worker);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            verbose.log(`工作器异常退出，退出码: ${code}`);
            this.replaceWorker(worker);
          }
        });
        
        this.workers.push(worker);
      } catch (error) {
        verbose.log(`创建工作器失败: ${error}`);
      }
    }
  }

  /**
   * 处理队列中的下一个任务
   */
  private processNextTask(): void {
    // 如果没有任务或所有工作器都在忙，就停止处理
    if (this.taskQueue.length === 0 || this.activeWorkers >= this.workers.length) {
      this.isProcessing = false;
      
      // 所有任务完成
      if (this.taskQueue.length === 0 && this.activeWorkers === 0) {
        this.emit('allCompleted');
      }
      
      return;
    }

    // 获取下一个任务
    const task = this.taskQueue.shift();
    
    // 查找可用的工作器
    const worker = this.workers.find(w => !w.hasOwnProperty('busy') || !w.busy);
    if (!worker) {
      // 没有可用的工作器，将任务放回队列
      this.taskQueue.unshift(task);
      this.isProcessing = false;
      return;
    }

    // 标记工作器为忙
    (worker as any).busy = true;
    this.activeWorkers++;

    // 提取文件中的标识符
    this.extractWithWorker(worker, task);

    // 继续处理队列
    setImmediate(() => this.processNextTask());
  }

  /**
   * 使用工作器提取标识符
   */
  private extractWithWorker(worker: Worker, task: any): void {
    const { file } = task;

    worker.postMessage({
      task: 'extract',
      file,
      runId: this.runId,
      projectId: this.projectId
    });

    (worker as any).currentTask = task;
  }

  /**
   * 处理工作器返回的结果
   */
  private handleWorkerResult(result: any): void {
    const worker = this.workers.find(w => (w as any).currentTask && (w as any).currentTask.id === result.fileId);
    if (!worker) {
      verbose.log(`收到结果但找不到对应的工作器: ${result.fileId}`);
      return;
    }

    const task = (worker as any).currentTask;
    
    // 清理工作器状态
    (worker as any).busy = false;
    (worker as any).currentTask = null;
    this.activeWorkers--;

    // 保存并返回结果
    this.results.set(result.fileId, result);
    
    if (result.error) {
      task.reject(new Error(result.error));
    } else {
      task.resolve(result);
    }

    // 触发进度事件
    this.emit('progress', {
      fileId: result.fileId,
      identifierCount: result.identifiers ? result.identifiers.length : 0,
      hasError: !!result.error
    });

    // 继续处理队列中的任务
    this.processNextTask();
  }

  /**
   * 替换出错的工作器
   */
  private replaceWorker(failedWorker: Worker): void {
    // 移除失败的工作器
    const index = this.workers.indexOf(failedWorker);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }

    // 如果工作器有正在处理的任务，将其放回队列
    const task = (failedWorker as any).currentTask;
    if (task) {
      this.taskQueue.unshift(task);
      this.activeWorkers--;
    }

    // 创建新的工作器
    this.ensureWorkers();
    
    // 继续处理队列
    this.processNextTask();
  }

  /**
   * 关闭所有工作器
   */
  async shutdown(): Promise<void> {
    // 等待所有活跃任务完成
    if (this.activeWorkers > 0) {
      await new Promise(resolve => this.once('allCompleted', resolve));
    }

    // 终止所有工作器
    for (const worker of this.workers) {
      try {
        await worker.terminate();
      } catch (error) {
        verbose.log(`终止工作器时出错: ${error}`);
      }
    }

    this.workers = [];
    this.activeWorkers = 0;
    this.taskQueue = [];
  }

  /**
   * 处理单个文件
   */
  async processFile(file: any): Promise<ExtractorTaskResult> {
    verbose.log(`处理文件: ${file.path || file.id}`);
    try {
      const result = await this.extractIdentifiers(file);
      return result;
    } catch (error: any) {
      verbose.log(`处理文件 ${file.path || file.id} 失败: ${error.message}`);
      return {
        fileId: file.id,
        identifiers: [],
        error: error.message
      };
    }
  }
} 