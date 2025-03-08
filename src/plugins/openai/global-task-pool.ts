import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import OpenAI from "openai";
import { verbose } from "../../verbose.js";
import { visitAllIdentifiersParallel } from '../../plugins/local-llm-rename/parallel-visit-identifiers.js';
import * as dbHelpers from '../../db/helpers.js';
import { IFile, IIdentifier, IProcessingRun, IOpenAIBatch, ILocalBatchTracker } from '../../db/models.js';

// 复杂度阈值常量
const COMPLEXITY_THRESHOLD = 300;

// 批处理请求接口
export interface BatchRequest {
  custom_id: string;                                    // 自定义ID，用于关联标识符
  method: string;                                       // HTTP方法 (通常为 "POST")
  url: string;                                          // API端点URL (如 "/v1/chat/completions")
  body: any;                                            // 请求体，包含模型、消息等
  openai_batch_id?: string;                             // OpenAI批处理ID
  project_id?: string;                                  // 项目ID
}

// 批处理响应接口
export interface BatchResponse {
  id: string;                                           // 批处理请求ID
  custom_id: string;                                    // 自定义ID，用于关联请求和标识符
  response: {                                           // 响应对象
    status_code: number;                                // HTTP状态码
    request_id: string;                                 // 请求ID
    body: any;                                          // 响应体，包含模型生成的内容
    error?: any;                                        // 错误信息
  };
  openai_batch_id?: string;                             // OpenAI批处理ID
}

// 批处理事件接口
export interface BatchEvent {
  timestamp: Date;                                      // 事件时间戳
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled'; // 事件状态
  details?: string;                                     // 事件详情
}

// 文件信息接口
export interface FileInfo {
  id: string;                                           // 唯一标识符
  path: string;                                         // 文件路径
  file_name: string;                                    // 文件名
  file_type: string;                                    // 文件类型
  size: number;                                         // 文件大小
  status: 'pending' | 'processing' | 'completed' | 'failed'; // 处理状态
  category: 'small' | 'large' | 'ultra_large';          // 文件分类
  chunk_count?: number;                                 // 分块数量
  last_processing_time?: number;                        // 处理时间
  last_processing_error?: string;                       // 错误消息
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id?: string;                                  // 项目ID
}

// 标识符任务接口
export interface IdentifierTask {
  name: string;                                         // 标识符名称
  surroundingCode: string;                              // 上下文代码
  customId: string;                                     // 唯一ID
  complexity: number;                                   // 复杂度
  filePath: string;                                     // 来源文件
  filePathHash: string;                                 // 文件路径哈希
  file_id?: string;                                     // 所属文件ID
  chunk_id?: string;                                    // 所属块ID
  project_id?: string;                                  // 项目ID
}

// 批处理结果接口
export interface BatchRenameResult {
  originalName: string;                                 // 原始名称
  newName: string;                                      // 新名称
  surroundingCode: string;                              // 上下文代码
  customId: string;                                     // 自定义ID
  filePath?: string;                                    // 文件路径
  file_id?: string;                                     // 所属文件ID
  batch_id?: string;                                    // 所属批次ID
  project_id?: string;                                  // 项目ID
}

// 性能指标接口
export interface BatchPerformanceMetrics {
  batchSize: number;                                    // 批处理大小
  processingTime: number;                               // 处理时间(毫秒)
  avgContextSize: number;                               // 平均上下文大小
  successRate: number;                                  // 成功率 (0-1)
  apiLatency: number;                                   // API响应时间
  run_id?: string;                                      // 关联的处理运行ID
  project_id?: string;                                  // 项目ID
}

// OpenAI批处理接口
export interface OpenAIBatch {
  id: string;                                           // OpenAI批处理ID
  status: BatchEvent['status'];                         // 批处理状态
  created_at: Date;                                     // 创建时间
  endpoint: string;                                     // API端点
  completion_window: string;                            // 完成窗口
  completion_time?: string;                             // 完成时间
  total_requests: number;                               // 总请求数
  completed_requests: number;                           // 完成的请求数
  failed_requests: number;                              // 失败的请求数
  input_file_id: string;                                // 输入文件ID
  input_file_path: string;                              // 输入文件路径
  output_file_id?: string;                              // 输出文件ID
  output_file_path?: string;                            // 输出文件路径
  error_file_path?: string;                             // 错误文件路径
  events: BatchEvent[];                                 // 批处理事件列表
  error?: string;                                       // 错误信息
  project_id?: string;                                  // 项目ID
}

// 本地批处理跟踪接口
export interface LocalBatchTracker {
  id: string;                                           // 本地唯一标识符
  openai_batch_id: string;                              // OpenAI批处理ID
  type: 'small' | 'large' | 'ultra_large';              // 批次类型
  file_ids: string[];                                   // 包含的文件ID列表
  identifier_count: number;                             // 标识符数量
  tasks_file_path: string;                              // 任务文件路径
  output_file_path?: string;                            // 输出文件路径
  processing_run_id: string;                            // 处理运行ID
  processing_start: Date;                               // 处理开始时间
  processing_end?: Date;                                // 处理结束时间
  status: 'preparing' | 'submitting' | 'processing' | 'downloading' | 'applying' | 'completed' | 'failed'; // 本地处理状态
  error?: string;                                       // 错误信息
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id?: string;                                  // 项目ID
}

// 全局配置接口
export interface GlobalTaskPoolConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize: number;
  outputDir: string;
  pollingInterval: number;
  concurrency: number;
  adaptiveBatching: boolean;
  minBatchSize: number;
  maxBatchSize: number;
  dryRun?: boolean;
  projectId?: string;                                   // 添加项目ID配置
}

// 添加verbose.warn方法定义
const verboseWithWarning = {
  ...verbose,
  warn: function(message?: any, ...optionalParams: any[]) {
    console.warn(message, ...optionalParams);
  }
};

// 全局任务池类
export class GlobalTaskPool {
  private tasks: IdentifierTask[] = [];
  private client: OpenAI;
  private fileContents: Map<string, string> = new Map();
  private fileResults: Map<string, BatchRenameResult[]> = new Map();
  private taskMap: Map<string, IdentifierTask> = new Map();
  private performanceMetrics: BatchPerformanceMetrics[] = [];
  private currentBatchSize: number;
  
  constructor(private config: GlobalTaskPoolConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.currentBatchSize = config.batchSize;
  }
  
  // 添加文件中的所有标识符任务
  async addFileIdentifiers(filePath: string, code: string): Promise<void> {
    const filePathHash = this.getFilePathHash(filePath);
    
    // 保存文件内容，以便后续处理
    this.fileContents.set(filePath, code);
    
    verboseWithWarning.log(`Collecting identifiers from file: ${filePath}`);
    
    try {
      // 使用并行标识符收集器获取所有标识符
      await visitAllIdentifiersParallel(
        code,
        async (name: string, surroundingCode: string) => {
          const customId = `id-${crypto.randomUUID()}`;
          // 计算标识符复杂度
          const complexity = this.calculateIdentifierComplexity(name, surroundingCode);
          
          // 创建任务并添加到任务池
          const task: IdentifierTask = {
            name,
            surroundingCode,
            customId,
            complexity,
            filePath,
            filePathHash
          };
          
          this.tasks.push(task);
          this.taskMap.set(customId, task);
          
          return name; // 返回原始名称，不进行重命名
        },
        this.config.contextWindowSize,
        (percentage: number) => verboseWithWarning.log(`Collecting identifiers from ${path.basename(filePath)}: ${Math.floor(percentage * 100)}%`),
        this.config.concurrency
      );
      
      verboseWithWarning.log(`Collected ${this.tasks.length - (this.taskMap.size - this.tasks.length)} identifiers from ${filePath}`);
    } catch (error) {
      verboseWithWarning.log(`Error collecting identifiers from ${filePath}: ${error}`);
      throw new Error(`Failed to collect identifiers from ${filePath}: ${error}`);
    }
  }
  
  // 创建最优批次
  createOptimalBatches(batchSize: number = this.currentBatchSize): IdentifierTask[][] {
    verboseWithWarning.log(`Creating optimal batches with target size: ${this.currentBatchSize}`);
    
    // 最大API限制
    const MAX_BATCH_REQUESTS = 50000; // OpenAI限制：最多50,000个请求
    const MAX_BATCH_BYTES = 200 * 1024 * 1024; // OpenAI限制：最大200MB
    
    // 优化：按文件分组标识符，避免跨文件分散
    const tasksByFile: Record<string, IdentifierTask[]> = {};
    
    // 按文件分组
    for (const task of this.tasks) {
      if (!tasksByFile[task.filePath]) {
        tasksByFile[task.filePath] = [];
      }
      tasksByFile[task.filePath].push(task);
    }
    
    // 估算每个请求的大致字节大小
    const estimateRequestBytes = (task: IdentifierTask): number => {
      const prompt = this.toRenamePrompt(task.name, task.surroundingCode, this.config.model);
      return JSON.stringify({
        custom_id: task.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: prompt
      }).length;
    };
    
    // 对所有任务进行处理，创建尽可能大的批次
    const batches: IdentifierTask[][] = [];
    let currentBatch: IdentifierTask[] = [];
    let currentBatchSize = 0;
    let currentBatchBytes = 0;
    
    // 优化：先处理较小文件的任务
    const sortedFilePaths = Object.keys(tasksByFile).sort((a, b) => {
      return tasksByFile[a].length - tasksByFile[b].length;
    });
    
    verboseWithWarning.log(`Creating batches from ${this.tasks.length} tasks in ${sortedFilePaths.length} files`);
    
    // 处理优先级较高（较小文件）的任务
    for (const filePath of sortedFilePaths) {
      const fileTasks = tasksByFile[filePath];
      
      // 如果当前文件的任务数量超过了最大批处理大小
      // 则为这个文件单独创建多个批次
      if (fileTasks.length > MAX_BATCH_REQUESTS) {
        verboseWithWarning.log(`File ${filePath} has ${fileTasks.length} tasks, which exceeds max batch size. Creating multiple batches.`);
        
        // 单独处理大文件
        let fileTaskBatch: IdentifierTask[] = [];
        let fileTaskBatchBytes = 0;
        
        for (const task of fileTasks) {
          const taskBytes = estimateRequestBytes(task);
          
          // 如果添加此任务会超过限制，创建新批次
          if (fileTaskBatch.length >= this.config.maxBatchSize || 
              fileTaskBatchBytes + taskBytes > MAX_BATCH_BYTES) {
            if (fileTaskBatch.length > 0) {
              batches.push(fileTaskBatch);
              verboseWithWarning.log(`Created batch for large file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
              fileTaskBatch = [];
              fileTaskBatchBytes = 0;
            }
          }
          
          // 添加任务到当前批次
          fileTaskBatch.push(task);
          fileTaskBatchBytes += taskBytes;
        }
        
        // 添加最后一个批次（如果有）
        if (fileTaskBatch.length > 0) {
          batches.push(fileTaskBatch);
          verboseWithWarning.log(`Created final batch for large file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
        }
        
        continue;
      }
      
      // 检查是否添加整个文件的所有任务会超过限制
      let fileTasksBytes = 0;
      for (const task of fileTasks) {
        fileTasksBytes += estimateRequestBytes(task);
      }
      
      // 如果添加整个文件的所有任务会超过限制，为该文件创建单独的批次
      if (currentBatchSize + fileTasks.length > MAX_BATCH_REQUESTS ||
          currentBatchBytes + fileTasksBytes > MAX_BATCH_BYTES) {
        // 添加前一个批次（如果不为空）
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          verboseWithWarning.log(`Created batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
          currentBatch = [];
          currentBatchSize = 0;
          currentBatchBytes = 0;
        }
        
        // 如果单个文件的所有任务仍超过限制，为该文件创建单独的批次
        if (fileTasks.length > MAX_BATCH_REQUESTS || fileTasksBytes > MAX_BATCH_BYTES) {
          let fileTaskBatch: IdentifierTask[] = [];
          let fileTaskBatchBytes = 0;
          
          for (const task of fileTasks) {
            const taskBytes = estimateRequestBytes(task);
            
            // 如果添加此任务会超过限制，创建新批次
            if (fileTaskBatch.length >= this.config.maxBatchSize || 
                fileTaskBatchBytes + taskBytes > MAX_BATCH_BYTES) {
              if (fileTaskBatch.length > 0) {
                batches.push(fileTaskBatch);
                verboseWithWarning.log(`Created batch for oversized file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
                fileTaskBatch = [];
                fileTaskBatchBytes = 0;
              }
            }
            
            // 添加任务到当前批次
            fileTaskBatch.push(task);
            fileTaskBatchBytes += taskBytes;
          }
          
          // 添加最后一个批次（如果有）
          if (fileTaskBatch.length > 0) {
            batches.push(fileTaskBatch);
            verboseWithWarning.log(`Created final batch for oversized file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
          }
        } else {
          // 文件任务可以放入一个批次，但需要单独放置
          batches.push(fileTasks);
          verboseWithWarning.log(`Created batch for entire file with ${fileTasks.length} tasks, size: ${Math.round(fileTasksBytes / (1024 * 1024))}MB`);
        }
      } else {
        // 将所有文件任务添加到当前批次
        currentBatch.push(...fileTasks);
        currentBatchSize += fileTasks.length;
        currentBatchBytes += fileTasksBytes;
        
        // 如果当前批次足够大，创建新批次
        if (currentBatchSize >= this.config.batchSize) {
          batches.push(currentBatch);
          verboseWithWarning.log(`Created batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
          currentBatch = [];
          currentBatchSize = 0;
          currentBatchBytes = 0;
        }
      }
    }
    
    // 添加最后一个批次（如果有）
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
      verboseWithWarning.log(`Created final batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
    }
    
    // 优化：调整批处理大小
    if (this.config.adaptiveBatching) {
      // 根据任务和批次数调整批处理大小
      if (batches.length > 1 && this.tasks.length > 0) {
        const avgBatchSize = Math.floor(this.tasks.length / batches.length);
        
        // 如果平均批次大小显著不同于当前批处理大小，则调整
        if (Math.abs(avgBatchSize - this.currentBatchSize) > this.currentBatchSize * 0.2) {
          const newBatchSize = Math.max(
            this.config.minBatchSize,
            Math.min(
              this.config.maxBatchSize,
              Math.floor(avgBatchSize)
            )
          );
          
          verboseWithWarning.log(`Adjusting batch size from ${this.currentBatchSize} to ${newBatchSize} based on workload`);
          this.currentBatchSize = newBatchSize;
        }
      }
    }
    
    verboseWithWarning.log(`Created ${batches.length} batches from ${this.tasks.length} tasks`);
    return batches;
  }
  
  // 处理所有批次
  async processBatches(): Promise<Map<string, BatchRenameResult[]>> {
    verboseWithWarning.log(`Starting to process all batches`);
    
    // 如果是 dry-run 模式，只生成批处理文件
    if (this.config.dryRun) {
      verboseWithWarning.log(`Dry-run mode enabled, skipping API calls`);
      await this.generateBatchesOnly();
      return new Map<string, BatchRenameResult[]>();
    }
    
    // 创建最优批次
    const batches = this.createOptimalBatches();
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verboseWithWarning.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} tasks`);
      
      // 记录批处理开始时间
      const batchStartTime = Date.now();
      
      // 计算当前批次的平均上下文大小
      const avgContextSize = batch.reduce((sum, item) => sum + item.surroundingCode.length, 0) / batch.length;
      verboseWithWarning.log(`Batch ${batchIndex + 1} average context size: ${Math.round(avgContextSize)} characters`);
      
      // 为每个任务的文件创建输出目录
      const uniqueFilePaths = [...new Set(batch.map(task => task.filePath))];
      for (const filePath of uniqueFilePaths) {
        const fileHash = this.getFilePathHash(filePath);
        const resultDir = path.join(this.config.outputDir, fileHash);
        await fs.mkdir(resultDir, { recursive: true });
        
        // 保存原始文件
        if (!this.fileResults.has(filePath)) {
          const originalFilePath = path.join(resultDir, "original.js");
          await fs.writeFile(originalFilePath, this.fileContents.get(filePath) || "");
        }
      }
      
      // 创建批处理任务文件
      const batchRequests: BatchRequest[] = batch.map(item => ({
        custom_id: item.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: this.toRenamePrompt(item.name, item.surroundingCode, this.config.model),
        project_id: this.config.projectId
      }));
      
      // 使用唯一的临时文件名
      const tempId = crypto.randomUUID().substring(0, 8);
      const batchTasksFilePath = path.join(this.config.outputDir, `batch_tasks_${tempId}.jsonl`);
      
      await fs.writeFile(
        batchTasksFilePath, 
        batchRequests.map(request => JSON.stringify(request)).join('\n')
      );
      
      // 保存批处理信息到数据库
      const dbBatchId = await this.saveBatchToDB(batch, tempId, batchTasksFilePath);
      
      // 上传文件进行批处理
      verboseWithWarning.log(`Uploading batch ${batchIndex + 1} to OpenAI`);
      
      let batchFile;
      try {
        // 使用文件流上传
        batchFile = await this.client.files.create({
          file: fsSync.createReadStream(batchTasksFilePath),
          purpose: "batch"
        });
      } catch (error) {
        verboseWithWarning.log(`Error uploading batch file: ${error}`);
        throw new Error(`Failed to upload batch file: ${error}`);
      }
      
      // 创建批处理作业
      verboseWithWarning.log(`Creating batch job for batch ${batchIndex + 1}`);
      const batchJobStartTime = Date.now();
      
      let openAIBatch: { id: string };
      try {
        openAIBatch = await this.client.batches.create({
          input_file_id: batchFile.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h"
        });
        
        // 更新批处理请求中的OpenAI批处理ID
        batchRequests.forEach(req => req.openai_batch_id = openAIBatch.id);
        
        // 保存 OpenAI 批处理信息到数据库
        if (dbBatchId) {
          await this.saveOpenAIBatchInfo(dbBatchId, openAIBatch.id, batchTasksFilePath);
          await this.updateBatchStatus(dbBatchId, 'processing');
        }
        
      } catch (error) {
        verboseWithWarning.log(`Error creating batch job: ${error}`);
        throw new Error(`Failed to create batch job: ${error}`);
      }
      
      // 轮询批处理作业完成情况
      verboseWithWarning.log(`Waiting for batch ${batchIndex + 1} to complete...`);
      let jobCompleted = false;
      let batchEvents: BatchEvent[] = [];
      
      // 记录批处理创建事件
      batchEvents.push({
        timestamp: new Date(),
        status: 'created'
      });
      
      while (!jobCompleted) {
        try {
          const jobStatus = await this.client.batches.retrieve(openAIBatch.id);
          verboseWithWarning.log(`Batch ${batchIndex + 1} status: ${jobStatus.status}`);
          
          // 记录状态变更事件
          if (batchEvents.length === 0 || batchEvents[batchEvents.length - 1].status !== jobStatus.status) {
            batchEvents.push({
              timestamp: new Date(),
              status: jobStatus.status as BatchEvent['status']
            });
          }
          
          if (jobStatus.status === 'completed') {
            jobCompleted = true;
            
            // 更新OpenAIBatch对象
            const completedOpenAIBatch: OpenAIBatch = {
              id: openAIBatch.id,
              status: jobStatus.status as BatchEvent['status'],
              created_at: new Date(jobStatus.created_at),
              endpoint: jobStatus.endpoint || "/v1/chat/completions",
              completion_window: jobStatus.expires_at ? "24h" : "unknown",
              completion_time: `${Math.round((Date.now() - batchJobStartTime) / 60000)} minutes`,
              // 使用安全的属性访问方式
              total_requests: (jobStatus as any).n_requests || batch.length,
              completed_requests: (jobStatus as any).n_succeeded || 0,
              failed_requests: (jobStatus as any).n_failed || 0,
              input_file_id: batchFile.id,
              input_file_path: batchTasksFilePath,
              output_file_id: jobStatus.output_file_id,
              output_file_path: `${openAIBatch.id}_output.jsonl`,
              events: batchEvents,
              project_id: this.config.projectId
            };
            
            // 在这里可以将completedOpenAIBatch保存到数据库
            verboseWithWarning.log(`Completed OpenAI batch with ID: ${completedOpenAIBatch.id}`);
            
            // 更新批处理状态
            if (dbBatchId) {
              await this.updateBatchStatus(dbBatchId, 'completed');
            }
            
          } else if (jobStatus.status === 'failed') {
            verboseWithWarning.log(`Batch ${batchIndex + 1} failed: ${jobStatus.errors ? JSON.stringify(jobStatus.errors) : 'Unknown error'}`);
            throw new Error(`Batch processing failed: ${jobStatus.errors ? JSON.stringify(jobStatus.errors) : 'Unknown error'}`);
          } else {
            // 等待一段时间后再次检查
            await new Promise(resolve => setTimeout(resolve, this.config.pollingInterval));
          }
        } catch (error) {
          verboseWithWarning.log(`Error polling batch job: ${error}`);
          throw new Error(`Failed to poll batch job: ${error}`);
        }
      }
      
      // 下载输出文件
      verboseWithWarning.log(`Downloading batch ${batchIndex + 1} output file`);
      const outputFilePath = path.join(this.config.outputDir, `${openAIBatch.id}_output.jsonl`);
      
      try {
        const outputFileContent = await this.downloadOutputFile(openAIBatch.id);
        await fs.writeFile(outputFilePath, outputFileContent);
      } catch (error) {
        verboseWithWarning.log(`Error downloading output file: ${error}`);
        throw new Error(`Failed to download output file: ${error}`);
      }
      
      // 解析输出结果
      verboseWithWarning.log(`Parsing batch ${batchIndex + 1} results`);
      let batchResponses: BatchResponse[] = [];
      
      try {
        const outputFileLines = (await fs.readFile(outputFilePath, 'utf-8')).split('\n').filter(Boolean);
        batchResponses = outputFileLines.map(line => {
          const response = JSON.parse(line);
          return {
            ...response,
            openai_batch_id: openAIBatch.id
          };
        });
      } catch (error) {
        verboseWithWarning.log(`Error parsing output file: ${error}`);
        throw new Error(`Failed to parse output file: ${error}`);
      }
      
      // 处理结果
      const successfulResults: BatchRenameResult[] = [];
      const failedResults: { customId: string, error: any }[] = [];
      
      for (const response of batchResponses) {
        try {
          const task = this.taskMap.get(response.custom_id);
          if (!task) {
            verboseWithWarning.log(`Task not found for custom_id: ${response.custom_id}`);
            continue;
          }
          
          if (response.response.status_code !== 200 || response.response.error) {
            failedResults.push({
              customId: response.custom_id,
              error: response.response.error || `Status code: ${response.response.status_code}`
            });
            continue;
          }
          
          const content = response.response.body.choices[0].message.content;
          let result: { newName: string };
          
          try {
            result = JSON.parse(content);
          } catch (jsonError) {
            failedResults.push({
              customId: response.custom_id,
              error: `Invalid JSON response: ${content}`
            });
            continue;
          }
          
          successfulResults.push({
            originalName: task.name,
            newName: result.newName,
            surroundingCode: task.surroundingCode,
            customId: response.custom_id,
            filePath: task.filePath,
            file_id: task.file_id,
            batch_id: response.openai_batch_id,
            project_id: this.config.projectId
          });
        } catch (error) {
          verboseWithWarning.log(`Error processing result: ${error}`);
          if (response.custom_id) {
            failedResults.push({
              customId: response.custom_id,
              error: `Processing error: ${error}`
            });
          }
        }
      }
      
      // 将结果添加到对应文件的结果集合中
      for (const result of successfulResults) {
        const filePath = this.taskMap.get(result.customId)?.filePath;
        if (!filePath) {
          verboseWithWarning.log(`Warning: Could not find file path for custom ID ${result.customId}`);
          continue;
        }
        
        if (!this.fileResults.has(filePath)) {
          this.fileResults.set(filePath, []);
        }
        
        this.fileResults.get(filePath)!.push(result);
      }
      
      // 记录批处理性能指标
      const processingTime = Date.now() - batchStartTime;
      this.performanceMetrics.push({
        batchSize: batch.length,
        processingTime,
        avgContextSize,
        successRate: successfulResults.length / batch.length,
        apiLatency: processingTime,
        project_id: this.config.projectId
      });
      
      verboseWithWarning.log(`Batch ${batchIndex + 1} completed in ${processingTime}ms with ${successfulResults.length}/${batch.length} successful renames`);
    }
    
    return this.fileResults;
  }
  
  // 应用结果到各个文件
  async applyResults(): Promise<Map<string, string>> {
    verboseWithWarning.log(`Applying rename results to files`);
    
    const renamedFiles = new Map<string, string>();
    
    for (const [filePath, results] of this.fileResults.entries()) {
      verboseWithWarning.log(`Applying ${results.length} renames to ${filePath}`);
      
      // 获取原始代码
      const originalCode = this.fileContents.get(filePath) || "";
      
      // 使用并行处理应用重命名
      try {
        const renamedCode = await visitAllIdentifiersParallel(
          originalCode,
          async (name: string, surroundingCode: string) => {
            // 在批处理结果中查找匹配的重命名
            const matchingRename = results.find(
              result => result.originalName === name && 
                      surroundingCode.includes(result.surroundingCode)
            );
            
            if (matchingRename) {
              verboseWithWarning.log(`Renaming ${name} to ${matchingRename.newName}`);
              return matchingRename.newName;
            }
            
            return name; // 如果没有找到匹配项，则保留原始名称
          },
          Infinity, // 使用最大上下文大小确保准确匹配
          (percentage: number) => verboseWithWarning.log(`Applying renames to ${path.basename(filePath)}: ${Math.floor(percentage * 1024)}%`),
          this.config.concurrency // 使用指定的并行度
        );
        
        renamedFiles.set(filePath, renamedCode);
      } catch (error) {
        verboseWithWarning.log(`Error applying renames to ${filePath}: ${error}`);
        throw new Error(`Failed to apply renames to ${filePath}: ${error}`);
      }
    }
    
    return renamedFiles;
  }
  
  // 计算标识符复杂度
  private calculateIdentifierComplexity(name: string, surroundingCode: string): number {
    // 基础复杂度：上下文长度
    let complexity = surroundingCode.length;
    
    // 增加基于嵌套深度的复杂度
    const nestingLevel = (surroundingCode.match(/{/g) || []).length;
    complexity += nestingLevel * 10;
    
    // 增加基于标识符用法的复杂度
    const usageCount = (surroundingCode.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
    complexity += usageCount * 5;
    
    // 检测关键语法结构
    if (surroundingCode.includes('class ')) complexity += 20;
    if (surroundingCode.includes('function ')) complexity += 15;
    if (surroundingCode.includes('async ')) complexity += 10;
    if (surroundingCode.includes('try') && surroundingCode.includes('catch')) complexity += 15;
    
    return complexity;
  }
  
  // 调整批处理大小
  private adaptBatchSize(): number {
    // 获取最近几次批次的指标
    const recentMetrics = this.performanceMetrics.slice(-2);
    
    if (recentMetrics.length < 2) {
      return this.currentBatchSize; // 不足以作出判断
    }
    
    // 计算平均指标
    const avgProcessingTime = recentMetrics.reduce((sum, m) => sum + m.processingTime, 0) / recentMetrics.length;
    const avgSuccessRate = recentMetrics.reduce((sum, m) => sum + m.successRate, 0) / recentMetrics.length;
    const avgContextSize = recentMetrics.reduce((sum, m) => sum + m.avgContextSize, 0) / recentMetrics.length;
    const avgApiLatency = recentMetrics.reduce((sum, m) => sum + m.apiLatency, 0) / recentMetrics.length;
    
    // 决策逻辑 - 基于多个因素调整批处理大小
    let newBatchSize = this.currentBatchSize;
    
    // 1. 根据成功率调整
    if (avgSuccessRate < 0.85) {
      // 成功率低，减小批处理大小
      newBatchSize = Math.round(this.currentBatchSize * 0.8);
    } else if (avgSuccessRate > 0.95 && avgProcessingTime < 10000) {
      // 成功率高且处理时间合理，可以增加批处理大小
      newBatchSize = Math.round(this.currentBatchSize * 1.2);
    }
    
    // 2. 根据上下文大小调整
    if (avgContextSize > COMPLEXITY_THRESHOLD * 2) {
      // 上下文非常大，减小批处理大小
      newBatchSize = Math.min(newBatchSize, Math.round(this.currentBatchSize * 0.7));
    }
    
    // 3. 根据API延迟调整
    if (avgApiLatency > 60000) { // 1分钟
      // API响应慢，减小批处理大小以降低单次失败风险
      newBatchSize = Math.min(newBatchSize, Math.round(this.currentBatchSize * 0.9));
    } else if (avgApiLatency < 10000) { // 10秒
      // API响应快，可以适当增加批处理大小
      newBatchSize = Math.max(newBatchSize, Math.round(this.currentBatchSize * 1.1));
    }
    
    // 确保批处理大小在允许范围内
    return Math.max(this.config.minBatchSize, Math.min(this.config.maxBatchSize, newBatchSize));
  }
  
  // 创建重命名提示
  private toRenamePrompt(
    name: string,
    surroundingCode: string,
    model: string
  ): any {
    return {
      model,
      messages: [
        {
          role: "system",
          content: `You are a code understanding assistant that helps to determine what a variable does based on surrounding code, and suggest a descriptive, semantically meaningful name for it.
  
Do NOT use Hungarian notation.
Do NOT repeat the original name unless it's already descriptive.
Do NOT use "value" or "instance" as a suffix.
Prefer descriptive single words where possible, or multiple words in camelCase.
Follow the project's naming conventions (e.g. if other variables use camelCase, use camelCase).`
        },
        {
          role: "user",
          content: `Please analyze the following JavaScript code with the variable/function name "${name}" and suggest a more descriptive name that reflects what this variable or function does based on the surrounding context. Here's the code snippet:

\`\`\`javascript
${surroundingCode}
\`\`\`

Respond with ONLY valid JSON in the format:
{"newName": "yourSuggestedName"}

The name should be descriptive, reflect the purpose or role, and follow JavaScript naming conventions.`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    };
  }
  
  // 获取文件路径哈希
  private getFilePathHash(filePath: string): string {
    return crypto
      .createHash("md5")
      .update(filePath)
      .digest("hex")
      .substring(0, 10);
  }
  
  // 获取任务数量
  getTaskCount(): number {
    return this.tasks.length;
  }
  
  // 获取文件数量
  getFileCount(): number {
    return this.fileContents.size;
  }
  
  // 获取性能指标
  getPerformanceMetrics(): BatchPerformanceMetrics[] {
    return this.performanceMetrics;
  }
  
  // 仅生成批处理文件，不发送API请求（用于dry-run模式）
  async generateBatchesOnly(): Promise<void> {
    verboseWithWarning.log(`Generating batch files only (dry-run mode)`);
    
    // 创建最优批次
    const batches = this.createOptimalBatches();
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verboseWithWarning.log(`Generating batch ${batchIndex + 1}/${batches.length} with ${batch.length} tasks`);
      
      // 计算当前批次的平均上下文大小
      const avgContextSize = batch.reduce((sum, item) => sum + item.surroundingCode.length, 0) / batch.length;
      verboseWithWarning.log(`Batch ${batchIndex + 1} average context size: ${Math.round(avgContextSize)} characters`);
      
      // 为每个任务的文件创建输出目录
      const uniqueFilePaths = [...new Set(batch.map(task => task.filePath))];
      for (const filePath of uniqueFilePaths) {
        const fileHash = this.getFilePathHash(filePath);
        const resultDir = path.join(this.config.outputDir, fileHash);
        await fs.mkdir(resultDir, { recursive: true });
        
        // 保存原始文件
        if (!this.fileResults.has(filePath)) {
          const originalFilePath = path.join(resultDir, "original.js");
          await fs.writeFile(originalFilePath, this.fileContents.get(filePath) || "");
        }
      }
      
      // 创建批处理任务文件
      const tasks = batch.map(item => ({
        custom_id: item.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: this.toRenamePrompt(item.name, item.surroundingCode, this.config.model)
      }));
      
      // 使用唯一的临时文件名
      const tempId = crypto.randomUUID().substring(0, 8);
      const batchTasksFilePath = path.join(this.config.outputDir, `batch_tasks_${tempId}.jsonl`);
      
      await fs.writeFile(
        batchTasksFilePath, 
        tasks.map(task => JSON.stringify(task)).join('\n')
      );
      
      // 保存批次细节（用于后续检查）
      const batchDetailsFilePath = path.join(this.config.outputDir, `batch_details_${tempId}.json`);
      await fs.writeFile(
        batchDetailsFilePath,
        JSON.stringify({
          batchIndex,
          taskCount: batch.length,
          avgContextSize,
          taskIds: batch.map(item => item.customId),
          createdAt: new Date().toISOString(),
          configuration: {
            model: this.config.model,
            contextWindowSize: this.config.contextWindowSize,
            batchSize: this.currentBatchSize,
            adaptiveBatching: this.config.adaptiveBatching
          }
        }, null, 2)
      );
      
      verboseWithWarning.log(`Generated batch file: ${batchTasksFilePath}`);
      verboseWithWarning.log(`Generated batch details: ${batchDetailsFilePath}`);
    }
    
    // 保存全局任务索引
    const taskIndexFilePath = path.join(this.config.outputDir, "task_index.json");
    await fs.writeFile(
      taskIndexFilePath,
      JSON.stringify({
        totalTasks: this.tasks.length,
        totalFiles: this.fileContents.size,
        batchCount: batches.length,
        batchSize: this.currentBatchSize,
        createdAt: new Date().toISOString(),
        configuration: {
          model: this.config.model,
          contextWindowSize: this.config.contextWindowSize,
          adaptiveBatching: this.config.adaptiveBatching,
          minBatchSize: this.config.minBatchSize,
          maxBatchSize: this.config.maxBatchSize
        }
      }, null, 2)
    );
    
    verboseWithWarning.log(`All batch files generated successfully. See: ${this.config.outputDir}`);
  }
  
  // 下载输出文件的实现
  private async downloadOutputFile(batchId: string): Promise<string> {
    verboseWithWarning.log(`Downloading output file for batch: ${batchId}`);
    
    try {
      const batchInfo = await this.client.batches.retrieve(batchId);
      if (!batchInfo.output_file_id) {
        throw new Error(`No output file ID found for batch: ${batchId}`);
      }
      
      const resultContentStream = await this.client.files.content(batchInfo.output_file_id);
      
      // 处理不同的响应类型
      if (resultContentStream instanceof Uint8Array) {
        return new TextDecoder().decode(resultContentStream);
      } else {
        // 作为流或其他响应类型处理
        const chunks = [];
        for await (const chunk of resultContentStream as any) {
          chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        }
        return chunks.join('');
      }
    } catch (error) {
      verboseWithWarning.log(`Error downloading output file: ${error}`);
      throw new Error(`Failed to download output file: ${error}`);
    }
  }

  // 在 GlobalTaskPool 类中添加数据库相关方法
  async addTaskToDB(task: IdentifierTask): Promise<string | undefined> {
    if (!this.config.projectId) return undefined;
    
    try {
      // 创建标识符记录
      const result = await dbHelpers.createIdentifiers([{
        file_id: task.file_id || '',
        chunk_id: task.chunk_id,
        original_name: task.name,
        surrounding_code: task.surroundingCode,
        custom_id: task.customId,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: this.config.projectId
      }]);
      
      if (result.success && result.identifierIds && result.identifierIds.length > 0) {
        verboseWithWarning.log(`Added identifier to DB: ${task.name} (${result.identifierIds[0]})`);
        return result.identifierIds[0];
      }
      
      verboseWithWarning.warn(`Failed to add identifier to DB: ${result.error}`);
      return undefined;
    } catch (error) {
      verboseWithWarning.warn(`Error adding task to DB: ${error}`);
      return undefined;
    }
  }

  async saveBatchToDB(batch: IdentifierTask[], batchId: string, taskFilePath: string): Promise<string | undefined> {
    if (!this.config.projectId) return undefined;
    
    try {
      // 收集文件ID
      const fileIds = [...new Set(batch.filter(task => task.file_id).map(task => task.file_id!))];
      
      // 创建本地批处理跟踪记录
      const result = await dbHelpers.createLocalBatchTracker({
        id: batchId,
        openai_batch_id: '', // 将在提交批处理后更新
        type: 'small', // 默认类型，可以根据实际情况调整
        file_ids: fileIds,
        identifier_count: batch.length,
        tasks_file_path: taskFilePath,
        processing_run_id: '', // 处理运行ID，可能需要从外部传入
        processing_start: new Date(),
        processing_end: undefined,
        status: 'preparing',
        created_at: new Date(),
        updated_at: new Date(),
        error: undefined,
        project_id: this.config.projectId
      });
      
      if (result.success && result.trackerId) {
        verboseWithWarning.log(`Created batch in DB: ${result.trackerId}`);
        
        // 更新批次中的标识符，关联到此批次
        for (const task of batch) {
          if (task.customId) {
            await dbHelpers.updateIdentifier(
              task.customId,
              task.name,
              'pending',
              result.trackerId // 将批次ID作为参数传递
            );
          }
        }
        
        return result.trackerId;
      }
      
      verboseWithWarning.warn(`Failed to create batch in DB: ${result.error}`);
      return undefined;
    } catch (error) {
      verboseWithWarning.warn(`Error saving batch to DB: ${error}`);
      return undefined;
    }
  }

  async updateBatchStatus(batchId: string, status: ILocalBatchTracker['status'], error?: string): Promise<boolean> {
    if (!this.config.projectId || !batchId) return false;
    
    try {
      const result = await dbHelpers.updateLocalBatchTrackerStatus(batchId, status, error);
      return result.success;
    } catch (error) {
      verboseWithWarning.warn(`Error updating batch status: ${error}`);
      return false;
    }
  }

  async saveOpenAIBatchInfo(batchId: string, openAIBatchId: string, inputPath: string): Promise<boolean> {
    if (!this.config.projectId || !batchId || !openAIBatchId) return false;
    
    try {
      // 更新本地批处理跟踪记录的 OpenAI 批处理 ID
      const updateResult = await dbHelpers.updateLocalBatchTrackerOpenAIBatchId(batchId, openAIBatchId);
      
      // 创建 OpenAI 批处理记录
      const batchResult = await dbHelpers.createOpenAIBatch({
        id: openAIBatchId,
        status: 'created',
        created_at: new Date(),
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        total_requests: 0, // 将在状态更新时填充
        completed_requests: 0,
        failed_requests: 0,
        input_file_id: '',
        input_file_path: inputPath,
        events: [{
          timestamp: new Date(),
          status: 'created'
        }],
        project_id: this.config.projectId
      });
      
      return updateResult.success && batchResult.success;
    } catch (error) {
      verboseWithWarning.warn(`Error saving OpenAI batch info: ${error}`);
      return false;
    }
  }
} 