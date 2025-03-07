#!/usr/bin/env -S npx tsx
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 正确导入 package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);
const { version } = packageJson;

import { download } from "./commands/download.js";
import { local } from "./commands/local.js";
import { openai } from "./commands/openai.js";
import { openAIBatch, openAIBatchApply } from "./commands/openai-batch.js";
import { openAIBatchParallel, openAIBatchParallelApply } from "./commands/openai-batch-parallel.js";
import { openAIBatchMultiFile, openAIBatchMultiFileApply } from "./commands/openai-batch-multi-file.js";
import { cli } from "./cli.js";
import { azure } from "./commands/gemini.js";

cli()
  .name("humanify")
  .description("Unminify code using OpenAI's API or a local LLM")
  .version(version)
  .addCommand(local)
  .addCommand(openai)
  .addCommand(azure)
  .addCommand(openAIBatch)
  .addCommand(openAIBatchApply)
  .addCommand(openAIBatchParallel)
  .addCommand(openAIBatchParallelApply)
  .addCommand(openAIBatchMultiFile)
  .addCommand(openAIBatchMultiFileApply)
  .addCommand(download())
  .parse(process.argv);
