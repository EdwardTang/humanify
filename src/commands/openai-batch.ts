import { cli } from "../cli.js";
import prettier from "../plugins/prettier.js";
import { unminify } from "../unminify.js";
import babel from "../plugins/babel/babel.js";
import { openAIBatchRename } from "../plugins/openai/openai-batch-rename.js";
import { verbose } from "../verbose.js";
import { env } from "../env.js";
import { parseNumber } from "../number-utils.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE } from "./default-args.js";

export const openaiLLMBatch = cli()
  .name("openai-batch")
  .description("Use OpenAI's Batch API to unminify code with efficient batching and retry logic")
  .option("-m, --model <model>", "The model to use", "gpt-4o-mini")
  .option("-o, --outputDir <o>", "The output directory", "output")
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
    "Number of identifiers to send in each batch (default: 100)",
    "100"
  )
  .option(
    "--chunkSize <chunkSize>",
    "Maximum chunk size in bytes for splitting large files (default: 500000)",
    "500000"
  )
  .option(
    "--pollInterval <pollInterval>",
    "Interval in ms to poll for batch completion status (default: 60000)",
    "60000"
  )
  .option(
    "--tempDir <tempDir>",
    "Directory to store temporary batch files",
    "./.humanify-temp"
  )
  .option(
    "--maxRetries <maxRetries>",
    "Maximum number of retries for failed identifier rename attempts (default: 3)",
    "3"
  )
  .option(
    "--backoffMultiplier <backoffMultiplier>",
    "Multiplier for exponential backoff on retries (default: 1.5)",
    "1.5"
  )
  .option(
    "--initialBackoff <initialBackoff>",
    "Initial backoff time in ms for retries (default: 5000)",
    "5000"
  )
  .option(
    "--useStreamProcessing <useStreamProcessing>",
    "Use stream-based processing for identifier collection",
    "true"
  )
  .argument("input", "The input minified Javascript file or directory")
  .action(async (input, opts) => {
    if (opts.verbose) {
      verbose.enabled = true;
    }

    const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
    const baseURL = opts.baseURL;
    const contextWindowSize = parseNumber(opts.contextSize);
    const batchSize = parseNumber(opts.batchSize);
    const chunkSize = parseNumber(opts.chunkSize);
    const pollInterval = parseNumber(opts.pollInterval);
    const maxRetries = parseNumber(opts.maxRetries);
    const backoffMultiplier = parseNumber(opts.backoffMultiplier);
    const initialBackoff = parseNumber(opts.initialBackoff);
    const useStreamProcessing = opts.useStreamProcessing === "true";
    
    // Use the enhanced batch rename plugin
    await unminify(input, opts.outputDir, [
      babel,
      openAIBatchRename({
        apiKey,
        baseURL,
        model: opts.model,
        contextWindowSize,
        batchSize,
        pollInterval,
        tempDir: opts.tempDir,
        maxRetries,
        backoffMultiplier,
        initialBackoff,
        chunkSize,
        useStreamProcessing
      }),
      prettier
    ]);
    
    verbose.log("Batch processing completed. Global rename map is stored in .humanify-rename-map.json");
  }); 