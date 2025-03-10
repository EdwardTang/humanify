import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// 获取当前文件的目录路径（在 ESM 中替代 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 设置环境变量
process.env.NODE_ENV = 'test';

// 测试配置
const config = {
  // 要运行的测试文件或目录
  testPaths: [
    './tests/unit/file-store.test.ts',
    './tests/unit/full-cycle-unminify.test.ts',
    './tests/unit/cli-options.test.ts',
    // 添加其他测试文件
  ],
  // 是否运行所有测试
  runAll: false,
  // 是否输出详细信息
  verbose: true,
  // 是否显示覆盖率报告
  coverage: false
};

// 解析命令行参数
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--all' || arg === '-a') {
    config.runAll = true;
  } else if (arg === '--verbose' || arg === '-v') {
    config.verbose = true;
  } else if (arg === '--coverage' || arg === '-c') {
    config.coverage = true;
  } else if (arg === '--file' || arg === '-f') {
    if (i + 1 < args.length) {
      config.testPaths = [args[++i]];
    }
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
使用方法: node tests/run-tests.js [选项]

选项:
  --all, -a          运行所有测试
  --verbose, -v      显示详细输出
  --coverage, -c     生成测试覆盖率报告
  --file, -f <path>  运行指定的测试文件
  --help, -h         显示帮助信息
    `);
    process.exit(0);
  }
}

// 如果选择运行所有测试，则扫描测试目录
if (config.runAll) {
  const testDir = path.join(__dirname, 'unit');
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    config.testPaths = files
      .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.js'))
      .map(file => path.join('./tests/unit', file));
  }
}

// 构建Jest命令
let command = 'npx jest';

// 添加测试路径
if (config.testPaths.length > 0) {
  command += ` ${config.testPaths.join(' ')}`;
}

// 添加其他选项
if (config.verbose) {
  command += ' --verbose';
}

if (config.coverage) {
  command += ' --coverage';
}

// 运行测试
console.log(`执行测试命令: ${command}`);
try {
  execSync(command, { stdio: 'inherit' });
  console.log('✅ 测试执行完成');
} catch (error) {
  console.error('❌ 测试执行失败');
  process.exit(1);
} 