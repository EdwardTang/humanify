import { cli } from "../cli.js";
import prettier from "../plugins/prettier.js";
import { unminify } from "../unminify.js";
import babel from "../plugins/babel/babel.js";
import { openAIBatchRename, applyBatchRename } from "../plugins/openai/openai-batch-rename.js";
import { verbose } from "../verbose.js";
import { env } from "../env.js";
import { parseNumber } from "../number-utils.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE } from "./default-args.js";
import * as fs from "fs/promises";
import * as path from "path";
import { ensureFileExists } from "../file-utils.js";

// Command for batch rename generation
export const openAIBatch = cli()
  .name("openai-batch")
  .description("Use OpenAI's Batch API to generate rename suggestions (without applying them)")
  .option("-m, --model <model>", "The model to use", "gpt-4o-mini")
  .option("-o, --outputDir <o>", "The output directory for batch results", "batch_results")
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
    
    try {
      // Verify file exists
      ensureFileExists(filename);
      
      // Read file directly, without unminify
      const code = await fs.readFile(filename, "utf-8");
      
      verbose.log(`Processing file ${filename} for batch rename suggestions`);
      
      // Directly call openAIBatchRename without using unminify
      await openAIBatchRename({
        apiKey,
        baseURL,
        model: opts.model,
        contextWindowSize,
        batchSize,
        outputDir: opts.outputDir,
        pollingInterval
      })(code, filename);
      
      console.log(`Batch rename suggestions generated successfully and saved to ${opts.outputDir}`);
      console.log(`To apply these suggestions, use the 'openai-batch-apply' command.`);
    } catch (error) {
      console.error("Error generating batch rename suggestions:", error);
      process.exit(1);
    }
  });

// Command for applying batch rename results
export const openAIBatchApply = cli()
  .name("openai-batch-apply")
  .description("Apply rename suggestions from a previous batch rename operation")
  .option("-o, --outputDir <o>", "The output directory for formatted code", "output")
  .option(
    "-r, --resultsDir <r>",
    "The directory containing batch results",
    "batch_results"
  )
  .option("--verbose", "Show verbose output")
  .argument("input", "The input minified Javascript file (same as used in openai-batch)")
  .action(async (filename, opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }
    
    try {
      // First, check if batch results exist for this file
      const fileResults = await applyBatchRename(filename, opts.resultsDir);
      
      // Create output directory
      await fs.mkdir(opts.outputDir, { recursive: true });
      
      // Determine output filename
      const outputFilename = path.join(
        opts.outputDir,
        path.basename(filename)
      );
      
      // Apply prettier to the renamed code
      const formattedCode = await prettier(fileResults);
      
      // Write the result to the output file
      await fs.writeFile(outputFilename, formattedCode);
      
      console.log(`Batch rename applied successfully. Output file saved to ${outputFilename}`);
    } catch (error) {
      console.error("Error applying batch rename:", error);
      process.exit(1);
    }
  }); 