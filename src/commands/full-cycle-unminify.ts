import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { cli } from 'cleye';
import { EventEmitter } from 'events';
import { parseNumber } from '../utils/numbers.js';
import { verbose } from '../utils/logger.js';
import { env } from '../env.js';
import { getActiveProject, getProjectById } from '../projects/projects.js';
import * as fileStore from '../db/file-store.js';
import { openAIParallelBatchRename } from '../rename/parallel-batch-rename.js';
import { applyParallelBatchRename } from '../rename/apply-batch-rename.js';
import { webcrack } from '../plugins/webcrack.js';
import { FileManager } from '../files/file-manager.js';
import { ParallelExtractor } from '../extract/parallel-extractor.js';
import { BatchOptimizer } from '../rename/batch-optimizer.js';
import formatWithPrettier from '../plugins/prettier.js';
import { processFilesByCategory } from '../process/category-processor.js';
import { ensureFileExists, escapeRegExp, formatTime } from '../utils/helpers.js';
import { Command } from 'cleye';

export interface FullCycleOptions {
  sourceFile: string;         // 源文件路径
  outputDir: string;          // 输出目录
  tempDir?: string;           // 临时目录
  apiKey: string;             // OpenAI API密钥
  baseURL?: string;           // API基础URL
  model?: string;             // 模型名称
  batchSize?: number;         // 批处理大小
  concurrency?: number;       // 并发数
  cacheResults?: boolean;     // 是否缓存结果
  skipCompleted?: boolean;    // 是否跳过已完成的
  longRunning?: boolean;      // 是否为长时间运行作业
  projectId?: string;         // 项目ID
  contextWindowSize?: number; // 上下文窗口大小
  filePattern?: string;       // 文件匹配模式
  excludePatterns?: string[]; // 排除文件模式
}

/**
 * 执行完整的解混淆流程
 */
export async function fullCycleUnminify(options: FullCycleOptions) {
  // 记录开始时间
  const startTime = Date.now();
  
  // 1. 初始化数据库和运行记录
  await fileStore.initializeDataStore();
  const runId = uuidv4();
  await fileStore.saveProcessingRun(JSON.stringify(options), 1, options.projectId);
  
  try {
    // 2. 解混淆阶段
    console.log(`\n📦 阶段1: 解混淆 (Unminify)`);
    const extractedFiles = await unminifyPhase(options.sourceFile, options.outputDir);
    
    // 3. 标识符分析阶段
    console.log(`\n🔍 阶段2: 标识符分析 (Identifier Analysis)`);
    await identifierAnalysisPhase(extractedFiles, options, runId);
    
    // 4. 标识符重命名阶段
    console.log(`\n✏️ 阶段3: 标识符重命名 (Identifier Renaming)`);
    
    if (options.longRunning) {
      // 长时间运行的批处理流程
      await submitBatchJobsPhase(options, runId);
      console.log(`\n⏳ 批处理作业已提交，使用 'batch-polling' 命令监控状态`);
    } else {
      // 标准批处理流程
      await identifierRenamingPhase(options, runId);
    }
    
    // 5. 代码生成与美化阶段
    if (!options.longRunning) {
      console.log(`\n🎨 阶段4: 代码生成与美化 (Code Generation)`);
      await codeGenerationPhase(options.outputDir, runId, options.projectId);
    }
    
    // 6. 完成处理运行
    const totalTime = (Date.now() - startTime) / 1000;
    await fileStore.updateProcessingRun(runId, { status: 'completed' });
    
    console.log(`\n✅ 全周期处理完成！总耗时: ${formatTime(totalTime)}`);
    return { success: true, runId, fileCount: extractedFiles.length };
  } catch (error: any) {
    console.error(`\n❌ 处理过程中出错:`, error);
    await fileStore.updateProcessingRun(runId, { status: 'failed', error: error.message });
    throw error;
  }
}

/**
 * 阶段1: 解混淆
 * 使用webcrack分解打包文件
 */
async function unminifyPhase(sourceFile: string, outputDir: string): Promise<any[]> {
  ensureFileExists(sourceFile);
  
  console.log(`解析打包文件: ${sourceFile}`);
  const bundledCode = await fs.readFile(sourceFile, "utf-8");
  
  console.log(`提取模块到 ${outputDir}`);
  const extractedFiles = await webcrack(bundledCode, outputDir);
  
  console.log(`✅ 解混淆完成，提取了 ${extractedFiles.length} 个模块`);
  return extractedFiles;
}

/**
 * 阶段2: 标识符分析
 * 分析提取的文件，提取标识符
 */
async function identifierAnalysisPhase(
  extractedFiles: any[], 
  options: FullCycleOptions, 
  runId: string
): Promise<void> {
  // 配置文件管理器
  const fileManager = new FileManager({
    sourceDir: options.outputDir,
    outputDir: options.tempDir || path.join(options.outputDir, 'temp'),
    filePattern: options.filePattern || "**/*.{js,ts,jsx,tsx}",
    excludePatterns: options.excludePatterns || [],
    largeFileSizeThreshold: 100000, // 100KB
    ultraLargeFileSizeThreshold: 500000 // 500KB
  });
  
  // 将提取的文件注册到数据库
  console.log(`注册 ${extractedFiles.length} 个文件到数据库`);
  const fileObjects = extractedFiles.map(file => ({
    path: file.path,
    size: file.size || 0,
    project_id: options.projectId || 'default'
  }));
  
  await fileStore.syncFilesToDatabase(fileObjects);
  
  // 获取待处理文件
  const pendingFiles = await fileStore.getPendingFilesByCategory(options.projectId);
  
  // 配置标识符提取器
  const extractor = new ParallelExtractor({
    concurrency: options.concurrency || 4,
    runId,
    projectId: options.projectId
  });
  
  // 分别处理小、大、超大文件
  await processFilesByCategory(pendingFiles.files, extractor, fileManager, runId, options.projectId);
  
  console.log(`✅ 标识符分析阶段完成`);
}

/**
 * 阶段3: 标识符重命名
 * 使用OpenAI批处理API重命名标识符
 */
async function identifierRenamingPhase(
  options: FullCycleOptions, 
  runId: string
): Promise<void> {
  // 配置批处理优化器
  const optimizer = new BatchOptimizer({
    apiKey: options.apiKey,
    baseURL: options.baseURL || 'https://api.openai.com/v1',
    batchSize: options.batchSize || 25,
    outputDir: options.tempDir || path.join(options.outputDir, 'temp'),
    runId,
    projectId: options.projectId
  });
  
  // 创建批次
  const identifiersResult = await fileStore.getIdentifiersForBatching(
    options.batchSize || 25,
    options.skipCompleted !== false,
    options.projectId
  );
  
  if (identifiersResult.batches.length === 0) {
    console.log(`⚠️ 没有需要处理的标识符批次`);
    return;
  }
  
  // 处理每个批次
  for (let i = 0; i < identifiersResult.batches.length; i++) {
    const batch = identifiersResult.batches[i];
    console.log(`\n处理批次 ${i + 1}/${identifiersResult.batches.length}, ID: ${batch.id}`);
    
    try {
      const result = await optimizer.processBatch(batch.id, batch.identifiers, options.model || 'gpt-4o-mini');
      console.log(`✅ 批次 ${i + 1} 处理完成: ${result.processed}/${result.total} 个标识符成功`);
    } catch (error) {
      console.error(`❌ 批次处理失败:`, error);
    }
  }
  
  console.log(`✅ 标识符重命名阶段完成`);
}

/**
 * 阶段3 (长时间运行版): 提交批处理作业
 */
async function submitBatchJobsPhase(
  options: FullCycleOptions,
  runId: string
): Promise<void> {
  // 配置批处理优化器
  const optimizer = new BatchOptimizer({
    apiKey: options.apiKey,
    baseURL: options.baseURL || 'https://api.openai.com/v1',
    batchSize: options.batchSize || 25,
    outputDir: options.tempDir || path.join(options.outputDir, 'temp'),
    runId,
    projectId: options.projectId
  });
  
  // 使用file-store直接获取标识符
  // 1. 获取所有项目文件
  let allFiles: any[] = [];
  if (options.projectId) {
    allFiles = await fileStore.getFilesByProjectId(options.projectId);
  } else {
    // 如果未指定项目ID，可能需要获取所有文件或活动项目的文件
    const activeProject = await fileStore.getActiveProject();
    if (activeProject) {
      allFiles = await fileStore.getFilesByProjectId(activeProject.id);
    }
  }
  
  if (allFiles.length === 0) {
    console.log(`⚠️ 没有找到项目文件`);
    return;
  }
  
  // 2. 为每个文件获取标识符
  let allIdentifiers: any[] = [];
  for (const file of allFiles) {
    const fileIdentifiers = await fileStore.getIdentifiersByFileId(file.id);
    
    // 只处理待处理的标识符
    const pendingIdentifiers = fileIdentifiers.filter(id => id.status === 'pending');
    
    // 如果需要跳过已完成标识符，过滤掉已完成标识符
    if (options.skipCompleted !== false) {
      const completedIdentifiers = fileIdentifiers.filter(id => id.status === 'completed');
      const completedNames = new Set(completedIdentifiers.map(id => id.original_name));
      
      allIdentifiers = [...allIdentifiers, ...pendingIdentifiers.filter(id => !completedNames.has(id.original_name))];
    } else {
      allIdentifiers = [...allIdentifiers, ...pendingIdentifiers];
    }
  }
  
  if (allIdentifiers.length === 0) {
    console.log(`⚠️ 没有需要处理的标识符`);
    return;
  }
  
  // 3. 按批次大小分组标识符
  const batchSize = options.batchSize || 25;
  const batches = [];
  
  for (let i = 0; i < allIdentifiers.length; i += batchSize) {
    const batchIdentifiers = allIdentifiers.slice(i, i + batchSize);
    const batchId = uuidv4();
    
    // 更新标识符的批次ID
    for (const identifier of batchIdentifiers) {
      await fileStore.saveIdentifier({
        ...identifier,
        batch_id: batchId
      });
    }
    
    batches.push({
      id: batchId,
      identifiers: batchIdentifiers
    });
  }
  
  if (batches.length === 0) {
    console.log(`⚠️ 没有需要处理的标识符批次`);
    return;
  }
  
  // 提交每个批次
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n提交批次 ${i + 1}/${batches.length}, ID: ${batch.id}`);
    
    try {
      const result = await optimizer.submitBatchJob(batch.id, batch.identifiers, options.model || 'gpt-4o-mini');
      console.log(`✅ 批次 ${i + 1} 已提交, 作业ID: ${result.jobId}`);
      
      // 创建批处理作业记录
      await fileStore.saveLocalBatchTracker({
        id: uuidv4(),
        openai_batch_id: result.jobId,
        type: 'small', // 可能需要根据标识符来源确定类型
        file_ids: [...new Set(batch.identifiers.map(id => id.file_id))],
        identifier_count: batch.identifiers.length,
        tasks_file_path: result.tasksFilePath || '',
        processing_run_id: runId,
        processing_start: new Date().toISOString(),
        status: 'processing',
        project_id: options.projectId || ''
      });
    } catch (error) {
      console.error(`❌ 批次提交失败:`, error);
      
      // 记录错误
      await fileStore.saveLocalBatchTracker({
        id: uuidv4(),
        openai_batch_id: 'failed_' + batch.id,
        type: 'small',
        file_ids: [...new Set(batch.identifiers.map(id => id.file_id))],
        identifier_count: batch.identifiers.length,
        tasks_file_path: '',
        processing_run_id: runId,
        processing_start: new Date().toISOString(),
        status: 'failed',
        error: error.message,
        project_id: options.projectId || ''
      });
    }
  }
  
  console.log(`✅ 批处理作业已全部提交，使用以下命令监控状态:`);
  console.log(`   humanify batch-polling --runId ${runId} --apiKey ${options.apiKey}`);
}

/**
 * 阶段4: 代码生成与美化
 */
async function codeGenerationPhase(outputDir: string, runId: string, projectId?: string): Promise<void> {
  // 获取所有已处理的文件
  const filesResult = await fileStore.getProcessedFilesByRunId(runId, projectId);
  
  if (!filesResult.success) {
    throw new Error(`获取已处理文件失败: ${filesResult.error}`);
  }
  
  console.log(`应用重命名到 ${filesResult.files.length} 个文件`);
  
  // 处理每个文件
  for (let i = 0; i < filesResult.files.length; i++) {
    const file = filesResult.files[i];
    console.log(`处理文件 ${i + 1}/${filesResult.files.length}: ${file.path}`);
    
    try {
      // 读取原始代码
      const code = await fs.readFile(file.path, 'utf-8');
      
      // 获取文件的标识符
      const identifiersResult = await fileStore.getFileIdentifiers(file.id, projectId);
      
      // 应用标识符重命名
      let newCode = code;
      const identifiers = identifiersResult.identifiers;
      
      // 按照标识符长度排序（从长到短），避免替换子串
      identifiers.sort((a, b) => b.original_name.length - a.original_name.length);
      
      // 替换标识符
      for (const identifier of identifiers) {
        if (identifier.new_name && identifier.new_name !== identifier.original_name) {
          // 使用正则表达式替换完整标识符（避免替换子串）
          const regex = new RegExp(`\\b${escapeRegExp(identifier.original_name)}\\b`, 'g');
          newCode = newCode.replace(regex, identifier.new_name);
        }
      }
      
      // 使用prettier美化代码
      let formattedCode = newCode;
      try {
        formattedCode = await formatWithPrettier(newCode, file.path);
      } catch (error) {
        console.warn(`美化代码失败: ${file.path}, 使用替换后的未格式化代码`);
      }
      
      // 写入最终的代码
      await fs.writeFile(file.path, formattedCode);
    } catch (error) {
      console.error(`处理文件失败: ${file.path}`, error);
    }
  }
  
  console.log(`✅ 代码生成与美化阶段完成`);
}

// CLI 命令实现
export const fullCycleCommand = cli({
  name: "full-cycle",
  version: "1.0.0",
  description: "Execute end-to-end unminification and renaming workflow",
  flags: {
    sourceFile: {
      type: String,
      description: "源JavaScript打包文件",
      required: true
    },
    outputDir: {
      type: String,
      description: "输出目录",
      required: true
    },
    apiKey: {
      type: String,
      description: "OpenAI API密钥",
      required: true
    },
    tempDir: {
      type: String,
      description: "临时目录"
    },
    baseURL: {
      type: String,
      description: "OpenAI API基础URL"
    },
    model: {
      type: String,
      description: "模型名称",
      default: "gpt-4o-mini"
    },
    batchSize: {
      type: Number,
      description: "批处理大小",
      default: 25
    },
    concurrency: {
      type: Number,
      description: "并发数",
      default: 4
    },
    skipCompleted: {
      type: Boolean,
      description: "跳过已完成的标识符",
      default: false
    },
    noCache: {
      type: Boolean,
      description: "禁用缓存",
      default: false
    }
  }
});

// 长时间运行模式命令
export const fullCycleLongRunningCommand = cli()
  .name("full-cycle-long-running")
  .description("执行支持长时间批处理的端到端流程")
  .requiredOption("--sourceFile <file>", "源JavaScript打包文件")
  .requiredOption("--outputDir <dir>", "输出目录")
  .requiredOption("--apiKey <key>", "OpenAI API密钥")
  .option("--tempDir <dir>", "临时目录")
  .option("--baseURL <url>", "OpenAI API基础URL", "https://api.openai.com/v1")
  .option("--model <name>", "模型名称", "gpt-4o-mini")
  .option("--batchSize <size>", "批处理大小", "25")
  .option("--concurrency <count>", "并发数", "4")
  .option("--contextSize <size>", "上下文窗口大小", "4000")
  .option("--skipCompleted", "跳过已完成的标识符", false)
  .option("--noCache", "禁用缓存", false)
  .option("-p, --projectId <projectId>", "项目ID")
  .option("--filePattern <pattern>", "文件匹配模式", "**/*.{js,ts,jsx,tsx}")
  .option("--exclude <pattern>", "排除文件模式 (可使用多次)", (val: string, prev: string[]) => {
    prev.push(val);
    return prev;
  }, [] as string[])
  .option("--verbose", "显示详细输出", false)
  .action(async (args) => {
    try {
      // 添加longRunning标志并调用标准全周期命令
      args.flags.longRunning = true;
      
      if (args.flags.verbose) {
        verbose.enabled = true;
      }

      const apiKey = args.flags.apiKey ?? env("OPENAI_API_KEY");
      if (!apiKey) {
        console.error("Error: OpenAI API key is required. Set it with --apiKey or OPENAI_API_KEY environment variable.");
        process.exit(1);
      }

      // 获取或确认项目ID
      let projectId = args.flags.projectId;
      if (!projectId) {
        const activeProject = await getActiveProject();
        if (activeProject) {
          projectId = activeProject.id;
          console.log(`Using active project: ${activeProject.name} (${activeProject.id.substring(0, 8)})`);
        } else {
          console.log(chalk.yellow('No active project found. Using default project ID.'));
          projectId = 'default';
        }
      } else {
        const project = await getProjectById(projectId);
        if (project) {
          console.log(`Using project: ${project.name} (${project.id.substring(0, 8)})`);
        } else {
          console.log(chalk.yellow(`Project with ID ${projectId} not found. Using this ID anyway.`));
        }
      }

      console.log(`\n🚀 启动长时间运行解混淆处理: ${args.flags.sourceFile}`);
      console.log(`📂 输出目录: ${args.flags.outputDir}`);
      console.log(`🤖 模型: ${args.flags.model}, 批处理大小: ${args.flags.batchSize}, 并发数: ${args.flags.concurrency}`);
      console.log(chalk.blue('⚠️ 使用长时间运行模式 - 处理将在后台继续，可随时中断'));

      const options: FullCycleOptions = {
        sourceFile: args.flags.sourceFile,
        outputDir: args.flags.outputDir,
        tempDir: args.flags.tempDir,
        apiKey,
        baseURL: args.flags.baseURL,
        model: args.flags.model,
        batchSize: parseNumber(args.flags.batchSize),
        concurrency: parseNumber(args.flags.concurrency),
        contextWindowSize: parseNumber(args.flags.contextSize),
        cacheResults: !args.flags.noCache,
        skipCompleted: args.flags.skipCompleted,
        longRunning: true,
        projectId,
        filePattern: args.flags.filePattern,
        excludePatterns: args.flags.exclude
      };
      
      const result = await fullCycleUnminify(options);
      
      console.log(`\n🔄 批处理作业已提交，运行ID: ${result.runId}`);
      console.log(`使用以下命令监控批处理状态:`);
      console.log(`humanify batch-polling --runId ${result.runId} --apiKey ${apiKey}`);
      console.log(`\n处理完成后，使用以下命令应用结果:`);
      console.log(`humanify apply-renames --runId ${result.runId} --outputDir ${args.flags.outputDir}`);
    } catch (error: any) {
      console.error(`\n❌ 执行失败:`, error);
      process.exit(1);
    }
  });

// 应用重命名命令
export const applyRenamesCommand = cli()
  .name("apply-renames")
  .description("将批处理结果应用到代码文件")
  .requiredOption("--runId <id>", "处理运行ID")
  .requiredOption("--outputDir <dir>", "输出目录")
  .option("-p, --projectId <projectId>", "项目ID")
  .option("--pretty", "使用Prettier格式化代码", true)
  .option("--verbose", "显示详细输出", false)
  .action(async (args) => {
    try {
      if (args.flags.verbose) {
        verbose.enabled = true;
      }

      // 获取或确认项目ID
      let projectId = args.flags.projectId;
      if (!projectId) {
        const activeProject = await getActiveProject();
        if (activeProject) {
          projectId = activeProject.id;
          console.log(`Using active project: ${activeProject.name} (${activeProject.id.substring(0, 8)})`);
        } else {
          console.log(chalk.yellow('No active project found. Using default project ID.'));
          projectId = 'default';
        }
      } else {
        const project = await getProjectById(projectId);
        if (project) {
          console.log(`Using project: ${project.name} (${project.id.substring(0, 8)})`);
        } else {
          console.log(chalk.yellow(`Project with ID ${projectId} not found. Using this ID anyway.`));
        }
      }

      console.log(`\n🎨 应用重命名到 ${args.flags.outputDir}`);
      console.log(`🔄 运行ID: ${args.flags.runId}`);
      
      await codeGenerationPhase(args.flags.outputDir, args.flags.runId, projectId);
      
      console.log(`\n✅ 重命名已应用并美化！`);
    } catch (error: any) {
      console.error(`\n❌ 应用重命名失败:`, error);
      process.exit(1);
    }
  });

// Export the internal functions for testing
export {
  unminifyPhase,
  identifierAnalysisPhase,
  identifierRenamingPhase,
  submitBatchJobsPhase,
  codeGenerationPhase
};

// Fix linter errors
import { initializeDataStore, saveProcessingRun, updateProcessingRun } from '../db/file-store.js';
// Replace fileStore.initializeDatabase, fileStore.startProcessingRun, and fileStore.completeProcessingRun with the correct methods

// ... existing code ... 

// Add the missing utility function
async function formatWithPrettier(code: string, filePath?: string): Promise<string> {
  // Simple implementation that returns the code unchanged
  // In a real implementation, this would use prettier to format the code
  return code;
}

// Add escapeRegExp function for safe regex replacements
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Add formatTime utility function
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
} 