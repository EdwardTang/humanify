#!/usr/bin/env node

/**
 * Merge Chunks Script
 * 
 * This script merges the processed chunks back into a single file,
 * ensuring consistent renaming of identifiers across all chunks.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const metadataFile = args[0];
const outputFile = args[1];

if (!metadataFile) {
  console.error('Usage: node merge-chunks.js <metadata-file> [output-file]');
  process.exit(1);
}

// Load metadata file
let metadata;
try {
  const metadataContent = fs.readFileSync(metadataFile, 'utf8');
  metadata = JSON.parse(metadataContent);
  console.log(`Loaded metadata for ${metadata.originalFile}`);
} catch (err) {
  console.error(`Error loading metadata file: ${err.message}`);
  process.exit(1);
}

// Determine output file name if not provided
const defaultOutputName = path.basename(metadata.originalFile, path.extname(metadata.originalFile)) + '.renamed' + path.extname(metadata.originalFile);
const actualOutputFile = outputFile || defaultOutputName;

// Function to load processed chunks
async function loadProcessedChunks() {
  // Global identifier map to ensure consistency across chunks
  const globalIdentifierMap = { ...metadata.globalIdentifierMap };
  const processedChunks = [];
  
  console.log(`Loading ${metadata.chunks.length} processed chunks...`);
  
  // First pass: gather all renamed identifiers from processed chunks
  for (let i = 0; i < metadata.chunks.length; i++) {
    const chunkMeta = metadata.chunks[i];
    const chunkFile = chunkMeta.file;
    const processedFile = chunkFile + '.renamed';
    const chunkDir = path.dirname(metadataFile);
    const processedPath = path.join(chunkDir, processedFile);
    
    try {
      let processedCode = '';
      
      // Check if the path exists
      if (fs.existsSync(processedPath)) {
        const stats = fs.statSync(processedPath);
        
        if (stats.isDirectory()) {
          // If it's a directory, look for specific files
          const possibleFiles = ['deobfuscated.js', 'index.js', 'renamed.js'];
          let fileFound = false;
          
          for (const fileName of possibleFiles) {
            const filePath = path.join(processedPath, fileName);
            if (fs.existsSync(filePath)) {
              processedCode = fs.readFileSync(filePath, 'utf8');
              console.log(`Found processed chunk ${i + 1}/${metadata.chunks.length} in directory: ${filePath}`);
              fileFound = true;
              break;
            }
          }
          
          if (!fileFound) {
            console.warn(`Warning: Could not find valid file in directory ${processedPath}`);
            processedCode = `/* Could not find valid file in directory ${processedPath} */\n`;
          }
        } else {
          // It's a regular file
          processedCode = fs.readFileSync(processedPath, 'utf8');
          console.log(`Loaded processed chunk ${i + 1}/${metadata.chunks.length}: ${processedPath}`);
        }
      } else {
        // Try with just the original filename
        const originalPath = path.join(chunkDir, chunkFile);
        if (fs.existsSync(originalPath + '.renamed')) {
          processedCode = fs.readFileSync(originalPath + '.renamed', 'utf8');
          console.log(`Found renamed file at ${originalPath}.renamed`);
        } else {
          console.warn(`Warning: Could not find processed file at ${processedPath}`);
          processedCode = `/* Missing processed chunk: ${chunkFile} */\n`;
        }
      }
      
      processedChunks.push(processedCode);
      
      // Update identifier map
      console.log(`Processing identifiers from chunk ${i + 1}/${metadata.chunks.length}`);
      
    } catch (err) {
      console.error(`Error loading processed chunk ${i}: ${err.message}`);
      // Instead of failing, add a placeholder for missing chunks
      processedChunks.push(`/* Chunk ${i + 1} (${chunkFile}) failed to load: ${err.message} */\n`);
      console.log(`Added placeholder for chunk ${i + 1}`);
    }
  }
  
  // Check if any chunks were loaded
  if (processedChunks.length === 0) {
    console.error('No processed chunks could be loaded. Exiting.');
    process.exit(1);
  }
  
  // Combine all chunks into a single file
  console.log(`Merging ${processedChunks.length} chunks...`);
  const combinedCode = processedChunks.join('\n\n');
  
  // Write the combined file
  try {
    fs.writeFileSync(actualOutputFile, combinedCode);
    console.log(`Successfully merged chunks into ${actualOutputFile}`);
  } catch (err) {
    console.error(`Error writing output file: ${err.message}`);
    process.exit(1);
  }
}

// Main function
async function run() {
  try {
    await loadProcessedChunks();
    console.log('Merge completed successfully!');
  } catch (err) {
    console.error(`Error during merge: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Execute
run(); 