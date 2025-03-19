#!/usr/bin/env node
// @ts-check

/**
 * This script runs a mock OpenAI API server to test the batch renaming feature
 * without incurring actual API costs.
 */

import { startMockBatchApi } from '../../src/plugins/openai/mock-batch-api.ts';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Create output directory
const outputDir = path.join('test', 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function main() {
  try {
    console.log('Starting mock OpenAI API server...');
    const server = await startMockBatchApi({
      port: 3500,
      tempDir: './test/temp/mock-api',
      // Set success rate to simulate some failures
      successRate: 0.7,
      // Faster processing for testing
      processingTime: 500,
      // Some identifiers will fail deliberately
      failureMode: 'specific-identifiers',
      failedIdentifiers: ['a', 'e', 'g']
    });

    console.log('Mock API server running on http://localhost:3500');
    console.log('Running batch rename test...');

    try {
      // Run the humanify command with the mock API server
      execSync(
        'node dist/index.mjs openai-batch ' +
        '--baseURL http://localhost:3500/v1 ' +
        '--apiKey mock-key ' +
        '--verbose ' +
        '--batchSize 3 ' + 
        '--pollInterval 1000 ' +
        '--maxRetries 2 ' +
        '--initialBackoff 500 ' +
        '--outputDir test/output ' +
        'test/fixtures/minified.js',
        { stdio: 'inherit' }
      );

      console.log('Test completed successfully!');
    } catch (err) {
      console.error('Error running humanify command:', err);
    } finally {
      // Shutdown the mock server
      console.log('Shutting down mock API server...');
      server.close();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main(); 