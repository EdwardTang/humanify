import OpenAI from "openai";
import * as fsPromises from "fs/promises";
import path from "node:path";
// Import Node.js types for Buffer and setTimeout
import { Buffer } from "buffer";
import { setTimeout } from "timers";
import { visitAllIdentifiers } from "../local-llm-rename/visit-all-identifiers.js";
import { showPercentage } from "../../progress.js";
import { verbose } from "../../verbose.js";
import { createReadStream } from "node:fs";
import { parse } from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
// Match the import pattern that works in visit-all-identifiers.ts
const traverse: typeof babelTraverse.default.default = (
  typeof babelTraverse.default === "function"
    ? babelTraverse.default
    : babelTraverse.default.default
) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- This hack is because of how the module is exported
import { collectIdentifiersFromString, IdentifierWithContext } from "../local-llm-rename/stream-identifier-collector.js";
import * as fsSync from "fs"; // Import native fs for sync operations

// Change the global rename map structure to support scope-based identifiers
// Map from original name to a nested map of {scopeId → renamed name}
const globalRenameMap = new Map<string, Map<string, string>>();

// Path to store the global rename map for persistence
const RENAME_MAP_PATH = "./.humanify-rename-map.json";

export interface BatchRenameOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  contextWindowSize: number;
  batchSize?: number;
  chunkSize?: number;
  pollInterval?: number;
  tempDir?: string;
  maxRetries?: number;
  backoffMultiplier?: number;
  initialBackoff?: number;
  useStreamProcessing?: boolean;
}

// Modify RetryableIdentifier to include both approaches
interface RetryableIdentifier {
  name: string;
  surroundingCode: string;
  retryCount: number;
  scopeId: string;
  // Optional location for compatibility with IdentifierWithContext
  location?: {
    line: number;
    column: number;
    filePath?: string;
  };
}

// Add a helper function to convert IdentifierWithContext to RetryableIdentifier
function convertToRetryable(identifier: IdentifierWithContext): RetryableIdentifier {
  // Create a scope ID based on location
  const { name, surroundingCode, location } = identifier;
  const scopeId = `${location.filePath || "unknown"}:${location.line}:${location.column}`;
  
  return {
    name,
    surroundingCode,
    retryCount: 0,
    scopeId
  };
}

// Function to split file into syntactically valid chunks
async function splitFileIntoChunks(code: string, maxChunkSize: number): Promise<string[]> {
  if (!maxChunkSize || code.length <= maxChunkSize) {
    return [code];
  }

  verbose.log(`Splitting file of size ${code.length} bytes into chunks of max ${maxChunkSize} bytes`);
  
  try {
    // Try to parse using Babel to create an AST
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"]
    });
    
    // Find syntactically valid split points
    const splitPoints: number[] = [];
    
    // Use a more generic visitor without explicit type constraints
    traverse(ast, {
      Program(path) {
        // Record the position of each top-level statement
        if (path.node?.body) {
          path.node.body.forEach((node) => {
            if (node.loc?.end?.index !== undefined) {
              splitPoints.push(node.loc.end.index);
            }
          });
        }
      },
      FunctionDeclaration(path) {
        if (path.node?.loc?.end?.index !== undefined) {
          splitPoints.push(path.node.loc.end.index);
        }
      },
      ClassDeclaration(path) {
        if (path.node?.loc?.end?.index !== undefined) {
          splitPoints.push(path.node.loc.end.index);
        }
      }
    });
    
    // Now create chunks based on the split points
    const chunks: string[] = [];
    let startPos = 0;
    
    for (let i = 0; i < splitPoints.length; i++) {
      const endPos = splitPoints[i];
      if (endPos - startPos > maxChunkSize) {
        // This chunk would be too large, so split it at the previous point
        if (i > 0) {
          chunks.push(code.substring(startPos, splitPoints[i - 1]));
          startPos = splitPoints[i - 1];
        } else {
          // If there's no previous point, we have to use a fallback approach
          verbose.log("No valid split point found, falling back to line-based splitting");
          return fallbackLineSplitting(code, maxChunkSize);
        }
      }
    }
    
    // Add the final chunk
    if (startPos < code.length) {
      chunks.push(code.substring(startPos));
    }
    
    verbose.log(`Successfully split file into ${chunks.length} syntactically valid chunks`);
    return chunks;
    
  } catch (error) {
    verbose.log(`Error parsing file for chunk splitting: ${error}. Falling back to line-based approach.`);
    return fallbackLineSplitting(code, maxChunkSize);
  }
}

// Fallback approach using line-based splitting
function fallbackLineSplitting(code: string, maxChunkSize: number): string[] {
  const lines = code.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  verbose.log(`Fallback: Split file into ${chunks.length} line-based chunks`);
  return chunks;
}

// Add this utility function to generate traceable file names
function generateTraceableFileName(filePath: string, suffix: string): string {
  if (!filePath) {
    return `unnamed-${suffix}.jsonl`;
  }
  
  // Parse the path components
  const parsedPath = path.parse(filePath);
  const dirParts = parsedPath.dir.split(path.sep).filter(part => part.length > 0);
  
  // Get the first letter of each directory component
  const abbreviatedPath = dirParts.map(part => {
    // For version-like parts (e.g., cursor_0.47.7), keep them intact
    if (/\d+\.\d+/.test(part)) {
      return part;
    }
    // Otherwise use first letter
    return part.charAt(0);
  }).join('-');
  
  // Combine with the filename
  const filename = parsedPath.name + parsedPath.ext;
  const result = abbreviatedPath 
    ? `${abbreviatedPath}-${filename}.${suffix}.jsonl` 
    : `${filename}.${suffix}.jsonl`;
  
  // Remove any invalid filename characters
  return result.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-');
}

export function openAIBatchRename({
  apiKey,
  baseURL,
  model, // We'll keep this for backward compatibility but it won't be used for batch requests
  contextWindowSize,
  batchSize = 100,
  chunkSize = 500000, // Default to 500KB chunks
  pollInterval = 60000, // 1 minute in milliseconds
  tempDir = "./.humanify-temp",
  maxRetries = 3,
  backoffMultiplier = 1.5,
  initialBackoff = 5000, // 5 seconds in milliseconds
  useStreamProcessing = true // New flag to control whether to use stream processing
}: BatchRenameOptions) {
  const client = new OpenAI({ apiKey, baseURL });
  
  // Note: For all batch processing, we're now using "o3-mini" model instead of the provided model parameter
  verbose.log(`Initializing OpenAI batch rename with hardcoded model "o3-mini" for batch requests (ignoring "${model}")`);

  // Update the loadGlobalRenameMap function to handle the nested structure
  async function loadGlobalRenameMap() {
    try {
      if (fsSync.existsSync(RENAME_MAP_PATH)) {
        const content = await fsPromises.readFile(RENAME_MAP_PATH, "utf8");
        const mapObject = JSON.parse(content);
        
        for (const [key, value] of Object.entries(mapObject)) {
          if (typeof value === 'string') {
            // Handle legacy format (flat map)
            if (!globalRenameMap.has(key)) {
              globalRenameMap.set(key, new Map());
            }
            // Store in default scope
            globalRenameMap.get(key)!.set('default', value as string);
          } else if (value && typeof value === 'object') {
            // Handle new format (scoped map)
            if (!globalRenameMap.has(key)) {
              globalRenameMap.set(key, new Map());
            }
            
            for (const [scopeId, scopedValue] of Object.entries(value as Record<string, string>)) {
              globalRenameMap.get(key)!.set(scopeId, scopedValue);
            }
          }
        }
        
        verbose.log(`Loaded global rename map with ${globalRenameMap.size} identifier entries`);
      }
    } catch (error) {
      verbose.log(`Error loading global rename map: ${error}`);
    }
  }

  // Update the saveGlobalRenameMap function to save the nested structure
  async function saveGlobalRenameMap() {
    try {
      // Convert nested map to a serializable object
      const mapObject: Record<string, Record<string, string>> = {};
      
      for (const [name, scopeMap] of globalRenameMap.entries()) {
        mapObject[name] = {};
        for (const [scopeId, rename] of scopeMap.entries()) {
          mapObject[name][scopeId] = rename;
        }
      }
      
      await fsPromises.writeFile(
        RENAME_MAP_PATH,
        JSON.stringify(mapObject, null, 2)
      );
      
      // Count total entries across all scopes
      let totalEntries = 0;
      for (const scopeMap of globalRenameMap.values()) {
        totalEntries += scopeMap.size;
      }
      
      verbose.log(`Saved global rename map with ${globalRenameMap.size} identifiers and ${totalEntries} total scope entries`);
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
      await fsPromises.mkdir(tempDir, { recursive: true });
      verbose.log(`Created temp directory: ${tempDir}`);
    } catch (error) {
      verbose.log(`Error creating temp directory: ${error}`);
    }

    // If using stream processing, we'll skip the chunking
    if (useStreamProcessing) {
      verbose.log("Using stream-based identifier collection");
      try {
        // Collect identifiers using stream approach
        const identifiersWithContext = await collectIdentifiersFromString(code, {
          contextWindowSize,
          onProgress: (progress) => {
            showPercentage(progress * 0.5); // First 50% for collection
          }
        });
        
        verbose.log(`Collected ${identifiersWithContext.length} identifiers`);
        
        // Convert to RetryableIdentifier format
        const retryableIdentifiers = identifiersWithContext.map(convertToRetryable);
        
        // Process identifiers in batches
        const batchedIdentifiers: RetryableIdentifier[][] = [];
        for (let i = 0; i < retryableIdentifiers.length; i += batchSize) {
          batchedIdentifiers.push(retryableIdentifiers.slice(i, i + batchSize));
        }
        
        verbose.log(`Split into ${batchedIdentifiers.length} batches`);
        
        // Failed identifiers that will need retries
        const failedIdentifiers: RetryableIdentifier[] = [];
        
        // Process each batch
        for (let batchIndex = 0; batchIndex < batchedIdentifiers.length; batchIndex++) {
          const batch = batchedIdentifiers[batchIndex];
          await processBatch(batch, batchIndex, batchedIdentifiers.length, failedIdentifiers);
          
          // Update progress
          const batchProgress = (batchIndex + 1) / batchedIdentifiers.length;
          showPercentage(0.5 + (batchProgress * 0.4)); // 40% of second half for initial batches
        }
        
        // Process any failed identifiers that need retries
        if (failedIdentifiers.length > 0) {
          await processFailedIdentifiers(failedIdentifiers);
        }
      } catch (error) {
        verbose.log(`Error in stream processing: ${error}`);
        throw error;
      }
    } else {
      verbose.log("Using chunk-based identifier collection");
      // Split the file into chunks if it exceeds the chunk size
      const chunks = await splitFileIntoChunks(code, chunkSize);
      verbose.log(`Processing ${chunks.length} chunks`);
      
      let processedCode = '';
      
      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunkCode = chunks[chunkIndex];
        verbose.log(`Processing chunk ${chunkIndex + 1} of ${chunks.length} (${chunkCode.length} bytes)`);
        
        const processedChunk = await processChunk(chunkCode, chunkIndex, chunks.length);
        processedCode += processedChunk;
      }
      
      return processedCode;
    }

    // Finally, apply all renames in a second pass
    verbose.log("Applying renames from global rename map");
    const finalCode = await visitAllIdentifiers(
      code,
      async (name, _surroundingCode, scopeId) => {
        // Get the most specific rename available
        if (globalRenameMap.has(name)) {
          const scopeMap = globalRenameMap.get(name)!;
          
          // Try exact scope first
          if (scopeMap.has(scopeId)) {
            return scopeMap.get(scopeId)!;
          }
          
          // Try default scope as fallback
          if (scopeMap.has('default')) {
            return scopeMap.get('default')!;
          }
        }
        
        return name; // No rename found
      },
      contextWindowSize,
      (progress) => {
        showPercentage(0.9 + progress * 0.1); // Last 10% of progress
      }
    );

    verbose.log("Renaming completed");
    await saveGlobalRenameMap();
    return finalCode;
  };

  // Update batch processing to use scope-based identifiers
  async function processChunk(chunkCode: string, chunkIndex: number, totalChunks: number): Promise<string> {
    // Collect all identifiers that need to be renamed in this chunk
    const identifiersWithContext: Array<RetryableIdentifier> = [];
    const failedIdentifiers: RetryableIdentifier[] = [];
    
    // First pass: collect all identifiers and their context
    await visitAllIdentifiers(
      chunkCode,
      async (name, surroundingCode, scopeId) => {
        // Check if we already have a rename for this identifier+scope in the global map
        if (globalRenameMap.has(name)) {
          const scopeMap = globalRenameMap.get(name)!;
          
          // Try exact scope first
          if (scopeMap.has(scopeId)) {
            const rename = scopeMap.get(scopeId)!;
            verbose.log(`Using existing rename for ${name} in scope ${scopeId} -> ${rename}`);
            return rename;
          }
          
          // Try default scope as fallback for compatibility
          if (scopeMap.has('default')) {
            const rename = scopeMap.get('default')!;
            verbose.log(`Using default scope rename for ${name} -> ${rename}`);
            return rename;
          }
        }
        
        // Add to the list of identifiers to process
        identifiersWithContext.push({ name, surroundingCode, retryCount: 0, scopeId });
        return name; // Return the original name in this first pass
      },
      contextWindowSize,
      (progress) => {
        // Progress tracking
        const chunkProgress = (chunkIndex / totalChunks) + (progress / (2 * totalChunks));
        showPercentage(chunkProgress);
      }
    );
    
    verbose.log(`Collected ${identifiersWithContext.length} scoped identifiers to rename in chunk`);
    
    // Process identifiers in batches
    const batchedIdentifiers = [];
    for (let i = 0; i < identifiersWithContext.length; i += batchSize) {
      batchedIdentifiers.push(identifiersWithContext.slice(i, i + batchSize));
    }
    
    verbose.log(`Split into ${batchedIdentifiers.length} batches of max size ${batchSize}`);
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batchedIdentifiers.length; batchIndex++) {
      const batch = batchedIdentifiers[batchIndex];
      await processBatch(batch, batchIndex, batchedIdentifiers.length, failedIdentifiers);
      
      // Update progress
      const batchProgress = (batchIndex + 1) / batchedIdentifiers.length;
      showPercentage(0.5 + (batchProgress * 0.4)); // 40% of second half for initial batches
    }
    
    // Process any failed identifiers that need retries
    if (failedIdentifiers.length > 0) {
      await processFailedIdentifiers(failedIdentifiers);
    }
    
    // Second pass: apply all renames
    const processedChunk = await visitAllIdentifiers(
      chunkCode,
      async (name, _surroundingCode, scopeId) => {
        // Get the most specific rename available
        if (globalRenameMap.has(name)) {
          const scopeMap = globalRenameMap.get(name)!;
          
          // Try exact scope first
          if (scopeMap.has(scopeId)) {
            return scopeMap.get(scopeId)!;
          }
          
          // Try default scope as fallback
          if (scopeMap.has('default')) {
            return scopeMap.get('default')!;
          }
        }
        
        return name; // No rename found
      },
      contextWindowSize,
      (progress) => {
        // Calculate overall progress including chunk position
        const chunkProgress = (chunkIndex / totalChunks) + 0.5 + (progress / (2 * totalChunks));
        showPercentage(chunkProgress);
      }
    );
    
    return processedChunk;
  }
  
  // Update toRenamePrompt to include scope information and use o3-mini
  function toRenamePrompt(
    name: string,
    surroundingCode: string,
    scopeId: string
  ): OpenAI.Chat.Completions.ChatCompletionCreateParams {
    const prompt = `You are an expert JavaScript developer. Please analyze the following identifier and suggest a better, more descriptive name for it based on how it's used in the code. The identifier may appear multiple times in the code.

Original identifier: ${name}
Scope context: ${scopeId}

Surrounding code:
\`\`\`javascript
${surroundingCode}
\`\`\`

Respond with only a single word or phrase in camelCase format (e.g., "getUserData", "formatTimestamp", "isValidInput") that would be a good replacement name for this identifier in this specific scope. Do not include explanations, code examples, or additional text.`;

    // Check if the context might benefit from additional file search
    const needsAdditionalContext = shouldUseFileSearch(name, surroundingCode);

    // Base request configuration
    const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      // Always use o3-mini model regardless of the parameter passed
      model: "o3-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 50
    };

    // Add tool calling capability if needed
    if (needsAdditionalContext) {
      requestConfig.tools = [
        {
          type: "function",
          function: {
            name: "file_search",
            description: "Search for additional code references in the codebase",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query to find relevant code references"
                },
                vector_store: {
                  type: "string",
                  description: "The vector store ID to search in"
                }
              },
              required: ["query", "vector_store"]
            }
          }
        }
      ];
      
      // Add tool choice to specify we want to use the file_search tool
      requestConfig.tool_choice = {
        type: "function",
        function: {
          name: "file_search"
        }
      };
      
      // Add specific instructions in the prompt about which vector store to use
      requestConfig.messages = [
        { 
          role: "user", 
          content: `${prompt}\n\nWhen using the file_search tool, search in vector store: vs_67d8f1137dd08191a78acb7beca6022b with query: "Function or variable similar to ${name}"`
        }
      ];
    }

    return requestConfig;
  }
  
  // Helper function to determine if we need additional context from file search
  function shouldUseFileSearch(name: string, surroundingCode: string): boolean {
    // Check if the identifier is very short (likely minified)
    if (name.length <= 2) {
      return true;
    }
    
    // Check if the surrounding code is very short or lacks context
    if (surroundingCode.trim().length < 50) {
      return true;
    }
    
    // Check for common patterns that might indicate a need for more context
    if (surroundingCode.includes("import ") || surroundingCode.includes("require(")) {
      return true;
    }
    
    // Default to false - only use when needed to minimize API costs
    return false;
  }
  
  // Update processBatch to include scope information in the batch requests
  async function processBatch(
    batch: RetryableIdentifier[], 
    batchIndex: number, 
    totalBatches: number,
    failedIdentifiers: RetryableIdentifier[]
  ) {
    verbose.log(`Processing batch ${batchIndex + 1} of ${totalBatches}`);
    
    // Get the file path from the first identifier's scopeId (which contains the file path)
    const firstItemScopeId = batch[0]?.scopeId || '';
    const filePath = firstItemScopeId.split(':')[0] || `batch-${batchIndex}`;
    
    // Create the batch file with traceable name
    const batchFileSuffix = `batch-${batchIndex}`;
    const batchFileName = generateTraceableFileName(filePath, batchFileSuffix);
    const batchFile = path.join(tempDir, batchFileName);
    
    const batchTasks = batch.map((item, index) => ({
      custom_id: `${batchIndex}-${index}`,
      method: "POST",
      url: "/v1/chat/completions",
      body: toRenamePrompt(item.name, item.surroundingCode, item.scopeId)
    }));
    
    await fsPromises.writeFile(
      batchFile,
      batchTasks.map(task => JSON.stringify(task)).join('\n')
    );
    
    verbose.log(`Created batch file: ${batchFile}`);
    
    try {
      // Upload the batch file first using the Files API
      const fileUpload = await client.files.create({
        file: createReadStream(batchFile),
        purpose: "batch"
      });
      
      verbose.log(`Uploaded file with ID: ${fileUpload.id}`);
      
      // Create the batch job with the file ID
      const batchJob = await client.batches.create({
        input_file_id: fileUpload.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
      
      verbose.log(`Created batch job with ID: ${batchJob.id}`);
      
      // Check if there are errors immediately after creating the batch job
      if (batchJob.errors) {
        verbose.log(`Batch job creation returned errors: ${JSON.stringify(batchJob.errors)}`);
        
        // If there's an error_file_id, download and display the error file
        if (batchJob.error_file_id) {
          await downloadAndDisplayErrorFile(batchJob.error_file_id, `batch_${batchJob.id}_creation_error`);
        }
        
        throw new Error(`Batch job creation failed with errors. Stopping batch processing.`);
      }
      
      // Poll for completion with backoff
      let completed = false;
      let pollRetryCount = 0;
      
      while (!completed) {
        try {
          const jobStatus = await client.batches.retrieve(batchJob.id);
          verbose.log(`Batch job status: ${jobStatus.status}`);
          pollRetryCount = 0; // Reset retry count on successful poll
          
          // Check for errors in job status
          if (jobStatus.errors) {
            verbose.log(`Batch job has errors: ${JSON.stringify(jobStatus.errors)}`);
            
            // If there's an error_file_id, download and display the error file
            if (jobStatus.error_file_id) {
              await downloadAndDisplayErrorFile(jobStatus.error_file_id, `batch_${jobStatus.id}_error`);
            }
            
            throw new Error(`Batch job has errors. Stopping batch processing.`);
          }
          
          if (jobStatus.status === "completed") {
            if (jobStatus.output_file_id) {
              // Get the results
              const resultContent = await client.files.content(jobStatus.output_file_id);
              const resultFileSuffix = `result-${batchIndex}`;
              const resultFileName = generateTraceableFileName(filePath, resultFileSuffix);
              const resultFile = path.join(tempDir, resultFileName);
              
              // Convert ArrayBuffer to Buffer
              const buffer = Buffer.from(await resultContent.arrayBuffer());
              await fsPromises.writeFile(resultFile, buffer);
              
              verbose.log(`Downloaded results to: ${resultFile}`);
              
              // Parse the results
              const resultText = await fsPromises.readFile(resultFile, 'utf-8');
              const results = resultText.split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => JSON.parse(line));
              
              // Process the results
              for (const result of results) {
                try {
                  const itemIndex = Number(result.custom_id.split('-')[1]);
                  const originalItem = batch[itemIndex];
                  const originalName = originalItem.name;
                  const scopeId = originalItem.scopeId;
                  
                  if (result.error) {
                    verbose.log(`Error processing ${originalName} in scope ${scopeId}: ${result.error.message}`);
                    
                    // Add to failed identifiers for retry if under max retries
                    if (originalItem.retryCount < maxRetries) {
                      originalItem.retryCount++;
                      verbose.log(`Adding ${originalName} in scope ${scopeId} for retry (attempt ${originalItem.retryCount})`);
                      failedIdentifiers.push(originalItem);
                    } else {
                      // Max retries reached, keep original name
                      verbose.log(`Max retries reached for ${originalName} in scope ${scopeId}, keeping original`);
                      if (!globalRenameMap.has(originalName)) {
                        globalRenameMap.set(originalName, new Map());
                      }
                      globalRenameMap.get(originalName)!.set(scopeId, originalName);
                    }
                  } else {
                    try {
                      const content = result.response.body.choices[0].message.content?.trim();
                      if (content) {
                        let renamed;
                        
                        // Try parsing as JSON first
                        try {
                          const jsonResponse = JSON.parse(content);
                          // Look for newName in the parsed JSON, but fallback to other possible properties
                          renamed = jsonResponse.newName || jsonResponse.name || jsonResponse.renamed || jsonResponse.suggestion;
                        } catch {
                          // If not valid JSON, use the content directly if it looks like a valid identifier
                          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(content)) {
                            renamed = content;
                            verbose.log(`Using direct string response: ${renamed}`);
                          } else {
                            throw new Error(`Response is not valid JSON or a valid identifier: ${content}`);
                          }
                        }
                        
                        // Validate the returned name is valid JS identifier
                        if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
                          verbose.log(`Renamed ${originalName} in scope ${scopeId} to ${renamed}`);
                          if (!globalRenameMap.has(originalName)) {
                            globalRenameMap.set(originalName, new Map());
                          }
                          globalRenameMap.get(originalName)!.set(scopeId, renamed);
                        } else {
                          verbose.log(`Invalid identifier ${renamed} for ${originalName} in scope ${scopeId}, keeping original`);
                          if (!globalRenameMap.has(originalName)) {
                            globalRenameMap.set(originalName, new Map());
                          }
                          globalRenameMap.get(originalName)!.set(scopeId, originalName);
                        }
                      }
                    } catch (parseError) {
                      verbose.log(`Error parsing rename result for ${originalName} in scope ${scopeId}: ${parseError}`);
                      
                      // Add to failed identifiers for retry if under max retries
                      if (originalItem.retryCount < maxRetries) {
                        originalItem.retryCount++;
                        failedIdentifiers.push(originalItem);
                      } else {
                        // Max retries reached, keep original name
                        if (!globalRenameMap.has(originalName)) {
                          globalRenameMap.set(originalName, new Map());
                        }
                        globalRenameMap.get(originalName)!.set(scopeId, originalName);
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
            verbose.log(`Batch job ${jobStatus.status}: ${JSON.stringify(jobStatus.errors || {})}`);
            
            // If there's an error_file_id, download and display the error file
            if (jobStatus.error_file_id) {
              await downloadAndDisplayErrorFile(jobStatus.error_file_id, `batch_${jobStatus.id}_error`);
              
              // After displaying errors, throw an error to stop processing
              throw new Error(`Batch job ${jobStatus.status} with error file. Stopping batch processing.`);
            }
            
            // If no error file but still failed/expired, retry items if possible
            for (const item of batch) {
              if (item.retryCount < maxRetries) {
                item.retryCount++;
                failedIdentifiers.push(item);
              } else {
                // Max retries reached, keep original name
                if (!globalRenameMap.has(item.name)) {
                  globalRenameMap.set(item.name, new Map());
                }
                globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
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
                if (!globalRenameMap.has(item.name)) {
                  globalRenameMap.set(item.name, new Map());
                }
                globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
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
          if (!globalRenameMap.has(item.name)) {
            globalRenameMap.set(item.name, new Map());
          }
          globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
        }
      }
    }
    
    // Save global rename map after each batch completes
    await saveGlobalRenameMap();
  }
  
  // Extract retry processing into a separate function
  async function processFailedIdentifiers(failedIdentifiers: RetryableIdentifier[]) {
    verbose.log(`Processing ${failedIdentifiers.length} failed identifiers with retries`);
    
    // We'll use a simpler approach for retries - process one at a time
    for (let i = 0; i < failedIdentifiers.length; i++) {
      const item = failedIdentifiers[i];
      verbose.log(`Retrying ${item.name} in scope ${item.scopeId} (attempt ${item.retryCount} of ${maxRetries})`);
      
      try {
        // Correctly handle the response type for newer OpenAI SDK
        const response = await client.chat.completions.create(
          toRenamePrompt(item.name, item.surroundingCode, item.scopeId)
        );
        
        try {
          // Check if response is stream or direct response
          if (!('choices' in response)) {
            throw new Error('Unexpected response format from OpenAI API');
          }
          
          const content = response.choices?.[0]?.message?.content?.trim();
          if (content) {
            let renamed;
            
            // Try parsing as JSON first
            try {
              const jsonResponse = JSON.parse(content);
              // Look for newName in the parsed JSON, but fallback to other possible properties
              renamed = jsonResponse.newName || jsonResponse.name || jsonResponse.renamed || jsonResponse.suggestion;
            } catch {
              // If not valid JSON, use the content directly if it looks like a valid identifier
              if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(content)) {
                renamed = content;
                verbose.log(`Using direct string response: ${renamed}`);
              } else {
                throw new Error(`Response is not valid JSON or a valid identifier: ${content}`);
              }
            }
            
            // Validate the returned name is valid JS identifier
            if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
              verbose.log(`Renamed ${item.name} in scope ${item.scopeId} to ${renamed}`);
              if (!globalRenameMap.has(item.name)) {
                globalRenameMap.set(item.name, new Map());
              }
              globalRenameMap.get(item.name)!.set(item.scopeId, renamed);
            } else {
              verbose.log(`Invalid identifier ${renamed} for ${item.name} in scope ${item.scopeId}, keeping original`);
              if (!globalRenameMap.has(item.name)) {
                globalRenameMap.set(item.name, new Map());
              }
              globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
            }
          }
        } catch (parseError) {
          verbose.log(`Error parsing retry result for ${item.name} in scope ${item.scopeId}: ${parseError}`);
          if (!globalRenameMap.has(item.name)) {
            globalRenameMap.set(item.name, new Map());
          }
          globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
        }
      } catch (error) {
        verbose.log(`Error retrying identifier ${item.name} in scope ${item.scopeId}: ${error}`);
        
        // Exponential backoff for API errors
        await exponentialBackoff(item.retryCount);
        
        // Keep original name after max retries
        if (item.retryCount >= maxRetries) {
          verbose.log(`Max retries reached for ${item.name} in scope ${item.scopeId}, keeping original`);
          if (!globalRenameMap.has(item.name)) {
            globalRenameMap.set(item.name, new Map());
          }
          globalRenameMap.get(item.name)!.set(item.scopeId, item.name);
        }
      }
      
      // Update progress (small increments for retries)
      showPercentage(0.9 + (i / failedIdentifiers.length) * 0.05);
    }
    
    // Save global rename map after all retries
    await saveGlobalRenameMap();
  }

  // Add this helper function before the processBatch function ends
  async function downloadAndDisplayErrorFile(errorFileId: string, errorFileName: string) {
    try {
      verbose.log(`Downloading error file with ID: ${errorFileId}`);
      const errorContent = await client.files.content(errorFileId);
      const errorFile = path.join(tempDir, `${errorFileName}.jsonl`);
      
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(await errorContent.arrayBuffer());
      await fsPromises.writeFile(errorFile, buffer);
      
      verbose.log(`Downloaded error file to: ${errorFile}`);
      
      // Read and display the error file contents
      const errorText = await fsPromises.readFile(errorFile, 'utf-8');
      console.error(`\n========== ERROR FILE CONTENTS ==========\n${errorText}\n=========================================\n`);
      
      return errorFile;
    } catch (error) {
      verbose.log(`Error downloading or displaying error file: ${error}`);
      return null;
    }
  }
} 