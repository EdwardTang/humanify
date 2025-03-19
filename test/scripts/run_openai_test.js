#!/usr/bin/env node

/**
 * This script runs tests using OpenAI API
 * It skips local model tests
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
  console.log('Starting OpenAI API test...');
  console.log('Using OpenAI API key:', process.env.OPENAI_API_KEY.substring(0, 8) + '...');
  
  // Run test with OpenAI
  execSync(
    'node dist/index.mjs openai ' +
    'test/fixtures/minified.js ' +
    '--apiKey ' + process.env.OPENAI_API_KEY + ' ' +
    '--verbose ' +
    '--outputDir test/output',
    { stdio: 'inherit' }
  );
  
  console.log('Test completed successfully!');
  console.log('Output file is in test/output directory');
} catch (err) {
  console.error('Error running humanify command:', err);
  process.exit(1);
} 