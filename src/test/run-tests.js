#!/usr/bin/env node

/**
 * 测试运行脚本
 * 
 * 这个脚本可以运行项目中的一个或多个测试文件
 * 使用方法：
 *   node run-tests.js [测试文件...]
 * 
 * 示例：
 *   node run-tests.js                    # 运行所有测试
 *   node run-tests.js file-store.test.js # 运行单个测试文件
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 测试目录
const TEST_DIR = __dirname;

// 要运行的测试文件
const testFiles = process.argv.slice(2);

// 如果没有指定测试文件，则运行所有测试文件
async function getAllTestFiles() {
  const files = await fs.readdir(TEST_DIR);
  return files.filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'));
}

// 运行测试文件
async function runTest(testFile) {
  const testPath = path.join(TEST_DIR, testFile);
  
  console.log(`\n-------------------------------------`);
  console.log(`🧪 运行测试: ${testFile}`);
  console.log(`-------------------------------------\n`);
  
  return new Promise((resolve) => {
    const proc = spawn('node', ['--test', testPath], { 
      stdio: 'inherit',
      shell: true
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        console.log(`\n❌ 测试失败: ${testFile} (退出码: ${code})`);
      } else {
        console.log(`\n✅ 测试通过: ${testFile}`);
      }
      resolve(code === 0);
    });
  });
}

// 主函数
async function main() {
  console.log('🚀 开始运行测试...\n');
  
  const filesToRun = testFiles.length > 0 ? testFiles : await getAllTestFiles();
  
  if (filesToRun.length === 0) {
    console.log('❌ 未找到测试文件！');
    process.exit(1);
  }
  
  console.log(`找到 ${filesToRun.length} 个测试文件`);
  
  let passed = 0;
  let failed = 0;
  
  for (const file of filesToRun) {
    const result = await runTest(file);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n-------------------------------------');
  console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('-------------------------------------\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('运行测试时出错:', err);
  process.exit(1);
}); 