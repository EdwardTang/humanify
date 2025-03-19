#!/usr/bin/env node

/**
 * This script cleans up test data and resets the test environment
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const dirsToClean = [
  'test/output',
  'test/temp',
  '.humanify-temp',
  '.humanify-temp-mock'
];

const filesToClean = [
  '.humanify-rename-map.json'
];

console.log('Cleaning test data...');

// Clean directories
dirsToClean.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`Removing directory: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Clean files
filesToClean.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`Removing file: ${file}`);
    fs.unlinkSync(file);
  }
});

console.log('Test environment reset complete.'); 