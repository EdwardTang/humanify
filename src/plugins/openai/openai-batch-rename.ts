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
const RENAME_MAP_PATH = `./.humanify-cursor_v${process.env.CURSOR_VERSION || "0.47.7"}-rename-map.json`;

// Map of common single-letter identifiers to fallback names based on semantic role
const fallbackRenameMap: Record<string, Record<string, string>> = {
  'e': {
    'ERROR_PARAM': 'errorObj',
    'EVENT_PARAM': 'event',
    'DOM_ELEMENT': 'element',
    'default': 'param'
  },
  't': {
    'TEMPORARY': 'tempValue',
    'OBJECT_CONTEXT': 'thisContext',
    'default': 'temp'
  },
  'i': {
    'ITERATOR': 'index',
    'default': 'iterator'
  },
  'j': {
    'ITERATOR': 'innerIndex',
    'default': 'jValue'
  },
  'k': {
    'ITERATOR': 'outerIndex',
    'default': 'key'
  },
  'r': {
    'CONDITION_RESULT': 'result',
    'PROMISE_RESOLVER': 'resolve',
    'default': 'returnValue'
  },
  'n': {
    'INDEX_REFERENCE': 'position',
    'default': 'number'
  },
  'p': {
    'default': 'param'
  },
  'v': {
    'default': 'value'
  },
  'x': {
    'INDEX_REFERENCE': 'xPosition',
    'default': 'xValue'
  },
  'y': {
    'INDEX_REFERENCE': 'yPosition',
    'default': 'yValue'
  },
  'cb': {
    'CALLBACK_PARAM': 'callback',
    'default': 'callback'
  },
  'fn': {
    'CALLBACK_PARAM': 'functionCallback',
    'default': 'function'
  },
  'el': {
    'DOM_ELEMENT': 'element',
    'default': 'element'
  }
};

/**
 * Forces renaming of single-letter identifiers if they weren't renamed by the LLM
 * This ensures we don't leave any short names in the output
 */
function applyFallbackRename(
  originalName: string, 
  currentName: string, 
  semanticRole?: string
): string {
  // If the name was already changed to something descriptive, keep it
  if (currentName !== originalName && currentName.length > 2) {
    verbose.log(`Keeping existing rename for '${originalName}' -> '${currentName}'`);
    return currentName;
  }
  
  // If original name is already descriptive (>2 chars), keep it
  if (originalName.length > 2) {
    return currentName;
  }
  
  verbose.log(`Applying fallback rename for short identifier '${originalName}' -> '${currentName}' with role ${semanticRole || 'UNKNOWN'}`);
  
  // Check if we have a fallback for this identifier
  if (fallbackRenameMap[originalName]) {
    // If we have role-specific fallback, use it
    if (semanticRole && fallbackRenameMap[originalName][semanticRole]) {
      const newName = fallbackRenameMap[originalName][semanticRole];
      verbose.log(`Using role-specific fallback: '${originalName}' -> '${newName}' (role: ${semanticRole})`);
      return newName;
    }
    // Otherwise use the default fallback
    const defaultName = fallbackRenameMap[originalName]['default'];
    verbose.log(`Using default fallback: '${originalName}' -> '${defaultName}'`);
    return defaultName;
  }
  
  // For any other single-letter identifier, append "Value" or use role-based suffix
  let fallbackName = '';
  if (semanticRole && semanticRole !== 'UNKNOWN') {
    // Create name based on role
    fallbackName = originalName + semanticRole.toLowerCase().replace(/_/g, '');
    verbose.log(`Generated role-based fallback: '${originalName}' -> '${fallbackName}'`);
  } else {
    fallbackName = originalName + 'Value';
    verbose.log(`Generated generic fallback: '${originalName}' -> '${fallbackName}'`);
  }
  
  return fallbackName;
}

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
  semanticRole?: string;
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
  const { name, surroundingCode, location, semanticRole } = identifier;
  const scopeId = `${location.filePath || "unknown"}:${location.line}:${location.column}`;
  
  return {
    name,
    surroundingCode,
    retryCount: 0,
    scopeId,
    semanticRole
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
  
  // Special handling for temp-code files with timestamps
  if (filePath.includes('temp-code-')) {
    // Extract just the filename without the path
    const baseName = path.basename(filePath);
    // Create a simplified name that avoids problematic prefixes
    return `temp-${baseName}.${suffix}.jsonl`;
  }
  
  // Get the base filename without path
  const baseName = path.basename(filePath);
  
  // Check if it already follows our cursor version convention
  if (baseName.startsWith('cursor_v')) {
    // Just append the suffix for temp files that already follow our convention
    return `${baseName.replace('.js', '')}-${suffix}.jsonl`;
  }
  
  // Extract version info from path if present
  const versionMatch = filePath.match(/cursor[_-]v?(\d+\.\d+\.\d+|\d+\.\d+)/);
  const cursorVersion = versionMatch ? versionMatch[1] : process.env.CURSOR_VERSION || "0.47.7"; // Default version
  
  // Extract file components
  const parsedPath = path.parse(filePath);
  const fileType = parsedPath.ext.replace('.', '') || 'unknown';
  const fileName = parsedPath.name;
  
  // Create abbreviated path components
  const pathComponents = parsedPath.dir.split(path.sep).filter(p => p);
  const pathFingerprint = pathComponents.length > 0 
    ? pathComponents.map(p => p.slice(0, 3)).join('-')
    : 'nopath';
  
  // Construct filename starting with version info
  let result = `cursor_v${cursorVersion}-${pathFingerprint}-${fileName}-${fileType}-${suffix}.jsonl`;
  
  // Sanitize any problematic characters
  result = result.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-');
  
  // Final validation to catch any edge cases with problematic prefixes
  if (result.startsWith('@') || result.startsWith('.')) {
    result = `temp-${result}`;
  }
  
  verbose.log(`Generated traceable filename: ${result} from path: ${filePath}`);
  return result;
}

export async function openAIBatchRename({
  apiKey,
  baseURL,
  model, // We'll keep this for backward compatibility but it won't be used for batch requests
  contextWindowSize,
  batchSize = 100,
  chunkSize = 500000, // Default to 500KB chunks
  pollInterval = 60000, // 1 minute in milliseconds
  tempDir = `./.humanify-cursor_v${process.env.CURSOR_VERSION || "0.47.7"}-batch`,
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
      // Add more detailed logging
      verbose.log(`Starting to save global rename map with ${globalRenameMap.size} identifier entries...`);
      
      // Log a few sample entries for debugging
      let samplesLogged = 0;
      for (const [name, scopeMap] of globalRenameMap.entries()) {
        if (samplesLogged < 5) {
          verbose.log(`Sample entry for '${name}': ${[...scopeMap.entries()].map(([scope, rename]) => 
            `{scope: ${scope}, rename: ${rename}}`).join(', ')}`);
          samplesLogged++;
        }
      }
      
      // Check for empty map
      if (globalRenameMap.size === 0) {
        verbose.log(`WARNING: Global rename map is empty! No renames will be saved.`);
      }
      
      // Convert nested map to a serializable object
      const mapObject: Record<string, Record<string, string>> = {};
      
      for (const [name, scopeMap] of globalRenameMap.entries()) {
        mapObject[name] = {};
        for (const [scopeId, rename] of scopeMap.entries()) {
          mapObject[name][scopeId] = rename;
        }
      }
      
      // Log the size of the JSON being saved
      const jsonString = JSON.stringify(mapObject, null, 2);
      verbose.log(`Saving rename map with ${Object.keys(mapObject).length} entries and ${jsonString.length} bytes to ${RENAME_MAP_PATH}`);
      
      await fsPromises.writeFile(
        RENAME_MAP_PATH,
        jsonString
      );
      
      // Count total entries across all scopes
      let totalEntries = 0;
      for (const scopeMap of globalRenameMap.values()) {
        totalEntries += scopeMap.size;
      }
      
      verbose.log(`Successfully saved global rename map with ${globalRenameMap.size} identifiers and ${totalEntries} total scope entries`);
    } catch (error) {
      verbose.log(`ERROR saving global rename map: ${error}`);
      // Log additional error details if available
      if (error instanceof Error && error.stack) {
        verbose.log(`Error stack: ${error.stack}`);
      }
    }
  }

  // Exponential backoff for rate limiting
  async function exponentialBackoff(retryCount: number) {
    const delay = initialBackoff * Math.pow(backoffMultiplier, retryCount);
    verbose.log(`Rate limit hit or error, backing off for ${delay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return async (code: string, filePath?: string): Promise<string> => {
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
          sourceInfo: filePath || 'direct-code-input', // Pass the current file path or a meaningful default
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
    let finalCode = await visitAllIdentifiers(
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

    // After all processing is done, perform final post-processing scan with dead letter queue approach
    try {
      verbose.log(`Starting enhanced post-processing scan for remaining short identifiers...`);
      
      // Parse the finalCode to find any remaining short identifiers
      const ast = parse(finalCode, {
        sourceType: "module",
        plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
      });
      
      // Track all remaining short identifiers
      const remainingShortIds = new Set<string>();
      
      // Map to track identifier locations for adding comments later
      const identifierLocations = new Map<string, Array<{start: number, end: number}>>();
      
      // Common single-letter identifiers we should always check for
      const commonSingleLetterIds = ['e', 't', 'i', 'j', 'k', 'r', 'n', 'p', 'v', 'x', 'y'];
      
      // Add common identifiers to check list
      for (const id of commonSingleLetterIds) {
        remainingShortIds.add(id);
      }
      
      // Traverse to find all identifiers and their locations
      traverse(ast, {
        Identifier(path) {
          const name = path.node.name;
          
          // Skip if not a variable/parameter name that should be renamed
          if (
            path.parentPath?.isImportSpecifier() || 
            path.parentPath?.isImportDefaultSpecifier() ||
            (path.parentPath?.isMemberExpression() && path.parentPath.get('property') === path) ||
            (path.parent && path.parent.type === 'ObjectProperty' && path.parent.key === path.node && !path.parent.computed)
          ) {
            return;
          }
          
          // Check if it's a short identifier (1-2 chars)
          if (name.length <= 2 && /^[a-zA-Z][a-zA-Z0-9]?$/.test(name)) {
            remainingShortIds.add(name);
            
            // Store location for potential comment insertion later
            if (path.node.start !== undefined && path.node.end !== undefined) {
              if (!identifierLocations.has(name)) {
                identifierLocations.set(name, []);
              }
              identifierLocations.get(name)!.push({
                start: path.node.start ?? 0,
                end: path.node.end ?? 0
              });
            }
          }
        }
      });
      
      // FIRST LOOP: Apply existing renames from the global rename map
      if (remainingShortIds.size > 0) {
        verbose.log(`LOOP 1: Found ${remainingShortIds.size} short identifiers to check: ${[...remainingShortIds].join(', ')}`);
        
        // Check which identifiers are already in the global rename map
        const mappedIdentifiers = new Set<string>();
        
        for (const shortId of remainingShortIds) {
          if (globalRenameMap.has(shortId)) {
            mappedIdentifiers.add(shortId);
            verbose.log(`Found existing rename for '${shortId}' in global map`);
          }
        }
        
        // Remove mapped identifiers from remaining list
        for (const mappedId of mappedIdentifiers) {
          remainingShortIds.delete(mappedId);
        }
        
        verbose.log(`LOOP 1: Applied ${mappedIdentifiers.size} existing renames, ${remainingShortIds.size} identifiers remain`);
      }
      
      // SECOND LOOP: Try using o1 model in batch mode for remaining identifiers
      if (remainingShortIds.size > 0) {
        verbose.log(`LOOP 2: Attempting to rename ${remainingShortIds.size} identifiers with o1 model in batch mode...`);
        
        // Convert set to array for processing
        const remainingIdsArray = Array.from(remainingShortIds);
        const batchItems: RetryableIdentifier[] = [];
        
        // Create batch items with context for each remaining identifier
        for (const shortId of remainingIdsArray) {
          let surroundingCode = "";
          if (identifierLocations.has(shortId) && identifierLocations.get(shortId)!.length > 0) {
            const firstLocation = identifierLocations.get(shortId)![0];
            const start = firstLocation.start ?? 0;
            const end = firstLocation.end ?? 0;
            const startPos = Math.max(0, start - 150);
            const endPos = Math.min(finalCode.length, end + 150);
            surroundingCode = finalCode.substring(startPos, endPos);
          } else {
            // Fallback to searching for the identifier in code
            const regex = new RegExp(`\\b${shortId}\\b`, 'g');
            const match = regex.exec(finalCode);
            if (match && match.index !== undefined) {
              const startPos = Math.max(0, match.index - 150);
              const endPos = Math.min(finalCode.length, match.index + shortId.length + 150);
              surroundingCode = finalCode.substring(startPos, endPos);
            } else {
              surroundingCode = `function example(${shortId}) { return ${shortId}; }`; // Fallback
            }
          }
          
          // Create a forced scope ID for this identifier
          const forcedScopeId = `forced:${filePath || 'unknown'}:${shortId}`;
          
          // Add to batch items
          batchItems.push({
            name: shortId,
            surroundingCode,
            retryCount: 0,
            scopeId: forcedScopeId
          });
        }
        
        // Split into batches if needed (standard batch size might be too large for o1)
        const o1BatchSize = Math.min(20, batchSize); // Smaller batch size for o1 to avoid timeouts
        const o1Batches: RetryableIdentifier[][] = [];
        
        for (let i = 0; i < batchItems.length; i += o1BatchSize) {
          o1Batches.push(batchItems.slice(i, i + o1BatchSize));
        }
        
        verbose.log(`Created ${o1Batches.length} batches for O1 processing with max ${o1BatchSize} items per batch`);
        
        // Failed identifiers container
        const failedFinalAttempts: RetryableIdentifier[] = [];
        const successfullyRenamed = new Set<string>();
        
        // Process each batch with o1 model
        for (let batchIdx = 0; batchIdx < o1Batches.length; batchIdx++) {
          const currentBatch = o1Batches[batchIdx];
          verbose.log(`Processing O1 batch ${batchIdx + 1} of ${o1Batches.length} with ${currentBatch.length} identifiers`);
          
          try {
            // Get the file path suffix for this batch
            const batchFileSuffix = `o1-final-batch-${batchIdx}`;
            const batchFileName = generateTraceableFileName(filePath || 'unknown', batchFileSuffix);
            const batchFile = path.join(tempDir, batchFileName);
            
            // Create batch tasks using the o1 model
            const batchTasks = currentBatch.map((item, index) => {
              // When using o1 for batch processing, we can't do the two-step approach 
              // since we can't chain API calls in a batch, so we'll use a combined prompt
              // that asks for both description and renaming
              const combinedPrompt = `You are an expert JavaScript developer. Please complete two tasks:

1. First, identify the purpose of the identifier '${item.name}' in one sentence based on how it's used in the code.
2. Then, suggest a better, more descriptive name for this identifier in camelCase format.

Original identifier: ${item.name}
Scope context: ${item.scopeId}
${item.semanticRole ? `Semantic role: ${item.semanticRole}` : ""}

Surrounding code:
\`\`\`javascript
${item.surroundingCode}
\`\`\`

${item.name.length === 1 ? "IMPORTANT: This is a single-letter identifier that needs a more descriptive name. Do not return single-letter names." : ""}

Respond with ONLY the suggested variable name in camelCase format (e.g., "getUserData"). No explanations or other text.`;

              return {
                custom_id: `${batchIdx}-${index}`,
                method: "POST",
                url: "/v1/chat/completions",
                body: {
                  model: "o1",
                  messages: [{ role: "user", content: combinedPrompt }],
                  temperature: 0.2,
                  reasoning_effort: "low"
                }
              };
            });
            
            // Write batch file
            await fsPromises.writeFile(
              batchFile,
              batchTasks.map(task => JSON.stringify(task)).join('\n')
            );
            
            verbose.log(`Created O1 batch file: ${batchFile}`);
            
            // Upload the batch file
            const fileUpload = await client.files.create({
              file: createReadStream(batchFile),
              purpose: "batch"
            });
            
            verbose.log(`Uploaded O1 batch file with ID: ${fileUpload.id}`);
            
            // Create the batch job
            const batchJob = await client.batches.create({
              input_file_id: fileUpload.id,
              endpoint: "/v1/chat/completions",
              completion_window: "24h"
            });
            
            verbose.log(`Created O1 batch job with ID: ${batchJob.id}`);
            
            // Check immediate errors
            if (batchJob.errors) {
              verbose.log(`O1 batch job creation returned errors: ${JSON.stringify(batchJob.errors)}`);
              throw new Error(`O1 batch job creation failed with errors`);
            }
            
            // Poll for completion with exponential backoff
            let completed = false;
            let pollRetryCount = 0;
            
            while (!completed) {
              try {
                const jobStatus = await client.batches.retrieve(batchJob.id);
                verbose.log(`O1 batch job status: ${jobStatus.status}`);
                
                if (jobStatus.status === "completed") {
                  if (jobStatus.output_file_id) {
                    // Get the results
                    const resultContent = await client.files.content(jobStatus.output_file_id);
                    const resultFileSuffix = `o1-result-${batchIdx}`;
                    const resultFileName = generateTraceableFileName(filePath || 'unknown', resultFileSuffix);
                    const resultFile = path.join(tempDir, resultFileName);
                    
                    // Convert ArrayBuffer to Buffer
                    const buffer = Buffer.from(await resultContent.arrayBuffer());
                    await fsPromises.writeFile(resultFile, buffer);
                    
                    verbose.log(`Downloaded O1 results to: ${resultFile}`);
                    
                    // Parse the results
                    const resultText = await fsPromises.readFile(resultFile, 'utf-8');
                    const results = resultText.split('\n')
                      .filter((line: string) => line.trim())
                      .map((line: string) => JSON.parse(line));
                    
                    // Process the results
                    for (const result of results) {
                      // Ignore the batch index part, only need the item index
                      const itemIdxStr = result.custom_id.split('-')[1];
                      const itemIdx = Number(itemIdxStr);
                      const originalItem = currentBatch[itemIdx];
                      const originalName = originalItem.name;
                      const scopeId = originalItem.scopeId;
                      
                      if (result.error) {
                        verbose.log(`Error in O1 processing for '${originalName}': ${result.error.message}`);
                        failedFinalAttempts.push(originalItem);
                      } else {
                        try {
                          const content = result.response.body.choices[0].message.content?.trim();
                          
                          // Validate the suggested name
                          if (content && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(content) && content !== originalName) {
                            // Add to global rename map
                            if (!globalRenameMap.has(originalName)) {
                              globalRenameMap.set(originalName, new Map());
                            }
                            globalRenameMap.get(originalName)!.set(scopeId, content);
                            
                            verbose.log(`LOOP 2: Successfully renamed '${originalName}' to '${content}' with o1 model`);
                            successfullyRenamed.add(originalName);
                          } else {
                            verbose.log(`LOOP 2: Invalid name received for '${originalName}' from o1 model: ${content}`);
                            failedFinalAttempts.push(originalItem);
                          }
                        } catch (parseError) {
                          verbose.log(`LOOP 2: Error parsing result for '${originalName}': ${parseError}`);
                          failedFinalAttempts.push(originalItem);
                        }
                      }
                    }
                    
                    completed = true;
                  } else {
                    verbose.log(`O1 job completed but no output file ID found`);
                    completed = true;
                  }
                } else if (jobStatus.status === "failed" || jobStatus.status === "expired") {
                  verbose.log(`O1 batch job ${jobStatus.status}: ${JSON.stringify(jobStatus.errors || {})}`);
                  // Add all items in this batch to failed attempts
                  failedFinalAttempts.push(...currentBatch);
                  completed = true;
                } else {
                  // Wait before polling again
                  const pollDelay = Math.min(pollInterval, 30000); // Use shorter polling for O1 batches
                  verbose.log(`Waiting ${pollDelay / 1000} seconds before polling O1 job again...`);
                  await new Promise(resolve => setTimeout(resolve, pollDelay));
                }
              } catch (error) {
                verbose.log(`Error polling O1 batch job: ${error}`);
                pollRetryCount++;
                
                if (pollRetryCount <= maxRetries) {
                  // Use exponential backoff for polling retries
                  await exponentialBackoff(pollRetryCount);
                } else {
                  verbose.log(`Max poll retries reached for O1 batch`);
                  // Move all items to failed identifiers
                  failedFinalAttempts.push(...currentBatch);
                  completed = true;
                }
              }
            }
          } catch (error) {
            verbose.log(`Error processing O1 batch: ${error}`);
            // Add all items in this batch to failed attempts
            failedFinalAttempts.push(...currentBatch);
          }
        }
        
        // Remove successfully renamed identifiers from remaining set
        for (const renamedId of successfullyRenamed) {
          remainingShortIds.delete(renamedId);
        }
        
        verbose.log(`LOOP 2: Successfully renamed ${successfullyRenamed.size} identifiers with o1 model, ${remainingShortIds.size} still remain`);
        
        // Save global rename map with o1 additions
        await saveGlobalRenameMap();
      }
      
      // THIRD LOOP: Add comments for any remaining identifiers
      if (remainingShortIds.size > 0) {
        verbose.log(`LOOP 3: Adding comments for ${remainingShortIds.size} remaining short identifiers`);
        
        // We need to reapply all the renames first, then add comments
        let codeWithRenames = finalCode;
        
        // First apply all successful renames from the global map
        codeWithRenames = await visitAllIdentifiers(
          finalCode,
          async (name, _surroundingCode, scopeId) => {
            // Get the most specific rename available
            if (globalRenameMap.has(name)) {
              const scopeMap = globalRenameMap.get(name)!;
              
              // Try exact scope first
              if (scopeMap.has(scopeId)) {
                return scopeMap.get(scopeId)!;
              }
              
              // Try forced scope
              const forcedScopeId = `forced:${filePath || 'unknown'}`;
              if (scopeMap.has(forcedScopeId)) {
                return scopeMap.get(forcedScopeId)!;
              }
              
              // Try default scope as fallback
              if (scopeMap.has('default')) {
                return scopeMap.get('default')!;
              }
            }
            
            return name; // No rename found
          },
          contextWindowSize
        );
        
        // After applying renames, we need to add comments for any remaining short identifiers
        // We'll use string manipulation since we need to add comments, not renames
        // Sort locations in reverse order to avoid position shifts
        let codeWithComments = codeWithRenames;
        
        // We need to parse again to find the remaining locations after renames
        const newAst = parse(codeWithRenames, {
          sourceType: "module",
          plugins: ["jsx", "typescript", "classProperties", "decorators-legacy"],
        });
        
        // Clear and rebuild the location map for remaining identifiers
        for (const shortId of remainingShortIds) {
          identifierLocations.set(shortId, []);
        }
        
        // Find current locations of remaining identifiers
        traverse(newAst, {
          Identifier(path) {
            const name = path.node.name;
            
            if (remainingShortIds.has(name) && 
                path.node.start !== undefined && 
                path.node.end !== undefined) {
              
              identifierLocations.get(name)!.push({
                start: path.node.start ?? 0,
                end: path.node.end ?? 0
              });
            }
          }
        });
        
        // For each remaining identifier, add a comment at its first occurrence
        const commentedIds = new Set<string>();
        
        // Collect all locations from all identifiers
        const allLocations: Array<{id: string, start: number, end: number}> = [];
        for (const [id, locations] of identifierLocations.entries()) {
          if (remainingShortIds.has(id)) {
            // Only use first occurrence of each identifier
            if (locations.length > 0) {
              allLocations.push({
                id,
                start: locations[0].start,
                end: locations[0].end
              });
            }
          }
        }
        
        // Sort locations in reverse order (to avoid position shifts)
        allLocations.sort((a, b) => b.start - a.start);
        
        // Add comments
        for (const location of allLocations) {
          const id = location.id;
          
          // Only add comment if we haven't already for this id
          if (!commentedIds.has(id)) {
            const comment = ` /* TODO: Short identifier '${id}' needs manual renaming, automated attempts failed */`;
            codeWithComments = codeWithComments.slice(0, location.end) + comment + codeWithComments.slice(location.end);
            commentedIds.add(id);
            
            verbose.log(`LOOP 3: Added comment for unresolved identifier '${id}'`);
          }
        }
        
        // Use the code with comments as the final result
        finalCode = codeWithComments;
        
        verbose.log(`LOOP 3: Added comments for ${commentedIds.size} identifiers that could not be automatically renamed`);
      }
      
      // Ensure we have something in the globalRenameMap if it's empty 
      if (globalRenameMap.size === 0) {
        verbose.log(`WARNING: Global rename map is empty! Adding some default entries as a placeholder...`);
        // Add some default entries to avoid empty maps
        for (const id of commonSingleLetterIds) {
          const defaultName = applyFallbackRename(id, id, "UNKNOWN");
          globalRenameMap.set(id, new Map());
          globalRenameMap.get(id)!.set("default", defaultName);
          verbose.log(`Added default rename entry: '${id}' -> '${defaultName}'`);
        }
      }
    } catch (error) {
      verbose.log(`Error in enhanced post-processing scan: ${error}`);
    }
    
    // One final save to ensure the rename map exists on disk
    try {
      await saveGlobalRenameMap();
      verbose.log(`Final check: rename map with ${globalRenameMap.size} entries saved to ${RENAME_MAP_PATH}`);
    } catch (mapSaveError) {
      verbose.log(`ERROR in final rename map save: ${mapSaveError}`);
    }
    
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
  
  // Update toRenamePrompt to include scope information and use o3-mini in a two-step process
  async function toRenamePrompt(
    client: OpenAI,
    name: string,
    surroundingCode: string,
    scopeId: string = "",
    semanticRole?: string
  ): Promise<OpenAI.Chat.Completions.ChatCompletionCreateParams> {
    // Check if this is a single-letter identifier
    const isSingleLetter = name.length === 1;
    
    // Format a semantic role message based on role
    let roleMessage = "";
    if (semanticRole) {
      switch (semanticRole) {
        case "ERROR_PARAM":
          roleMessage = "This identifier is a parameter in a catch clause (error object).";
          break;
        case "EVENT_PARAM":
          roleMessage = "This identifier is an event parameter in an event handler function.";
          break;
        case "ITERATOR":
          roleMessage = "This identifier is used as an iterator in a loop.";
          break;
        case "TEMPORARY":
          roleMessage = "This identifier is used as a temporary variable.";
          break;
        case "CONDITION_RESULT":
          roleMessage = "This identifier stores the result of a conditional expression.";
          break;
        case "CALLBACK_PARAM":
          roleMessage = "This identifier is a callback function parameter.";
          break;
        case "PROMISE_RESOLVER":
          roleMessage = "This identifier is a Promise resolver or rejecter parameter.";
          break;
        case "OBJECT_CONTEXT":
          roleMessage = "This identifier stores a reference to 'this' context.";
          break;
        case "DOM_ELEMENT":
          roleMessage = "This identifier references a DOM element.";
          break;
        case "INDEX_REFERENCE":
          roleMessage = "This identifier is used as an index or reference to an array element.";
          break;
        case "MODULE_ALIAS":
          roleMessage = "This identifier is an alias for an imported module.";
          break;
        case "DESTRUCTURED_PARAM":
          roleMessage = "This identifier is part of a destructured parameter or assignment.";
          break;
        default:
          roleMessage = "";
      }
    }
    
    // Prepare examples message for common single-letter variables only if needed
    let examplesMessage = "";
    if (isSingleLetter) {
      examplesMessage = `
Examples of good renames for common single-letter identifiers:
- 'e' in catch clause → 'error', 'err', 'exception'
- 'e' in event handlers → 'event', 'evt', 'domEvent'
- 'i' in for loops → 'index', 'counter', 'itemIndex'
- 't' as temporary variable → 'temp', 'tempValue', 'intermediate'
- 'r' storing results → 'result', 'returnValue', 'response'
- 'p' for parameters → 'param', 'options', 'config'
- 'cb' for callbacks → 'callback', 'onComplete', 'handler'`;
    }

    // Step 1: Get description of the identifier
    const descriptionPrompt = `You are an expert JavaScript developer. Your task is to read the following code and write the purpose of the identifier '${name}' in one sentence. Describe what this identifier is used for based on the context.

Original identifier: ${name}
Scope context: ${scopeId}
${roleMessage ? `Semantic role: ${roleMessage}` : ""}

Surrounding code:
\`\`\`javascript
${surroundingCode}
\`\`\`

Respond with only a clear, concise description of what this identifier does or represents.`;

    // Get description
    try {
      const description = await client.chat.completions.create({
        model: "o3-mini",
        messages: [{ role: "user", content: descriptionPrompt }],
        temperature: 0.2
      });
      
      const identifierDescription = description.choices[0]?.message?.content?.trim() || "Unknown identifier purpose";
      verbose.log(`Description for '${name}': ${identifierDescription}`);

      // Step 2: Now create the naming prompt based on the description
      const namingPrompt = `You are an expert JavaScript developer. Based on the following description, suggest a better, more descriptive name for the identifier.

Original identifier: ${name}
Description: ${identifierDescription}
${isSingleLetter ? "IMPORTANT: This is a single-letter identifier that needs a more descriptive name. Do not return single-letter names." : ""}
${examplesMessage}

Respond with only a single word or phrase in camelCase format (e.g., "getUserData", "formatTimestamp", "isValidInput"). Do not include explanations, code examples, or additional text.`;

      // Check if the context might benefit from additional file search
      const needsAdditionalContext = shouldUseFileSearch(name, surroundingCode);

      // Base request configuration
      const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model: "o3-mini",
        messages: [{ role: "user", content: namingPrompt }],
        temperature: 0.2 // Lower temperature for more deterministic coding responses
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
                  }
                },
                required: ["query"]
              }
            }
          }
        ];
      }

      return requestConfig;
    } catch (error) {
      console.error("Error getting identifier description:", error);
      
      // Fallback to original approach if description fails
      const fallbackPrompt = `You are an expert JavaScript developer. Please analyze the following identifier and suggest a better, more descriptive name for it based on how it's used in the code.

Original identifier: ${name}
Scope context: ${scopeId}
${roleMessage ? `Semantic role: ${roleMessage}` : ""}

Surrounding code:
\`\`\`javascript
${surroundingCode}
\`\`\`
${examplesMessage}

${isSingleLetter ? "IMPORTANT: This is a single-letter identifier that needs a more descriptive name. Do not return single-letter names." : ""}

Respond with only a single word or phrase in camelCase format (e.g., "getUserData", "formatTimestamp", "isValidInput"). Do not include explanations, code examples, or additional text.`;

      return {
        model: "o3-mini",
        messages: [{ role: "user", content: fallbackPrompt }],
        temperature: 0.2
      };
    }
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
    
    const batchTasks = await Promise.all(batch.map(async (item, index) => ({
      custom_id: `${batchIndex}-${index}`,
      method: "POST",
      url: "/v1/chat/completions",
      body: await toRenamePrompt(client, item.name, item.surroundingCode, item.scopeId, item.semanticRole)
    })));
    
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
                  const semanticRole = originalItem.semanticRole;
                  
                  if (result.error) {
                    verbose.log(`Error processing ${originalName} in scope ${scopeId}: ${result.error.message}`);
                    
                    // Add to failed identifiers for retry if under max retries
                    if (originalItem.retryCount < maxRetries) {
                      originalItem.retryCount++;
                      verbose.log(`Adding ${originalName} in scope ${scopeId} for retry (attempt ${originalItem.retryCount})`);
                      failedIdentifiers.push(originalItem);
                    } else {
                      // Max retries reached, apply fallback rename for short identifiers
                      let finalName = originalName;
                      if (originalName.length <= 2) {
                        finalName = applyFallbackRename(originalName, originalName, semanticRole);
                        verbose.log(`Max retries reached for short identifier '${originalName}', using fallback rename: ${finalName}`);
                      } else {
                        verbose.log(`Max retries reached for ${originalName} in scope ${scopeId}, keeping original`);
                      }
                      
                      if (!globalRenameMap.has(originalName)) {
                        globalRenameMap.set(originalName, new Map());
                      }
                      globalRenameMap.get(originalName)!.set(scopeId, finalName);
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
                        
                        // Apply fallback rename if the LLM returned the original name for a short identifier
                        if (renamed === originalName && originalName.length <= 2) {
                          renamed = applyFallbackRename(originalName, renamed, semanticRole);
                          verbose.log(`LLM returned original name for short identifier '${originalName}', using fallback rename: ${renamed}`);
                        }
                        
                        // Validate the returned name is valid JS identifier
                        if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
                          verbose.log(`Renamed ${originalName} in scope ${scopeId} to ${renamed}`);
                          if (!globalRenameMap.has(originalName)) {
                            globalRenameMap.set(originalName, new Map());
                          }
                          globalRenameMap.get(originalName)!.set(scopeId, renamed);
                        } else {
                          // Invalid identifier, apply fallback for short identifiers
                          let finalName = originalName;
                          if (originalName.length <= 2) {
                            finalName = applyFallbackRename(originalName, originalName, semanticRole);
                            verbose.log(`Invalid identifier ${renamed} for short identifier '${originalName}', using fallback: ${finalName}`);
                          } else {
                            verbose.log(`Invalid identifier ${renamed} for ${originalName} in scope ${scopeId}, keeping original`);
                          }
                          
                          if (!globalRenameMap.has(originalName)) {
                            globalRenameMap.set(originalName, new Map());
                          }
                          globalRenameMap.get(originalName)!.set(scopeId, finalName);
                        }
                      }
                    } catch (parseError) {
                      verbose.log(`Error parsing rename result for ${originalName} in scope ${scopeId}: ${parseError}`);
                      
                      // Add to failed identifiers for retry if under max retries
                      if (originalItem.retryCount < maxRetries) {
                        originalItem.retryCount++;
                        failedIdentifiers.push(originalItem);
                      } else {
                        // Max retries reached, apply fallback rename for short identifiers
                        let finalName = originalName;
                        if (originalName.length <= 2) {
                          finalName = applyFallbackRename(originalName, originalName, semanticRole);
                          verbose.log(`Error processing short identifier '${originalName}', using fallback rename: ${finalName}`);
                        } else {
                          verbose.log(`Max retries reached for ${originalName} in scope ${scopeId}, keeping original`);
                        }
                        
                        if (!globalRenameMap.has(originalName)) {
                          globalRenameMap.set(originalName, new Map());
                        }
                        globalRenameMap.get(originalName)!.set(scopeId, finalName);
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
      const semanticRole = item.semanticRole;
      verbose.log(`Retrying ${item.name} in scope ${item.scopeId} (attempt ${item.retryCount} of ${maxRetries})`);
      
      try {
        // Correctly handle the response type for newer OpenAI SDK
        const response = await client.chat.completions.create(
          await toRenamePrompt(client, item.name, item.surroundingCode, item.scopeId, item.semanticRole)
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
            
            // Apply fallback rename if the LLM returned the original name for a short identifier
            if (renamed === item.name && item.name.length <= 2) {
              renamed = applyFallbackRename(item.name, renamed, semanticRole);
              verbose.log(`LLM returned original name for short identifier '${item.name}', using fallback rename: ${renamed}`);
            }
            
            // Validate the returned name is valid JS identifier
            if (renamed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(renamed)) {
              verbose.log(`Renamed ${item.name} in scope ${item.scopeId} to ${renamed}`);
              if (!globalRenameMap.has(item.name)) {
                globalRenameMap.set(item.name, new Map());
              }
              globalRenameMap.get(item.name)!.set(item.scopeId, renamed);
            } else {
              // Invalid identifier, apply fallback for short identifiers
              let finalName = item.name;
              if (item.name.length <= 2) {
                finalName = applyFallbackRename(item.name, item.name, semanticRole);
                verbose.log(`Invalid identifier ${renamed} for short identifier '${item.name}', using fallback: ${finalName}`);
              } else {
                verbose.log(`Invalid identifier ${renamed} for ${item.name} in scope ${item.scopeId}, keeping original`);
              }
              
              if (!globalRenameMap.has(item.name)) {
                globalRenameMap.set(item.name, new Map());
              }
              globalRenameMap.get(item.name)!.set(item.scopeId, finalName);
            }
          }
        } catch (parseError) {
          verbose.log(`Error parsing retry result for ${item.name} in scope ${item.scopeId}: ${parseError}`);
          
          // Apply fallback rename for short identifiers that have reached max retries
          let finalName = item.name;
          if (item.retryCount >= maxRetries && item.name.length <= 2) {
            finalName = applyFallbackRename(item.name, item.name, semanticRole);
            verbose.log(`Error processing short identifier '${item.name}', using fallback rename: ${finalName}`);
          }
          
          if (!globalRenameMap.has(item.name)) {
            globalRenameMap.set(item.name, new Map());
          }
          globalRenameMap.get(item.name)!.set(item.scopeId, finalName);
        }
      } catch (error) {
        verbose.log(`Error retrying identifier ${item.name} in scope ${item.scopeId}: ${error}`);
        
        // Exponential backoff for API errors
        await exponentialBackoff(item.retryCount);
        
        // Keep original name after max retries, with fallback for short identifiers
        if (item.retryCount >= maxRetries) {
          let finalName = item.name;
          if (item.name.length <= 2) {
            finalName = applyFallbackRename(item.name, item.name, semanticRole);
            verbose.log(`Max retries reached for short identifier '${item.name}', using fallback rename: ${finalName}`);
          } else {
            verbose.log(`Max retries reached for ${item.name} in scope ${item.scopeId}, keeping original`);
          }
          
          if (!globalRenameMap.has(item.name)) {
            globalRenameMap.set(item.name, new Map());
          }
          globalRenameMap.get(item.name)!.set(item.scopeId, finalName);
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