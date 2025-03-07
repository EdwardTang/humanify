import OpenAI from "openai";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { verbose } from "../../verbose.js";
import { createInterface } from "readline";
import * as os from 'os';

// 获取CPU核心数，但限制最大并行度
const MAX_PARALLELISM = Math.min(os.cpus().length, 8);

type BatchRenameResult = {
  originalName: string;
  newName: string;
  surroundingCode: string;
  customId: string;
};

export function openAIParallelBatchRename({
  apiKey,
  baseURL,
  model,
  contextWindowSize,
  batchSize = 25,
  outputDir = "batch_results",
  pollingInterval = 30000, // 30 seconds by default
  concurrency = MAX_PARALLELISM
}: {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize?: number;
  outputDir?: string;
  pollingInterval?: number;
  concurrency?: number;
}) {
  const client = new OpenAI({ apiKey, baseURL });
  
  return async (code: string, filename: string): Promise<string> => {
    verbose.log(`Starting parallel batch rename for ${filename}`);
    verbose.log(`Using concurrency: ${concurrency}, batch size: ${batchSize}`);
    
    // Create output directory based on file path
    const filePathHash = getFilePathHash(filename);
    const resultDir = path.join(outputDir, filePathHash);
    await fs.mkdir(resultDir, { recursive: true });
    
    // Save the original code to output directory
    const originalFilePath = path.join(resultDir, "original.js");
    await fs.writeFile(originalFilePath, code);
    
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
    }[] = [];
    
    verbose.log(`Starting parallel identifier collection...`);
    
    // 我们创建一个特殊的访问者函数，该函数只收集标识符而不进行重命名
    await visitAllIdentifiersParallel(
      code,
      async (name: string, surroundingCode: string) => {
        const customId = `id-${crypto.randomUUID()}`;
        identifiersToRename.push({
          name,
          surroundingCode,
          customId
        });
        return name; // 返回原始名称，不进行重命名
      },
      contextWindowSize,
      (percentage: number) => verbose.log(`Collecting identifiers in parallel: ${Math.floor(percentage * 100)}%`),
      concurrency // 使用指定的并行度
    );
    
    verbose.log(`Collected ${identifiersToRename.length} identifiers for batch renaming`);
    
    // 将标识符分成多个批次
    const batches = [];
    for (let i = 0; i < identifiersToRename.length; i += batchSize) {
      batches.push(identifiersToRename.slice(i, i + batchSize));
    }
    
    const batchResultsFilePath = path.join(resultDir, "batch_results.json");
    
    // 创建批处理任务
    const allRenameResults: BatchRenameResult[] = [];
    
    verbose.log(`Processing ${batches.length} batches with batch size ${batchSize}`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verbose.log(`Processing batch ${batchIndex + 1}/${batches.length}`);
      
      // 创建批处理任务文件
      const tasks = batch.map(item => ({
        custom_id: item.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: toRenamePrompt(item.name, item.surroundingCode, model)
      }));
      
      const batchTasksFilePath = path.join(resultDir, `batch_tasks_${batchIndex}.jsonl`);
      await fs.writeFile(
        batchTasksFilePath, 
        tasks.map(task => JSON.stringify(task)).join('\n')
      );
      
      // 上传文件进行批处理
      verbose.log(`Uploading batch ${batchIndex + 1} to OpenAI`);
      const batchFile = await client.files.create({
        file: fsSync.createReadStream(batchTasksFilePath),
        purpose: "batch"
      });
      
      // 创建批处理作业
      verbose.log(`Creating batch job for batch ${batchIndex + 1}`);
      const batchJob = await client.batches.create({
        input_file_id: batchFile.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
      
      // 轮询批处理作业完成情况
      verbose.log(`Waiting for batch ${batchIndex + 1} to complete...`);
      let jobCompleted = false;
      let batchJobResult: any;
      
      while (!jobCompleted) {
        const jobStatus = await client.batches.retrieve(batchJob.id);
        verbose.log(`Batch ${batchIndex + 1} status: ${jobStatus.status}`);
        
        if (jobStatus.status === 'completed') {
          jobCompleted = true;
          batchJobResult = jobStatus;
        } else if (jobStatus.status === 'failed') {
          throw new Error(`Batch job ${batchJob.id} failed: ${JSON.stringify(jobStatus.errors || 'Unknown error')}`);
        } else {
          // 等待轮询间隔后再次检查
          await new Promise(resolve => setTimeout(resolve, pollingInterval));
        }
      }
      
      // 获取结果
      verbose.log(`Retrieving results for batch ${batchIndex + 1}`);
      const resultFileId = batchJobResult.output_file_id;
      const resultContentStream = await client.files.content(resultFileId);
      
      // 通过读取流数据解析结果
      let resultContentText = '';
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
      
      const resultLines = resultContentText.split('\n');
      const batchResults = resultLines
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      // 处理重命名结果
      for (const result of batchResults) {
        try {
          const customId = result.custom_id;
          const originalItem = batch.find(item => item.customId === customId);
          
          if (!originalItem) {
            verbose.log(`Warning: Could not find original item for custom ID ${customId}`);
            continue;
          }
          
          const responseContent = result.response.body.choices[0].message.content;
          const parsedContent = JSON.parse(responseContent);
          
          allRenameResults.push({
            originalName: originalItem.name,
            newName: parsedContent.newName,
            surroundingCode: originalItem.surroundingCode,
            customId: customId
          });
        } catch (error) {
          verbose.log(`Error processing result: ${error}`);
        }
      }
      
      // 每批处理后保存批次结果以便可恢复
      await fs.writeFile(
        batchResultsFilePath,
        JSON.stringify(allRenameResults, null, 2)
      );
      
      verbose.log(`Completed batch ${batchIndex + 1}/${batches.length}`);
    }
    
    verbose.log(`All batches processed. Results saved to ${batchResultsFilePath}`);
    
    // 对于现在，只返回原始代码，因为我们只是收集重命名建议
    return code;
  };
}

// 创建重命名提示
function toRenamePrompt(
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
function getFilePathHash(filePath: string): string {
  return crypto
    .createHash("md5")
    .update(filePath)
    .digest("hex")
    .substring(0, 10);
}

// 应用批处理重命名结果到文件
export async function applyParallelBatchRename(
  filename: string,
  batchResultsDir: string,
  concurrency = MAX_PARALLELISM
): Promise<string> {
  // 获取文件路径哈希
  const filePathHash = getFilePathHash(filename);
  const resultDir = path.join(batchResultsDir, filePathHash);
  const batchResultsFilePath = path.join(resultDir, "batch_results.json");
  const originalFilePath = path.join(resultDir, "original.js");
  
  // 检查批处理结果和原始文件是否存在
  try {
    await fs.access(batchResultsFilePath);
    await fs.access(originalFilePath);
  } catch (error) {
    throw new Error(`Batch results or original file not found for ${filename}`);
  }
  
  // 读取结果和原始代码
  const batchResults: BatchRenameResult[] = JSON.parse(
    await fs.readFile(batchResultsFilePath, "utf-8")
  );
  const originalCode = await fs.readFile(originalFilePath, "utf-8");
  
  verbose.log(`Applying ${batchResults.length} rename operations from batch results using parallel processing`);
  
  // 导入并行标识符收集器
  verbose.log(`Importing parallel identifier collector for applying renames...`);
  let visitAllIdentifiersParallel: any;
  
  try {
    const parallelModule = await import('../local-llm-rename/parallel-visit-identifiers.js');
    visitAllIdentifiersParallel = parallelModule.visitAllIdentifiersParallel;
    
    if (!visitAllIdentifiersParallel) {
      throw new Error('Parallel visitor function not found');
    }
  } catch (error) {
    verbose.log(`Error importing parallel visitor for applying: ${error}`);
    throw new Error(`Failed to import parallel visitor for applying: ${error}`);
  }
  
  // 使用并行处理应用重命名
  return await visitAllIdentifiersParallel(
    originalCode,
    async (name: string, surroundingCode: string) => {
      // 在批处理结果中查找匹配的重命名
      const matchingRename = batchResults.find(
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
    (percentage: number) => verbose.log(`Applying renames in parallel: ${Math.floor(percentage * 100)}%`),
    concurrency // 使用指定的并行度
  );
} 