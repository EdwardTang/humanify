#!/usr/bin/env node

/**
 * This script runs a test for the batch processing functionality
 * using the real OpenAI API (not the mock server)
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check if OpenAI API key is available
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is not set');
  process.exit(1);
}

// Create output directory
const outputDir = path.join('test', 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Run the test
try {
  console.log('Starting OpenAI Batch API test...');
  console.log('Using OpenAI API key:', process.env.OPENAI_API_KEY.substring(0, 8) + '...');
  
  // Run test with OpenAI batch processing
  execSync(
    'node dist/index.mjs openai-batch ' +
    'test/fixtures/minified.js ' +
    '--apiKey ' + process.env.OPENAI_API_KEY + ' ' +
    '--verbose ' +
    '--model gpt-4o-mini ' +
    '--batchSize 5 ' +
    '--pollInterval 10000 ' +
    '--maxRetries 2 ' +
    '--initialBackoff 2000 ' +
    '--outputDir test/output',
    { stdio: 'inherit' }
  );
  
  console.log('Batch test completed successfully!');
  console.log('Output file is in test/output directory');
  console.log('Rename map is stored in .humanify-rename-map.json');
} catch (err) {
  console.error('Error running batch command:', err);
  process.exit(1);
} 