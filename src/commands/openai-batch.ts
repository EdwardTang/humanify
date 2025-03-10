/**
 * OpenAI Batch Parallel Command
 * Handles batch processing of files with staged execution and database integration
 */
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
import { openAIParallelBatchRename, applyParallelBatchRename } from "../plugins/openai/openai-batch-rename.js";
import * as globLib from 'glob';
import { execSync, spawn, ChildProcess } from 'child_process';
import { fork } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { getProjects, getProjectById, setActiveProject, deleteProject, saveProject, getActiveProject } from '../db/file-store.js';

// Base OpenAI Batch command
export const openAIBatchParallel = cli()
  .name("openai-batch")
  .description("Use OpenAI Batch API to process multiple files in parallel")
  .option("-m, --model <model>", "The model to use", "gpt-3.5-turbo")
  .option("-o, --outputDir <o>", "The output directory", "output")
  .option("--contextSize <contextSize>", "The context size to use for the LLM", `${DEFAULT_CONTEXT_WINDOW_SIZE}`)
  .option("-k, --apiKey <apiKey>", "The OpenAI API key. Alternatively use OPENAI_API_KEY environment variable")
  .option("-b, --baseURL <baseURL>", "The OpenAI API base URL", "https://api.openai.com/v1")
  .option("--batchSize <batchSize>", "Batch size for API requests", "25")
  .option("-c, --concurrency <concurrency>", "Parallel processing concurrency", "4")
  .option("--verbose", "Show verbose output")
  .option("--filePattern <pattern>", "File pattern to match", "**/*.{js,ts,jsx,tsx}")
  .option("-p, --projectId <projectId>", "Project ID to associate with this batch")
  .option("--exclude <pattern>", "Pattern to exclude (can be used multiple times)", (val: string, prev: string[]) => {
    prev.push(val);
    return prev;
  }, [] as string[])
  .argument("<input>", "The input directory or file")
  .action(async (input, opts) => {
    try {
      if (opts.verbose) {
        verbose.enabled = true;
      }

      const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
      if (!apiKey) {
        console.error("Error: OpenAI API key is required. Set it with --apiKey or OPENAI_API_KEY environment variable.");
        process.exit(1);
      }

      // Get project ID from option or active project
      let projectId = opts.projectId;
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

      console.log(`Starting OpenAI Batch processing on ${input}`);
      console.log(`Model: ${opts.model}, Output directory: ${opts.outputDir}`);
      console.log(`Processing with concurrency: ${opts.concurrency}, batch size: ${opts.batchSize}`);

      // Just a basic implementation to make the CLI run
      const renamer = openAIParallelBatchRename({
        apiKey,
        baseURL: opts.baseURL,
        model: opts.model,
        contextWindowSize: parseNumber(opts.contextSize),
        batchSize: parseNumber(opts.batchSize),
        outputDir: opts.outputDir,
        concurrency: parseNumber(opts.concurrency),
        projectId
      });
      
      const outputPath = await renamer(input, path.basename(input));

      console.log(`✅ Processing completed. Results saved to: ${outputPath}`);
    } catch (error: any) {
      console.error(`❌ Error processing batch: ${error.message}`);
      process.exit(1);
    }
  });

export const openAIBatchParallelApply = cli()
  .name("openai-batch-apply")
  .description("Apply OpenAI Batch processing results to files")
  .option("-o, --outputDir <o>", "The output directory", "output")
  .option("-c, --concurrency <concurrency>", "Parallel processing concurrency", "4")
  .option("--verbose", "Show verbose output")
  .option("--batchId <batchId>", "Specific batch ID to apply")
  .option("-p, --projectId <projectId>", "Project ID to use for applying batch results")
  .argument("<input>", "The input file to process")
  .action(async (input, opts) => {
    try {
      if (opts.verbose) {
        verbose.enabled = true;
      }

      // Get project ID from option or active project
      let projectId = opts.projectId;
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

      console.log(`Applying batch results to ${input}`);
      console.log(`Output directory: ${opts.outputDir}`);

      // Simple implementation to make the CLI run
      const outputPath = await applyParallelBatchRename(
        input,
        opts.outputDir,
        parseNumber(opts.concurrency),
        opts.batchId
      );

      console.log(`✅ Applied batch results. Output saved to: ${outputPath}`);
    } catch (error: any) {
      console.error(`❌ Error applying batch results: ${error.message}`);
      process.exit(1);
    }
  });

// Project-related subcommands for openai-batch
const projectCommand = cli()
  .name("project")
  .description("Manage project information for batch processing");

/**
 * List all projects
 */
async function listProjects() {
  try {
    const projects = await getProjects();
    
    if (projects.length === 0) {
      console.log(chalk.yellow('No projects found. Use "humanify openai-batch project init" command to initialize a project.'));
      return;
    }
    
    console.log(chalk.cyan('Project list:'));
    projects.forEach(project => {
      console.log(
        `${project.is_active ? chalk.green('*') : ' '} ${chalk.bold(project.name)} ${project.version} ` +
        `[ID: ${project.id.substring(0, 8)}] ` +
        `${new Date(project.created_at).toLocaleDateString()}`
      );
    });
    console.log(chalk.gray(`Total: ${projects.length} projects`));
  } catch (error) {
    console.error(chalk.red('Failed to list projects:'), error);
  }
}

/**
 * Display project details
 */
async function showProjectDetail(projectId: string) {
  try {
    const project = await getProjectById(projectId);
    
    if (!project) {
      console.log(chalk.yellow(`Project with ID ${projectId} not found.`));
      return;
    }
    
    console.log(chalk.cyan('Project details:'));
    console.log(chalk.cyan(`ID: ${project.id}`));
    console.log(chalk.cyan(`Name: ${project.name}`));
    console.log(chalk.cyan(`Version: ${project.version}`));
    console.log(chalk.cyan(`Distribution: ${project.distro || 'N/A'}`));
    console.log(chalk.cyan(`Author: ${project.author || 'N/A'}`));
    console.log(chalk.cyan(`Description: ${project.description || 'N/A'}`));
    console.log(chalk.cyan(`Node version: ${project.node_version || 'N/A'}`));
    console.log(chalk.cyan(`Electron version: ${project.electron_version || 'N/A'}`));
    console.log(chalk.cyan(`Repository: ${project.repository || 'N/A'}`));
    console.log(chalk.cyan(`Main file: ${project.main_file || 'N/A'}`));
    console.log(chalk.cyan(`Status: ${project.is_active ? chalk.green('Active') : chalk.gray('Inactive')}`));
    console.log(chalk.cyan(`Created: ${new Date(project.created_at).toLocaleString()}`));
    console.log(chalk.cyan(`Updated: ${new Date(project.updated_at).toLocaleString()}`));
  } catch (error) {
    console.error(chalk.red('Failed to show project details:'), error);
  }
}

/**
 * Activate a project
 */
async function activateProject(projectId: string) {
  try {
    const success = await setActiveProject(projectId);
    
    if (!success) {
      console.log(chalk.yellow(`Project with ID ${projectId} not found.`));
      return;
    }
    
    const project = await getProjectById(projectId);
    if (project) {
      console.log(chalk.green(`Successfully set project "${project.name} ${project.version}" as active.`));
    }
  } catch (error) {
    console.error(chalk.red('Failed to activate project:'), error);
  }
}

/**
 * Delete a project
 */
async function removeProject(projectId: string) {
  try {
    // Get project info before deleting
    const project = await getProjectById(projectId);
    
    if (!project) {
      console.log(chalk.yellow(`Project with ID ${projectId} not found.`));
      return;
    }
    
    const result = await deleteProject(projectId);
    
    if (result) {
      console.log(chalk.green(`Successfully deleted project "${project.name} ${project.version}"`));
    } else {
      console.log(chalk.yellow(`Failed to delete project "${project.name} ${project.version}"`));
    }
  } catch (error) {
    console.error(chalk.red('Failed to delete project:'), error);
  }
}

/**
 * Create project from package.json
 */
async function createProjectFromPackageJson(packageJsonPath: string, isActive: boolean = true) {
  try {
    // Read package.json file
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageData = JSON.parse(packageJsonContent);

    // Extract important info
    const projectData = {
      name: packageData.name || 'Unknown',
      version: packageData.version || '0.0.0',
      distro: packageData.distro || '',
      author: typeof packageData.author === 'object' ? packageData.author.name : packageData.author || 'Unknown',
      description: packageData.description,
      node_version: packageData.engines?.node,
      electron_version: packageData.devDependencies?.electron,
      repository: typeof packageData.repository === 'object' ? packageData.repository.url : packageData.repository,
      main_file: packageData.main,
      is_active: isActive
    };
    
    // Save to file storage
    return await saveProject(projectData);
  } catch (error) {
    console.error('Failed to create project record:', error);
    throw error;
  }
}

/**
 * Initialize a project
 */
async function initProject(options: { packagePath: string; active: boolean }) {
  try {
    const packagePath = path.resolve(process.cwd(), options.packagePath);
    console.log(chalk.blue(`Initializing project from ${packagePath}...`));
    
    const project = await createProjectFromPackageJson(packagePath, options.active);
    
    console.log(chalk.green('Project initialization successful!'));
    console.log(chalk.cyan('Project information:'));
    console.log(chalk.cyan(`  Name: ${project.name}`));
    console.log(chalk.cyan(`  Version: ${project.version}`));
    console.log(chalk.cyan(`  Distribution: ${project.distro}`));
    console.log(chalk.cyan(`  Author: ${project.author}`));
    console.log(chalk.cyan(`  Node version: ${project.node_version || 'N/A'}`));
    console.log(chalk.cyan(`  Electron version: ${project.electron_version || 'N/A'}`));
    console.log(chalk.cyan(`  Main file: ${project.main_file || 'N/A'}`));
    console.log(chalk.cyan(`  Active status: ${project.is_active ? 'Yes' : 'No'}`));
    console.log(chalk.cyan(`  Project ID: ${project.id}`));
    console.log(chalk.cyan(`  Created: ${new Date(project.created_at).toLocaleString()}`));
  } catch (error) {
    console.error(chalk.red('Failed to initialize project:'), error);
    throw error;
  }
}

// Add subcommands to the project command
projectCommand
  .command('list')
  .description('List all projects')
  .action(listProjects);

projectCommand
  .command('show')
  .description('Show project details')
  .argument('<projectId>', 'Project ID')
  .action(showProjectDetail);

projectCommand
  .command('activate')
  .description('Set project as active')
  .argument('<projectId>', 'Project ID')
  .action(activateProject);

projectCommand
  .command('delete')
  .description('Delete a project')
  .argument('<projectId>', 'Project ID')
  .action(removeProject);

projectCommand
  .command('init')
  .description('Initialize project record from package.json file')
  .option('--packagePath <path>', 'Path to package.json file', 'package.json')
  .option('--active', 'Set project as active', true)
  .action(initProject);

// Add the project command as a subcommand of openAIBatchParallel
openAIBatchParallel.addCommand(projectCommand);