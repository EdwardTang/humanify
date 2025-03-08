/**
 * 数据库系统初始化脚本 (Database System Initialization Script)
 * 
 * 创建所有必要的目录和文件结构，安装依赖等
 * Create all necessary directories and file structures, install dependencies, etc.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';

/**
 * 安装依赖 (Install dependencies)
 */
function installDependencies(): void {
  console.log('安装依赖... (Installing dependencies...)');
  
  try {
    execSync('npm install knex better-sqlite3 uuid', { stdio: 'inherit' });
    console.log('依赖安装成功 (Dependencies installed successfully)');
  } catch (error) {
    console.error('安装依赖失败 (Failed to install dependencies)', error);
    throw error;
  }
}

/**
 * 创建目录 (Create directory)
 * @param {string} dirPath - 目录路径 (Directory path)
 */
async function createDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    console.log(`创建目录: ${dirPath} (Created directory: ${dirPath})`);
  } catch (error) {
    console.error(`创建目录失败: ${dirPath} (Failed to create directory: ${dirPath})`, error);
    throw error;
  }
}

/**
 * 创建必要的目录结构 (Create necessary directory structure)
 */
async function createDirectories(): Promise<void> {
  console.log('创建目录结构... (Creating directory structure...)');
  
  const dirs = [
    path.join(process.cwd(), 'temp'),
    path.join(process.cwd(), 'db-backup'),
    path.join(process.cwd(), 'humanified-cursor')
  ];
  
  for (const dir of dirs) {
    await createDirectory(dir);
  }
}

/**
 * 创建.env文件 (Create .env file)
 */
async function createEnvFile(): Promise<void> {
  console.log('创建.env文件... (Creating .env file...)');
  
  const envPath = path.join(process.cwd(), '.env');
  
  try {
    // 检查是否已存在 (Check if already exists)
    try {
      await fs.access(envPath);
      console.log('.env文件已存在，跳过创建 (.env file already exists, skipping creation)');
      return;
    } catch (error) {
      // 文件不存在，继续创建 (File does not exist, continue creation)
    }
    
    const envContent = `
# 数据库设置 (Database Settings)
DB_PATH=${path.join(process.cwd(), 'cursor-re.db')}
DB_DEBUG=false

# OpenAI API设置 (OpenAI API Settings)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4

# 处理设置 (Processing Settings)
MAX_PARALLEL_FILES=5
MAX_BATCH_SIZE=50
SMALL_FILE_THRESHOLD=10000
`;
    
    await fs.writeFile(envPath, envContent.trim());
    console.log(`创建.env文件: ${envPath} (Created .env file: ${envPath})`);
  } catch (error) {
    console.error(`创建.env文件失败: ${envPath} (Failed to create .env file: ${envPath})`, error);
    throw error;
  }
}

/**
 * 运行测试验证 (Run test validation)
 */
async function runTestValidation(): Promise<void> {
  console.log('运行测试验证... (Running test validation...)');
  
  try {
    // 初始化数据库 (Initialize database)
    console.log('\n--- 验证数据库初始化 (Validating database initialization) ---');
    execSync('node src/db-test.js', { stdio: 'inherit' });
    
    console.log('\n测试验证成功 (Test validation successful)');
  } catch (error) {
    console.error('测试验证失败 (Test validation failed)', error);
    throw error;
  }
}

/**
 * 初始化系统 (Initialize system)
 */
async function initialize(): Promise<void> {
  console.log('开始初始化数据库系统 (Starting database system initialization)');
  
  try {
    // 1. 安装依赖 (Install dependencies)
    installDependencies();
    
    // 2. 创建目录结构 (Create directory structure)
    await createDirectories();
    
    // 3. 创建.env文件 (Create .env file)
    await createEnvFile();
    
    // 4. 运行测试验证 (Run test validation)
    await runTestValidation();
    
    console.log('\n数据库系统初始化完成 (Database system initialization completed)');
    console.log('\n可以通过以下命令运行数据库集成工具 (You can run the database integration tool with the following command):');
    console.log('node src/integrate-db.js help');
  } catch (error) {
    console.error('初始化过程中出错 (Error during initialization):', error);
    process.exit(1);
  }
}

// 执行初始化 (Execute initialization)
initialize().catch(console.error); 