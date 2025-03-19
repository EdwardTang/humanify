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

export interface IdentifierWithContext {
  name: string;
  surroundingCode: string;
  location: {
    line: number;
    column: number;
    filePath?: string;
  };
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
    tempDir = "./.humanify-temp"
  } = options;

  // Ensure temp directory exists
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  // Create a temporary file to store identifiers
  const tempFilePath = path.join(tempDir, `identifiers-${path.basename(filePath)}.jsonl`);
  
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
        
        // Add to the list of identifiers
        identifiers.push({
          name,
          surroundingCode,
          location: {
            line: path.node.loc?.start.line || 0,
            column: path.node.loc?.start.column || 0,
            filePath,
          },
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
 */
export async function collectIdentifiersFromString(
  code: string,
  options: Omit<StreamCollectorOptions, "tempDir">
): Promise<IdentifierWithContext[]> {
  const tempDir = "./.humanify-temp-string";
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  // Write code to a temporary file
  const tempFilePath = path.join(tempDir, `temp-code-${Date.now()}.js`);
  await fs.promises.writeFile(tempFilePath, code);
  
  try {
    // Use the stream collector
    return await collectIdentifiersFromStream(tempFilePath, {
      ...options,
      tempDir,
    });
  } finally {
    // Clean up
    try {
      await fs.promises.unlink(tempFilePath);
      await fs.promises.rmdir(tempDir);
    } catch (error) {
      verbose.log(`Error cleaning up temporary files: ${error}`);
    }
  }
} 