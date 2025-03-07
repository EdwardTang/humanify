import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import * as os from 'os';
import { verbose } from "../verbose.js";
import * as glob from "glob";
import { env } from "../env.js";
import { GlobalTaskPool, GlobalTaskPoolConfig } from "../plugins/openai/global-task-pool.js";

// 常量定义
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_CONTEXT_WINDOW_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MIN_BATCH_SIZE = 5;
const DEFAULT_MAX_BATCH_SIZE = 50;
const DEFAULT_ADAPTIVE_BATCHING = true;
const DEFAULT_POLLING_INTERVAL = 5000; // 毫秒
const MAX_DEFAULT_CONCURRENCY = 4;

// 计算默认最大并行度
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(MAX_DEFAULT_CONCURRENCY, Math.floor(os.cpus().length * 0.75)));

// 获取 OpenAI API 密钥
async function getOpenaiApiKey(): Promise<string | undefined> {
  return env("OPENAI_API_KEY");
}

// 获取 OpenAI 基础 URL
function getBaseUrl(): string {
  return env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
}

interface MultiFileCommandOptions {
  model: string;
  output: string;
  apiKey?: string;
  baseUrl: string;
  contextSize: string;
  batchSize: string;
  concurrency: string;
  pollingInterval: string;
  glob: string;
  directory: string;
  adaptiveBatching: boolean;
  minBatchSize: string;
  maxBatchSize: string;
  verbose: boolean;
  dryRun: boolean;
  fileList?: string;
}

interface MultiFileApplyCommandOptions {
  output: string;
  results: string;
  verbose: boolean;
  concurrency: string;
}

// MultiFile 批处理命令
export const openAIBatchMultiFile = new Command("openai-batch-multi-file")
  .description("使用 OpenAI API 批量处理多个文件中的标识符重命名")
  .option(
    "-m, --model <model>",
    "OpenAI 模型",
    DEFAULT_MODEL
  )
  .option(
    "-o, --output <directory>",
    "输出目录",
    "./output"
  )
  .option(
    "-k, --api-key <key>",
    "OpenAI API 密钥"
  )
  .option(
    "-u, --base-url <url>",
    "OpenAI API 基础 URL",
    getBaseUrl()
  )
  .option(
    "-c, --context-size <size>",
    "上下文窗口大小",
    String(DEFAULT_CONTEXT_WINDOW_SIZE)
  )
  .option(
    "-b, --batch-size <size>",
    "批处理大小",
    String(DEFAULT_BATCH_SIZE)
  )
  .option(
    "-p, --concurrency <number>",
    "并发处理数",
    String(Math.min(4, DEFAULT_CONCURRENCY))
  )
  .option(
    "-i, --polling-interval <ms>",
    "轮询间隔（毫秒）",
    String(DEFAULT_POLLING_INTERVAL)
  )
  .option(
    "-g, --glob <pattern>",
    "文件匹配模式",
    "**/*.{js,ts,jsx,tsx}"
  )
  .option(
    "-d, --directory <path>",
    "要处理的目录",
    "."
  )
  .option(
    "--file-list <path>",
    "包含要处理的文件列表的文件路径"
  )
  .option(
    "-a, --adaptive-batching",
    "启用自适应批处理大小",
    DEFAULT_ADAPTIVE_BATCHING
  )
  .option(
    "--min-batch-size <size>",
    "最小批处理大小",
    String(DEFAULT_MIN_BATCH_SIZE)
  )
  .option(
    "--max-batch-size <size>",
    "最大批处理大小",
    String(DEFAULT_MAX_BATCH_SIZE)
  )
  .option(
    "-v, --verbose",
    "启用详细日志",
    false
  )
  .option(
    "--dry-run",
    "仅生成批处理文件，不发送API请求",
    false
  )
  .action(async (options: MultiFileCommandOptions) => {
    try {
      const startTime = Date.now();
      
      // 设置详细日志
      verbose.enabled = options.verbose;
      
      // 检查API密钥（在dry-run模式下不强制要求）
      const apiKey = options.apiKey || (await getOpenaiApiKey());
      if (!apiKey && !options.dryRun) {
        throw new Error(
          "No OpenAI API key provided. Either pass --api-key or set the OPENAI_API_KEY environment variable."
        );
      }
      
      // 当使用dry-run模式但没有提供API密钥时，使用占位符密钥
      const effectiveApiKey = apiKey || "sk-dry-run-dummy-key";
      
      const outputDir = path.resolve(options.output);
      const sourceDir = path.resolve(options.directory);
      
      // 创建输出目录
      await fs.mkdir(outputDir, { recursive: true });
      
      // 配置全局任务池
      const config: GlobalTaskPoolConfig = {
        apiKey: effectiveApiKey,
        baseURL: options.baseUrl,
        model: options.model,
        contextWindowSize: parseInt(options.contextSize, 10),
        batchSize: parseInt(options.batchSize, 10),
        outputDir,
        pollingInterval: parseInt(options.pollingInterval, 10),
        concurrency: parseInt(options.concurrency, 10),
        adaptiveBatching: options.adaptiveBatching,
        minBatchSize: parseInt(options.minBatchSize, 10),
        maxBatchSize: parseInt(options.maxBatchSize, 10),
        dryRun: options.dryRun
      };
      
      // 创建全局任务池
      const taskPool = new GlobalTaskPool(config);
      
      let files: string[];
      
      // 从文件列表中读取文件
      if (options.fileList) {
        console.log(chalk.cyan(`📋 从文件列表中读取文件: ${options.fileList}`));
        try {
          const fileListContent = await fs.readFile(options.fileList, 'utf-8');
          files = fileListContent.split('\n').filter(line => line.trim() !== '');
          console.log(chalk.green(`✓ 从文件列表中读取了 ${files.length} 个文件`));
        } catch (error) {
          console.error(chalk.red(`❌ 无法读取文件列表: ${error}`));
          process.exit(1);
        }
      } else {
        // 查找匹配的文件
        console.log(chalk.cyan(`🔍 查找匹配模式 "${options.glob}" 的文件...`));
        console.log(chalk.cyan(`   搜索目录: ${sourceDir} (绝对路径)`));
        
        // 测试目录是否存在
        try {
          await fs.access(sourceDir);
          console.log(chalk.green(`✓ 目录存在`));
        } catch (error) {
          console.error(chalk.red(`❌ 目录不存在或无法访问: ${sourceDir}`));
          process.exit(1);
        }
        
        files = glob.sync(options.glob, { 
          cwd: sourceDir, 
          absolute: false,
          ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
        });
        
        console.log(chalk.yellow(`   忽略模式: node_modules, dist, build 目录`));
        
        if (files.length === 0) {
          console.error(chalk.red(`⚠️  在 ${sourceDir} 中未找到匹配 "${options.glob}" 的文件。`));
          
          // 尝试不带忽略模式重新查找，以便调试
          const allFiles = glob.sync(options.glob, { 
            cwd: sourceDir, 
            absolute: false
          });
          
          if (allFiles.length > 0) {
            console.log(chalk.yellow(`   但不带忽略模式时找到了 ${allFiles.length} 个文件。前 5 个:`));
            allFiles.slice(0, 5).forEach(file => console.log(`   - ${file}`));
          }
          
          process.exit(1);
        }
      }
      
      console.log(chalk.green(`✓ 找到 ${files.length} 个文件进行处理。前 5 个:`));
      files.slice(0, 5).forEach(file => console.log(`   - ${file}`));
      
      // 收集所有文件中的标识符
      console.log(chalk.cyan("\n📥 收集所有文件中的标识符..."));
      let fileCount = 0;
      let taskCount = 0;
      
      for (const relativeFilePath of files) {
        const filePath = path.join(sourceDir, relativeFilePath);
        try {
          const code = await fs.readFile(filePath, "utf-8");
          await taskPool.addFileIdentifiers(filePath, code);
          fileCount++;
          taskCount = taskPool.getTaskCount();
        } catch (error) {
          console.error(chalk.red(`❌ 处理文件 ${filePath} 时出错: ${error}`));
        }
      }
      
      console.log(chalk.green(`✓ 从 ${fileCount} 个文件中收集了 ${taskCount} 个标识符`));
      
      // 处理所有批次
      if (options.dryRun) {
        console.log(chalk.cyan("\n🔍 生成批处理文件 (Dry Run 模式)..."));
        await taskPool.generateBatchesOnly();
        console.log(chalk.green(`✓ 完成批处理文件生成，未发送API请求`));
      } else {
        console.log(chalk.cyan("\n🚀 开始处理所有批次..."));
        const results = await taskPool.processBatches();
        
        console.log(chalk.green(`✓ 完成批处理，处理了 ${results.size} 个文件的重命名结果`));
        
        // 应用结果
        console.log(chalk.cyan("\n📝 应用重命名结果..."));
        await taskPool.applyResults();
        
        console.log(chalk.green(`✓ 已更新 ${results.size} 个文件`));
      }
      
      // 完成并显示总运行时间
      const totalTime = (Date.now() - startTime) / 1000;
      console.log(chalk.green(`\n✅ 完成! 总运行时间: ${totalTime.toFixed(1)} 秒`));
    } catch (error) {
      console.error(chalk.red(`\n❌ 错误: ${error}`));
      process.exit(1);
    }
  });

// 应用跨文件批处理结果的命令
export const openAIBatchMultiFileApply = new Command("openai-batch-multi-file-apply")
  .description("应用之前批处理操作的重命名建议")
  .option(
    "-o, --output <directory>",
    "输出目录",
    "./renamed"
  )
  .option(
    "-r, --results <directory>",
    "结果目录",
    "./output"
  )
  .option(
    "-v, --verbose",
    "启用详细日志",
    false
  )
  .option(
    "-p, --concurrency <number>",
    "并发处理数",
    String(Math.min(4, DEFAULT_CONCURRENCY))
  )
  .action(async (options: MultiFileApplyCommandOptions) => {
    try {
      // 设置详细日志
      verbose.enabled = options.verbose;
      
      const outputDir = path.resolve(options.output);
      const resultsDir = path.resolve(options.results);
      
      // 检查结果目录是否存在
      try {
        await fs.access(resultsDir);
      } catch (error) {
        throw new Error(`输出目录不存在或无法访问: ${resultsDir}`);
      }
      
      // 创建输出目录
      await fs.mkdir(outputDir, { recursive: true });
      
      // 应用结果
      console.log(chalk.cyan("\n📝 应用重命名结果..."));
      try {
        // 这里我们需要实现一个静态方法来应用结果
        // 由于我们还没有实现这个方法，这里先留空
        console.log('此功能尚未实现。请使用 GlobalTaskPool 实例的 applyResults 方法。');
      } catch (error) {
        console.error(chalk.red(`❌ 应用结果时出错: ${error}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ 错误: ${error}`));
      process.exit(1);
    }
  });

// 工具函数：解析布尔值或使用默认值
function parseBooleanOrDefault(defaultValue: boolean): (value: string) => boolean {
  return (value: string) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return defaultValue;
  };
}

// 转义正则表达式特殊字符
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 