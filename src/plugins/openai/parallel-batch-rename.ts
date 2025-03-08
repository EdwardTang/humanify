import OpenAI from "openai";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { verbose } from "../../verbose.js";
import { createInterface } from "readline";
import * as os from 'os';
import * as dbHelpers from "../../db/helpers.js";
import fetch from 'node-fetch';
import { IFile, IIdentifier } from '../../db/models.js';

// 获取CPU核心数，但限制最大并行度
const MAX_PARALLELISM = Math.min(os.cpus().length, 8);

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

// 批处理结果类型
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

export function openAIParallelBatchRename({
  apiKey,
  baseURL,
  model,
  contextWindowSize,
  batchSize = 25,
  outputDir = "batch_results",
  pollingInterval = 30000, // 30 seconds by default
  concurrency = MAX_PARALLELISM,
  completionWindow = "24h",
  trackEvents = true,
  storeMetadata = false,
  projectId = 'default'
}: {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize?: number;
  outputDir?: string;
  pollingInterval?: number;
  concurrency?: number;
  completionWindow?: string;
  trackEvents?: boolean;
  storeMetadata?: boolean;
  projectId?: string;
}) {
  const client = new OpenAI({ apiKey, baseURL });
  
  return async (code: string, filename: string): Promise<string> => {
    verbose.log(`Starting parallel batch rename for ${filename}`);
    verbose.log(`Using concurrency: ${concurrency}, batch size: ${batchSize}`);
    
    // 创建处理运行记录
    const { success: runSuccess, runId, error: runError } = await dbHelpers.startProcessingRun(
      JSON.stringify({
        filename,
        model,
        contextWindowSize,
        batchSize,
        concurrency,
        completionWindow
      }),
      1, // 只处理一个文件
      projectId
    );
    
    if (!runSuccess || !runId) {
      throw new Error(`无法创建处理运行记录: ${runError}`);
    }
    
    // Create output directory based on file path
    const filePathHash = getFilePathHash(filename);
    const resultDir = path.join(outputDir, filePathHash);
    await fs.mkdir(resultDir, { recursive: true });
    
    // Save the original code to output directory
    const originalFilePath = path.join(resultDir, "original.js");
    await fs.writeFile(originalFilePath, code);
    
    // 将文件信息同步到数据库
    const { success: syncSuccess, error: syncError } = await dbHelpers.syncFilesToDatabase(
      [{ path: filename, size: code.length }],
      projectId
    );
    
    if (!syncSuccess) {
      throw new Error(`无法同步文件到数据库: ${syncError}`);
    }
    
    // 导入并行标识符收集器
    verbose.log(`Importing parallel identifier collector...`);
    let visitAllIdentifiersParallel: any;
    
    try {
      const parallelModule = await import('../local-llm-rename/parallel-visit-identifiers.js');
      visitAllIdentifiersParallel = parallelModule.visitAllIdentifiersParallel;
      
      if (!visitAllIdentifiersParallel) {
        throw new Error('Parallel visitor function not found');
      }
    } catch (error) {
      verbose.log(`Error importing parallel visitor: ${error}`);
      verbose.log(`Falling back to standard batch processor...`);
      
      // 这里我们可以退回到标准的 batch processor，但暂时就抛出错误
      throw new Error(`Failed to import parallel visitor: ${error}`);
    }
    
    // 收集标识符集合 - 使用并行方式
    const identifiersToRename: { 
      name: string;
      surroundingCode: string;
      customId: string;
      file_id?: string;
      project_id?: string;
    }[] = [];
    
    verbose.log(`Starting parallel identifier collection...`);
    
    // 查找数据库中的文件记录
    const files = await dbHelpers.getPendingFilesByCategory(projectId);
    if (!files.success || !files.files) {
      throw new Error(`无法获取待处理文件: ${files.error}`);
    }
    
    // 找到当前文件的ID
    let fileId = '';
    for (const category of ['small', 'large', 'ultra_large'] as const) {
      const file = files.files[category].find(f => f.path === filename);
      if (file) {
        fileId = file._id?.toString() || file.id;
        // 更新文件状态为处理中
        await dbHelpers.updateFileStatus(fileId, 'processing');
        break;
      }
    }
    
    if (!fileId) {
      throw new Error(`未找到文件记录: ${filename}`);
    }
    
    // 我们创建一个特殊的访问者函数，该函数只收集标识符而不进行重命名
    await visitAllIdentifiersParallel(
      code,
      async (name: string, surroundingCode: string) => {
        const customId = `id-${crypto.randomUUID()}`;
        identifiersToRename.push({
          name,
          surroundingCode,
          customId,
          file_id: fileId,
          project_id: projectId
        });
        return name; // 返回原始名称，不进行重命名
      },
      contextWindowSize,
      (percentage: number) => verbose.log(`Collecting identifiers in parallel: ${Math.floor(percentage * 100)}%`),
      concurrency // 使用指定的并行度
    );
    
    verbose.log(`Collected ${identifiersToRename.length} identifiers for batch renaming`);
    
    // 保存标识符到数据库
    const identifiersForDb = identifiersToRename.map(item => ({
      original_name: item.name,
      surrounding_code: item.surroundingCode,
      custom_id: item.customId
    }));
    
    const { success: createSuccess, count, error: createError } = await dbHelpers.createIdentifiers(
      identifiersForDb,
      fileId,
      undefined, // 没有分块
      projectId
    );
    
    if (!createSuccess) {
      throw new Error(`无法创建标识符记录: ${createError}`);
    }
    
    verbose.log(`Saved ${count} identifiers to database`);
    
    // 获取用于批处理的标识符
    const { success: batchSuccess, batches, error: batchError } = await dbHelpers.getIdentifiersForBatching(
      batchSize,
      true, // 跳过已完成的
      projectId
    );
    
    if (!batchSuccess) {
      throw new Error(`无法获取批处理标识符: ${batchError}`);
    }
    
    verbose.log(`Created ${batches.length} batches from database`);
    
    const batchResultsFilePath = path.join(resultDir, "batch_results.json");
    
    // 创建批处理任务
    const allRenameResults: BatchRenameResult[] = [];
    
    verbose.log(`Processing ${batches.length} batches with batch size ${batchSize}`);
    
    // 记录处理开始时间
    const batchJobStartTime = Date.now();
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verbose.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.identifiers.length} identifiers`);
      
      // 创建批处理任务文件
      const batchRequests: BatchRequest[] = batch.identifiers.map(item => ({
        custom_id: item.custom_id,
        method: "POST",
        url: "/v1/chat/completions",
        body: toRenamePrompt(item.original_name, item.surrounding_code, model),
        project_id: projectId
      }));
      
      const tempId = crypto.randomUUID().substring(0, 8);
      const batchTasksFilePath = path.join(resultDir, `batch_tasks_${tempId}.jsonl`);
      await fs.writeFile(
        batchTasksFilePath, 
        batchRequests.map(request => JSON.stringify(request)).join('\n')
      );
      
      // 上传文件进行批处理
      verbose.log(`Uploading batch ${batchIndex + 1} to OpenAI`);
      const batchFile = await client.files.create({
        file: fsSync.createReadStream(batchTasksFilePath),
        purpose: "batch"
      });
      
      // 创建批处理作业
      verbose.log(`Creating batch job for batch ${batchIndex + 1}`);
      
      let openAIBatchResponse: any;
      try {
        openAIBatchResponse = await client.batches.create({
          input_file_id: batchFile.id,
          endpoint: "/v1/chat/completions",
          completion_window: completionWindow as "24h"
        });
        
        // 更新批处理请求中的OpenAI批处理ID
        const openAIBatchId = openAIBatchResponse.id;
        batchRequests.forEach(req => req.openai_batch_id = openAIBatchId);
        
        // 创建批处理作业记录
        await dbHelpers.createBatchJob(
          batch.id,
          openAIBatchId,
          batchTasksFilePath,
          batchRequests.length,
          projectId
        );
        
        // 创建本地批处理跟踪记录
        const fileIdsInBatch = Array.from(new Set(batch.identifiers.map(i => i.file_id.toString())));
        await dbHelpers.createLocalBatchTracker(
          openAIBatchId,
          'small', // TODO: 根据文件大小确定类型
          fileIdsInBatch,
          batch.identifiers.length,
          batchTasksFilePath,
          runId,
          projectId
        );
        
        // 保存请求到数据库
        for (const request of batchRequests) {
          await dbHelpers.saveBatchRequest(
            request.custom_id,
            request.method,
            request.url,
            request.body,
            openAIBatchId,
            projectId
          );
        }
        
        // 创建批处理事件记录
        const batchEvents: BatchEvent[] = [{
          timestamp: new Date(),
          status: 'created',
          details: `Batch created with ${batchRequests.length} rename requests`
        }];
        
        // 轮询批处理作业状态
        verbose.log(`Polling batch job status for batch ${batchIndex + 1} (ID: ${openAIBatchId})`);
        let isCompleted = false;
        let failedAttempts = 0;
        const MAX_FAILED_ATTEMPTS = 5;
        
        while (!isCompleted && failedAttempts < MAX_FAILED_ATTEMPTS) {
          try {
            // 等待指定的轮询间隔
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
            
            // 检查批处理作业状态
            const batchStatus = await client.batches.retrieve(openAIBatchId);
            const currentStatus = batchStatus.status;
            
            // 更新批处理作业状态
            await dbHelpers.updateBatchJobStatus(
              openAIBatchId,
              currentStatus as any,
              `Batch ${currentStatus}: ${batchStatus.completed_at ? 'Completed' : 'In progress'}`
            );
            
            const statusEvent: BatchEvent = {
              timestamp: new Date(),
              status: currentStatus as any,
              details: `Batch status updated to ${currentStatus}`
            };
            
            batchEvents.push(statusEvent);
            
            if (currentStatus === 'completed') {
              isCompleted = true;
              verbose.log(`Batch ${batchIndex + 1} completed successfully`);
              
              // 下载输出文件
              verbose.log(`Downloading output file for batch ${batchIndex + 1}`);
              const outputFilePath = await downloadOutputFile(client, batchStatus.id);
              
              // 更新本地批处理跟踪记录
              await dbHelpers.updateLocalBatchTracker(
                batch.id,
                'downloading',
                outputFilePath
              );
              
              // 解析批处理结果
              verbose.log(`Parsing batch results for batch ${batchIndex + 1}`);
              const batchResults: BatchRenameResult[] = [];
              
              // 读取结果文件
              const fileStream = fsSync.createReadStream(outputFilePath);
              const rl = createInterface({
                input: fileStream,
                crlfDelay: Infinity
              });
              
              // 逐行处理结果
              for await (const line of rl) {
                try {
                  const response = JSON.parse(line) as BatchResponse;
                  
                  // 获取对应的请求对象
                  const request = batchRequests.find(req => req.custom_id === response.custom_id);
                  if (!request) {
                    verbose.log(`Warning: Could not find matching request for response with custom_id ${response.custom_id}`);
                    continue;
                  }
                  
                  // 保存响应到数据库
                  const { success: saveSuccess, error: saveError } = await dbHelpers.saveBatchResponse(
                    request.custom_id, // 使用custom_id作为requestId
                    response.custom_id,
                    {
                      status_code: response.response.status_code,
                      request_id: response.response.request_id,
                      body: response.response.body,
                      error: response.response.error
                    },
                    openAIBatchId
                  );
                  
                  if (!saveSuccess) {
                    verbose.log(`Warning: Failed to save batch response: ${saveError}`);
                  }
                  
                  if (response.response.status_code === 200) {
                    const body = response.response.body;
                    if (body && body.choices && body.choices.length > 0) {
                      const content = body.choices[0].message.content;
                      
                      // 查找原始标识符
                      const identifier = batch.identifiers.find(i => i.custom_id === response.custom_id);
                      if (identifier) {
                        // 更新标识符的新名称和状态
                        await dbHelpers.updateIdentifier(
                          identifier._id?.toString() || identifier.id,
                          content,
                          'completed'
                        );
                        
                        // 添加到批处理结果中
                        batchResults.push({
                          originalName: identifier.original_name,
                          newName: content,
                          surroundingCode: identifier.surrounding_code,
                          customId: identifier.custom_id,
                          file_id: identifier.file_id.toString(),
                          batch_id: batch.id,
                          project_id: projectId
                        });
                      }
                    }
                  } else {
                    verbose.log(`Warning: Batch request failed with status code ${response.response.status_code}`);
                    
                    // 查找原始标识符并更新状态为失败
                    const identifier = batch.identifiers.find(i => i.custom_id === response.custom_id);
                    if (identifier) {
                      await dbHelpers.updateIdentifier(
                        identifier._id?.toString() || identifier.id,
                        identifier.original_name, // 保留原始名称
                        'failed'
                      );
                    }
                  }
                } catch (error) {
                  verbose.log(`Error parsing response: ${error}`);
                }
              }
              
              // 更新本地批处理跟踪记录
              await dbHelpers.updateLocalBatchTracker(
                batch.id,
                'applying'
              );
              
              // 添加到总结果中
              allRenameResults.push(...batchResults);
              
              // 更新本地批处理跟踪记录
              await dbHelpers.updateLocalBatchTracker(
                batch.id,
                'completed'
              );
              
              verbose.log(`Batch ${batchIndex + 1} processing completed with ${batchResults.length} successful renames`);
            } else if (currentStatus === 'failed') {
              isCompleted = true;
              const errorMessage = 'Batch processing failed';
              verbose.log(`Batch ${batchIndex + 1} failed: ${errorMessage}`);
              
              // 更新本地批处理跟踪记录
              await dbHelpers.updateLocalBatchTracker(
                batch.id,
                'failed',
                undefined,
                errorMessage
              );
              
              // 更新批处理中的标识符状态为失败
              for (const identifier of batch.identifiers) {
                await dbHelpers.updateIdentifier(
                  identifier._id?.toString() || identifier.id,
                  identifier.original_name, // 保留原始名称
                  'failed'
                );
              }
            } else {
              verbose.log(`Batch ${batchIndex + 1} status: ${currentStatus}`);
            }
          } catch (error) {
            failedAttempts++;
            verbose.log(`Error polling batch status (attempt ${failedAttempts}): ${error}`);
            
            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
              verbose.log(`Max failed attempts reached for batch ${batchIndex + 1}, moving to next batch`);
              
              // 更新本地批处理跟踪记录
              await dbHelpers.updateLocalBatchTracker(
                batch.id,
                'failed',
                undefined,
                `Max polling attempts reached: ${error}`
              );
              
              // 作为一种后备措施，将标识符状态设置为失败
              for (const identifier of batch.identifiers) {
                await dbHelpers.updateIdentifier(
                  identifier._id?.toString() || identifier.id,
                  identifier.original_name, // 保留原始名称
                  'failed'
                );
              }
            }
          }
        }
      } catch (error) {
        verbose.log(`Error creating batch job for batch ${batchIndex + 1}: ${error}`);
        
        // 作为一种后备措施，将标识符状态设置为失败
        for (const identifier of batch.identifiers) {
          await dbHelpers.updateIdentifier(
            identifier._id?.toString() || identifier.id,
            identifier.original_name, // 保留原始名称
            'failed'
          );
        }
      }
    }
    
    // 更新文件状态为已完成
    await dbHelpers.updateFileStatus(
      fileId,
      'completed',
      Date.now() - batchJobStartTime, // 处理时间
      undefined // 没有错误
    );
    
    // 更新处理运行状态
    await dbHelpers.updateProcessingRunProgress(
      runId,
      1, // 已处理1个文件
      0  // 没有失败
    );
    
    // 完成处理运行
    await dbHelpers.completeProcessingRun(
      runId,
      { status: 'completed' }
    );
    
    // 保存所有重命名结果
    await fs.writeFile(batchResultsFilePath, JSON.stringify(allRenameResults, null, 2));
    
    verbose.log(`All batches processed. Total rename results: ${allRenameResults.length}`);
    return code; // 返回原始代码，应用重命名需要使用另一个命令
  };
}

async function downloadOutputFile(client: OpenAI, batchId: string): Promise<string> {
  // 获取批处理输出文件
  const batchStatus = await client.batches.retrieve(batchId);
  
  if (!batchStatus.output_file_id) {
    throw new Error(`Batch ${batchId} has no output file`);
  }
  
  // 获取输出文件
  const batchOutputFile = await client.files.retrieve(batchStatus.output_file_id);
  
  // 使用类型断言获取download_url
  const fileDetails = batchOutputFile as any;
  const outputUrl = fileDetails.download_url;
  
  if (!outputUrl) {
    throw new Error(`Batch ${batchId} output file has no download URL`);
  }
  
  // 获取临时目录
  const tempDir = path.join(os.tmpdir(), 'openai-batch-output');
  await fs.mkdir(tempDir, { recursive: true });
  
  // 下载输出文件
  const outputFilePath = path.join(tempDir, `batch_output_${batchId}.jsonl`);
  
  // 使用fetch下载文件
  const response = await fetch(outputUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to download batch output file: ${response.statusText}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputFilePath, buffer);
  
  return outputFilePath;
}

function toRenamePrompt(
  name: string,
  surroundingCode: string,
  model: string
): any {
  // 基本提示
  const basePrompt = `You are a code renaming expert. Suggest a clear, descriptive name for the following minified identifier.
  
Original name: ${name}

Here is the surrounding code for context:
\`\`\`javascript
${surroundingCode}
\`\`\`

Reply with ONLY the suggested new name. No explanation, no code formatting, no surrounding text. Just the new name.`;

  // 根据模型构造请求体
  return {
    model,
    messages: [
      {
        role: "system",
        content: "You are a code renaming expert. Be concise and to the point. Provide ONLY the suggested new name, nothing else."
      },
      {
        role: "user",
        content: basePrompt
      }
    ],
    max_tokens: 50
  };
}

function getFilePathHash(filePath: string): string {
  const hash = crypto.createHash('md5');
  hash.update(filePath);
  return hash.digest('hex');
}

export async function applyParallelBatchRename(
  filename: string,
  batchResultsDir: string,
  concurrency = MAX_PARALLELISM,
  batchId?: string
): Promise<string> {
  verbose.log(`Applying batch rename results to ${filename}`);
  
  // 读取原始代码
  const code = await fs.readFile(filename, 'utf-8');
  
  // 获取文件路径哈希
  const filePathHash = getFilePathHash(filename);
  const resultDir = path.join(batchResultsDir, filePathHash);
  
  // 检查结果目录是否存在
  try {
    await fs.access(resultDir);
  } catch (error) {
    throw new Error(`Results directory not found for ${filename}. Please run batch rename first.`);
  }
  
  // 检查批处理结果文件是否存在
  const batchResultsFilePath = path.join(resultDir, "batch_results.json");
  
  try {
    await fs.access(batchResultsFilePath);
  } catch (error) {
    throw new Error(`Batch results file not found. Please run batch rename first.`);
  }
  
  // 读取批处理结果
  verbose.log(`Reading batch results from ${batchResultsFilePath}`);
  const batchResultsContent = await fs.readFile(batchResultsFilePath, 'utf-8');
  const allRenameResults: BatchRenameResult[] = JSON.parse(batchResultsContent);
  
  // 如果指定了批处理ID，只应用该批处理的结果
  let renameResults = allRenameResults;
  if (batchId) {
    renameResults = allRenameResults.filter(result => result.batch_id === batchId);
    verbose.log(`Filtered to ${renameResults.length} results for batch ID ${batchId}`);
  }
  
  // 应用重命名
  verbose.log(`Applying ${renameResults.length} renames to ${filename}`);
  
  // 我们先按标识符长度排序（从长到短），避免替换子串
  renameResults.sort((a, b) => b.originalName.length - a.originalName.length);
  
  // 创建替换对的数组
  const replacements = renameResults.map(result => ({
    original: result.originalName,
    replacement: result.newName
  }));
  
  // 使用并行访问器替换标识符
  let renamedCode = code;
  
  try {
    verbose.log(`Importing parallel identifier visitor...`);
    const parallelModule = await import('../local-llm-rename/parallel-visit-identifiers.js');
    const visitAllIdentifiersParallel = parallelModule.visitAllIdentifiersParallel;
    
    if (!visitAllIdentifiersParallel) {
      throw new Error('Parallel visitor function not found');
    }
    
    // 创建替换映射
    const replaceMap = new Map<string, string>();
    for (const { original, replacement } of replacements) {
      replaceMap.set(original, replacement);
    }
    
    // 使用并行访问器替换标识符
    renamedCode = await visitAllIdentifiersParallel(
      code,
      async (name: string) => {
        return replaceMap.get(name) || name;
      },
      4096, // 上下文窗口大小
      (percentage: number) => verbose.log(`Applying renames in parallel: ${Math.floor(percentage * 100)}%`),
      concurrency
    );
  } catch (error) {
    verbose.log(`Error using parallel visitor: ${error}`);
    verbose.log(`Falling back to sequential replacement...`);
    
    // 回退到简单的正则表达式替换
    renamedCode = code;
    for (const { original, replacement } of replacements) {
      // 使用正则表达式替换整个单词
      const regex = new RegExp(`\\b${escapeRegExp(original)}\\b`, 'g');
      renamedCode = renamedCode.replace(regex, replacement);
    }
  }
  
  return renamedCode;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 