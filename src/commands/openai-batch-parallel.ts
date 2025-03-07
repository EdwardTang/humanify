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
    
    try {
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
        concurrency
      });
      
      // Process the code
      await batchProcessor(code, filename);
      
      console.log(`Parallel batch processing completed for ${filename}`);
      console.log(`Results saved to ${opts.outputDir}`);
      console.log(`To apply these suggestions, use the 'openai-batch-parallel-apply' command.`);
    } catch (error) {
      console.error("Error in parallel batch processing:", error);
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
  .argument("input", "The input minified Javascript file (same as used in openai-batch-parallel)")
  .action(async (filename, opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }
    
    const concurrency = parseNumber(opts.concurrency);
    
    try {
      // Apply batch results
      const renamedCode = await applyParallelBatchRename(
        filename, 
        opts.resultsDir,
        concurrency
      );
      
      // Create output directory
      await fs.mkdir(opts.outputDir, { recursive: true });
      
      // Determine output filename
      const outputFilename = path.join(
        opts.outputDir,
        path.basename(filename)
      );
      
      // Apply prettier to the renamed code
      const formattedCode = await prettier(renamedCode);
      
      // Write the result to the output file
      await fs.writeFile(outputFilename, formattedCode);
      
      console.log(`Parallel batch rename applied successfully. Output file saved to ${outputFilename}`);
    } catch (error) {
      console.error("Error applying parallel batch rename:", error);
      process.exit(1);
    }
  });