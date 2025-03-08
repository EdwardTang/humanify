import { cli } from "../cli.js";
import prettier from "../plugins/prettier.js";
import { verbose } from "../verbose.js";
import { env } from "../env.js";
import { parseNumber } from "../number-utils.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE } from "./default-args.js";
import * as fs from "fs/promises";
import * as path from "path";
import { ensureFileExists } from "../file-utils.js";
import * as os from 'os';
import { openAIParallelBatchRename, applyParallelBatchRename } from "../plugins/openai/parallel-batch-rename.js";
import * as dbHelpers from "../db/helpers.js";
import { connectDB, disconnectDB } from "../db/models.js";

// 获取CPU核心数，但限制最大并行度
const MAX_PARALLELISM = Math.min(os.cpus().length, 8);

// Command for batch rename generation with parallel processing
export const openAIBatchParallel = cli()
  .name("openai-batch-parallel")
  .description("Use OpenAI's Batch API with parallel processing to generate rename suggestions")
  .option("-m, --model <model>", "The model to use", "gpt-4o-mini")
  .option("-o, --outputDir <o>", "The output directory for batch results", "batch_results_parallel")
  .option(
    "-k, --apiKey <apiKey>",
    "The OpenAI API key. Alternatively use OPENAI_API_KEY environment variable"
  )
  .option(
    "--baseURL <baseURL>",
    "The OpenAI base server URL.",
    env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1"
  )
  .option("--verbose", "Show verbose output")
  .option(
    "--contextSize <contextSize>",
    "The context size to use for the LLM",
    `${DEFAULT_CONTEXT_WINDOW_SIZE}`
  )
  .option(
    "--batchSize <batchSize>",
    "The number of rename operations to include in each batch",
    "25"
  )
  .option(
    "--concurrency <concurrency>",
    "The number of parallel workers to use",
    `${MAX_PARALLELISM}`
  )
  .option(
    "--pollingInterval <pollingInterval>",
    "The interval in milliseconds to poll for batch job status",
    "30000"
  )
  .option(
    "--completionWindow <completionWindow>",
    "The window of time for batch completion (e.g., '24h')",
    "24h"
  )
  .option(
    "--trackEvents",
    "Track and store batch processing events",
    false
  )
  .option(
    "--storeMetadata",
    "Store detailed batch metadata in addition to results",
    false
  )
  .option(
    "--projectId <projectId>",
    "Project ID for tracking in multi-project environments",
    "default"
  )
  .option(
    "--useDatabase",
    "Use MongoDB database for storage",
    false
  )
  .argument("input", "The input minified Javascript file")
  .action(async (filename, opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }

    const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("API key is required. Please provide it via --apiKey or OPENAI_API_KEY environment variable.");
      process.exit(1);
    }
    
    const baseURL = opts.baseURL;
    const contextWindowSize = parseNumber(opts.contextSize);
    const batchSize = parseNumber(opts.batchSize);
    const pollingInterval = parseNumber(opts.pollingInterval);
    const concurrency = parseNumber(opts.concurrency);
    const projectId = opts.projectId;
    
    try {
      // 如果使用数据库，则连接数据库
      if (opts.useDatabase) {
        verbose.log('Connecting to database...');
        await connectDB();
        verbose.log('Connected to database');
      }
      
      // Verify file exists
      ensureFileExists(filename);
      
      // Read file directly
      const code = await fs.readFile(filename, "utf-8");
      
      verbose.log(`Processing file ${filename} for batch rename suggestions using parallel processing`);
      verbose.log(`Using concurrency: ${concurrency}, batch size: ${batchSize}`);
      
      // Create output directory
      const outputDir = path.resolve(opts.outputDir);
      await fs.mkdir(outputDir, { recursive: true });
      
      // Use the parallel batch rename processor
      const batchProcessor = openAIParallelBatchRename({
        apiKey,
        baseURL,
        model: opts.model,
        contextWindowSize,
        batchSize,
        outputDir: opts.outputDir,
        pollingInterval,
        concurrency,
        completionWindow: opts.completionWindow,
        trackEvents: opts.trackEvents,
        storeMetadata: opts.storeMetadata,
        projectId: projectId
      });
      
      // Process the code
      await batchProcessor(code, filename);
      
      console.log(`Parallel batch processing completed for ${filename}`);
      console.log(`Results saved to ${opts.outputDir}`);
      console.log(`To apply these suggestions, use the 'openai-batch-parallel-apply' command.`);
      
      // 如果使用数据库，则断开数据库连接
      if (opts.useDatabase) {
        verbose.log('Disconnecting from database...');
        await disconnectDB();
        verbose.log('Disconnected from database');
      }
    } catch (error) {
      console.error("Error in parallel batch processing:", error);
      
      // 确保在出错时也断开数据库连接
      if (opts.useDatabase) {
        try {
          await disconnectDB();
          verbose.log('Disconnected from database after error');
        } catch (dbError) {
          console.error("Error disconnecting from database:", dbError);
        }
      }
      
      process.exit(1);
    }
  });

// Command for applying parallel batch rename results
export const openAIBatchParallelApply = cli()
  .name("openai-batch-parallel-apply")
  .description("Apply rename suggestions from a previous parallel batch rename operation")
  .option("-o, --outputDir <o>", "The output directory for formatted code", "output")
  .option(
    "-r, --resultsDir <r>",
    "The directory containing batch results",
    "batch_results_parallel"
  )
  .option("--verbose", "Show verbose output")
  .option(
    "--concurrency <concurrency>",
    "The number of parallel workers to use",
    `${MAX_PARALLELISM}`
  )
  .option(
    "--batchId <batchId>",
    "Apply results from a specific batch ID only"
  )
  .option(
    "--skipFormat",
    "Skip code formatting with prettier after applying renames",
    false
  )
  .option(
    "--projectId <projectId>",
    "Project ID for tracking in multi-project environments",
    "default"
  )
  .option(
    "--useDatabase",
    "Use MongoDB database for storage",
    false
  )
  .option(
    "--runId <runId>",
    "Processing run ID to get results from database"
  )
  .argument("input", "The input minified Javascript file (same as used in openai-batch-parallel)")
  .action(async (filename, opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }
    
    const concurrency = parseNumber(opts.concurrency);
    
    try {
      // 如果使用数据库，则连接数据库
      if (opts.useDatabase) {
        verbose.log('Connecting to database...');
        await connectDB();
        verbose.log('Connected to database');
      }
      
      let renamedCode;
      
      if (opts.useDatabase && opts.runId) {
        // 从数据库中获取并应用重命名结果
        verbose.log(`Applying renames from database for run ID: ${opts.runId}`);
        
        // 获取文件ID
        const fileResults = await dbHelpers.getProcessedFilesByRunId(opts.runId);
        if (!fileResults.success || fileResults.files.length === 0) {
          throw new Error(`No processed files found for run ID: ${opts.runId}`);
        }
        
        // 查找匹配的文件
        const file = fileResults.files.find(f => f.path === filename);
        if (!file) {
          throw new Error(`File ${filename} not found in run ID: ${opts.runId}`);
        }
        
        // 获取文件的所有标识符
        const identifiersResult = await dbHelpers.getFileIdentifiers(file._id.toString());
        if (!identifiersResult.success) {
          throw new Error(`Failed to get identifiers: ${identifiersResult.error}`);
        }
        
        // 读取原始代码
        const code = await fs.readFile(filename, "utf-8");
        
        // 创建替换映射
        const replacements = identifiersResult.identifiers
          .filter(i => i.status === 'completed' && i.new_name && i.new_name !== i.original_name)
          .map(i => ({
            original: i.original_name,
            replacement: i.new_name
          }));
        
        verbose.log(`Applying ${replacements.length} renames from database`);
        
        // 应用重命名
        // 按原始名称长度排序（从长到短），避免替换子串
        replacements.sort((a, b) => b.original.length - a.original.length);
        
        // 使用正则表达式替换
        renamedCode = code;
        for (const { original, replacement } of replacements) {
          const regex = new RegExp(`\\b${escapeRegExp(original)}\\b`, 'g');
          renamedCode = renamedCode.replace(regex, replacement);
        }
      } else {
        // 使用文件系统中的结果
        renamedCode = await applyParallelBatchRename(
          filename, 
          opts.resultsDir,
          concurrency,
          opts.batchId
        );
      }
      
      // Create output directory
      await fs.mkdir(opts.outputDir, { recursive: true });
      
      // Determine output filename
      const outputFilename = path.join(
        opts.outputDir,
        path.basename(filename)
      );
      
      // Apply prettier to the renamed code if not skipped
      let formattedCode = renamedCode;
      if (!opts.skipFormat) {
        verbose.log("Formatting code with prettier...");
        formattedCode = await prettier(renamedCode);
      }
      
      // Write the result to the output file
      await fs.writeFile(outputFilename, formattedCode);
      
      console.log(`Parallel batch rename applied successfully. Output file saved to ${outputFilename}`);
      
      // 如果使用数据库，则断开数据库连接
      if (opts.useDatabase) {
        verbose.log('Disconnecting from database...');
        await disconnectDB();
        verbose.log('Disconnected from database');
      }
    } catch (error) {
      console.error("Error applying parallel batch rename:", error);
      
      // 确保在出错时也断开数据库连接
      if (opts.useDatabase) {
        try {
          await disconnectDB();
          verbose.log('Disconnected from database after error');
        } catch (dbError) {
          console.error("Error disconnecting from database:", dbError);
        }
      }
      
      process.exit(1);
    }
  });

// 工具函数：转义正则表达式特殊字符
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Command for listing batch job status
export const openAIBatchStatus = cli()
  .name("openai-batch-status")
  .description("List status of OpenAI batch jobs")
  .option(
    "-r, --resultsDir <r>",
    "The directory containing batch results",
    "batch_results_parallel"
  )
  .option("--verbose", "Show verbose output")
  .option(
    "-k, --apiKey <apiKey>",
    "The OpenAI API key. Alternatively use OPENAI_API_KEY environment variable"
  )
  .option(
    "--baseURL <baseURL>",
    "The OpenAI base server URL.",
    env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1"
  )
  .option(
    "--batchId <batchId>",
    "Show details for a specific batch ID"
  )
  .option(
    "--json",
    "Output in JSON format",
    false
  )
  .option(
    "--projectId <projectId>",
    "Filter status by project ID",
    "default"
  )
  .option(
    "--useDatabase",
    "Use MongoDB database for storage",
    false
  )
  .option(
    "--listAll",
    "List all batch jobs including completed ones",
    false
  )
  .option(
    "--includeEvents",
    "Include detailed event logs in the output",
    false
  )
  .option(
    "--runId <runId>",
    "Show batches for a specific processing run ID"
  )
  .action(async (opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }

    const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("API key is required. Please provide it via --apiKey or OPENAI_API_KEY environment variable.");
      process.exit(1);
    }

    try {
      // 如果使用数据库，则连接数据库
      if (opts.useDatabase) {
        verbose.log('Connecting to database...');
        await connectDB();
        verbose.log('Connected to database');
      }

      if (opts.useDatabase) {
        // 从数据库获取批处理作业状态
        verbose.log('Fetching batch job status from database...');
        
        // 获取待处理的批处理作业
        const pendingJobs = await dbHelpers.getPendingBatchJobs(opts.projectId);
        
        if (!pendingJobs.success) {
          throw new Error(`Failed to get pending batch jobs: ${pendingJobs.error}`);
        }
        
        console.log(`Found ${pendingJobs.jobs.length} pending batch jobs`);
        
        // 输出作业信息
        if (opts.json) {
          console.log(JSON.stringify(pendingJobs.jobs, null, 2));
        } else {
          console.log('Pending Batch Jobs:');
          console.log('-------------------');
          
          for (const job of pendingJobs.jobs) {
            console.log(`Batch ID: ${job.batch_id}`);
            console.log(`Status: ${job.status}`);
            console.log(`Created: ${job.created_at}`);
            console.log(`Input File: ${job.input_file_path}`);
            
            if (job.output_file_path) {
              console.log(`Output File: ${job.output_file_path}`);
            }
            
            if (job.error) {
              console.log(`Error: ${job.error}`);
            }
            
            console.log(`Total Requests: ${job.total_requests}`);
            console.log(`Completed Requests: ${job.completed_requests}`);
            console.log(`Failed Requests: ${job.failed_requests}`);
            
            if (opts.includeEvents && job.events && job.events.length > 0) {
              console.log('Events:');
              for (const event of job.events) {
                console.log(`  ${event.timestamp}: ${event.status} - ${event.details || 'No details'}`);
              }
            }
            
            console.log('-------------------');
          }
        }
      } else {
        // 使用 OpenAI SDK 获取批处理作业状态
        console.error("Direct API batch status check not implemented. Please use --useDatabase option.");
        process.exit(1);
      }
      
      // 如果使用数据库，则断开数据库连接
      if (opts.useDatabase) {
        verbose.log('Disconnecting from database...');
        await disconnectDB();
        verbose.log('Disconnected from database');
      }
    } catch (error) {
      console.error("Error checking batch status:", error);
      
      // 确保在出错时也断开数据库连接
      if (opts.useDatabase) {
        try {
          await disconnectDB();
          verbose.log('Disconnected from database after error');
        } catch (dbError) {
          console.error("Error disconnecting from database:", dbError);
        }
      }
      
      process.exit(1);
    }
  });