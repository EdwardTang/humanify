import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import OpenAI from "openai";
import { verbose } from "../../verbose.js";
import { visitAllIdentifiersParallel } from '../../plugins/local-llm-rename/parallel-visit-identifiers.js';

// 复杂度阈值常量
const COMPLEXITY_THRESHOLD = 300;

// 标识符任务接口
export interface IdentifierTask {
  name: string;              // 标识符名称
  surroundingCode: string;   // 上下文代码
  customId: string;          // 唯一ID
  complexity: number;        // 复杂度
  filePath: string;          // 来源文件
  filePathHash: string;      // 文件路径哈希
}

// 批处理结果接口
export interface BatchRenameResult {
  originalName: string;
  newName: string;
  surroundingCode: string;
  customId: string;
}

// 性能指标接口
export interface BatchPerformanceMetrics {
  batchSize: number;
  processingTime: number;         // 毫秒
  avgContextSize: number;         // 平均上下文大小
  successRate: number;            // 成功率 (0-1)
  apiLatency: number;             // API响应时间
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
}

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
    
    verbose.log(`Collecting identifiers from file: ${filePath}`);
    
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
        (percentage: number) => verbose.log(`Collecting identifiers from ${path.basename(filePath)}: ${Math.floor(percentage * 100)}%`),
        this.config.concurrency
      );
      
      verbose.log(`Collected ${this.tasks.length - (this.taskMap.size - this.tasks.length)} identifiers from ${filePath}`);
    } catch (error) {
      verbose.log(`Error collecting identifiers from ${filePath}: ${error}`);
      throw new Error(`Failed to collect identifiers from ${filePath}: ${error}`);
    }
  }
  
  // 创建最优批次
  createOptimalBatches(batchSize: number = this.currentBatchSize): IdentifierTask[][] {
    verbose.log(`Creating optimal batches with target size: ${this.currentBatchSize}`);
    
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
    
    verbose.log(`Creating batches from ${this.tasks.length} tasks in ${sortedFilePaths.length} files`);
    
    // 处理优先级较高（较小文件）的任务
    for (const filePath of sortedFilePaths) {
      const fileTasks = tasksByFile[filePath];
      
      // 如果当前文件的任务数量超过了最大批处理大小
      // 则为这个文件单独创建多个批次
      if (fileTasks.length > MAX_BATCH_REQUESTS) {
        verbose.log(`File ${filePath} has ${fileTasks.length} tasks, which exceeds max batch size. Creating multiple batches.`);
        
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
              verbose.log(`Created batch for large file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
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
          verbose.log(`Created final batch for large file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
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
          verbose.log(`Created batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
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
                verbose.log(`Created batch for oversized file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
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
            verbose.log(`Created final batch for oversized file with ${fileTaskBatch.length} tasks, size: ${Math.round(fileTaskBatchBytes / (1024 * 1024))}MB`);
          }
        } else {
          // 文件任务可以放入一个批次，但需要单独放置
          batches.push(fileTasks);
          verbose.log(`Created batch for entire file with ${fileTasks.length} tasks, size: ${Math.round(fileTasksBytes / (1024 * 1024))}MB`);
        }
      } else {
        // 将所有文件任务添加到当前批次
        currentBatch.push(...fileTasks);
        currentBatchSize += fileTasks.length;
        currentBatchBytes += fileTasksBytes;
        
        // 如果当前批次足够大，创建新批次
        if (currentBatchSize >= this.config.batchSize) {
          batches.push(currentBatch);
          verbose.log(`Created batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
          currentBatch = [];
          currentBatchSize = 0;
          currentBatchBytes = 0;
        }
      }
    }
    
    // 添加最后一个批次（如果有）
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
      verbose.log(`Created final batch with ${currentBatch.length} tasks, size: ${Math.round(currentBatchBytes / (1024 * 1024))}MB`);
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
          
          verbose.log(`Adjusting batch size from ${this.currentBatchSize} to ${newBatchSize} based on workload`);
          this.currentBatchSize = newBatchSize;
        }
      }
    }
    
    verbose.log(`Created ${batches.length} batches from ${this.tasks.length} tasks`);
    return batches;
  }
  
  // 处理所有批次
  async processBatches(): Promise<Map<string, BatchRenameResult[]>> {
    verbose.log(`Starting to process all batches`);
    
    // 如果是 dry-run 模式，只生成批处理文件
    if (this.config.dryRun) {
      verbose.log(`Dry-run mode enabled, skipping API calls`);
      await this.generateBatchesOnly();
      return new Map<string, BatchRenameResult[]>();
    }
    
    // 创建最优批次
    const batches = this.createOptimalBatches();
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verbose.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} tasks`);
      
      // 记录批处理开始时间
      const batchStartTime = Date.now();
      
      // 计算当前批次的平均上下文大小
      const avgContextSize = batch.reduce((sum, item) => sum + item.surroundingCode.length, 0) / batch.length;
      verbose.log(`Batch ${batchIndex + 1} average context size: ${Math.round(avgContextSize)} characters`);
      
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
      
      // 上传文件进行批处理
      verbose.log(`Uploading batch ${batchIndex + 1} to OpenAI`);
      
      let batchFile;
      try {
        // 使用文件流上传
        batchFile = await this.client.files.create({
          file: fsSync.createReadStream(batchTasksFilePath),
          purpose: "batch"
        });
      } catch (error) {
        verbose.log(`Error uploading batch file: ${error}`);
        throw new Error(`Failed to upload batch file: ${error}`);
      }
      
      // 创建批处理作业
      verbose.log(`Creating batch job for batch ${batchIndex + 1}`);
      const batchJobStartTime = Date.now();
      
      let batchJob;
      try {
        batchJob = await this.client.batches.create({
          input_file_id: batchFile.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h"
        });
      } catch (error) {
        verbose.log(`Error creating batch job: ${error}`);
        throw new Error(`Failed to create batch job: ${error}`);
      }
      
      // 轮询批处理作业完成情况
      verbose.log(`Waiting for batch ${batchIndex + 1} to complete...`);
      let jobCompleted = false;
      let batchJobResult: any;
      
      while (!jobCompleted) {
        try {
          const jobStatus = await this.client.batches.retrieve(batchJob.id);
          verbose.log(`Batch ${batchIndex + 1} status: ${jobStatus.status}`);
          
          if (jobStatus.status === 'completed') {
            jobCompleted = true;
            batchJobResult = jobStatus;
          } else if (jobStatus.status === 'failed') {
            throw new Error(`Batch job ${batchJob.id} failed: ${JSON.stringify(jobStatus.errors || 'Unknown error')}`);
          } else {
            // 等待轮询间隔后再次检查
            await new Promise(resolve => setTimeout(resolve, this.config.pollingInterval));
          }
        } catch (error) {
          verbose.log(`Error polling batch job: ${error}`);
          throw new Error(`Failed to poll batch job: ${error}`);
        }
      }
      
      // 记录API延迟时间
      const apiLatency = Date.now() - batchJobStartTime;
      verbose.log(`Batch ${batchIndex + 1} API latency: ${apiLatency}ms`);
      
      // 获取结果
      verbose.log(`Retrieving results for batch ${batchIndex + 1}`);
      
      let resultContentText = '';
      try {
        const resultFileId = batchJobResult.output_file_id;
        const resultContentStream = await this.client.files.content(resultFileId);
        
        // 处理不同的响应类型
        if (resultContentStream instanceof Uint8Array) {
          resultContentText = new TextDecoder().decode(resultContentStream);
        } else {
          // 作为流或其他响应类型处理
          const chunks = [];
          for await (const chunk of resultContentStream as any) {
            chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
          }
          resultContentText = chunks.join('');
        }
      } catch (error) {
        verbose.log(`Error retrieving batch results: ${error}`);
        throw new Error(`Failed to retrieve batch results: ${error}`);
      }
      
      const resultLines = resultContentText.split('\n');
      const batchResults = resultLines
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      // 计算成功率
      const successCount = batchResults.filter(result => 
        result.response && result.response.body && 
        result.response.body.choices && 
        result.response.body.choices[0] && 
        result.response.body.choices[0].message
      ).length;
      const successRate = successCount / batch.length;
      
      verbose.log(`Batch ${batchIndex + 1} success rate: ${Math.round(successRate * 100)}%`);
      
      // 处理重命名结果
      for (const result of batchResults) {
        try {
          const customId = result.custom_id;
          const originalTask = this.taskMap.get(customId);
          
          if (!originalTask) {
            verbose.log(`Warning: Could not find original task for custom ID ${customId}`);
            continue;
          }
          
          const responseContent = result.response.body.choices[0].message.content;
          const parsedContent = JSON.parse(responseContent);
          
          // 将结果添加到对应文件的结果集合中
          if (!this.fileResults.has(originalTask.filePath)) {
            this.fileResults.set(originalTask.filePath, []);
          }
          
          this.fileResults.get(originalTask.filePath)!.push({
            originalName: originalTask.name,
            newName: parsedContent.newName,
            surroundingCode: originalTask.surroundingCode,
            customId: customId
          });
        } catch (error) {
          verbose.log(`Error processing result: ${error}`);
        }
      }
      
      // 为每个文件保存批次结果
      for (const [filePath, results] of this.fileResults.entries()) {
        const fileHash = this.getFilePathHash(filePath);
        const resultDir = path.join(this.config.outputDir, fileHash);
        const batchResultsFilePath = path.join(resultDir, "batch_results.json");
        
        await fs.writeFile(
          batchResultsFilePath,
          JSON.stringify(results, null, 2)
        );
      }
      
      // 记录批处理性能指标
      const processingTime = Date.now() - batchStartTime;
      this.performanceMetrics.push({
        batchSize: batch.length,
        processingTime,
        avgContextSize,
        successRate,
        apiLatency
      });
      
      verbose.log(`Batch ${batchIndex + 1} processing time: ${processingTime}ms`);
      
      // 如果启用了自适应批处理并且已处理了足够多的批次，调整批处理大小
      if (this.config.adaptiveBatching && (batchIndex + 1) % 2 === 0 && batchIndex < batches.length - 1) {
        const newBatchSize = this.adaptBatchSize();
        
        if (newBatchSize !== this.currentBatchSize) {
          verbose.log(`Adapting batch size from ${this.currentBatchSize} to ${newBatchSize} based on performance metrics`);
          
          // 更新当前批处理大小
          this.currentBatchSize = newBatchSize;
          
          // 重新创建剩余的批次
          const processedTaskIds = new Set<string>();
          // 收集所有已处理批次中的任务ID
          for (let i = 0; i <= batchIndex; i++) {
            batches[i].forEach((task: IdentifierTask) => {
              processedTaskIds.add(task.customId);
            });
          }
          
          const remainingTasks = this.tasks.filter(task => !processedTaskIds.has(task.customId));
          
          // 重新排序剩余任务
          remainingTasks.sort((a, b) => a.complexity - b.complexity);
          
          // 重新分配这些任务
          this.tasks = remainingTasks;
          
          // 重新创建批次
          batches.splice(batchIndex + 1);
          const newBatches = this.createOptimalBatches();
          batches.push(...newBatches);
          
          verbose.log(`Reorganized remaining work into ${newBatches.length} batches with size ${this.currentBatchSize}`);
        }
      }
      
      verbose.log(`Completed batch ${batchIndex + 1}/${batches.length}`);
      
      // 清理临时文件
      try {
        await fs.unlink(batchTasksFilePath);
      } catch (error) {
        verbose.log(`Warning: Could not delete temporary file ${batchTasksFilePath}: ${error}`);
      }
    }
    
    // 保存性能指标以供分析
    await fs.writeFile(
      path.join(this.config.outputDir, "performance_metrics.json"),
      JSON.stringify(this.performanceMetrics, null, 2)
    );
    
    verbose.log(`All batches processed. Results saved for ${this.fileResults.size} files`);
    
    return this.fileResults;
  }
  
  // 应用结果到各个文件
  async applyResults(): Promise<Map<string, string>> {
    verbose.log(`Applying rename results to files`);
    
    const renamedFiles = new Map<string, string>();
    
    for (const [filePath, results] of this.fileResults.entries()) {
      verbose.log(`Applying ${results.length} renames to ${filePath}`);
      
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
              verbose.log(`Renaming ${name} to ${matchingRename.newName}`);
              return matchingRename.newName;
            }
            
            return name; // 如果没有找到匹配项，则保留原始名称
          },
          Infinity, // 使用最大上下文大小确保准确匹配
          (percentage: number) => verbose.log(`Applying renames to ${path.basename(filePath)}: ${Math.floor(percentage * 100)}%`),
          this.config.concurrency // 使用指定的并行度
        );
        
        renamedFiles.set(filePath, renamedCode);
      } catch (error) {
        verbose.log(`Error applying renames to ${filePath}: ${error}`);
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
    verbose.log(`Generating batch files only (dry-run mode)`);
    
    // 创建最优批次
    const batches = this.createOptimalBatches();
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verbose.log(`Generating batch ${batchIndex + 1}/${batches.length} with ${batch.length} tasks`);
      
      // 计算当前批次的平均上下文大小
      const avgContextSize = batch.reduce((sum, item) => sum + item.surroundingCode.length, 0) / batch.length;
      verbose.log(`Batch ${batchIndex + 1} average context size: ${Math.round(avgContextSize)} characters`);
      
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
      
      verbose.log(`Generated batch file: ${batchTasksFilePath}`);
      verbose.log(`Generated batch details: ${batchDetailsFilePath}`);
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
    
    verbose.log(`All batch files generated successfully. See: ${this.config.outputDir}`);
  }
} 