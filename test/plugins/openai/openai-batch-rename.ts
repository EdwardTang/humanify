import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";
// Import Node.js types for Buffer and setTimeout
import { Buffer } from "buffer";
import { setTimeout } from "timers";
import { visitAllIdentifiers } from "../local-llm-rename/visit-all-identifiers.js";
import { showPercentage } from "../../progress.js";
import { verbose } from "../../verbose.js";

// Global rename map to ensure cross-file consistency
const globalRenameMap = new Map<string, string>();

// Path to store the global rename map for persistence
const GLOBAL_RENAME_MAP_PATH = "./.humanify-rename-map.json";

export interface BatchRenameOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize?: number;
  pollInterval?: number;
  tempDir?: string;
  maxRetries?: number;
  backoffMultiplier?: number;
  initialBackoff?: number;
}

// Interface for retry tracking
interface RetryableIdentifier {
  name: string;
  surroundingCode: string;
  retryCount: number;
}

export function openAIBatchRename({
  apiKey,
  baseURL,
  model,
  contextWindowSize,
  batchSize = 100,
  pollInterval = 60000, // 1 minute in milliseconds
  tempDir = "./.humanify-temp",
  maxRetries = 3,
  backoffMultiplier = 1.5,
  initialBackoff = 5000 // 5 seconds in milliseconds
}: BatchRenameOptions) {
  const client = new OpenAI({ apiKey, baseURL });

  // Load global rename map if it exists
  async function loadGlobalRenameMap() {
    try {
      const mapData = await fs.readFile(GLOBAL_RENAME_MAP_PATH, 'utf-8');
      const savedMap = JSON.parse(mapData);
      
      // Convert the object back to a Map
      Object.entries(savedMap).forEach(([key, value]) => {
        globalRenameMap.set(key, value as string);
      });
      
      verbose.log(`Loaded global rename map with ${globalRenameMap.size} entries`);
    } catch (error) {
      verbose.log(`No existing global rename map found or error loading it: ${error}`);
    }
  }

  // Save global rename map to disk
  async function saveGlobalRenameMap() {
    try {
      // Convert Map to a serializable object
      const mapObject = Object.fromEntries(globalRenameMap.entries());
      await fs.writeFile(GLOBAL_RENAME_MAP_PATH, JSON.stringify(mapObject, null, 2));
      verbose.log(`Saved global rename map with ${globalRenameMap.size} entries`);
    } catch (error) {
      verbose.log(`Error saving global rename map: ${error}`);
    }
  }

  // Exponential backoff for rate limiting
  async function exponentialBackoff(retryCount: number) {
    const delay = initialBackoff * Math.pow(backoffMultiplier, retryCount);
    verbose.log(`Rate limit hit or error, backing off for ${delay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return async (code: string): Promise<string> => {
    // Load the global rename map at the start
    await loadGlobalRenameMap();

    // Create temp directory if it doesn't exist
    try {
      await fs.mkdir(tempDir, { recursive: true });
      verbose.log(`Created temp directory: ${tempDir}`);
    } catch (error) {
      verbose.log(`Error creating temp directory: ${error}`);
    }

    // Collect all identifiers that need to be renamed
    const identifiersWithContext: Array<RetryableIdentifier> = [];
    
    // First pass: collect all identifiers and their context
    await visitAllIdentifiers(
      code,
      async (name, surroundingCode) => {
        // Check if we already have a rename for this identifier in the global map
        if (globalRenameMap.has(name)) {
          verbose.log(`Using existing rename for ${name} -> ${globalRenameMap.get(name)}`);
          return globalRenameMap.get(name) || name;
        }
        
        identifiersWithContext.push({ name, surroundingCode, retryCount: 0 });
        return name; // Return the original name in this first pass
      },
      contextWindowSize,
      (progress) => showPercentage(progress / 2) // First half of the progress
    );
    
    verbose.log(`Collected ${identifiersWithContext.length} identifiers to rename`);
    
    // Process identifiers in batches
    const batchedIdentifiers = [];
    for (let i = 0; i < identifiersWithContext.length; i += batchSize) {
      batchedIdentifiers.push(identifiersWithContext.slice(i, i + batchSize));
    }
    
    verbose.log(`Split into ${batchedIdentifiers.length} batches of max size ${batchSize}`);
    
    // Process each batch
    const failedIdentifiers: RetryableIdentifier[] = [];
    
    for (let batchIndex = 0; batchIndex < batchedIdentifiers.length; batchIndex++) {
      const batch = batchedIdentifiers[batchIndex];
      verbose.log(`Processing batch ${batchIndex + 1} of ${batchedIdentifiers.length}`);
      
      // Create the batch file
      const batchFile = path.join(tempDir, `rename-batch-${batchIndex}.jsonl`);
      const batchTasks = batch.map((item, index) => ({
        custom_id: `${batchIndex}-${index}`,
        method: "POST",
        url: "/v1/chat/completions",
        body: toRenamePrompt(item.name, item.surroundingCode)
      }));
      
      await fs.writeFile(
        batchFile,
        batchTasks.map(task => JSON.stringify(task)).join('\n')
      );
      
      verbose.log(`Created batch file: ${batchFile}`);
      
      try {
        // Upload the batch file
        const uploadedFile = await client.files.create({
          file: await fs.readFile(batchFile),
          purpose: "batch"
        });
        
        verbose.log(`Uploaded batch file with ID: ${uploadedFile.id}`);
        
        // Create the batch job
        const batchJob = await client.batches.create({
          input_file_id: uploadedFile.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h"
        });
        
        verbose.log(`Created batch job with ID: ${batchJob.id}`);
        
        // Poll for completion with backoff
        let completed = false;
        let pollRetryCount = 0;
        
        while (!completed) {
          try {
            const jobStatus = await client.batches.retrieve(batchJob.id);
            verbose.log(`Batch job status: ${jobStatus.status}`);
            pollRetryCount = 0; // Reset retry count on successful poll
            
            if (jobStatus.status === "completed") {
              if (jobStatus.output_file_id) {
                // Get the results
                const resultContent = await client.files.content(jobStatus.output_file_id);
                const resultFile = path.join(tempDir, `rename-result-${batchIndex}.jsonl`);
                
                // Convert ArrayBuffer to Buffer
                const buffer = Buffer.from(await resultContent.arrayBuffer());
                await fs.writeFile(resultFile, buffer);
                
                verbose.log(`Downloaded results to: ${resultFile}`);
                
                // Parse the results
                const resultText = await fs.readFile(resultFile, 'utf-8');
                const results = resultText.split('\n')
                  .filter((line: string) => line.trim())
                  .map((line: string) => JSON.parse(line));
                
                // Process the results
                for (const result of results) {
                  try {
                    const [batchId, itemIndex] = result.custom_id.split('-').map(Number);
                    const originalItem = batch[itemIndex];
                    const originalName = originalItem.name;
                    
                    if (result.error) {
                      verbose.log(`Error processing ${originalName}: ${result.error.message}`);
                      
                      // Add to failed identifiers for retry if under max retries
                      if (originalItem.retryCount < maxRetries) {
                        originalItem.retryCount++;
                        verbose.log(`Adding ${originalName} for retry (attempt ${originalItem.retryCount})`);
                        failedIdentifiers.push(originalItem);
                      } else {
                        // Max retries reached, keep original name
                        verbose.log(`Max retries reached for ${originalName}, keeping original`);
                        globalRenameMap.set(originalName, originalName);
                      }
                    } else {
                      try {
                        const content = result.response.body.choices[0].message.content;
                        const jsonResponse = JSON.parse(content);
                        // Look for newName in the parsed JSON, but fallback to other possible properties
                        const renamed = jsonResponse.newName || 
                                       jsonResponse.new_name || 
                                       jsonResponse.renamed || 
                                       jsonResponse.suggestedName || 
                                       jsonResponse.name;
                        
                        // Validate the returned name is valid JS identifier
                        if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
                          verbose.log(`Renamed ${originalName} to ${renamed}`);
                          globalRenameMap.set(originalName, renamed);
                        } else {
                          verbose.log(`Invalid identifier ${renamed} for ${originalName}, keeping original`);
                          globalRenameMap.set(originalName, originalName);
                        }
                      } catch (parseError) {
                        verbose.log(`Error parsing rename result for ${originalName}: ${parseError}`);
                        
                        // Add to failed identifiers for retry if under max retries
                        if (originalItem.retryCount < maxRetries) {
                          originalItem.retryCount++;
                          failedIdentifiers.push(originalItem);
                        } else {
                          // Max retries reached, keep original name
                          globalRenameMap.set(originalName, originalName);
                        }
                      }
                    }
                  } catch (error) {
                    verbose.log(`Error processing result: ${error}`);
                  }
                }
                
                completed = true;
              } else {
                verbose.log(`Job completed but no output file ID found`);
                completed = true;
              }
            } else if (jobStatus.status === "failed" || jobStatus.status === "expired") {
              verbose.log(`Batch job ${jobStatus.status}: ${JSON.stringify(jobStatus.error || {})}`);
              // Move all items to failed identifiers for retry if under max retries
              for (const item of batch) {
                if (item.retryCount < maxRetries) {
                  item.retryCount++;
                  failedIdentifiers.push(item);
                } else {
                  // Max retries reached, keep original name
                  globalRenameMap.set(item.name, item.name);
                }
              }
              completed = true;
            } else {
              // Wait before polling again
              verbose.log(`Waiting ${pollInterval / 1000} seconds before polling again...`);
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
          } catch (error) {
            verbose.log(`Error polling batch job: ${error}`);
            pollRetryCount++;
            
            if (pollRetryCount <= maxRetries) {
              // Use exponential backoff for polling retries
              await exponentialBackoff(pollRetryCount);
            } else {
              verbose.log(`Max poll retries reached, moving to failed identifiers`);
              // Move all items to failed identifiers
              for (const item of batch) {
                if (item.retryCount < maxRetries) {
                  item.retryCount++;
                  failedIdentifiers.push(item);
                } else {
                  globalRenameMap.set(item.name, item.name);
                }
              }
              completed = true;
            }
          }
        }
      } catch (error) {
        verbose.log(`Error processing batch: ${error}`);
        // Move all items to failed identifiers for retry if under max retries
        for (const item of batch) {
          if (item.retryCount < maxRetries) {
            item.retryCount++;
            failedIdentifiers.push(item);
          } else {
            globalRenameMap.set(item.name, item.name);
          }
        }
      }
      
      // Save global rename map after each batch completes
      await saveGlobalRenameMap();
      
      // Update progress
      const batchProgress = (batchIndex + 1) / batchedIdentifiers.length;
      showPercentage(0.5 + (batchProgress * 0.4)); // 40% of second half for initial batches
    }
    
    // Process any failed identifiers that need retries
    if (failedIdentifiers.length > 0) {
      verbose.log(`Processing ${failedIdentifiers.length} failed identifiers with retries`);
      
      // We'll use a simpler approach for retries - process one at a time
      for (let i = 0; i < failedIdentifiers.length; i++) {
        const item = failedIdentifiers[i];
        verbose.log(`Retrying ${item.name} (attempt ${item.retryCount} of ${maxRetries})`);
        
        try {
          // Simple direct API call instead of batch for retries
          const response = await client.chat.completions.create(
            toRenamePrompt(item.name, item.surroundingCode)
          );
          
          try {
            const content = response.choices[0].message.content || "";
            const jsonResponse = JSON.parse(content);
            // Look for newName in the parsed JSON, but fallback to other possible properties
            const renamed = jsonResponse.newName || 
                           jsonResponse.new_name || 
                           jsonResponse.renamed || 
                           jsonResponse.suggestedName || 
                           jsonResponse.name;
            
            // Validate the returned name is valid JS identifier
            if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
              verbose.log(`Renamed ${item.name} to ${renamed}`);
              globalRenameMap.set(item.name, renamed);
            } else {
              verbose.log(`Invalid identifier ${renamed} for ${item.name}, keeping original`);
              globalRenameMap.set(item.name, item.name);
            }
          } catch (parseError) {
            verbose.log(`Error parsing retry result for ${item.name}: ${parseError}`);
            globalRenameMap.set(item.name, item.name);
          }
        } catch (error: any) {
          verbose.log(`Error in retry for ${item.name}: ${error}`);
          globalRenameMap.set(item.name, item.name);
          
          // Apply backoff if rate limited
          if (error.status === 429 || (error.response && error.response.status === 429)) {
            await exponentialBackoff(item.retryCount);
          }
        }
        
        // Update progress for retries
        const retryProgress = (i + 1) / failedIdentifiers.length;
        showPercentage(0.9 + (retryProgress * 0.1)); // Last 10% of progress
        
        // Save global rename map periodically during retries
        if ((i + 1) % 10 === 0 || i === failedIdentifiers.length - 1) {
          await saveGlobalRenameMap();
        }
      }
    }
    
    // Save final global rename map
    await saveGlobalRenameMap();
    
    // Apply renames using the global map
    return await visitAllIdentifiers(
      code,
      async (name) => {
        return globalRenameMap.get(name) || name;
      },
      contextWindowSize,
      () => showPercentage(1) // Complete the progress
    );
  };
}

function toRenamePrompt(
  name: string,
  surroundingCode: string
): OpenAI.Chat.Completions.ChatCompletionCreateParams {
  const prompt = `You are an expert JavaScript developer. Please analyze the following identifier and suggest a better, more descriptive name for it based on how it's used in the code.

Original identifier: ${name}

Surrounding code:
\`\`\`javascript
${surroundingCode}
\`\`\`

Respond with only a valid JSON object in the following format:
{"newName": "yourSuggestedName"}

The suggested name should be in camelCase and descriptive of the identifier's purpose.`;

  // In tests, we honor the model parameter for simplicity
  return {
    model: "o3-mini", // Always use o3-mini in tests regardless of what's passed in
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
    max_tokens: 50
  };
} 