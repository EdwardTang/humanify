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
import { openAIBatchParallel, openAIBatchParallelApply } from "./commands/openai-batch.js";
import { fullCycleCommand, fullCycleLongRunningCommand, applyRenamesCommand } from "./commands/full-cycle-unminify.js";
import { cli } from "./cli.js";
import { azure } from "./commands/gemini.js";
import { Command } from "commander";

// Create a new CLI program
const program = cli()
  .name("humanify")
  .description("Unminify code using OpenAI's API or a local LLM")
  .version(version);

// Add commands
program.addCommand(local);
program.addCommand(openai);
program.addCommand(azure);
program.addCommand(openAIBatchParallel);
program.addCommand(openAIBatchParallelApply);
program.addCommand(download());

// Add full cycle unminify commands
program.addCommand(fullCycleCommand);
program.addCommand(fullCycleLongRunningCommand);
program.addCommand(applyRenamesCommand);

// Parse arguments
program.parse(process.argv);
