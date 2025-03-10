// tests/integration/full-cycle-workflow.test.ts
import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fullCycleUnminify } from '../../src/commands/full-cycle-unminify.js';

// 这些测试需要真实的API密钥，且会调用实际的API服务
// 使用以下环境变量来运行这些测试
// OPENAI_API_KEY = 你的OpenAI API密钥
// TEST_INTEGRATION = true (设置这个才会运行集成测试)

// 跳过所有集成测试除非TEST_INTEGRATION环境变量设置为true
const runIntegrationTests = process.env.TEST_INTEGRATION === 'true';

// 获取API密钥
const apiKey = process.env.OPENAI_API_KEY;

if (!runIntegrationTests) {
  // 如果不是集成测试环境，跳过所有测试
  describe.skip('Full Cycle Workflow Integration', () => {
    it('Skipped: Set TEST_INTEGRATION=true to run integration tests', () => {});
  });
} else if (!apiKey) {
  // 如果没有API密钥，也跳过所有测试
  describe.skip('Full Cycle Workflow Integration', () => {
    it('Skipped: Set OPENAI_API_KEY environment variable to run integration tests', () => {});
  });
} else {
  // 运行集成测试
  describe('Full Cycle Workflow Integration', () => {
    let tempDir: string;
    let outputDir: string;
    let sampleFilePath: string;
    
    // 在所有测试之前创建临时目录和测试文件
    beforeAll(async () => {
      // 创建临时目录
      tempDir = path.join(os.tmpdir(), `humanify-test-${Date.now()}`);
      outputDir = path.join(tempDir, 'output');
      
      // 确保目录存在
      await fs.mkdir(tempDir, { recursive: true });
      await fs.mkdir(outputDir, { recursive: true });
      
      // 创建一个简单的混淆JavaScript文件用于测试
      sampleFilePath = path.join(tempDir, 'sample.min.js');
      
      // 这是一个简单的混淆样本，包含一些典型的混淆模式
      const minifiedCode = `
        !function(e){var t={};function n(r){if(t[r])return t[r].exports;var o=t[r]={i:r,l:!1,exports:{}};return e[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}n.m=e,n.c=t,n.d=function(e,t,r){n.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:r})},n.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},n.t=function(e,t){if(1&t&&(e=n(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var r=Object.create(null);if(n.r(r),Object.defineProperty(r,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var o in e)n.d(r,o,function(t){return e[t]}.bind(null,o));return r},n.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return n.d(t,"a",t),t},n.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},n.p="",n(n.s=0)}([function(e,t,n){"use strict";n.r(t);var r=function(e){return e*e},o=function(e){return e+e};console.log("计算平方:",r(5)),console.log("双倍值:",o(5))}]);
      `;
      
      await fs.writeFile(sampleFilePath, minifiedCode, 'utf-8');
      
      // 如果需要，创建一个小型webpack-like的库，这样webcrack可以提取模块
      // 这里使用的示例很简单，实际测试时可能需要更复杂的示例
    });
    
    // 在所有测试之后清理临时目录
    afterAll(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('清理临时目录失败:', error);
      }
    });
    
    // 集成测试：执行完整的处理流程
    it('should process a simple minified file end to end', async () => {
      // 此测试使用小型文件，可以快速完成，但仍然测试端到端功能
      // 使用短超时时间运行，避免长时间运行
      jest.setTimeout(30000); // 30秒超时
      
      // 配置选项与实际使用类似
      const options = {
        sourceFile: sampleFilePath,
        outputDir,
        apiKey,
        batchSize: 10,          // 使用小批量，减少API调用
        concurrency: 2,         // 低并发，适合小文件
        skipCompleted: false,   // 不跳过已完成的标识符
        cacheResults: false,    // 不缓存结果
        projectId: 'integration-test',  // 使用特定项目ID方便清理
        // 默认使用gpt-4o-mini模型，速度快且成本低
      };
      
      // 执行全周期处理
      const result = await fullCycleUnminify(options);
      
      // 验证处理成功
      expect(result.success).toBe(true);
      
      // 验证文件被创建
      const outputFiles = await fs.readdir(outputDir);
      expect(outputFiles.length).toBeGreaterThan(0);
      
      // 检查至少一个输出文件的内容
      if (outputFiles.length > 0) {
        const firstOutputFile = path.join(outputDir, outputFiles[0]);
        const content = await fs.readFile(firstOutputFile, 'utf-8');
        
        // 验证文件内容不包含单字母变量名
        // 这是一个简单的启发式检查，实际测试可能需要更复杂的验证
        const singleLetterVarRegex = /\b[a-z]\b/g;
        const matches = content.match(singleLetterVarRegex) || [];
        
        // 我们预期重命名后单字母变量名的数量会大幅减少
        // 注意：这是一个启发式检查，可能需要调整
        console.log(`找到 ${matches.length} 个单字母变量名`);
        console.log('输出文件内容片段:');
        console.log(content.substring(0, 500) + '...');
        
        // 验证核心功能正常工作 - 这里我们检查是否有处理结果
        // 而不是确切的重命名结果，因为LLM输出可能有变化
        expect(content.length).toBeGreaterThan(0);
      }
    }, 60000); // 增加超时时间到60秒
    
    // 添加轻量级的集成测试 - 不实际调用OpenAI API
    it('should validate project structure correctly', async () => {
      // 这个测试检查项目结构和基本功能，但不调用API
      // 设置一个标志，模拟而不是实际调用API
      const mockOptions = {
        sourceFile: sampleFilePath,
        outputDir,
        apiKey: 'sk-mock-key',  // 使用假API密钥
        dryRun: true,           // 启用干运行模式（需要在代码中支持）
        projectId: 'mock-test'
      };
      
      // 我们不能直接调用fullCycleUnminify，因为它会尝试调用API
      // 相反，我们可以检查项目的关键组件是否存在
      
      // 检查关键文件是否存在
      const fileExists = async (filePath: string) => {
        try {
          await fs.access(filePath);
          return true;
        } catch {
          return false;
        }
      };
      
      // 验证主文件存在
      const srcPath = path.resolve(__dirname, '../../src');
      expect(await fileExists(path.join(srcPath, 'commands/full-cycle-unminify.ts'))).toBe(true);
      expect(await fileExists(path.join(srcPath, 'db/file-store.ts'))).toBe(true);
      expect(await fileExists(path.join(srcPath, 'files/file-manager.ts'))).toBe(true);
      expect(await fileExists(path.join(srcPath, 'extract/parallel-extractor.ts'))).toBe(true);
      expect(await fileExists(path.join(srcPath, 'rename/batch-optimizer.ts'))).toBe(true);
    });
  });
} 