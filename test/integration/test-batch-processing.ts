#!/usr/bin/env -S npx tsx
/**
 * Test script for OpenAI Batch API processing with mock server
 * 
 * This script demonstrates how the batch processing feature works
 * by unminifying a sample JavaScript file using a mock OpenAI API
 * server. It tests error handling, retries, and cross-file consistency.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { startMockBatchApi } from '../../src/plugins/openai/mock-batch-api.js';
import { openAIBatchRename } from '../../src/plugins/openai/openai-batch-rename.js';
import babel from '../../src/plugins/babel/babel.js';
import prettier from '../../src/plugins/prettier.js';
import { verbose } from '../../src/verbose.js';

// Enable verbose logging
verbose.enabled = true;

// Create a sample minified JavaScript file
async function createSampleFile(filePath: string): Promise<void> {
  // Smaller sample for faster testing
  const minifiedCode = `
function a(b){return b.charAt(0).toUpperCase()+b.slice(1)}
var c=["hello","world"];
var d={};for(var e=0;e<c.length;e++){var f=c[e];d[f]=a(f)}console.log(d);
`;
  
  await fs.writeFile(filePath, minifiedCode);
  console.log(`Created sample file: ${filePath}`);
}

// Main test function
async function runTest() {
  try {
    // Create temporary directories
    const testDir = './.humanify-test';
    const outputDir = path.join(testDir, 'output');
    const tempDir = path.join(testDir, 'temp');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create sample files
    const inputFile = path.join(testDir, 'input.js');
    await createSampleFile(inputFile);
    
    // Start the mock API server
    console.log('Starting mock API server...');
    const server = await startMockBatchApi({
      port: 3500,
      tempDir: path.join(tempDir, 'mock-api'),
      // Set a lower success rate to test retries
      successRate: 0.7,
      // Faster processing for testing
      processingTime: 50,
      // Specific identifiers that will fail (to test retry logic)
      failureMode: 'specific-identifiers',
      failedIdentifiers: ['a', 'e']
    });
    
    console.log('Mock API server started on port 3500');
    
    // Create a batch rename function that uses the mock API
    const batchRename = openAIBatchRename({
      apiKey: 'mock-api-key',
      baseURL: 'http://localhost:3500/v1',
      model: 'gpt-4o-mini',
      contextWindowSize: 500,
      batchSize: 2, // Smaller batch size for faster testing
      pollInterval: 50, // Faster polling
      tempDir: path.join(tempDir, 'batch-files'),
      maxRetries: 1, // Fewer retries for faster testing
      backoffMultiplier: 1.2,
      initialBackoff: 50
    });
    
    // Read the input file
    const inputCode = await fs.readFile(inputFile, 'utf-8');
    
    // Process the file through the plugins
    console.log('Starting batch processing...');
    
    // First apply babel to parse
    const babelOutput = await babel(inputCode);
    
    // Then apply the batch rename
    const renamedCode = await batchRename(babelOutput);
    
    // Finally format with prettier
    const formattedCode = await prettier(renamedCode);
    
    // Write the result to the output file
    const outputFile = path.join(outputDir, 'output.js');
    await fs.writeFile(outputFile, formattedCode);
    
    console.log('Batch processing completed!');
    console.log(`Result saved to: ${outputFile}`);
    
    // Read and display the output
    console.log('\nOriginal code:');
    console.log(inputCode);
    
    console.log('\nProcessed code:');
    console.log(formattedCode);
    
    // Check the global rename map
    const renameMapPath = './.humanify-rename-map.json';
    if (await fileExists(renameMapPath)) {
      const mapData = await fs.readFile(renameMapPath, 'utf-8');
      console.log('\nGlobal rename map:');
      console.log(mapData);
    }
    
    // Cleanup
    console.log('\nShutting down server...');
    server.close();
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Helper to check if a file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Run the test
runTest(); 