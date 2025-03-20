import { parse } from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
import { Identifier } from "@babel/types";
import * as fs from "fs";
import { createReadStream } from "fs";
import { verbose } from "../../verbose.js";
import * as path from "path";

// Match the import pattern that works in visit-all-identifiers.ts
const traverse: typeof babelTraverse.default.default = (
  typeof babelTraverse.default === "function"
    ? babelTraverse.default
    : babelTraverse.default.default
) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- This hack is because of how the module is exported

// New enum to classify identifier roles
export enum SemanticRole {
  ERROR_PARAM = "ERROR_PARAM",        // e.g., catch(e) {}
  EVENT_PARAM = "EVENT_PARAM",        // e.g., function(e) { e.preventDefault() }
  ITERATOR = "ITERATOR",              // e.g., for(let i = 0; i < 10; i++)
  TEMPORARY = "TEMPORARY",            // e.g., let t = x; return t * 2;
  CONDITION_RESULT = "CONDITION_RESULT", // e.g., const r = condition ? a : b;
  CALLBACK_PARAM = "CALLBACK_PARAM",  // e.g., function(cb) { cb(); } or setTimeout(() => {}, t)
  PROMISE_RESOLVER = "PROMISE_RESOLVER", // e.g., new Promise((r, j) => {})
  OBJECT_CONTEXT = "OBJECT_CONTEXT",  // e.g., const t = this; t.method()
  DOM_ELEMENT = "DOM_ELEMENT",        // e.g., const e = document.getElementById()
  INDEX_REFERENCE = "INDEX_REFERENCE", // e.g., arr[n] or mapping indices
  MODULE_ALIAS = "MODULE_ALIAS",      // e.g., import * as m from 'module'
  DESTRUCTURED_PARAM = "DESTRUCTURED_PARAM", // e.g., const { a, b: r } = obj;
  UNKNOWN = "UNKNOWN",                 // Default case
  NO_NEED_TO_RENAME = "NO_NEED_TO_RENAME" // e.g., const x = 1;
}

export interface IdentifierWithContext {
  name: string;
  surroundingCode: string;
  location: {
    line: number;
    column: number;
    filePath?: string;
  };
  semanticRole?: string;
}

export interface StreamCollectorOptions {
  // Size of chunks to read at once (in bytes)
  chunkReadSize?: number;
  // Maximum surrounding context size to capture
  contextWindowSize: number;
  // Function to call with progress updates
  onProgress?: (progress: number) => void;
  // Directory to store temporary files
  tempDir?: string;
  // Source information (file path or name)
  sourceInfo?: string;
}

/**
 * Identifies the semantic role of an identifier based on its context and usage
 * This helps provide better context for renaming short identifiers
 */
function identifySemanticRole(path: babelTraverse.NodePath<Identifier>): string {
  const name = path.node.name;
  
  // Skip identifiers that are already descriptive (length > 2)
  if (name.length > 2) {
    return SemanticRole.NO_NEED_TO_RENAME;
  }
  
  verbose.log(`Analyzing semantic role for identifier '${name}'...`);
  
  // Check if this is a catch parameter
  if (path.parentPath && path.parentPath.isCatchClause() && path.parentPath.get('param') === path) {
    verbose.log(`Identified '${name}' as ERROR_PARAM in catch clause`);
    return SemanticRole.ERROR_PARAM;
  }
  
  // Check if this is likely an event parameter
  if (name === 'e' || name === 'evt' || name === 'event') {
    // Check usage in the function body
    const functionParent = path.getFunctionParent();
    if (functionParent) {
      // Get the function body as a string
      const functionBodyCode = functionParent.toString();
      
      // Check for common event method calls
      if (
        functionBodyCode.includes(`${name}.preventDefault()`) ||
        functionBodyCode.includes(`${name}.stopPropagation()`) ||
        functionBodyCode.includes(`${name}.target`) ||
        functionBodyCode.includes(`${name}.currentTarget`) ||
        functionBodyCode.includes(`${name}.clientX`) ||
        functionBodyCode.includes(`${name}.clientY`) ||
        functionBodyCode.includes(`${name}.keyCode`) ||
        functionBodyCode.includes(`${name}.which`)
      ) {
        verbose.log(`Identified '${name}' as EVENT_PARAM with event method usage`);
        return SemanticRole.EVENT_PARAM;
      }
    }
  }
  
  // Check if this is an iterator
  if ((name === 'i' || name === 'j' || name === 'k') && path.findParent(p => p.isForStatement() || p.isForInStatement() || p.isForOfStatement())) {
    verbose.log(`Identified '${name}' as ITERATOR in loop context`);
    return SemanticRole.ITERATOR;
  }
  
  // Check if this is a temporary variable
  if ((name === 't' || name === 'tmp' || name === 'temp') && 
      path.findParent(p => p.isVariableDeclarator() && p.get('id') === path)) {
    verbose.log(`Identified '${name}' as TEMPORARY variable`);
    return SemanticRole.TEMPORARY;
  }
  
  // Check if this is a condition result
  if ((name === 'r' || name === 'result') && 
      path.findParent(p => p.isVariableDeclarator() && p.get('init')?.isConditionalExpression())) {
    verbose.log(`Identified '${name}' as CONDITION_RESULT from conditional expression`);
    return SemanticRole.CONDITION_RESULT;
  }
  
  // Check if this is a DOM element reference
  if ((name === 'el' || name === 'elem' || name === 'e') && 
      path.findParent(p => {
        if (!p.isVariableDeclarator()) return false;
        const init = p.get('init');
        return init?.isCallExpression() && 
              (init.get('callee').toString().includes('getElementById') ||
               init.get('callee').toString().includes('querySelector'));
      })) {
    verbose.log(`Identified '${name}' as DOM_ELEMENT with DOM query usage`);
    return SemanticRole.DOM_ELEMENT;
  }
  
  // Enhance detection for function parameters with single letters
  // Common single-letter parameters often follow patterns
  if (path.parentPath && path.parentPath.isFunction() && path.parentPath.get('params').includes(path)) {
    const functionBody = path.parentPath.get('body').toString();
    
    // Check for this-related contexts
    if (name === 't' && functionBody.includes(`${name}.`)) {
      verbose.log(`Identified '${name}' as OBJECT_CONTEXT in function parameter`);
      return SemanticRole.OBJECT_CONTEXT;
    }
    
    // Check for callback patterns
    if ((name === 'cb' || name === 'fn') && functionBody.includes(`${name}(`)) {
      verbose.log(`Identified '${name}' as CALLBACK_PARAM in function parameter`);
      return SemanticRole.CALLBACK_PARAM;
    }
  }
  
  verbose.log(`No specific semantic role identified for '${name}', using UNKNOWN`);
  return SemanticRole.UNKNOWN;
}

/**
 * Collects identifiers from a source file using a streaming approach
 * This reduces memory usage for large files by processing them in chunks
 */
export async function collectIdentifiersFromStream(
  filePath: string,
  options: StreamCollectorOptions
): Promise<IdentifierWithContext[]> {
  const {
    chunkReadSize = 1024 * 1024, // Default to 1MB chunks for reading
    contextWindowSize,
    onProgress,
    tempDir = "./.humanify-temp",
    sourceInfo
  } = options;

  // Ensure temp directory exists
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  // Create a temporary file to store identifiers with source info if available
  const sourceIndicator = sourceInfo ? `-${sourceInfo.replace(/[<>:"/\\|?*]/g, '-')}` : '';
  const tempFilePath = path.join(tempDir, `identifiers-${path.basename(filePath)}${sourceIndicator}.jsonl`);
  
  verbose.log(`Starting stream-based identifier collection for ${filePath}`);
  
  // Get file stats to calculate total size for progress reporting
  const stats = await fs.promises.stat(filePath);
  const totalSize = stats.size;
  
  // Create a read stream for the file
  const readStream = createReadStream(filePath, {
    highWaterMark: chunkReadSize,
    encoding: "utf8",
  });
  
  let accumulatedCode = "";
  let bytesProcessed = 0;
  let identifierCount = 0;
  
  // Create a write stream for the temporary identifier storage - using JSONL (line-delimited JSON)
  const writeStream = fs.createWriteStream(tempFilePath);
  
  // Process the file in chunks
  for await (const chunk of readStream) {
    bytesProcessed += chunk.length;
    accumulatedCode += chunk;
    
    // Try to parse and extract identifiers from accumulated code
    try {
      const identifiers = await extractIdentifiersFromCode(
        accumulatedCode,
        contextWindowSize,
        filePath
      );
      
      // Write identifiers to temp file as JSONL (one JSON object per line)
      for (const identifier of identifiers) {
        writeStream.write(JSON.stringify(identifier) + "\n");
        identifierCount++;
      }
      
      // Report progress
      if (onProgress) {
        onProgress(bytesProcessed / totalSize);
      }
      
      verbose.log(`Processed ${bytesProcessed}/${totalSize} bytes, found ${identifierCount} identifiers`);
      
      // Keep a buffer of code for context (about twice the context window size)
      if (accumulatedCode.length > contextWindowSize * 2) {
        accumulatedCode = accumulatedCode.slice(-contextWindowSize * 2);
      }
    } catch (error) {
      // If parsing fails, we'll just continue accumulating more code
      verbose.log(`Parsing chunk failed, continuing to accumulate more code: ${error}`);
    }
  }
  
  // Final pass to catch any remaining identifiers
  try {
    const identifiers = await extractIdentifiersFromCode(
      accumulatedCode,
      contextWindowSize,
      filePath
    );
    
    // Write identifiers to temp file as JSONL
    for (const identifier of identifiers) {
      writeStream.write(JSON.stringify(identifier) + "\n");
      identifierCount++;
    }
  } catch (error) {
    verbose.log(`Final parsing failed: ${error}`);
  }
  
  // Close the write stream
  writeStream.end();
  
  verbose.log(`Completed stream processing, found ${identifierCount} identifiers`);
  
  // Read back the collected identifiers line by line
  const identifiers: IdentifierWithContext[] = [];
  
  // Read and parse the file line by line
  try {
    const fileContent = await fs.promises.readFile(tempFilePath, "utf8");
    const lines = fileContent.split("\n").filter(line => line.trim() !== "");
    
    for (const line of lines) {
      try {
        const identifier = JSON.parse(line);
        identifiers.push(identifier);
      } catch (parseError) {
        verbose.log(`Error parsing identifier line: ${parseError}. Skipping this entry.`);
        // Continue with other lines rather than failing completely
      }
    }
  } catch (readError) {
    verbose.log(`Error reading identifiers file: ${readError}`);
    throw readError;
  }
  
  // Clean up the temporary file
  await fs.promises.unlink(tempFilePath);
  
  return identifiers;
}

/**
 * Extracts identifiers from a code string
 */
async function extractIdentifiersFromCode(
  code: string,
  contextWindowSize: number,
  filePath?: string
): Promise<IdentifierWithContext[]> {
  const identifiers: IdentifierWithContext[] = [];
  
  try {
    // Parse the code
    const ast = parse(code, {
      sourceType: "unambiguous",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      ranges: true
    });
    
    // Visit all identifiers in the AST
    traverse(ast, {
      Identifier(path) {
        // Skip identifiers that are property access or not directly renameable
        if (
          path.parent.type === "MemberExpression" && !path.parent.computed && path.key === "property" ||
          path.parent.type === "ObjectProperty" && !path.parent.computed && path.key === "key" ||
          path.parent.type === "ImportSpecifier" && path.key === "imported" ||
          path.parent.type === "ExportSpecifier" && path.key === "exported" ||
          path.isReferencedMemberExpression()
        ) {
          return;
        }
        
        // Skip if the identifier is a built-in or reserved keyword
        const name = path.node.name;
        if (isReservedKeyword(name)) {
          return;
        }
        
        // Extract surrounding code
        const surroundingCode = extractSurroundingCode(code, path.node, contextWindowSize);
        
        // Identify semantic role for this identifier
        const semanticRole = identifySemanticRole(path);
        
        // Add to the list of identifiers with semantic role
        identifiers.push({
          name,
          surroundingCode,
          location: {
            line: path.node.loc?.start.line || 0,
            column: path.node.loc?.start.column || 0,
            filePath,
          },
          semanticRole,
        });
      },
    });
  } catch (error) {
    verbose.log(`Error extracting identifiers: ${error}`);
  }
  
  return identifiers;
}

/**
 * Extracts surrounding code around an identifier for context
 */
function extractSurroundingCode(
  code: string,
  node: Identifier,
  contextWindowSize: number
): string {
  if (!node.loc) return "";
  
  const startPos = Math.max(0, node.loc.start.index - contextWindowSize / 2);
  const endPos = Math.min(code.length, node.loc.start.index + contextWindowSize / 2);
  
  return code.substring(startPos, endPos);
}

/**
 * Checks if a name is a reserved JavaScript keyword or built-in
 */
function isReservedKeyword(name: string): boolean {
  const reservedKeywords = [
    "abstract", "arguments", "await", "boolean", "break", "byte", "case", "catch", 
    "char", "class", "const", "continue", "debugger", "default", "delete", "do", 
    "double", "else", "enum", "eval", "export", "extends", "false", "final", 
    "finally", "float", "for", "function", "goto", "if", "implements", "import", 
    "in", "instanceof", "int", "interface", "let", "long", "native", "new", "null", 
    "package", "private", "protected", "public", "return", "short", "static", 
    "super", "switch", "synchronized", "this", "throw", "throws", "transient", 
    "true", "try", "typeof", "var", "void", "volatile", "while", "with", "yield"
  ];
  
  return reservedKeywords.includes(name);
}

/**
 * Stream-based wrapper around collectIdentifiersFromStream that processes
 * a code string directly (for testing and compatibility)
 * @param code - The JavaScript code string to process
 * @param options - Processing options
 * @returns Promise resolving to array of identifiers with context
 */
export async function collectIdentifiersFromString(
  code: string,
  options: Omit<StreamCollectorOptions, "tempDir">
): Promise<IdentifierWithContext[]> {
  // Determine cursor version from environment or default
  const cursorVersion = process.env.CURSOR_VERSION || "0.47.7";
  
  // Create a more descriptive temporary directory with timestamp and context
  const timestamp = Date.now();
  const operation = "identifier-collection";
  const context = "string-source";
  const tempDir = path.resolve(`./.humanify-cursor_v${cursorVersion}-${operation}-${context}-${timestamp}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  // Create a safe temporary filename that always starts with "temp-"
  const tempFileName = `temp-code-${timestamp}.js`;
  const tempFilePath = path.join(tempDir, tempFileName);
  
  verbose.log(`Writing code to temporary file: ${tempFilePath}`);
  await fs.promises.writeFile(tempFilePath, code);
  
  try {
    // Use the stream collector
    verbose.log(`Collecting identifiers from temp file: ${tempFilePath}`);
    const result = await collectIdentifiersFromStream(tempFilePath, {
      ...options,
      tempDir,
    });
    verbose.log(`Found ${result.length} identifiers in temp file`);
    return result;
  } finally {
    // Clean up
    try {
      verbose.log(`Cleaning up temporary file: ${tempFilePath}`);
      await fs.promises.unlink(tempFilePath);
      
      // Only try to remove the directory if it's empty
      const files = await fs.promises.readdir(tempDir);
      if (files.length === 0) {
        await fs.promises.rmdir(tempDir);
        verbose.log(`Removed empty temp directory: ${tempDir}`);
      } else {
        verbose.log(`Temp directory not empty, skipping removal: ${tempDir}`);
      }
    } catch (error) {
      verbose.log(`Error cleaning up temporary files: ${error}`);
    }
  }
} 