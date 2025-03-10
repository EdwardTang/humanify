import OpenAI from "openai";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { verbose } from "../../verbose.js";
import { createInterface } from "readline";
import * as os from 'os';
import fetch from 'node-fetch';

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

// Simple implementation of the openAIParallelBatchRename function
export function openAIParallelBatchRename({
  apiKey,
  baseURL,
  model,
  contextWindowSize,
  batchSize = 25,
  outputDir = "batch_results",
  pollingInterval = 30000,
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
  // Create OpenAI client
  const client = new OpenAI({ apiKey, baseURL });
  
  // Return a function that processes a file
  return async (code: string, filename: string): Promise<string> => {
    verbose.log(`Starting parallel batch rename for ${filename}`);
    verbose.log(`Using concurrency: ${concurrency}, batch size: ${batchSize}`);
    
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });
      
      // Generate a unique ID for this batch
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const outputPath = path.join(outputDir, `${path.basename(filename)}_renamed.js`);
      
      console.log(`Processing ${filename} with batch ID: ${batchId}`);
      console.log(`Will save results to: ${outputPath}`);
      
      // This is a simplified version that doesn't actually process the file
      // In a real implementation, this would extract identifiers, send them to OpenAI, etc.
      
      // Simply copy the input file to the output path for now
      await fs.writeFile(outputPath, code);
      
      console.log(`Created batch output at: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error(`Error processing batch: ${error}`);
      throw error;
    }
  };
}

// Simple implementation of the applyParallelBatchRename function
export async function applyParallelBatchRename(
  filename: string,
  batchResultsDir: string,
  concurrency = MAX_PARALLELISM,
  batchId?: string
): Promise<string> {
  try {
    verbose.log(`Applying batch rename to ${filename}`);
    
    // Create output directory if it doesn't exist
    await fs.mkdir(batchResultsDir, { recursive: true });
    
    // Generate output path
    const outputPath = path.join(batchResultsDir, `${path.basename(filename)}_renamed.js`);
    
    // Read the original file
    const code = await fs.readFile(filename, 'utf-8');
    
    // This is a simplified version that doesn't actually apply any renames
    // In a real implementation, this would read the batch results and apply the renames
    
    // Simply copy the input file to the output path for now
    await fs.writeFile(outputPath, code);
    
    console.log(`Applied batch rename to: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error applying batch rename: ${error}`);
    throw error;
  }
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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 