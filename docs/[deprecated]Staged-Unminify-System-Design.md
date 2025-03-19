This design is deprecated.!!!!!!!!

# 分阶段解混淆与重命名系统设计
# Staged Unminification and Renaming System Design

## 背景与目标

本设计文档旨在定义一个完整的系统，通过整合各个现有组件（`parallel-batch-rename.ts`, `openai-batch-parallel.ts`, `staged-humanify-db.ts`, `process-monitor.ts`, `large-file-chunker.ts`, `initialize-db-system.ts`, `extract-identifiers-worker.ts`等），创建一个端到端的解决方案，处理大型JavaScript代码库的解混淆、标识符重命名和代码美化工作。

该系统应具备以下核心能力：
- 分阶段处理大型代码库，避免内存溢出
- 利用数据库持久化处理状态和上下文
- 支持断点续传和增量处理
- 批量处理标识符重命名，提高效率
- 支持长时间运行的批处理作业
- 提供完整的监控、恢复和报告功能

## 1. 总体架构设计

系统采用分层架构，各组件职责明确，通过数据库协调工作：

```
┌─────────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  协调器 Controller  │────▶│ 任务队列 Queue    │────▶│ 工作器池 Worker Pool│
│  (staged-humanify)  │     │ (DB Integration)  │     │ (Parallel Process)  │
└─────────────────────┘     └───────────────────┘     └─────────────────────┘
          │                          │                          │
          ▼                          ▼                          ▼
┌─────────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  文件管理器         │     │ 标识符提取器      │     │ 批处理优化器        │
│  (File Manager)     │     │ (Extractor)       │     │ (BatchOptimizer)    │
└─────────────────────┘     └───────────────────┘     └─────────────────────┘
          │                          │                          │
          └──────────────────────────┼──────────────────────────┘
                                     ▼
                           ┌───────────────────┐
                           │ 数据库持久层      │
                           │ (Database Layer)  │
                           └───────────────────┘
                                     │
                                     ▼
                           ┌───────────────────┐
                           │ 监控与恢复系统    │
                           │ (Monitor/Recovery)│
                           └───────────────────┘
```

## 2. 端到端工作流程

完整的解混淆和重命名流程包含五个主要阶段：

```
┌─────────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  解混淆阶段         │────▶│ 标识符分析阶段    │────▶│ 标识符重命名阶段    │
│  (Unminify Phase)   │     │ (Identifier Phase) │     │ (Renaming Phase)    │
└─────────────────────┘     └───────────────────┘     └─────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  代码生成与美化     │◀────│ 合并与完整性检查  │◀────│ 数据库持久化       │
│  (Code Generation)  │     │ (Merge & Validate) │     │ (DB Persistence)    │
└─────────────────────┘     └───────────────────┘     └─────────────────────┘
```

1. **解混淆阶段**：使用WebCrack分解打包的JavaScript文件，提取模块
2. **标识符分析阶段**：分析提取的文件，识别需要重命名的标识符
3. **标识符重命名阶段**：使用批处理方式并行重命名标识符
4. **数据库持久化**：将处理状态和结果保存到数据库 MongoDB
5. **代码生成与美化**：应用重命名并格式化最终代码

## 3. 数据库模型设计

系统采用关系型数据库存储处理状态和中间结果，确保可靠性和持久性：

### 数据库表结构

```typescript
// 文件表：存储处理的文件信息
export interface File {
  id: string;                                           // 唯一标识符
  path: string;                                         // 文件路径
  file_name: string;                                     // 文件名
  file_type: string;                                     // 文件类型
  size: number;                                         // 文件大小
  status: 'pending' | 'processing' | 'completed' | 'failed'; // 处理状态
  category: 'small' | 'large' | 'ultra_large';          // 文件分类
  chunk_count?: number;                                 // 分块数量
  last_processing_time?: number;                             // 处理时间
  last_processing_error?: string;                                       // 错误消息
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id: string;                                    // 项目ID
}

// 文件块表：存储文件块信息
export interface Chunk {
  id: string;                                           // 唯一标识符
  file_id: string;                                      // 所属文件ID
  chunk_index: number;                                  // 块索引
  content: string;                                      // 块内容
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id: string;                                    // 项目ID
}

// 标识符表：存储需要重命名的标识符
export interface Identifier {
  id: string;                                           // 唯一标识符
  file_id: string;                                      // 所属文件ID
  chunk_id?: string;                                     // 所属块ID
  original_name: string;                                // 原始名称
  new_name?: string;                                    // 新名称
  surrounding_code: string;                             // 上下文代码
  status: 'pending' | 'processing' | 'completed' | 'failed'; // 处理状态
  custom_id: string;                                    // 自定义标识符
  batch_id?: string;                                    // 所属批次ID
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id: string;                                    // 项目ID
}

// 处理运行表：存储整体处理进度
export interface ProcessingRun {
  id: string;                                           // 唯一标识符
  status: 'running' | 'completed' | 'failed';           // 处理状态
  config: string;                                       // 配置信息
  total_files: number;                                  // 总文件数
  processed_files: number;                              // 已处理文件数
  failed_files: number;                                 // 失败文件数
  start_time: Date;                                     // 开始时间
  end_time?: Date;                                      // 结束时间
  error?: string;                                       // 错误消息
  project_id: string;                                    // 项目ID
}

// 性能指标表：存储处理性能数据
export interface PerformanceMetric {
  id: number;                                           // 唯一标识符
  run_id: string;                                       // 关联的处理运行ID
  metric_name: string;                                  // 指标名称
  value: number;                                        // 指标值
  unit: string;                                         // 单位
  metadata?: Record<string, any>;                       // 元数据
  created_at: Date;                                     // 创建时间
  project_id: string;                                    // 项目ID
}

// OpenAI批处理接口：存储OpenAI Batch API返回的完整信息
export interface OpenAIBatch {
  id: string;                                           // OpenAI批处理ID (如 batch_67c94f8606dc8190bfdcb2e18aac53a8)
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled'; // OpenAI批处理状态
  created_at: Date;                                     // 创建时间
  endpoint: string;                                     // API端点 (如 /v1/chat/completions)
  completion_window: string;                            // 完成窗口 (如 24h)
  completion_time?: string;                             // 完成时间 (如 26 minutes)
  total_requests: number;                               // 总请求数
  completed_requests: number;                           // 完成的请求数
  failed_requests: number;                              // 失败的请求数
  input_file_id: string;                                // 输入文件ID
  input_file_path: string;                              // 输入文件路径 (如 batch_tasks_38001344.jsonl)
  output_file_id?: string;                              // 输出文件ID
  output_file_path?: string;                            // 输出文件路径 (如 batch_67c94f8606dc8190bfdcb2e18aac53a8_output.jsonl)
  error_file_path?: string;                             // 错误文件路径
  events: BatchEvent[];                                 // 批处理事件列表
  error?: string;                                       // 错误信息
  project_id: string;                                    // 项目ID
}

// 批处理事件接口：存储批处理生命周期中的事件
export interface BatchEvent {
  timestamp: Date;                                      // 事件时间戳
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled'; // 事件状态
  details?: string;                                     // 事件详情
}

// 批处理请求接口：存储单个批处理请求信息
export interface BatchRequest {
  custom_id: string;                                    // 自定义ID，用于关联标识符
  method: string;                                       // HTTP方法 (通常为 "POST")
  url: string;                                          // API端点URL (如 "/v1/chat/completions")
  body: any;                                            // 请求体，包含模型、消息等
  openai_batch_id: string;                              // OpenAI批处理ID
  project_id: string;                                    // 项目ID
}

// 批处理响应接口：存储单个批处理响应信息
export interface BatchResponse {
  id: string;                                           // 批处理请求ID
  custom_id: string;                                    // 自定义ID，用于关联请求和标识符
  response: {                                           // 响应对象
    status_code: number;                                // HTTP状态码
    request_id: string;                                 // 请求ID
    body: any;                                          // 响应体，包含模型生成的内容
    error?: any;                                        // 错误信息
  };
  openai_batch_id: string;                              // OpenAI批处理ID
}

// 本地批处理跟踪接口：连接内部批处理处理与OpenAI批处理
export interface LocalBatchTracker {
  id: string;                                           // 本地唯一标识符
  openai_batch_id: string;                              // OpenAI批处理ID
  type: 'small' | 'large' | 'ultra_large';              // 批次类型
  file_ids: string[];                                   // 包含的文件ID列表
  identifier_count: number;                             // 标识符数量
  tasks_file_path: string;                              // 任务文件路径
  output_file_path?: string;                            // 输出文件路径
  processing_run_id: string;                            // 处理运行ID
  processing_start: Date;                               // 处理开始时间
  processing_end?: Date;                                // 处理结束时间
  status: 'preparing' | 'submitting' | 'processing' | 'downloading' | 'applying' | 'completed' | 'failed'; // 本地处理状态
  error?: string;                                       // 错误信息
  created_at: Date;                                     // 创建时间
  updated_at: Date;                                     // 更新时间
  project_id: string;                                    // 项目ID
}
```

## 4. 核心组件设计

### 4.1 文件管理器 (File Manager)

负责文件分类、大型文件分块和输出管理：

```typescript
export class FileManager extends EventEmitter {
  // 设置项
  private sourceDir: string;
  private outputDir: string;
  private filePattern: string;
  private excludePatterns: string[];
  private largeFileSizeThreshold: number;
  private ultraLargeFileSizeThreshold: number;
  
  // 主要方法
  async findMatchingFiles(): Promise<any[]> // 查找匹配的文件
  async chunkLargeFile(filePath: string, chunkSize: number): Promise<any> // 将大文件分块
  async applyRenamesToFile(filePath: string, identifiers: any[]): Promise<boolean> // 应用重命名
}
```

### 4.2 标识符提取器 (Parallel Extractor)

并行提取文件中的标识符：

```typescript
export class ParallelExtractor extends EventEmitter {
  // 设置项
  private concurrency: number;
  private runId: string;
  private workers: Worker[];
  private queue: Queue;
  
  // 主要方法
  async extractIdentifiers(file: any): Promise<any> // 提取文件中的标识符
  async processFile(file: any): Promise<any> // 处理单个文件
  shutdown(): void // 关闭工作器池
}
```

### 4.3 批处理优化器 (Batch Optimizer)

优化标识符批处理，减少API调用：

```typescript
export class BatchOptimizer extends EventEmitter {
  // 设置项
  private apiKey: string;
  private baseURL: string;
  private batchSize: number;
  private outputDir: string;
  private runId: string;
  
  // 主要方法
  async processBatch(batchId: string, model: string): Promise<any> // 处理批次
  async submitBatchJob(batchId: string, identifiers: any[], model: string): Promise<any> // 提交批处理作业
  private toRenamePrompt(name: string, surroundingCode: string, model: string): any // 创建提示
}
```

### 4.4 批处理轮询服务 (Batch Polling Service)

管理长时间运行的批处理作业：

```typescript
export class BatchPollingService extends EventEmitter {
  // 设置项
  private apiKey: string;
  private baseURL: string;
  private outputDir: string;
  private initialPollingInterval: number;
  private maxPollingInterval: number;
  private pollingBackoffFactor: number;
  private runId: string;
  private isRunning: boolean;
  private currentPollingInterval: number;
  
  // 主要方法
  async start(): Promise<void> // 开始轮询服务
  async stop(): Promise<void> // 停止轮询服务
  private async poll(): Promise<void> // 轮询批处理作业
  private async checkJobStatus(job: any): Promise<any> // 检查作业状态
  private async handleCompletedJob(job: any, result: any): Promise<void> // 处理完成的作业
}
```

## 5. 端到端流程实现

### 5.1 完整系统入口 (Full Cycle Unminify)

```typescript
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
}

export async function fullCycleUnminify(options: FullCycleOptions) {
  // 1. 初始化数据库和运行记录
  await dbHelpers.initializeDatabase();
  const runId = uuidv4();
  await dbHelpers.startProcessingRun(JSON.stringify(options), 1);
  
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
      await codeGenerationPhase(options.outputDir, runId);
    }
    
    // 6. 完成处理运行
    const totalTime = (Date.now() - startTime) / 1000;
    await dbHelpers.completeProcessingRun(runId, { status: 'completed' });
    
    console.log(`\n✅ 全周期处理完成！总耗时: ${formatTime(totalTime)}`);
    return { success: true, runId, fileCount: extractedFiles.length };
  } catch (error) {
    console.error(`\n❌ 处理过程中出错:`, error);
    await dbHelpers.completeProcessingRun(runId, { status: 'failed', error: error.message });
    throw error;
  }
}
```

### 5.2 各阶段具体实现

```typescript
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
    outputDir: options.tempDir || path.join(options.outputDir, 'temp')
  });
  
  // 将提取的文件注册到数据库
  console.log(`注册 ${extractedFiles.length} 个文件到数据库`);
  const fileObjects = extractedFiles.map(file => ({
    path: file.path,
    size: file.size || 0
  }));
  
  await dbHelpers.syncFilesToDatabase(fileObjects);
  
  // 获取待处理文件
  const pendingFiles = await dbHelpers.getPendingFilesByCategory();
  
  // 配置标识符提取器
  const extractor = new ParallelExtractor(
    options.concurrency || 4,
    runId
  );
  
  // 分别处理小、大、超大文件
  await processFilesByCategory(pendingFiles.files, extractor, fileManager, runId);
  
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
    runId
  });
  
  // 创建批次
  const identifiersResult = await dbHelpers.getIdentifiersForBatching(
    options.batchSize || 25,
    options.skipCompleted !== false
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
      const result = await optimizer.processBatch(batch.id, options.model || 'gpt-4o-mini');
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
    runId
  });
  
  // 创建批次
  const identifiersResult = await dbHelpers.getIdentifiersForBatching(
    options.batchSize || 25,
    options.skipCompleted !== false
  );
  
  if (identifiersResult.batches.length === 0) {
    console.log(`⚠️ 没有需要处理的标识符批次`);
    return;
  }
  
  // 提交每个批次
  for (let i = 0; i < identifiersResult.batches.length; i++) {
    const batch = identifiersResult.batches[i];
    console.log(`\n提交批次 ${i + 1}/${identifiersResult.batches.length}, ID: ${batch.id}`);
    
    try {
      const result = await optimizer.submitBatchJob(batch.id, batch.identifiers, options.model || 'gpt-4o-mini');
      console.log(`✅ 批次 ${i + 1} 已提交, 作业ID: ${result.jobId}`);
      
      // 创建批处理作业记录
      await dbHelpers.createBatchJob(batch.id, result.jobId);
    } catch (error) {
      console.error(`❌ 批次提交失败:`, error);
    }
  }
  
  console.log(`✅ 批处理作业已全部提交，使用以下命令监控状态:`);
  console.log(`   humanify batch-polling --runId ${runId} --apiKey ${options.apiKey}`);
}

/**
 * 阶段4: 代码生成与美化
 */
async function codeGenerationPhase(outputDir: string, runId: string): Promise<void> {
  // 获取所有已处理的文件
  const filesResult = await dbHelpers.getProcessedFilesByRunId(runId);
  
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
      const identifiersResult = await dbHelpers.getFileIdentifiers(file.id);
      
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
        formattedCode = await formatWithPrettier(newCode);
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
```

## 6. 命令行界面设计

### 6.1 标准处理命令

```typescript
const fullCycleCommand = new Command('full-cycle')
  .description('执行端到端的解混淆和重命名流程')
  .requiredOption('--sourceFile <file>', '源JavaScript打包文件')
  .requiredOption('--outputDir <dir>', '输出目录')
  .requiredOption('--apiKey <key>', 'OpenAI API密钥')
  .option('--tempDir <dir>', '临时目录')
  .option('--baseURL <url>', 'OpenAI API基础URL')
  .option('--model <name>', '模型名称', 'gpt-4o-mini')
  .option('--batchSize <size>', '批处理大小', '25')
  .option('--concurrency <count>', '并发数', '4')
  .option('--skipCompleted', '跳过已完成的标识符', false)
  .option('--noCache', '禁用缓存', false)
  .action(async (opts) => {
    try {
      const options = {
        sourceFile: opts.sourceFile,
        outputDir: opts.outputDir,
        tempDir: opts.tempDir,
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
        model: opts.model,
        batchSize: parseInt(opts.batchSize),
        concurrency: parseInt(opts.concurrency),
        cacheResults: !opts.noCache,
        skipCompleted: opts.skipCompleted
      };
      
      await fullCycleUnminify(options);
    } catch (error) {
      console.error(`执行失败:`, error);
      process.exit(1);
    }
  });
```

### 6.2 长时间运行批处理命令

```typescript
const fullCycleLongRunningCommand = new Command('full-cycle-long-running')
  .description('执行支持长时间批处理的端到端流程')
  .requiredOption('--sourceFile <file>', '源JavaScript打包文件')
  .requiredOption('--outputDir <dir>', '输出目录')
  .requiredOption('--apiKey <key>', 'OpenAI API密钥')
  .option('--tempDir <dir>', '临时目录')
  .option('--baseURL <url>', 'OpenAI API基础URL')
  .option('--model <name>', '模型名称', 'gpt-4o-mini')
  .option('--batchSize <size>', '批处理大小', '25')
  .option('--concurrency <count>', '并发数', '4')
  .option('--skipCompleted', '跳过已完成的标识符', false)
  .option('--noCache', '禁用缓存', false)
  .action(async (opts) => {
    try {
      const options = {
        sourceFile: opts.sourceFile,
        outputDir: opts.outputDir,
        tempDir: opts.tempDir,
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
        model: opts.model,
        batchSize: parseInt(opts.batchSize),
        concurrency: parseInt(opts.concurrency),
        cacheResults: !opts.noCache,
        skipCompleted: opts.skipCompleted,
        longRunning: true
      };
      
      const result = await fullCycleUnminify(options);
      console.log(`\n运行ID: ${result.runId}`);
      console.log(`使用以下命令监控批处理状态:`);
      console.log(`humanify batch-polling --runId ${result.runId} --apiKey ${opts.apiKey}`);
    } catch (error) {
      console.error(`执行失败:`, error);
      process.exit(1);
    }
  });
```

### 6.3 批处理轮询命令

```typescript
const batchPollingCommand = new Command('batch-polling')
  .description('启动批处理轮询服务，监控批处理作业状态')
  .requiredOption('--runId <id>', '处理运行ID')
  .requiredOption('--apiKey <key>', 'OpenAI API密钥')
  .option('--baseURL <url>', 'OpenAI基础URL', 'https://api.openai.com/v1')
  .option('--outputDir <dir>', '输出目录', 'batch_results')
  .option('--initialInterval <ms>', '初始轮询间隔（毫秒）', '60000')
  .option('--maxInterval <ms>', '最大轮询间隔（毫秒）', '3600000')
  .option('--backoffFactor <factor>', '轮询间隔增长因子', '1.5')
  .option('--verbose', '显示详细输出', false)
  .action(async (opts) => {
    // 实现批处理轮询逻辑
    // ...
  });
```

### 6.4 应用重命名命令

```typescript
const applyRenamesCommand = new Command('apply-renames')
  .description('将批处理结果应用到代码文件')
  .requiredOption('--runId <id>', '处理运行ID')
  .requiredOption('--outputDir <dir>', '输出目录')
  .option('--pretty', '使用Prettier格式化代码', true)
  .action(async (opts) => {
    try {
      await codeGenerationPhase(opts.outputDir, opts.runId);
    } catch (error) {
      console.error(`应用重命名失败:`, error);
      process.exit(1);
    }
  });
```

## 7. 系统优势与特点

整合后的系统具有以下主要优势：

1. **自适应资源管理**
   - 根据文件大小分类处理，避免内存溢出
   - 自动调整并发度和批处理大小
   - 大型文件自动分块处理

2. **高效批处理**
   - 使用OpenAI批处理API减少请求数量
   - 优化提示词，一次处理多个标识符
   - 缓存相似标识符的结果，避免重复请求

3. **可靠性保障**
   - 数据库持久化所有状态和结果
   - 支持断点续传和增量处理
   - 完善的错误处理和恢复机制

4. **灵活处理模式**
   - 支持标准处理模式（单次运行完成）
   - 支持长时间运行模式（批处理作业+轮询）
   - 分离式轮询，允许主程序退出

5. **完整监控与报告**
   - 详细的进度和性能指标
   - 全面的错误和警告信息
   - 生成处理摘要和统计报告

## 8. 系统扩展性与未来优化

本系统设计为可扩展的架构，未来可以继续优化：

1. **扩展插件系统**
   - 添加更多代码转换和美化插件
   - 支持自定义标识符提取规则
   - 集成代码质量检查工具

2. **增强批处理能力**
   - 支持更多的LLM提供商
   - 优化提示词和上下文窗口大小
   - 实现更智能的批次调度算法

3. **改进界面与可视化**
   - 添加Web界面，监控处理进度
   - 提供可视化的代码对比工具
   - 实现交互式重命名审核界面

4. **性能优化**
   - 引入更高效的AST解析方法
   - 优化数据库查询和索引
   - 支持分布式处理大型代码库

通过数据库持久化和模块化设计，系统能够可靠地处理大型JavaScript代码库的解混淆和重命名任务，即使在需要长时间处理的情况下也能保持稳定性和可靠性。
