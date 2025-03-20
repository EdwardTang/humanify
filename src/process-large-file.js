#!/usr/bin/env node

/**
 * Process Large JavaScript File
 * 
 * This script combines the AST chunking, processing, and merging steps
 * into a single workflow for handling large JavaScript files.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
let sourceFile = null;
let outputDir = 'chunks';
let chunkSize = 500000; // Default chunk size (bytes)
let batchSize = 100; // Default batch size for identifier processing
let nodeMemory = 8192; // Default Node.js memory limit (MB)
let model = 'o3-mini'; // Default model for processing
let verbose = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' || args[i] === '-o') {
    outputDir = args[++i];
  } else if (args[i] === '--chunk-size') {
    chunkSize = parseInt(args[++i], 10);
  } else if (args[i] === '--batch-size') {
    batchSize = parseInt(args[++i], 10);
  } else if (args[i] === '--memory') {
    nodeMemory = parseInt(args[++i], 10);
  } else if (args[i] === '--model' || args[i] === '-m') {
    model = args[++i];
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    verbose = true;
  } else if (!sourceFile) {
    sourceFile = args[i];
  }
}

if (!sourceFile) {
  console.error('Usage: node process-large-file.js <source-file> [options]');
  console.error('Options:');
  console.error('  --output, -o DIR        Output directory (default: chunks)');
  console.error('  --chunk-size SIZE       Target chunk size in bytes (default: 500000)');
  console.error('  --batch-size SIZE       Batch size for identifiers (default: 100)');
  console.error('  --memory MB             Node.js memory limit in MB (default: 8192)');
  console.error('  --model, -m MODEL       Model for processing (default: o3-mini)');
  console.error('  --verbose, -v           Enable verbose output');
  process.exit(1);
}

// Get original file name for generating output paths
const originalFileName = path.basename(sourceFile, path.extname(sourceFile));
const metadataFile = path.join(outputDir, `${originalFileName}-metadata.json`);
const finalOutputFile = `${originalFileName}.renamed${path.extname(sourceFile)}`;

// Utility to execute shell commands
function executeCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}

// Main processing workflow
async function processLargeFile() {
  try {
    console.log(`\n=== PROCESSING LARGE FILE: ${sourceFile} ===\n`);
    console.time('Total processing time');
    
    // Step 1: AST-based chunking
    console.log('\n=== STEP 1: AST-BASED CHUNKING ===\n');
    console.time('Chunking time');
    
    const chunkArgs = [
      sourceFile,
      '--output', outputDir,
      '--chunk-size', chunkSize.toString()
    ];
    
    if (verbose) {
      chunkArgs.push('--verbose');
    }
    
    await executeCommand('node', [path.join(__dirname, 'ast-chunker.js'), ...chunkArgs]);
    console.timeEnd('Chunking time');
    
    // Step 2: Process each chunk with humanify
    console.log('\n=== STEP 2: PROCESSING CHUNKS ===\n');
    console.time('Processing time');
    
    // Load metadata to get chunk file names
    const metadataContent = fs.readFileSync(metadataFile, 'utf8');
    const metadata = JSON.parse(metadataContent);
    
    for (let i = 0; i < metadata.chunks.length; i++) {
      const chunk = metadata.chunks[i];
      const chunkFile = path.join(outputDir, chunk.file);
      const outputFile = `${chunkFile}.renamed`;
      
      console.log(`\nProcessing chunk ${i + 1}/${metadata.chunks.length}: ${chunk.file}`);
      
      const humanifyArgs = [
        `--max-old-space-size=${nodeMemory}`,
        '$(which humanify)',
        'openai-batch',
        '-m', model,
        '--batchSize', batchSize.toString(),
        '--useStreamProcessing', 'true',
        '--verbose',
        '-o', outputFile,
        chunkFile
      ];
      
      await executeCommand('node', humanifyArgs, { shell: true });
    }
    
    console.timeEnd('Processing time');
    
    // Step 3: Merge processed chunks
    console.log('\n=== STEP 3: MERGING CHUNKS ===\n');
    console.time('Merging time');
    
    await executeCommand('node', [
      path.join(__dirname, 'merge-chunks.js'),
      metadataFile,
      finalOutputFile
    ]);
    
    console.timeEnd('Merging time');
    
    console.timeEnd('Total processing time');
    console.log(`\nSuccessfully processed ${sourceFile}`);
    console.log(`Output saved to: ${finalOutputFile}`);
    
  } catch (error) {
    console.error(`Error during processing: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Execute the workflow
processLargeFile(); 