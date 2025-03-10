import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { verbose } from '../utils/logger.js';
import axios from 'axios';
import * as dbHelpers from '../db/db-helpers-adapter.js';

export interface BatchOptimizerOptions {
  apiKey: string;
  baseURL: string;
  batchSize: number;
  outputDir: string;
  runId: string;
  projectId?: string;
}

export interface BatchResult {
  processed: number;
  total: number;
  skipped: number;
  errors: number;
}

export interface BatchJobResult {
  jobId: string;
  taskPath: string;
}

/**
 * BatchOptimizer类负责优化标识符批处理，减少API调用
 */
export class BatchOptimizer extends EventEmitter {
  private apiKey: string;
  private baseURL: string;
  private batchSize: number;
  private outputDir: string;
  private runId: string;
  private projectId?: string;
  private cachedResults: Map<string, string> = new Map();

  constructor(options: BatchOptimizerOptions) {
    super();
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
    this.batchSize = options.batchSize;
    this.outputDir = options.outputDir;
    this.runId = options.runId;
    this.projectId = options.projectId;
  }

  /**
   * 处理批次
   */
  async processBatch(batchId: string, identifiers: any[], model: string = 'gpt-4o-mini'): Promise<BatchResult> {
    verbose.log(`处理批次 ${batchId}, 包含 ${identifiers.length} 个标识符`);
    
    // 确保输出目录存在
    await fs.mkdir(this.outputDir, { recursive: true });
    
    // 生成请求
    const requests = await this.prepareRequests(identifiers, model);
    
    // 如果没有有效请求，直接返回
    if (requests.length === 0) {
      return { processed: 0, total: identifiers.length, skipped: identifiers.length, errors: 0 };
    }
    
    // 提交批次并获取结果
    const results = await this.sendBatchRequests(requests);
    
    // 处理结果并更新数据库
    const processedResult = await this.processResults(batchId, identifiers, results);
    
    return processedResult;
  }

  /**
   * 提交批处理作业
   */
  async submitBatchJob(batchId: string, identifiers: any[], model: string = 'gpt-4o-mini'): Promise<BatchJobResult> {
    verbose.log(`提交批处理作业 ${batchId}, 包含 ${identifiers.length} 个标识符`);
    
    // 确保输出目录存在
    await fs.mkdir(this.outputDir, { recursive: true });
    
    // 生成请求
    const requests = await this.prepareRequests(identifiers, model);
    
    // 创建批处理任务文件
    const taskFilePath = path.join(this.outputDir, `batch_tasks_${batchId}.jsonl`);
    await this.createBatchFile(requests, taskFilePath);
    
    // 提交批处理作业
    const jobId = await this.submitBatchToAPI(taskFilePath);
    
    return { jobId, taskPath: taskFilePath };
  }

  /**
   * 准备批处理请求
   */
  private async prepareRequests(identifiers: any[], model: string): Promise<any[]> {
    const requests: any[] = [];
    let processed = 0;
    
    for (const identifier of identifiers) {
      // 检查缓存
      if (this.cachedResults.has(identifier.original_name)) {
        // 使用缓存的结果
        const newName = this.cachedResults.get(identifier.original_name);
        await dbHelpers.updateIdentifier(identifier.id, {
          new_name: newName,
          status: 'completed'
        }, this.projectId);
        continue;
      }
      
      // 准备请求
      const prompt = this.toRenamePrompt(identifier.original_name, identifier.surrounding_code, model);
      
      const request = {
        custom_id: identifier.id,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model,
          messages: [
            {
              role: "system",
              content: "你是一位资深JavaScript程序员，负责将混淆代码中的标识符改为有意义的名称。请始终使用英文命名并遵循JavaScript命名约定。"
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1
        }
      };
      
      requests.push(request);
      processed++;
      
      // 达到批处理大小就停止
      if (processed >= this.batchSize) {
        break;
      }
    }
    
    return requests;
  }

  /**
   * 创建批处理文件
   */
  private async createBatchFile(requests: any[], filePath: string): Promise<void> {
    let content = '';
    for (const request of requests) {
      content += JSON.stringify(request) + '\n';
    }
    
    await fs.writeFile(filePath, content, 'utf-8');
    verbose.log(`已创建批处理文件: ${filePath}`);
  }

  /**
   * 向OpenAI API提交批处理作业
   */
  private async submitBatchToAPI(filePath: string): Promise<string> {
    const formData = new FormData();
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const file = new Blob([fileContent], { type: 'application/jsonl' });
    formData.append('file', file, path.basename(filePath));
    
    try {
      const response = await axios.post(
        `${this.baseURL}/batches`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );
      
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`提交批处理作业失败: ${response.status} ${response.statusText}`);
      }
      
      const jobId = response.data.id;
      verbose.log(`批处理作业已提交，作业ID: ${jobId}`);
      
      return jobId;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`提交批处理作业失败: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
      } else {
        throw new Error(`提交批处理作业失败: ${error.message}`);
      }
    }
  }

  /**
   * 发送批处理请求
   */
  private async sendBatchRequests(requests: any[]): Promise<any[]> {
    const results: any[] = [];
    
    try {
      for (const request of requests) {
        // 调用API
        const response = await axios.post(
          `${this.baseURL}${request.url}`,
          request.body,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        results.push({
          custom_id: request.custom_id,
          response: {
            status_code: response.status,
            body: response.data
          }
        });
      }
    } catch (error: any) {
      verbose.log(`发送批处理请求失败: ${error.message}`);
      if (error.response) {
        verbose.log(`响应状态: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
    
    return results;
  }

  /**
   * 处理批处理结果
   */
  private async processResults(batchId: string, identifiers: any[], results: any[]): Promise<BatchResult> {
    let processed = 0;
    let errors = 0;
    let skipped = 0;
    
    // 创建ID到标识符的映射
    const idToIdentifier = new Map();
    for (const identifier of identifiers) {
      idToIdentifier.set(identifier.id, identifier);
    }
    
    // 处理每个结果
    for (const result of results) {
      const identifier = idToIdentifier.get(result.custom_id);
      
      if (!identifier) {
        verbose.log(`找不到标识符: ${result.custom_id}`);
        continue;
      }
      
      try {
        // 提取新名称
        let newName = '';
        
        if (result.response.body && 
            result.response.body.choices && 
            result.response.body.choices.length > 0 &&
            result.response.body.choices[0].message &&
            result.response.body.choices[0].message.content) {
          // 尝试提取回复中的标识符
          newName = this.extractNewName(result.response.body.choices[0].message.content, identifier.original_name);
        }
        
        if (newName && newName !== identifier.original_name) {
          // 更新标识符
          await dbHelpers.updateIdentifier(identifier.id, {
            new_name: newName,
            status: 'completed'
          }, this.projectId);
          
          // 缓存结果
          this.cachedResults.set(identifier.original_name, newName);
          processed++;
        } else {
          // 跳过
          await dbHelpers.updateIdentifier(identifier.id, {
            status: 'skipped'
          }, this.projectId);
          skipped++;
        }
      } catch (error: any) {
        verbose.log(`处理标识符 ${identifier.id} 失败: ${error.message}`);
        
        // 更新为失败状态
        await dbHelpers.updateIdentifier(identifier.id, {
          status: 'failed',
          error: error.message
        }, this.projectId);
        
        errors++;
      }
    }
    
    // 处理未处理的标识符
    const processedIds = new Set(results.map(r => r.custom_id));
    for (const identifier of identifiers) {
      if (!processedIds.has(identifier.id)) {
        await dbHelpers.updateIdentifier(identifier.id, {
          status: 'skipped'
        }, this.projectId);
        skipped++;
      }
    }
    
    return {
      processed,
      total: identifiers.length,
      skipped,
      errors
    };
  }

  /**
   * 提取新名称
   */
  private extractNewName(content: string, originalName: string): string {
    // 尝试直接提取名称
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 检查是否只包含名称
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmedLine) && trimmedLine !== originalName) {
        return trimmedLine;
      }
      
      // 尝试从"new name: xxx"或"newName: xxx"格式提取
      const nameMatch = trimmedLine.match(/(?:new\s*name|newName)\s*:\s*["']?([a-zA-Z_$][a-zA-Z0-9_$]*)["']?/i);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== originalName) {
        return nameMatch[1];
      }
    }
    
    // 如果上述方法失败，尝试更宽松的提取
    const potentialNames: string[] = [];
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const codeBlock = match[1];
      const identifiers = codeBlock.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
      
      for (const identifier of identifiers) {
        if (identifier !== originalName && 
            !potentialNames.includes(identifier) && 
            !['const', 'let', 'var', 'function', 'class', 'if', 'else', 'return', 'true', 'false', 'null', 'undefined'].includes(identifier)) {
          potentialNames.push(identifier);
        }
      }
    }
    
    // 使用最频繁出现的标识符
    if (potentialNames.length > 0) {
      return potentialNames[0];
    }
    
    // 如果所有尝试都失败，返回原始名称
    return originalName;
  }

  /**
   * 创建重命名提示
   */
  private toRenamePrompt(name: string, surroundingCode: string, model: string): string {
    // 针对不同模型优化提示
    if (model.includes('gpt-4')) {
      return `以下是一段JavaScript代码中的标识符及其上下文。请将混淆的标识符重命名为有意义的名称，遵循JavaScript命名约定。

标识符: \`${name}\`

上下文代码:
\`\`\`javascript
${surroundingCode}
\`\`\`

请直接回复新的标识符名称，不要包含其他解释。如果标识符已经有意义，可以保持不变。`;
    } else {
      return `请将这个JavaScript标识符 \`${name}\` 重命名为有意义的名称。
上下文代码:
\`\`\`javascript
${surroundingCode}
\`\`\`
直接回复新的名称，不要包含其他文字。`;
    }
  }
} 