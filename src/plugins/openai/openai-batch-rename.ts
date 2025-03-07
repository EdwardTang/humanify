import OpenAI from "openai";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { visitAllIdentifiers } from "../local-llm-rename/visit-all-identifiers.js";
import { verbose } from "../../verbose.js";
import { createInterface } from "readline";

type BatchRenameResult = {
  originalName: string;
  newName: string;
  surroundingCode: string;
  customId: string;
};

export function openAIBatchRename({
  apiKey,
  baseURL,
  model,
  contextWindowSize,
  batchSize = 25,
  outputDir = "batch_results",
  pollingInterval = 30000 // 30 seconds by default
}: {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize?: number;
  outputDir?: string;
  pollingInterval?: number;
}) {
  const client = new OpenAI({ apiKey, baseURL });
  
  return async (code: string, filename: string): Promise<string> => {
    verbose.log(`Starting batch rename for ${filename}`);
    
    // Create output directory based on file path
    const filePathHash = getFilePathHash(filename);
    const resultDir = path.join(outputDir, filePathHash);
    await fs.mkdir(resultDir, { recursive: true });
    
    // Save the original code to output directory
    const originalFilePath = path.join(resultDir, "original.js");
    await fs.writeFile(originalFilePath, code);
    
    // Extract all identifiers and their surrounding code
    const identifiersToRename: { 
      name: string;
      surroundingCode: string;
      customId: string;
    }[] = [];
    
    // Use visitAllIdentifiers to collect all identifiers
    await visitAllIdentifiers(
      code,
      async (name, surroundingCode) => {
        const customId = `id-${crypto.randomUUID()}`;
        identifiersToRename.push({
          name,
          surroundingCode,
          customId
        });
        return name; // Return original name to avoid renaming at this stage
      },
      contextWindowSize,
      (percentage) => verbose.log(`Collecting identifiers: ${Math.floor(percentage * 100)}%`)
    );
    
    verbose.log(`Collected ${identifiersToRename.length} identifiers for batch renaming`);
    
    // Split identifiers into batches
    const batches = [];
    for (let i = 0; i < identifiersToRename.length; i += batchSize) {
      batches.push(identifiersToRename.slice(i, i + batchSize));
    }
    
    const batchResultsFilePath = path.join(resultDir, "batch_results.json");
    
    // Create batch tasks for OpenAI batch API
    const allRenameResults: BatchRenameResult[] = [];
    
    verbose.log(`Processing ${batches.length} batches with batch size ${batchSize}`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      verbose.log(`Processing batch ${batchIndex + 1}/${batches.length}`);
      
      // Create batch tasks file
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
      
      // Upload file for batch processing
      verbose.log(`Uploading batch ${batchIndex + 1} to OpenAI`);
      const batchFile = await client.files.create({
        file: fsSync.createReadStream(batchTasksFilePath),
        purpose: "batch"
      });
      
      // Create batch job
      verbose.log(`Creating batch job for batch ${batchIndex + 1}`);
      const batchJob = await client.batches.create({
        input_file_id: batchFile.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
      
      // Poll for batch job completion
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
          // Wait for the polling interval before checking again
          await new Promise(resolve => setTimeout(resolve, pollingInterval));
        }
      }
      
      // Retrieve results
      verbose.log(`Retrieving results for batch ${batchIndex + 1}`);
      const resultFileId = batchJobResult.output_file_id;
      const resultContentStream = await client.files.content(resultFileId);
      
      // Parse results by reading the stream data
      let resultContentText = '';
      // Handle different response types
      if (resultContentStream instanceof Uint8Array) {
        resultContentText = new TextDecoder().decode(resultContentStream);
      } else {
        // Handle as a stream or other response type
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
      
      // Process rename results
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
      
      // Save batch results after each batch for resumability
      await fs.writeFile(
        batchResultsFilePath,
        JSON.stringify(allRenameResults, null, 2)
      );
      
      verbose.log(`Completed batch ${batchIndex + 1}/${batches.length}`);
    }
    
    verbose.log(`All batches processed. Results saved to ${batchResultsFilePath}`);
    
    // For now, just return the original code since we're only collecting rename suggestions
    return code;
  };
}

// Apply batch rename results to a file
export async function applyBatchRename(
  filename: string,
  batchResultsDir: string
): Promise<string> {
  // Get the file path hash
  const filePathHash = getFilePathHash(filename);
  const resultDir = path.join(batchResultsDir, filePathHash);
  const batchResultsFilePath = path.join(resultDir, "batch_results.json");
  const originalFilePath = path.join(resultDir, "original.js");
  
  // Check if batch results and original file exist
  try {
    await fs.access(batchResultsFilePath);
    await fs.access(originalFilePath);
  } catch (error) {
    throw new Error(`Batch results or original file not found for ${filename}`);
  }
  
  // Read the results and original code
  const batchResults: BatchRenameResult[] = JSON.parse(
    await fs.readFile(batchResultsFilePath, "utf-8")
  );
  const originalCode = await fs.readFile(originalFilePath, "utf-8");
  
  verbose.log(`Applying ${batchResults.length} rename operations from batch results`);
  
  // Apply renames to the code
  return await visitAllIdentifiers(
    originalCode,
    async (name, surroundingCode) => {
      // Find a matching rename in the batch results
      const matchingRename = batchResults.find(
        result => result.originalName === name && 
                 surroundingCode.includes(result.surroundingCode)
      );
      
      if (matchingRename) {
        verbose.log(`Renaming ${name} to ${matchingRename.newName}`);
        return matchingRename.newName;
      }
      
      return name; // Keep original name if no match found
    },
    Infinity, // Use max context size to ensure accurate matching
    (percentage) => verbose.log(`Applying renames: ${Math.floor(percentage * 100)}%`)
  );
}

// Helper function to convert identifier to rename prompt
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
        content: `Rename Javascript variables/function \`${name}\` to have descriptive name based on their usage in the code."`
      },
      {
        role: "user",
        content: surroundingCode
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        strict: true,
        name: "rename",
        schema: {
          type: "object",
          properties: {
            newName: {
              type: "string",
              description: `The new name for the variable/function called \`${name}\``
            }
          },
          required: ["newName"],
          additionalProperties: false
        }
      }
    }
  };
}

// Helper function to generate a hash for file path
function getFilePathHash(filePath: string): string {
  // If the path is less than 20 characters, use it directly
  if (path.basename(filePath).length <= 20) {
    return path.basename(filePath);
  }
  
  // Otherwise, generate a hash
  const hash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
  const fileBase = path.basename(filePath);
  const fileExt = path.extname(fileBase);
  const fileName = fileBase.substring(0, fileBase.length - fileExt.length);
  
  // Return first 10 chars of filename + underscore + hash + extension
  return `${fileName.substring(0, 10)}_${hash}${fileExt}`;
} 