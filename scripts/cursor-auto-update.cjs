#!/usr/bin/env node

/**
 * Cursor Auto-Update Script
 * 
 * This script automatically checks for the latest version of Cursor,
 * downloads it if needed, and manages the version files.
 * It also extracts the AppImage and copies the app resources to a version-specific folder.
 * 
 * Features:
 * - Automatic version checking and downloading
 * - Archiving of previous versions
 * - Extraction of app resources
 * - Selective copying modes:
 *   - Full copy: Copies all app resources (default)
 *   - Core copy: Copies only core AI components (extensions, out, package.json, product.json)
 * 
 * Usage:
 *   node cursor-auto-update.js [options]
 * 
 * Options:
 *   --full          Full copy mode (default)
 *   --core          Core AI components only
 *   --js-only       Core JavaScript files only
 *   --help          Show help information
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// Configuration
const config = {
  readmeUrl: 'https://raw.githubusercontent.com/oslook/cursor-ai-downloads/refs/heads/main/README.md',
  latestCursorDir: path.join(process.cwd(), 'latest_cursor'),
  archivedImagesDir: path.join(process.env.HOME || process.env.USERPROFILE, 'archived_images'),
  dbPath: path.join(process.env.HOME || process.env.USERPROFILE, '.cursor-version-db.json'),
  tempReadmePath: path.join(require('os').tmpdir(), 'cursor_readme.md'),
  extractDir: path.join(process.cwd(), 'latest_cursor', 'squashfs-root'),
  versionAppsDir: process.cwd(), // 更改为当前工作目录，而不是用户主目录
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isWindows: process.platform === 'win32',
  tempMountPoint: path.join(require('os').tmpdir(), 'cursor_dmg_mount')
};

// Console colors
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Helper functions
function logInfo(message) {
  console.log(`${colors.yellow}${message}${colors.reset}`);
}

function logSuccess(message) {
  console.log(`${colors.green}${message}${colors.reset}`);
}

function logError(message) {
  console.error(`${colors.red}${message}${colors.reset}`);
}

// Ensure directories exist
function ensureDirectoriesExist() {
  [config.latestCursorDir, config.archivedImagesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logInfo(`Created directory: ${dir}`);
    }
  });
}

// Get current stored version
function getCurrentVersion() {
  try {
    if (fs.existsSync(config.dbPath)) {
      const data = JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
      return data.currentVersion;
    }
  } catch (error) {
    logError(`Error reading version database: ${error.message}`);
  }
  return null;
}

// Save current version to database
function saveCurrentVersion(version) {
  try {
    fs.writeFileSync(config.dbPath, JSON.stringify({ currentVersion: version }, null, 2));
    logSuccess(`Updated version database to ${version}`);
  } catch (error) {
    logError(`Error saving version to database: ${error.message}`);
  }
}

// Download file with progress
function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    
    https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download, status code: ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLoggedPercentage = -1;

      response.on('data', chunk => {
        downloadedBytes += chunk.length;
        const percentage = Math.floor((downloadedBytes / totalBytes) * 100);
        
        // Log progress every 5%
        if (percentage % 5 === 0 && percentage !== lastLoggedPercentage && totalBytes > 0) {
          lastLoggedPercentage = percentage;
          process.stdout.write(`\rDownloading: ${percentage}% (${(downloadedBytes / 1048576).toFixed(2)}MB / ${(totalBytes / 1048576).toFixed(2)}MB)`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\rDownload completed                                                      ');
        resolve();
      });

      file.on('error', err => {
        fs.unlink(destination, () => {});
        reject(err);
      });

    }).on('error', err => {
      fs.unlink(destination, () => {});
      reject(err);
    });
  });
}

// Download README.md from GitHub
function downloadReadme() {
  return new Promise((resolve, reject) => {
    https.get(config.readmeUrl, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download README, status code: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', chunk => {
        data += chunk;
      });

      response.on('end', () => {
        fs.writeFileSync(config.tempReadmePath, data);
        resolve(data);
      });

    }).on('error', err => {
      reject(err);
    });
  });
}

// Extract latest version and download URL from README
function extractVersionInfo(readmeContent) {
  // Find the table header
  const tableHeaderMatch = readmeContent.match(/Version \| Date \| Mac Installer \| Windows Installer \| Linux Installer/);
  if (!tableHeaderMatch) {
    throw new Error('Could not find version table in README');
  }

  // Get the position of the table header
  const tableHeaderPos = readmeContent.indexOf(tableHeaderMatch[0]);
  
  // Get the table content after the header
  const tableContent = readmeContent.substring(tableHeaderPos);
  
  // Split by lines and get the first data row (skipping header and separator)
  const lines = tableContent.split('\n');
  if (lines.length < 3) {
    throw new Error('Table format in README is not as expected');
  }
  
  const dataRow = lines[2]; // Skip header and separator lines
  
  // Extract the appropriate download URL based on OS
  let downloadUrl;
  let installerType;
  
  if (config.isMacOS) {
    // Extract Mac download URL - 支持多种格式模式
    // 首先尝试darwin-universal格式
    const macArchType = 'universal';
    const macUrlRegex = new RegExp(`\\[darwin-${macArchType}\\]\\((https:\\/\\/[^)]*)\\)`);
    const macUrlMatch = dataRow.match(macUrlRegex);
    
    // 如果找不到darwin-universal格式，尝试简单的[mac]格式
    const simpleMacUrlMatch = dataRow.match(/\[mac\]\((https:\/\/[^)]*)\)/);
    
    if (macUrlMatch && macUrlMatch.length >= 2) {
      downloadUrl = macUrlMatch[1];
    } else if (simpleMacUrlMatch && simpleMacUrlMatch.length >= 2) {
      downloadUrl = simpleMacUrlMatch[1];
    } else {
      throw new Error('Could not find Mac download URL in README');
    }
    
    installerType = 'dmg';
  } else if (config.isWindows) {
    // Extract Windows download URL
    const winUrlMatch = dataRow.match(/\[win-x64\]\((https:\/\/[^)]*)\)/);
    if (!winUrlMatch || winUrlMatch.length < 2) {
      throw new Error('Could not find Windows download URL in README');
    }
    downloadUrl = winUrlMatch[1];
    installerType = 'exe';
  } else {
    // Default to Linux
    const linuxUrlMatch = dataRow.match(/\[linux-x64\]\((https:\/\/[^)]*)\)/);
    if (!linuxUrlMatch || linuxUrlMatch.length < 2) {
      throw new Error('Could not find Linux download URL in README');
    }
    downloadUrl = linuxUrlMatch[1];
    installerType = 'AppImage';
  }
  
  // Extract version from URL or from version column
  let version;
  // 首先尝试从表格第一列提取版本号
  const versionFromColumn = dataRow.match(/^\|\s*([0-9]+\.[0-9]+\.[0-9]+)/);
  
  if (versionFromColumn && versionFromColumn.length > 1) {
    version = versionFromColumn[1];
  } else {
    // 尝试从URL中提取版本号
    const versionMatch = downloadUrl.match(/[0-9]+\.[0-9]+\.[0-9]+/);
    if (versionMatch) {
      version = versionMatch[0];
    } else {
      // 尝试另一种格式
      const altVersionMatch = downloadUrl.match(/Cursor-([0-9.]*)/);
      if (altVersionMatch && altVersionMatch.length > 1) {
        version = altVersionMatch[1];
      } else {
        // 使用时间戳作为备用方案
        version = new Date().toISOString().split('T')[0].replace(/-/g, '');
      }
    }
  }

  return { version, downloadUrl, installerType };
}

// Make file executable (Linux/Mac only)
function makeExecutable(filePath) {
  if (process.platform !== 'win32') {
    try {
      execSync(`chmod +x "${filePath}"`);
      logInfo(`Made ${filePath} executable`);
    } catch (error) {
      logError(`Failed to make file executable: ${error.message}`);
    }
  }
}

// Move previous version to archive folder
function archivePreviousVersion(currentVersion) {
  try {
    // Find current AppImage in latest-cursor folder
    const files = fs.readdirSync(config.latestCursorDir);
    const appImageFiles = files.filter(file => file.endsWith('.AppImage'));

    for (const file of appImageFiles) {
      if (!file.includes(currentVersion)) {
        const sourcePath = path.join(config.latestCursorDir, file);
        const destPath = path.join(config.archivedImagesDir, file);
        
        logInfo(`Moving ${file} to archived_images folder`);
        fs.renameSync(sourcePath, destPath);
      }
    }
  } catch (error) {
    logError(`Error archiving previous version: ${error.message}`);
  }
}

// Handle DMG file on macOS
function handleMacDmg(dmgPath, version, copyMode = 'full') {
  try {
    const versionAppDir = path.join(config.versionAppsDir, `cursor_${version}_app`);
    
    if (!fs.existsSync(versionAppDir)) {
      fs.mkdirSync(versionAppDir, { recursive: true });
      logInfo(`Created directory: ${versionAppDir}`);
    }
    
    // Create mount point if it doesn't exist
    if (!fs.existsSync(config.tempMountPoint)) {
      fs.mkdirSync(config.tempMountPoint, { recursive: true });
    }
    
    // Mount the DMG
    logInfo(`Mounting DMG: ${dmgPath}`);
    execSync(`hdiutil attach "${dmgPath}" -mountpoint "${config.tempMountPoint}" -nobrowse`);
    
    // Find the .app directory in the mounted DMG
    const appPath = path.join(config.tempMountPoint, 'Cursor.app');
    
    if (!fs.existsSync(appPath)) {
      throw new Error(`Could not find Cursor.app in mounted DMG at ${appPath}`);
    }
    
    // Path to the resources/app directory in the .app bundle
    const resourcesAppDir = path.join(appPath, 'Contents', 'Resources', 'app');
    
    if (!fs.existsSync(resourcesAppDir)) {
      throw new Error(`Expected resources directory not found: ${resourcesAppDir}`);
    }
    
    if (copyMode === 'full') {
      // Copy full resources/app directory to version-specific folder
      logInfo(`Copying full resources to: ${versionAppDir}`);
      execSync(`cp -r "${resourcesAppDir}"/* "${versionAppDir}"/`);
      logSuccess(`Full resources copied successfully to ${versionAppDir}`);
    } else if (copyMode === 'core') {
      // Copy only core AI components
      logInfo(`Copying only core AI components to: ${versionAppDir}`);
      
      // Create necessary directories
      const dirs = ['extensions', 'out'];
      dirs.forEach(dir => {
        const targetDir = path.join(versionAppDir, dir);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          logInfo(`Created directory: ${targetDir}`);
        }
      });
      
      // Copy extensions directories
      const extensionsDir = path.join(resourcesAppDir, 'extensions');
      const coreExtensions = [
        'cursor-always-local',
        'cursor-retrieval',
        'cursor-shadow-workspace',
        'cursor-tokenize'
      ];
      
      coreExtensions.forEach(extName => {
        const sourceExtDir = path.join(extensionsDir, extName);
        const targetExtDir = path.join(versionAppDir, 'extensions', extName);
        
        if (fs.existsSync(sourceExtDir)) {
          execSync(`cp -r "${sourceExtDir}" "${path.join(versionAppDir, 'extensions')}"/`);
          logInfo(`Copied extension: ${extName}`);
        } else {
          logInfo(`Extension directory not found: ${sourceExtDir}`);
        }
      });
      
      // Copy out directory
      const sourceOutDir = path.join(resourcesAppDir, 'out');
      if (fs.existsSync(sourceOutDir)) {
        execSync(`cp -r "${sourceOutDir}" "${versionAppDir}"/`);
        logInfo(`Copied out directory`);
      } else {
        logInfo(`Out directory not found: ${sourceOutDir}`);
      }
      
      // Copy package.json and product.json
      const filesToCopy = ['package.json', 'product.json'];
      filesToCopy.forEach(file => {
        const sourceFile = path.join(resourcesAppDir, file);
        if (fs.existsSync(sourceFile)) {
          execSync(`cp "${sourceFile}" "${versionAppDir}"/`);
          logInfo(`Copied ${file}`);
        } else {
          logInfo(`File not found: ${sourceFile}`);
        }
      });
      
      logSuccess(`Core AI components copied successfully to ${versionAppDir}`);
    } else if (copyMode === 'js-only') {
      // Copy only core JavaScript files
      logInfo(`Copying only core JavaScript files to: ${versionAppDir}`);
      
      // Create necessary directories
      const dirs = [
        'out', 'out/vs', 'out/vs/base/parts/sandbox/electron-sandbox', 
        'out/vs/editor/common/services', 'out/vs/code/electron-sandbox/processExplorer',
        'out/vs/code/electron-sandbox/workbench', 'out/vs/code/electron-utility/sharedProcess',
        'out/vs/code/node', 'out/vs/platform/files/node/watcher',
        'out/vs/platform/profiling/electron-sandbox', 'out/vs/platform/terminal/node',
        'out/vs/workbench/api/node', 'out/vs/workbench/api/worker',
        'out/vs/workbench/contrib/webview/browser/pre',
        'out/vs/workbench/contrib/notebook/common/services',
        'out/vs/workbench/contrib/output/common',
        'out/vs/workbench/services/languageDetection/browser',
        'out/vs/workbench/services/textMate/browser/backgroundTokenization/worker',
        'out/vs/workbench/services/search/worker',
        'out/vs/workbench/contrib/debug/node',
        // Add extension directories
        'extensions',
        'extensions/cursor-always-local',
        'extensions/cursor-always-local/dist',
        'extensions/cursor-retrieval',
        'extensions/cursor-retrieval/dist',
        'extensions/cursor-shadow-workspace',
        'extensions/cursor-shadow-workspace/dist',
        'extensions/cursor-tokenize',
        'extensions/cursor-tokenize/dist'
      ];
      
      dirs.forEach(dir => {
        const targetDir = path.join(versionAppDir, dir);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          logInfo(`Created directory: ${targetDir}`);
        }
      });
      
      // Core JavaScript files based on categorization
      const coreJsFiles = [
        // Core Application Files
        'out/bootstrap-fork.js',
        'out/cli.js',
        'out/main.js',
        
        // Base System Files
        'out/vs/base/parts/sandbox/electron-sandbox/preload-aux.js',
        'out/vs/base/parts/sandbox/electron-sandbox/preload.js',
        
        // Editor Core
        'out/vs/editor/common/services/editorSimpleWorkerMain.js',
        
        // Code/Electron Integration
        'out/vs/code/electron-sandbox/processExplorer/processExplorer.js',
        'out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js',
        'out/vs/code/electron-sandbox/workbench/workbench.js',
        'out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js',
        'out/vs/code/node/cliProcessMain.js',
        
        // Platform Services
        'out/vs/platform/files/node/watcher/watcherMain.js',
        'out/vs/platform/profiling/electron-sandbox/profileAnalysisWorkerMain.js',
        'out/vs/platform/terminal/node/ptyHostMain.js',
        
        // Workbench API and Extensions
        'out/vs/workbench/api/node/extensionHostProcess.js',
        'out/vs/workbench/api/worker/extensionHostWorkerMain.js',
        
        // Webview and Browser Components
        'out/vs/workbench/contrib/webview/browser/pre/service-worker.js',
        
        // Language and Text Processing
        'out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorkerMain.js',
        'out/vs/workbench/contrib/output/common/outputLinkComputerMain.js',
        'out/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorkerMain.js',
        'out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js',
        
        // Search Services
        'out/vs/workbench/services/search/worker/localFileSearchMain.js',
        
        // Main UI
        'out/vs/workbench/workbench.desktop.main.js',
        
        // Additional Files
        'out/vs/workbench/contrib/debug/node/telemetryApp.js',
        
        // Add Cursor extension files
        'extensions/cursor-always-local/dist/main.js',
        'extensions/cursor-retrieval/dist/832.main.js',
        'extensions/cursor-retrieval/dist/868.main.js',
        'extensions/cursor-retrieval/dist/main.js',
        'extensions/cursor-shadow-workspace/dist/extension.js',
        'extensions/cursor-tokenize/dist/main.js'
      ];
      
      // Copy individual JS files
      coreJsFiles.forEach(file => {
        const sourceFile = path.join(resourcesAppDir, file);
        const targetFile = path.join(versionAppDir, file);
        
        if (fs.existsSync(sourceFile)) {
          // Ensure the parent directory exists
          const targetDir = path.dirname(targetFile);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          execSync(`cp "${sourceFile}" "${targetFile}"`);
          logInfo(`Copied ${file}`);
        } else {
          logInfo(`File not found: ${sourceFile}`);
        }
      });
      
      // Also copy extension package.json files to ensure proper functionality
      const extensionPackageJsonFiles = [
        'extensions/cursor-always-local/package.json',
        'extensions/cursor-retrieval/package.json', 
        'extensions/cursor-shadow-workspace/package.json',
        'extensions/cursor-tokenize/package.json'
      ];
      
      extensionPackageJsonFiles.forEach(file => {
        const sourceFile = path.join(resourcesAppDir, file);
        const targetFile = path.join(versionAppDir, file);
        
        if (fs.existsSync(sourceFile)) {
          // Ensure the parent directory exists
          const targetDir = path.dirname(targetFile);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          execSync(`cp "${sourceFile}" "${targetFile}"`);
          logInfo(`Copied ${file}`);
        } else {
          logInfo(`File not found: ${sourceFile}`);
        }
      });
      
      // Copy package.json and product.json which might be needed
      const filesToCopy = ['package.json', 'product.json'];
      filesToCopy.forEach(file => {
        const sourceFile = path.join(resourcesAppDir, file);
        if (fs.existsSync(sourceFile)) {
          execSync(`cp "${sourceFile}" "${versionAppDir}"/`);
          logInfo(`Copied ${file}`);
        } else {
          logInfo(`File not found: ${sourceFile}`);
        }
      });
      
      logSuccess(`Core JavaScript files and Cursor extensions copied successfully to ${versionAppDir}`);
    } else {
      throw new Error(`Invalid copy mode: ${copyMode}. Supported modes are 'full', 'core', or 'js-only'.`);
    }
    
    // Unmount the DMG
    logInfo('Unmounting DMG...');
    execSync(`hdiutil detach "${config.tempMountPoint}" -force`);
    logSuccess('DMG unmounted successfully');
    
    return versionAppDir;
  } catch (error) {
    // Ensure DMG is unmounted even if there was an error
    try {
      execSync(`hdiutil detach "${config.tempMountPoint}" -force`);
    } catch (unmountError) {
      // Ignore unmount errors
    }
    
    logError(`Error handling DMG file: ${error.message}`);
    return null;
  }
}

// Extract AppImage or handle DMG and copy resources based on OS
function extractAppAndCopyResources(installPath, version, copyMode = 'full') {
  // For macOS, handle DMG
  if (config.isMacOS && installPath.endsWith('.dmg')) {
    return handleMacDmg(installPath, version, copyMode);
  }
  // For Linux, extract AppImage
  else if (config.isLinux && installPath.endsWith('.AppImage')) {
    try {
      // Create version-specific app folder
      const versionAppDir = path.join(config.versionAppsDir, `cursor_${version}_app`);
      
      if (!fs.existsSync(versionAppDir)) {
        fs.mkdirSync(versionAppDir, { recursive: true });
        logInfo(`Created directory: ${versionAppDir}`);
      }

      // Extract AppImage
      logInfo(`Extracting AppImage: ${installPath}`);
      
      // First, remove any existing extraction directory to avoid conflicts
      if (fs.existsSync(config.extractDir)) {
        logInfo(`Removing previous extraction directory: ${config.extractDir}`);
        execSync(`rm -rf "${config.extractDir}"`);
      }
      
      // 首先复制一个临时副本，避免"Text file busy"错误
      const tempAppImagePath = `${installPath}.temp`;
      logInfo(`Creating temporary copy of AppImage...`);
      execSync(`cp "${installPath}" "${tempAppImagePath}"`);
      execSync(`chmod +x "${tempAppImagePath}"`);
      
      // 使用临时副本执行提取
      logInfo(`Extracting from temporary copy...`);
      execSync(`cd "${path.dirname(installPath)}" && "${tempAppImagePath}" --appimage-extract`);
      logSuccess(`AppImage extracted successfully`);
      
      // 删除临时副本
      execSync(`rm -f "${tempAppImagePath}"`);
      
      // Check if the expected resources directory exists
      const resourcesAppDir = path.join(config.extractDir, 'usr', 'share', 'cursor', 'resources', 'app');
      
      if (!fs.existsSync(resourcesAppDir)) {
        throw new Error(`Expected resources directory not found: ${resourcesAppDir}`);
      }
      
      if (copyMode === 'full') {
        // Copy full resources/app directory to version-specific folder
        logInfo(`Copying full resources to: ${versionAppDir}`);
        execSync(`cp -r "${resourcesAppDir}"/* "${versionAppDir}"/`);
        logSuccess(`Full resources copied successfully to ${versionAppDir}`);
      } else if (copyMode === 'core') {
        // Copy only core AI components
        logInfo(`Copying only core AI components to: ${versionAppDir}`);
        
        // Create necessary directories
        const dirs = ['extensions', 'out'];
        dirs.forEach(dir => {
          const targetDir = path.join(versionAppDir, dir);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            logInfo(`Created directory: ${targetDir}`);
          }
        });
        
        // Copy extensions directories
        const extensionsDir = path.join(resourcesAppDir, 'extensions');
        const coreExtensions = [
          'cursor-always-local',
          'cursor-retrieval',
          'cursor-shadow-workspace',
          'cursor-tokenize'
        ];
        
        coreExtensions.forEach(extName => {
          const sourceExtDir = path.join(extensionsDir, extName);
          const targetExtDir = path.join(versionAppDir, 'extensions', extName);
          
          if (fs.existsSync(sourceExtDir)) {
            execSync(`cp -r "${sourceExtDir}" "${path.join(versionAppDir, 'extensions')}"/`);
            logInfo(`Copied extension: ${extName}`);
          } else {
            logInfo(`Extension directory not found: ${sourceExtDir}`);
          }
        });
        
        // Copy out directory
        const sourceOutDir = path.join(resourcesAppDir, 'out');
        if (fs.existsSync(sourceOutDir)) {
          execSync(`cp -r "${sourceOutDir}" "${versionAppDir}"/`);
          logInfo(`Copied out directory`);
        } else {
          logInfo(`Out directory not found: ${sourceOutDir}`);
        }
        
        // Copy package.json and product.json
        const filesToCopy = ['package.json', 'product.json'];
        filesToCopy.forEach(file => {
          const sourceFile = path.join(resourcesAppDir, file);
          if (fs.existsSync(sourceFile)) {
            execSync(`cp "${sourceFile}" "${versionAppDir}"/`);
            logInfo(`Copied ${file}`);
          } else {
            logInfo(`File not found: ${sourceFile}`);
          }
        });
        
        logSuccess(`Core AI components copied successfully to ${versionAppDir}`);
      } else if (copyMode === 'js-only') {
        // Copy only core JavaScript files
        logInfo(`Copying only core JavaScript files to: ${versionAppDir}`);
        
        // Create necessary directories
        const dirs = [
          'out', 'out/vs', 'out/vs/base/parts/sandbox/electron-sandbox', 
          'out/vs/editor/common/services', 'out/vs/code/electron-sandbox/processExplorer',
          'out/vs/code/electron-sandbox/workbench', 'out/vs/code/electron-utility/sharedProcess',
          'out/vs/code/node', 'out/vs/platform/files/node/watcher',
          'out/vs/platform/profiling/electron-sandbox', 'out/vs/platform/terminal/node',
          'out/vs/workbench/api/node', 'out/vs/workbench/api/worker',
          'out/vs/workbench/contrib/webview/browser/pre',
          'out/vs/workbench/contrib/notebook/common/services',
          'out/vs/workbench/contrib/output/common',
          'out/vs/workbench/services/languageDetection/browser',
          'out/vs/workbench/services/textMate/browser/backgroundTokenization/worker',
          'out/vs/workbench/services/search/worker',
          'out/vs/workbench/contrib/debug/node',
          // Add extension directories
          'extensions',
          'extensions/cursor-always-local',
          'extensions/cursor-always-local/dist',
          'extensions/cursor-retrieval',
          'extensions/cursor-retrieval/dist',
          'extensions/cursor-shadow-workspace',
          'extensions/cursor-shadow-workspace/dist',
          'extensions/cursor-tokenize',
          'extensions/cursor-tokenize/dist'
        ];
        
        dirs.forEach(dir => {
          const targetDir = path.join(versionAppDir, dir);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            logInfo(`Created directory: ${targetDir}`);
          }
        });
        
        // Core JavaScript files based on categorization
        const coreJsFiles = [
          // Core Application Files
          'out/bootstrap-fork.js',
          'out/cli.js',
          'out/main.js',
          
          // Base System Files
          'out/vs/base/parts/sandbox/electron-sandbox/preload-aux.js',
          'out/vs/base/parts/sandbox/electron-sandbox/preload.js',
          
          // Editor Core
          'out/vs/editor/common/services/editorSimpleWorkerMain.js',
          
          // Code/Electron Integration
          'out/vs/code/electron-sandbox/processExplorer/processExplorer.js',
          'out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js',
          'out/vs/code/electron-sandbox/workbench/workbench.js',
          'out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js',
          'out/vs/code/node/cliProcessMain.js',
          
          // Platform Services
          'out/vs/platform/files/node/watcher/watcherMain.js',
          'out/vs/platform/profiling/electron-sandbox/profileAnalysisWorkerMain.js',
          'out/vs/platform/terminal/node/ptyHostMain.js',
          
          // Workbench API and Extensions
          'out/vs/workbench/api/node/extensionHostProcess.js',
          'out/vs/workbench/api/worker/extensionHostWorkerMain.js',
          
          // Webview and Browser Components
          'out/vs/workbench/contrib/webview/browser/pre/service-worker.js',
          
          // Language and Text Processing
          'out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorkerMain.js',
          'out/vs/workbench/contrib/output/common/outputLinkComputerMain.js',
          'out/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorkerMain.js',
          'out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js',
          
          // Search Services
          'out/vs/workbench/services/search/worker/localFileSearchMain.js',
          
          // Main UI
          'out/vs/workbench/workbench.desktop.main.js',
          
          // Additional Files
          'out/vs/workbench/contrib/debug/node/telemetryApp.js',
          
          // Add Cursor extension files
          'extensions/cursor-always-local/dist/main.js',
          'extensions/cursor-retrieval/dist/832.main.js',
          'extensions/cursor-retrieval/dist/868.main.js',
          'extensions/cursor-retrieval/dist/main.js',
          'extensions/cursor-shadow-workspace/dist/extension.js',
          'extensions/cursor-tokenize/dist/main.js'
        ];
        
        // Copy individual JS files
        coreJsFiles.forEach(file => {
          const sourceFile = path.join(resourcesAppDir, file);
          const targetFile = path.join(versionAppDir, file);
          
          if (fs.existsSync(sourceFile)) {
            // Ensure the parent directory exists
            const targetDir = path.dirname(targetFile);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            
            execSync(`cp "${sourceFile}" "${targetFile}"`);
            logInfo(`Copied ${file}`);
          } else {
            logInfo(`File not found: ${sourceFile}`);
          }
        });
        
        // Also copy extension package.json files to ensure proper functionality
        const extensionPackageJsonFiles = [
          'extensions/cursor-always-local/package.json',
          'extensions/cursor-retrieval/package.json', 
          'extensions/cursor-shadow-workspace/package.json',
          'extensions/cursor-tokenize/package.json'
        ];
        
        extensionPackageJsonFiles.forEach(file => {
          const sourceFile = path.join(resourcesAppDir, file);
          const targetFile = path.join(versionAppDir, file);
          
          if (fs.existsSync(sourceFile)) {
            // Ensure the parent directory exists
            const targetDir = path.dirname(targetFile);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            
            execSync(`cp "${sourceFile}" "${targetFile}"`);
            logInfo(`Copied ${file}`);
          } else {
            logInfo(`File not found: ${sourceFile}`);
          }
        });
        
        // Copy package.json and product.json which might be needed
        const filesToCopy = ['package.json', 'product.json'];
        filesToCopy.forEach(file => {
          const sourceFile = path.join(resourcesAppDir, file);
          if (fs.existsSync(sourceFile)) {
            execSync(`cp "${sourceFile}" "${versionAppDir}"/`);
            logInfo(`Copied ${file}`);
          } else {
            logInfo(`File not found: ${sourceFile}`);
          }
        });
        
        logSuccess(`Core JavaScript files and Cursor extensions copied successfully to ${versionAppDir}`);
      } else {
        throw new Error(`Invalid copy mode: ${copyMode}. Supported modes are 'full', 'core', or 'js-only'.`);
      }
      
      return versionAppDir;
    } catch (error) {
      logError(`Error extracting AppImage or copying resources: ${error.message}`);
      return null;
    }
  }
  // Windows or unsupported format
  else {
    logError(`Unsupported installer format for this platform: ${installPath}`);
    return null;
  }
}

// Clean up extraction directory
function cleanupExtractDir() {
  try {
    if (fs.existsSync(config.extractDir)) {
      logInfo(`Cleaning up extraction directory: ${config.extractDir}`);
      execSync(`rm -rf "${config.extractDir}"`);
      logSuccess(`Cleanup completed successfully`);
    }
  } catch (error) {
    logError(`Error during cleanup: ${error.message}`);
  }
}

// 显示帮助信息
function showHelp() {
  console.log(`
Cursor Auto-Update Script
=========================

This script automatically checks for the latest version of Cursor,
downloads it if needed, and copies the resources to a version-specific folder.

Usage: 
  node cursor-auto-update.js [options]

Options:
  --full          Copy all application resources (default)
  --core          Copy only core AI components (extensions, out, package.json, product.json)
  --js-only       Copy only core JavaScript files (main app JS files)
  --help          Show this help message

Examples:
  node cursor-auto-update.js              // Interactive mode, asks for copy mode
  node cursor-auto-update.js --full       // Full copy mode
  node cursor-auto-update.js --core       // Core AI components only
  node cursor-auto-update.js --js-only    // Core JavaScript files only
  
  `);
  process.exit(0);
}

// Main function
async function main() {
  try {
    // 添加命令行参数解析
    const args = process.argv.slice(2);
    
    // 如果有 --help 参数，显示帮助信息
    if (args.includes('--help') || args.includes('-h')) {
      showHelp();
      return;
    }
    
    logInfo('Starting Cursor auto-update check...');
    
    // Ensure directories exist
    ensureDirectoriesExist();
    
    let copyMode = 'full'; // 默认为完整复制
    
    // 如果有 --core 参数，则使用核心模式
    if (args.includes('--core')) {
      copyMode = 'core';
      logInfo('Using core components copy mode');
    } else if (args.includes('--full')) {
      copyMode = 'full';
      logInfo('Using full resources copy mode');
    } else if (args.includes('--js-only')) {
      copyMode = 'js-only';
      logInfo('Using core JavaScript files copy mode');
    } else {
      // 如果没有指定模式，则询问用户
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('选择复制模式 (Select copy mode):\n1. 完整复制 (Full copy - entire app resources)\n2. 仅核心AI组件 (Core AI components only)\n3. 仅核心JavaScript文件 (Core JavaScript files only)\n请输入选项 (Enter option) [1/2/3]: ', (ans) => {
          resolve(ans.trim());
          rl.close();
        });
      });
      
      if (answer === '2') {
        copyMode = 'core';
        logInfo('Using core components copy mode');
      } else if (answer === '3') {
        copyMode = 'js-only';
        logInfo('Using core JavaScript files copy mode');
      } else {
        copyMode = 'full';
        logInfo('Using full resources copy mode');
      }
    }
    
    // 检查是否需要重新下载（如果latest_cursor目录为空）
    const latestCursorFiles = fs.readdirSync(config.latestCursorDir);
    const hasInstallerFile = latestCursorFiles.length > 0;
    
    // 如果latest_cursor目录中没有安装文件，则重置版本数据库
    if (!hasInstallerFile) {
      logInfo('New download location detected, will download latest version...');
      saveCurrentVersion(null); // 重置版本数据库
    }
    
    // Get current version
    const currentVersion = getCurrentVersion();
    logInfo(`Current version: ${currentVersion || 'Not found'}`);
    
    // Download and parse README
    logInfo('Downloading README to check for updates...');
    const readmeContent = await downloadReadme();
    
    // Extract version info
    const { version, downloadUrl, installerType } = extractVersionInfo(readmeContent);
    logSuccess(`Latest version available: ${version}`);
    
    // Check if update is needed
    if (version === currentVersion && hasInstallerFile) {
      logSuccess('You already have the latest version installed.');
      
      // Optional: Even if already installed, ask if should extract and copy resources
      let installerPath;
      
      if (config.isMacOS) {
        installerPath = path.join(config.latestCursorDir, `Cursor-${version}.dmg`);
      } else if (config.isWindows) {
        installerPath = path.join(config.latestCursorDir, `Cursor-${version}.exe`);
      } else {
        installerPath = path.join(config.latestCursorDir, `Cursor-${version}.AppImage`);
      }
      
      if (fs.existsSync(installerPath)) {
        logInfo('The latest version is already downloaded.');
        
        // Extract and copy resources from the existing installer
        const versionAppDir = extractAppAndCopyResources(installerPath, version, copyMode);
        
        // Clean up extraction directory if it was created
        cleanupExtractDir();
        
        if (versionAppDir) {
          logSuccess(`Resources available at: ${versionAppDir}`);
        }
      }
      
      return;
    }
    
    // Set paths for new version
    let installerFileName;
    
    if (config.isMacOS) {
      installerFileName = `Cursor-${version}.dmg`;
    } else if (config.isWindows) {
      installerFileName = `Cursor-${version}.exe`;
    } else {
      installerFileName = `Cursor-${version}.AppImage`;
    }
    
    const downloadPath = path.join(config.latestCursorDir, installerFileName);
    
    // Download new version
    logInfo(`Downloading Cursor ${version}...`);
    await downloadFile(downloadUrl, downloadPath);
    logSuccess(`Downloaded to: ${downloadPath}`);
    
    // Make executable if it's an AppImage
    if (installerType === 'AppImage') {
      makeExecutable(downloadPath);
    }
    
    // Archive previous version if it exists
    if (currentVersion) {
      archivePreviousVersion(currentVersion);
    }
    
    // Extract and copy resources
    const versionAppDir = extractAppAndCopyResources(downloadPath, version, copyMode);
    
    // Clean up extraction directory if it was created
    cleanupExtractDir();
    
    // Update version database
    saveCurrentVersion(version);
    
    // Clean up
    if (fs.existsSync(config.tempReadmePath)) {
      fs.unlinkSync(config.tempReadmePath);
    }
    
    logSuccess('Cursor auto-update completed successfully!');
    
    if (versionAppDir) {
      logSuccess(`Resources available at: ${versionAppDir}`);
      if (copyMode === 'core') {
        logInfo('Note: Only core AI components were copied. This is not a complete Cursor installation.');
      } else if (copyMode === 'js-only') {
        logInfo('Note: Only core JavaScript files were copied. This is not a complete Cursor installation.');
      }
    }
    
  } catch (error) {
    logError(`Error during auto-update: ${error.message}`);
    
    // Ensure we clean up the extraction directory even if there was an error
    cleanupExtractDir();
    
    process.exit(1);
  }
}

// Run the main function
main(); 