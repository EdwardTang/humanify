const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Regex to extract sourcemap URL from a file
const sourcemapRegex = /\/\/# sourceMappingURL=https:\/\/cursor-sourcemaps\.s3\.amazonaws\.com\/sourcemaps\/([a-f0-9]+)\/(.+)\.map/;

// Track node_modules folders
const nodeModulesFolders = [];

// Helper function to recursively scan directories for all files
async function findAllFiles(dir) {
  const allFiles = [];
  
  async function scan(directory) {
    const files = await readdir(directory);
    
    // Check if this is a node_modules directory
    const basename = path.basename(directory);
    if (basename === 'node_modules') {
      // Document the node_modules location
      nodeModulesFolders.push(directory);
      console.log(`Skipping node_modules folder: ${directory}`);
      return; // Skip processing this directory and its subdirectories
    }
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = await stat(filePath);
      
      if (stats.isDirectory()) {
        await scan(filePath);
      } else {
        allFiles.push(filePath);
      }
    }
  }
  
  await scan(dir);
  return allFiles;
}

// Extract sourcemap information from a file
async function extractSourceMapInfo(filePath) {
  try {
    // Read the last 1000 bytes of the file to check for sourcemap URL
    const fileSize = (await stat(filePath)).size;
    
    // Skip empty files
    if (fileSize === 0) {
      return null;
    }
    
    const buffer = Buffer.alloc(Math.min(fileSize, 1000));
    
    const fd = await promisify(fs.open)(filePath, 'r');
    await promisify(fs.read)(fd, buffer, 0, buffer.length, Math.max(0, fileSize - buffer.length));
    await promisify(fs.close)(fd);
    
    const lastChunk = buffer.toString();
    const match = sourcemapRegex.exec(lastChunk);
    
    if (match) {
      const [_, commitId, sourcePath] = match;
      return {
        filePath,
        commitId,
        sourcePath
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error.message);
    return null;
  }
}

// Create a mapping from unpacked code paths to original source code paths
async function generateMapping(baseDir) {
  console.log(`Scanning directory: ${baseDir} for all files...`);
  const allFiles = await findAllFiles(baseDir);
  console.log(`Found ${allFiles.length} files.`);
  
  const mappings = {};
  let filesWithSourcemap = 0;
  let processedFiles = 0;
  const totalFiles = allFiles.length;
  
  // Track file types for statistics
  const fileTypeStats = {};
  const fileTypeWithSourcemapStats = {};
  
  for (const filePath of allFiles) {
    processedFiles++;
    
    // Log progress every 100 files
    if (processedFiles % 100 === 0 || processedFiles === totalFiles) {
      console.log(`Progress: ${processedFiles}/${totalFiles} files processed (${Math.round(processedFiles/totalFiles*100)}%)`);
    }
    
    // Track file type statistics
    const ext = path.extname(filePath).toLowerCase() || '(no extension)';
    fileTypeStats[ext] = (fileTypeStats[ext] || 0) + 1;
    
    const sourceMapInfo = await extractSourceMapInfo(filePath);
    if (sourceMapInfo) {
      filesWithSourcemap++;
      
      // Track file types with sourcemaps
      fileTypeWithSourcemapStats[ext] = (fileTypeWithSourcemapStats[ext] || 0) + 1;
      
      const relativeFilePath = path.relative(baseDir, filePath);
      const { commitId, sourcePath } = sourceMapInfo;
      
      if (!mappings[commitId]) {
        mappings[commitId] = [];
      }
      
      mappings[commitId].push({
        source_code_path: sourcePath,
        unpacked_code_path: relativeFilePath
      });
    }
  }
  
  console.log(`Found sourcemap URLs in ${filesWithSourcemap} out of ${allFiles.length} files.`);
  
  // Print file type statistics
  console.log('\nFile type statistics:');
  const sortedFileTypes = Object.keys(fileTypeStats).sort((a, b) => fileTypeStats[b] - fileTypeStats[a]);
  for (const ext of sortedFileTypes) {
    const count = fileTypeStats[ext];
    const withSourcemap = fileTypeWithSourcemapStats[ext] || 0;
    const percentage = Math.round((count / totalFiles) * 100);
    const sourcemapPercentage = withSourcemap > 0 ? Math.round((withSourcemap / count) * 100) : 0;
    
    console.log(`  ${ext}: ${count} files (${percentage}%) - ${withSourcemap} with sourcemap (${sourcemapPercentage}%)`);
  }
  
  if (filesWithSourcemap === 0) {
    console.log("Warning: No files with sourcemap URLs were found. Check if the regex pattern matches the sourcemap URLs in your files.");
  }
  
  return mappings;
}

// Save the mapping to JSON files organized by commit ID
async function saveMappings(mappings, outputDir) {
  try {
    // Create the output directory if it doesn't exist
    await mkdir(outputDir, { recursive: true });
    
    for (const commitId in mappings) {
      const mapping = {
        commit_id: commitId,
        mappings: mappings[commitId]
      };
      
      const outputPath = path.join(outputDir, `${commitId}.json`);
      await writeFile(outputPath, JSON.stringify(mapping, null, 2));
      console.log(`Mapping saved to ${outputPath}`);
    }
    
    // Save node_modules locations if any were found
    if (nodeModulesFolders.length > 0) {
      const nodeModulesOutputPath = path.join(outputDir, 'node_modules_locations.json');
      await writeFile(nodeModulesOutputPath, JSON.stringify({ 
        locations: nodeModulesFolders.map(folder => path.relative(process.cwd(), folder))
      }, null, 2));
      console.log(`Node modules locations saved to ${nodeModulesOutputPath}`);
    }
  } catch (error) {
    console.error('Error saving mappings:', error.message);
  }
}

// Generate a report of the mapped files, organized by directories
async function generateReport(mappings, outputDir) {
  try {
    await mkdir(outputDir, { recursive: true });
    
    for (const commitId in mappings) {
      const mapping = mappings[commitId];
      
      // Group files by directory structure
      const directories = {};
      
      for (const entry of mapping) {
        const { source_code_path, unpacked_code_path } = entry;
        const sourceDir = path.dirname(source_code_path);
        
        if (!directories[sourceDir]) {
          directories[sourceDir] = [];
        }
        
        directories[sourceDir].push({
          source_file: path.basename(source_code_path),
          unpacked_path: unpacked_code_path
        });
      }
      
      // Generate report
      let report = `# Repository Structure for Commit: ${commitId}\n\n`;
      report += `Total mapped files: ${mapping.length}\n\n`;
      
      // Add node_modules information
      if (nodeModulesFolders.length > 0) {
        report += `## Detected node_modules Folders (Skipped during processing)\n\n`;
        for (const folder of nodeModulesFolders) {
          report += `- ${path.relative(process.cwd(), folder)}\n`;
        }
        report += `\n`;
      }
      
      report += `## Directory Structure\n\n`;
      
      // Sort directories for readability
      const sortedDirs = Object.keys(directories).sort();
      
      for (const dir of sortedDirs) {
        report += `### ${dir}/\n\n`;
        report += `Files count: ${directories[dir].length}\n\n`;
        report += `| Source File | Unpacked Path |\n`;
        report += `|-------------|---------------|\n`;
        
        for (const file of directories[dir]) {
          report += `| ${file.source_file} | ${file.unpacked_path} |\n`;
        }
        
        report += `\n`;
      }
      
      const reportPath = path.join(outputDir, `${commitId}-report.md`);
      await writeFile(reportPath, report);
      console.log(`Report saved to ${reportPath}`);
    }
  } catch (error) {
    console.error('Error generating report:', error.message);
  }
}

// Generate a summary of the repository structure
async function generateStructureSummary(mappings, outputDir) {
  try {
    await mkdir(outputDir, { recursive: true });
    
    for (const commitId in mappings) {
      const mapping = mappings[commitId];
      
      // Extract unique directories
      const dirSet = new Set();
      for (const entry of mapping) {
        const sourceDir = path.dirname(entry.source_code_path);
        dirSet.add(sourceDir);
      }
      
      // Build directory tree
      const dirTree = {};
      for (const dir of dirSet) {
        const parts = dir.split('/');
        let current = dirTree;
        
        for (const part of parts) {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
      }
      
      // Generate directory tree as markdown
      function generateTreeMarkdown(tree, prefix = '') {
        let result = '';
        const keys = Object.keys(tree).sort();
        
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const isLast = i === keys.length - 1;
          result += `${prefix}${isLast ? '└── ' : '├── '}${key}\n`;
          
          if (Object.keys(tree[key]).length > 0) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            result += generateTreeMarkdown(tree[key], newPrefix);
          }
        }
        
        return result;
      }
      
      const summary = `# Repository Structure Summary for Commit: ${commitId}\n\n`;
      
      // Add node_modules information
      let nodeModulesInfo = '';
      if (nodeModulesFolders.length > 0) {
        nodeModulesInfo = `## Detected node_modules Folders (Skipped during processing)\n\n`;
        for (const folder of nodeModulesFolders) {
          nodeModulesInfo += `- ${path.relative(process.cwd(), folder)}\n`;
        }
        nodeModulesInfo += `\n`;
      }
      
      const tree = `\`\`\`\n${generateTreeMarkdown(dirTree)}\`\`\`\n\n`;
      
      const summaryPath = path.join(outputDir, `${commitId}-structure.md`);
      await writeFile(summaryPath, summary + nodeModulesInfo + tree);
      console.log(`Structure summary saved to ${summaryPath}`);
    }
  } catch (error) {
    console.error('Error generating structure summary:', error.message);
  }
}

// Main function
async function main() {
  const baseDir = process.argv[2] || 'cursor_app';
  const outputDir = process.argv[3] || 'cursor_repo_structure';
  const generateReports = process.argv.includes('--report');
  
  console.log(`Starting to analyze all files in: ${baseDir}`);
  console.log(`Mappings will be saved to: ${outputDir}`);
  
  const mappings = await generateMapping(baseDir);
  
  // Print summary of found commits
  for (const commitId in mappings) {
    console.log(`Found ${mappings[commitId].length} files for commit: ${commitId}`);
  }
  
  // Print node_modules information
  if (nodeModulesFolders.length > 0) {
    console.log('\nDetected node_modules folders (skipped during processing):');
    for (const folder of nodeModulesFolders) {
      console.log(`- ${path.relative(process.cwd(), folder)}`);
    }
  }
  
  await saveMappings(mappings, outputDir);
  console.log('All mappings have been saved.');
  
  if (generateReports) {
    console.log('Generating detailed reports...');
    await generateReport(mappings, outputDir);
    await generateStructureSummary(mappings, outputDir);
    console.log('All reports have been saved.');
  }
}

// Execute the main function
main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
}); 