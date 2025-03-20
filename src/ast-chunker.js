#!/usr/bin/env node

/**
 * AST-based JavaScript File Chunker
 * 
 * This script splits large JavaScript files at syntactically valid boundaries
 * using AST analysis, creating multiple smaller files that can be processed
 * by humanify without exceeding memory limits.
 */

import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import prettier from 'prettier';
import { fileURLToPath } from 'url';

// Fix for ESM compatibility
const traverse = _traverse.default;
const generate = _generate.default;

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
let sourceFile = null;
let outputDir = 'chunks';
let targetChunkSize = 500000; // Default target chunk size in bytes
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' || args[i] === '-o') {
    outputDir = args[++i];
  } else if (args[i] === '--chunk-size' || args[i] === '-s') {
    targetChunkSize = parseInt(args[++i], 10);
    if (isNaN(targetChunkSize)) {
      console.error('Invalid chunk size. Using default 500000 bytes.');
      targetChunkSize = 500000;
    }
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    verbose = true;
  } else if (!sourceFile) {
    sourceFile = args[i];
  }
}

if (!sourceFile) {
  console.error('Usage: node ast-chunker.js [SOURCE_FILE] [OPTIONS]');
  console.error('Options:');
  console.error('  --output, -o DIR     Output directory for chunks (default: chunks)');
  console.error('  --chunk-size, -s N   Target chunk size in bytes (default: 500000)');
  console.error('  --verbose, -v        Enable verbose logging');
  process.exit(1);
}

// Ensure output directory exists
try {
  fs.mkdirSync(outputDir, { recursive: true });
} catch (err) {
  console.error(`Error creating output directory: ${err.message}`);
  process.exit(1);
}

// Load the source file
let sourceCode;
try {
  sourceCode = fs.readFileSync(sourceFile, 'utf8');
  console.log(`Loaded source file: ${sourceFile} (${sourceCode.length} bytes)`);
} catch (err) {
  console.error(`Error reading source file: ${err.message}`);
  process.exit(1);
}

// Generate a metadata file name
const originalFileName = path.basename(sourceFile, path.extname(sourceFile));
const metadataFile = path.join(outputDir, `${originalFileName}-metadata.json`);

/**
 * Parse JavaScript code with fallback strategies
 * Try multiple parsing strategies until one succeeds
 */
function parseWithFallback(code, options = {}) {
  const defaultPlugins = ['jsx', 'typescript', 'classProperties', 'objectRestSpread', 'dynamicImport'];
  const pluginsToUse = options.plugins || defaultPlugins;
  
  // Add handling for exports without declarations
  if (options.allowUndeclaredExports === undefined) {
    options.allowUndeclaredExports = true;
  }
  
  // Detection strategy for import/export statements
  const hasImportExport = /\b(import|export)\b/.test(code);
  
  console.log('Analyzing code for module patterns...');
  console.log(`Import/Export detected: ${hasImportExport}`);
  
  // Strategy 1: Try "unambiguous" mode first (auto-detect module vs. script)
  try {
    console.log('Attempting parse with "unambiguous" sourceType...');
    return parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: pluginsToUse,
      ...options
    });
  } catch (err) {
    console.warn(`Parse with "unambiguous" sourceType failed: ${err.message}`);
    
    // Strategy 2: If import/export statements were detected, try module mode
    if (hasImportExport) {
      try {
        console.log('Attempting parse with "module" sourceType...');
        return parser.parse(code, {
          sourceType: 'module',
          plugins: pluginsToUse,
          ...options
        });
      } catch (err) {
        console.warn(`Parse with "module" sourceType failed: ${err.message}`);
      }
    }
    
    // Strategy 3: Try script mode as a fallback
    try {
      console.log('Attempting parse with "script" sourceType...');
      // For script mode, remove import and export-related plugins
      const scriptPlugins = pluginsToUse.filter(p => p !== 'dynamicImport');
      return parser.parse(code, {
        sourceType: 'script',
        plugins: scriptPlugins,
        ...options
      });
    } catch (err) {
      console.warn(`Parse with "script" sourceType failed: ${err.message}`);
    }
    
    // Strategy 4: Try with different plugin combinations
    try {
      console.log('Attempting parse with minimal plugins...');
      return parser.parse(code, {
        sourceType: hasImportExport ? 'module' : 'script',
        plugins: ['jsx'],
        ...options
      });
    } catch (err) {
      console.error(`All parsing strategies failed. Last error: ${err.message}`);
      throw new Error(`Unable to parse JavaScript with any parsing strategy: ${err.message}`);
    }
  }
}

/**
 * Estimate the size of an AST node
 */
function estimateNodeSize(node) {
  if (!node) return 0;
  
  try {
    // Generate code for this node to get its string representation
    const generated = generate(node, { comments: false });
    return Buffer.byteLength(generated.code, 'utf8');
  } catch (err) {
    console.warn(`Error estimating node size: ${err.message}`);
    // Fallback: estimate based on node's location data if available
    if (node.loc) {
      const start = node.loc.start;
      const end = node.loc.end;
      if (start && end) {
        // Rough estimate based on line count and average characters per line
        const lines = end.line - start.line + 1;
        return lines * 80; // Assuming average 80 chars per line
      }
    }
    return 100; // Default fallback size
  }
}

/**
 * Fallback to text-based chunking if AST-based chunking fails
 */
async function fallbackToTextBasedChunking() {
  console.log('Falling back to text-based chunking...');
  
  // Define a regex pattern to find reasonable chunk boundaries
  // Look for patterns like function declarations, object definitions, etc.
  const chunkBoundaryPattern = /(\}\)\s*;|\}\s*;|\}\)\s*\(\s*\{\s*|\}\)\s*\(\s*function|\}\s*\(\s*function)/g;
  
  let chunks = [];
  let positions = [];
  let match;
  
  // Find all potential chunk boundary positions
  while ((match = chunkBoundaryPattern.exec(sourceCode)) !== null) {
    positions.push(match.index + match[0].length);
  }
  
  // If we found some boundaries, use them to chunk the code
  if (positions.length > 0) {
    console.log(`Found ${positions.length} potential chunk boundaries`);
    
    // Add start and end positions
    positions = [0, ...positions, sourceCode.length];
    
    // Create chunks based on positions, trying to keep close to target size
    let startPos = 0;
    let currentSize = 0;
    
    for (let i = 1; i < positions.length; i++) {
      const chunkSize = positions[i] - positions[i-1];
      
      // If adding this section would exceed target size, create a chunk
      if (currentSize > 0 && currentSize + chunkSize > targetChunkSize) {
        const chunkCode = sourceCode.substring(startPos, positions[i-1]);
        chunks.push({
          code: chunkCode,
          size: currentSize,
          metadata: {
            startPos,
            endPos: positions[i-1],
            nodeCount: 1, // Not applicable for text-based chunking
            identifierMap: extractIdentifiersViaRegex(chunkCode)
          }
        });
        
        startPos = positions[i-1];
        currentSize = chunkSize;
      } else {
        currentSize += chunkSize;
      }
    }
    
    // Add the final chunk
    if (startPos < sourceCode.length) {
      const chunkCode = sourceCode.substring(startPos);
      chunks.push({
        code: chunkCode,
        size: sourceCode.length - startPos,
        metadata: {
          startPos,
          endPos: sourceCode.length,
          nodeCount: 1,
          identifierMap: extractIdentifiersViaRegex(chunkCode)
        }
      });
    }
  } else {
    // If no boundaries found, use fixed-size chunking as last resort
    console.log('No chunk boundaries found, using fixed-size chunking');
    const chunkCount = Math.ceil(sourceCode.length / targetChunkSize);
    const actualChunkSize = Math.ceil(sourceCode.length / chunkCount);
    
    for (let i = 0; i < chunkCount; i++) {
      const startPos = i * actualChunkSize;
      const endPos = Math.min(startPos + actualChunkSize, sourceCode.length);
      const chunkCode = sourceCode.substring(startPos, endPos);
      
      chunks.push({
        code: chunkCode,
        size: endPos - startPos,
        metadata: {
          startPos,
          endPos,
          nodeCount: 1,
          identifierMap: extractIdentifiersViaRegex(chunkCode)
        }
      });
    }
  }
  
  console.log(`Created ${chunks.length} chunks using text-based chunking`);
  return chunks;
}

/**
 * Extract identifiers from code using regex patterns
 */
function extractIdentifiersViaRegex(code) {
  const identifierRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const matches = code.match(identifierRegex) || [];
  const identifierMap = {};
  
  // Filter out common keywords
  const keywords = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 
    'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 
    'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let'
  ]);
  
  matches.forEach(id => {
    if (!keywords.has(id)) {
      identifierMap[id] = true;
    }
  });
  
  return identifierMap;
}

/**
 * Split a JavaScript file into chunks at syntactically valid boundaries
 */
async function splitFileIntoASTChunks() {
  const chunks = [];
  let currentChunk = { 
    code: '', 
    size: 0, 
    metadata: { 
      startPos: 0,
      endPos: 0,
      nodeCount: 0,
      identifierMap: {}
    } 
  };
  let chunkIndex = 0;
  
  // Parse the code into an AST using our fallback strategy
  console.log('Parsing JavaScript code into AST with fallback strategies...');
  let ast;
  try {
    ast = parseWithFallback(sourceCode);
    console.log('Successfully parsed JavaScript code!');
    
    // Find top-level nodes that can serve as chunk boundaries
    const topLevelNodes = [];
    
    // First pass: Collect top-level nodes
    traverse(ast, {
      Program(path) {
        const body = path.node.body;
        if (verbose) {
          console.log(`Found ${body.length} top-level AST nodes`);
        }
        topLevelNodes.push(...body);
      }
    });
    
    // Second pass: Create chunks based on node size
    console.log(`Creating chunks with target size of ${targetChunkSize} bytes...`);
    
    // Track export statements and their referenced identifiers
    const exportStatementsMap = new Map();
    
    // First, identify all export statements and collect exported identifiers
    for (let i = 0; i < topLevelNodes.length; i++) {
      const node = topLevelNodes[i];
      
      if (node.type === 'ExportNamedDeclaration' && node.specifiers && node.specifiers.length > 0) {
        const exportedNames = node.specifiers.map(specifier => 
          specifier.local ? specifier.local.name : null).filter(Boolean);
        
        if (exportedNames.length > 0) {
          exportStatementsMap.set(i, exportedNames);
          if (verbose) {
            console.log(`Found export at node ${i} exporting: ${exportedNames.join(', ')}`);
          }
        }
      }
    }
    
    // Now process nodes with awareness of the export requirements
    for (let i = 0; i < topLevelNodes.length; i++) {
      const node = topLevelNodes[i];
      try {
        // Generate code for this node
        const nodeSrc = generate(node).code;
        const nodeSize = Buffer.byteLength(nodeSrc, 'utf8');
        
        // Check if current node is an export statement
        const isExport = exportStatementsMap.has(i);
        
        // If this node is an export statement with undeclared identifiers,
        // add placeholder declarations before the export
        if (isExport) {
          // Add placeholder declarations for the exported variables
          exportStatementsMap.get(i).forEach(exportName => {
            // Add a placeholder declaration at the beginning of the chunk
            if (!currentChunk.code.includes(`var ${exportName}`)) {
              currentChunk.code = `var ${exportName} = {}; /* Placeholder for export */\n` + currentChunk.code;
            }
          });
        }
        
        // Check if adding this node would exceed our target chunk size
        if (currentChunk.size > 0 && (currentChunk.size + nodeSize) > targetChunkSize && !isExport) {
          // Finalize the current chunk
          chunks.push({...currentChunk});
          
          // Start a new chunk
          currentChunk = { 
            code: nodeSrc, 
            size: nodeSize, 
            metadata: { 
              startPos: i,
              endPos: i,
              nodeCount: 1,
              identifierMap: {}
            } 
          };
          chunkIndex++;
          
          if (verbose) {
            console.log(`Chunk ${chunkIndex} created with ${currentChunk.metadata.nodeCount} nodes (${nodeSize} bytes)`);
          }
        } else {
          // Add this node to the current chunk
          currentChunk.code += nodeSrc;
          currentChunk.size += nodeSize;
          currentChunk.metadata.endPos = i;
          currentChunk.metadata.nodeCount++;
        }
        
        // Collect identifiers from this node to build the identifier map
        let nodeIdentifiers = new Set();
        
        try {
          // Create a new AST for this node to safely traverse it
          const nodeAST = parser.parse(nodeSrc, { 
            sourceType: 'unambiguous',
            plugins: ['jsx', 'typescript', 'classProperties', 'objectRestSpread'],
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: true,
            allowSuperOutsideMethod: true,
            allowUndeclaredExports: true
          });
          
          traverse(nodeAST, {
            Identifier(path) {
              nodeIdentifiers.add(path.node.name);
            }
          });
        } catch (err) {
          if (verbose) {
            console.warn(`Warning: Could not parse node ${i} to collect identifiers: ${err.message}`);
          }
          
          // Fallback: Use regex to find likely identifiers
          const identifierRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
          const matches = nodeSrc.match(identifierRegex) || [];
          matches.forEach(id => nodeIdentifiers.add(id));
        }
        
        // Add to the current chunk's identifier map
        nodeIdentifiers.forEach(id => {
          currentChunk.metadata.identifierMap[id] = true;
        });
      } catch (nodeErr) {
        console.warn(`Warning: Error processing node ${i}: ${nodeErr.message}`);
        
        // For export statements that fail, replace them with empty statements
        // to prevent "Export X is not defined" errors
        if (exportStatementsMap.has(i)) {
          if (verbose) {
            console.log(`Removing problematic export statement at node ${i}`);
          }
          
          // If this is an export statement, check if we need to add placeholders
          if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
            let replacementCode = '/* Export statement removed due to chunking */\n';
            
            // Add placeholder declarations for each exported identifier
            exportStatementsMap.get(i).forEach(depName => {
              if (depName) {
                replacementCode += `var ${depName} = {}; /* Placeholder for export */\n`;
              }
            });
            
            currentChunk.code += replacementCode;
          } else {
            currentChunk.code += '/* Export statement removed due to chunking */\n';
          }
        }
        
        // Skip this node if we can't process it
        continue;
      }
    }
    
    // Don't forget the last chunk if it has content
    if (currentChunk.size > 0) {
      chunks.push({...currentChunk});
      if (verbose) {
        console.log(`Final chunk ${chunkIndex + 1} created with ${currentChunk.metadata.nodeCount} nodes (${currentChunk.size} bytes)`);
      }
    }
    
    console.log(`Created ${chunks.length} chunks from AST-based chunking`);
  } catch (err) {
    console.error(`Error in AST-based chunking: ${err.message}`);
    // Fall back to text-based chunking
    return await fallbackToTextBasedChunking();
  }
  
  return chunks;
}

/**
 * Process chunks and generate metadata
 */
async function processChunks(chunks) {
  console.log(`Processing ${chunks.length} chunks and generating metadata...`);
  
  // Write chunks to files and prepare metadata
  const metadata = {
    originalFile: sourceFile,
    chunks: [],
    globalIdentifierMap: {}
  };
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkFileName = `${originalFileName}-chunk-${i.toString().padStart(3, '0')}.js`;
    const chunkPath = path.join(outputDir, chunkFileName);
    
    // Format the chunk code for better readability if possible
    let formattedCode;
    try {
      formattedCode = await prettier.format(chunk.code, {
        parser: 'babel',
        singleQuote: true,
        trailingComma: 'es5',
        printWidth: 80
      });
    } catch (err) {
      console.warn(`Warning: Could not format chunk ${i}: ${err.message}`);
      formattedCode = chunk.code;
    }
    
    // Write the chunk to a file
    fs.writeFileSync(chunkPath, formattedCode);
    
    // Update metadata
    metadata.chunks.push({
      file: chunkFileName,
      nodeCount: chunk.metadata.nodeCount,
      size: chunk.size,
      startNode: chunk.metadata.startPos,
      endNode: chunk.metadata.endPos,
      identifierMap: Object.keys(chunk.metadata.identifierMap).reduce((acc, id) => {
        acc[id] = null; // Will be filled with renamed identifiers after processing
        return acc;
      }, {})
    });
    
    // Merge identifiers into global map
    Object.keys(chunk.metadata.identifierMap).forEach(id => {
      metadata.globalIdentifierMap[id] = null; // Will be filled with final renamed identifiers
    });
    
    console.log(`Wrote chunk ${i + 1}/${chunks.length}: ${chunkPath} (${chunk.size} bytes)`);
  }
  
  // Write metadata file
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  console.log(`Wrote metadata file: ${metadataFile}`);
  
  // Return information about the chunking
  return {
    chunkCount: chunks.length,
    totalNodes: chunks.reduce((acc, chunk) => acc + chunk.metadata.nodeCount, 0),
    uniqueIdentifiers: Object.keys(metadata.globalIdentifierMap).length
  };
}

// Execute the chunking
async function main() {
  console.log('Starting AST-based chunking...');
  try {
    const chunks = await splitFileIntoASTChunks();
    const result = await processChunks(chunks);
    
    console.log(`
Chunking Summary:
----------------
Created ${result.chunkCount} chunks
Processed ${result.totalNodes} nodes
Identified ${result.uniqueIdentifiers} unique identifiers
Metadata saved to ${metadataFile}
`);
  } catch (error) {
    console.error(`Fatal error during chunking: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
