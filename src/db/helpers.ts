import mongoose, { Types } from 'mongoose';
import { 
  IFile, 
  File, 
  IIdentifier, 
  Identifier, 
  IProcessingRun, 
  ProcessingRun,
  IOpenAIBatch,
  OpenAIBatch,
  ILocalBatchTracker,
  LocalBatchTracker,
  IBatchRequest,
  BatchRequest,
  IBatchResponse,
  BatchResponse
} from './models.js';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

/**
 * 将文件信息同步到数据库
 * @param files 文件对象数组，包含路径和大小
 * @param projectId 项目ID
 * @returns 同步的文件对象
 */
export async function syncFilesToDatabase(
  files: Array<{ path: string; size: number }>, 
  projectId: string = 'default'
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    
    // 处理每个文件
    for (const fileInfo of files) {
      const filePath = fileInfo.path;
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase().replace('.', '');
      const fileSize = fileInfo.size;
      
      // 根据文件大小分类
      let category: 'small' | 'large' | 'ultra_large';
      if (fileSize < 50 * 1024) { // 小于50KB
        category = 'small';
      } else if (fileSize < 500 * 1024) { // 小于500KB
        category = 'large';
      } else {
        category = 'ultra_large';
      }
      
      // 使用upsert更新或创建文件记录
      const file = await File.findOneAndUpdate(
        { path: filePath, project_id: projectId },
        {
          file_name: fileName,
          file_type: fileExt,
          size: fileSize,
          category,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
          project_id: projectId
        },
        { upsert: true, new: true }
      );
      
      count++;
    }
    
    return { success: true, count };
  } catch (error) {
    console.error('同步文件到数据库失败:', error);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * 获取按类别分组的待处理文件
 * @param projectId 项目ID
 * @returns 分组的文件对象
 */
export async function getPendingFilesByCategory(
  projectId: string = 'default'
): Promise<{ 
  success: boolean; 
  files?: { 
    small: IFile[]; 
    large: IFile[]; 
    ultra_large: IFile[]; 
  }; 
  error?: string 
}> {
  try {
    // 获取状态为pending的文件
    const pendingFiles = await File.find({ 
      status: 'pending', 
      project_id: projectId 
    }).sort({ size: 1 });
    
    // 按类别分组
    const small = pendingFiles.filter(file => file.category === 'small');
    const large = pendingFiles.filter(file => file.category === 'large');
    const ultra_large = pendingFiles.filter(file => file.category === 'ultra_large');
    
    return { 
      success: true, 
      files: { small, large, ultra_large } 
    };
  } catch (error) {
    console.error('获取待处理文件失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新文件状态
 * @param fileId 文件ID
 * @param status 新状态
 * @param errorMessage 可选的错误消息
 */
export async function updateFileStatus(
  fileId: string, 
  status: 'pending' | 'processing' | 'completed' | 'failed',
  processingTime?: number,
  errorMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: any = { 
      status, 
      updated_at: new Date() 
    };
    
    if (processingTime !== undefined) {
      updateData.last_processing_time = processingTime;
    }
    
    if (errorMessage) {
      updateData.last_processing_error = errorMessage;
    }
    
    await File.findByIdAndUpdate(fileId, updateData);
    return { success: true };
  } catch (error) {
    console.error(`更新文件状态失败 [ID: ${fileId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 创建标识符记录
 * @param identifiers 标识符对象数组
 * @param fileId 文件ID
 * @param projectId 项目ID
 */
export async function createIdentifiers(
  identifiers: Array<{
    original_name: string;
    surrounding_code: string;
    custom_id: string;
  }>,
  fileId: string,
  chunkId?: string,
  projectId: string = 'default'
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (!identifiers.length) {
      return { success: true, count: 0 };
    }
    
    const now = new Date();
    const identifierDocs = identifiers.map(identifier => ({
      file_id: new Types.ObjectId(fileId),
      chunk_id: chunkId ? new Types.ObjectId(chunkId) : undefined,
      original_name: identifier.original_name,
      surrounding_code: identifier.surrounding_code,
      status: 'pending',
      custom_id: identifier.custom_id,
      created_at: now,
      updated_at: now,
      project_id: projectId
    }));
    
    const result = await Identifier.insertMany(identifierDocs);
    return { success: true, count: result.length };
  } catch (error) {
    console.error(`创建标识符记录失败 [FileID: ${fileId}]:`, error);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * 获取用于批处理的标识符
 * @param batchSize 批处理大小
 * @param skipCompleted 是否跳过已完成的
 * @param projectId 项目ID
 */
export async function getIdentifiersForBatching(
  batchSize: number = 25,
  skipCompleted: boolean = true,
  projectId: string = 'default'
): Promise<{
  success: boolean;
  batches: Array<{
    id: string;
    identifiers: IIdentifier[];
  }>;
  error?: string;
}> {
  try {
    // 查询条件
    const query: any = { project_id: projectId };
    if (skipCompleted) {
      query.status = 'pending';
    }
    
    // 获取标识符
    const identifiers = await Identifier.find(query)
      .populate('file_id')
      .limit(batchSize * 10) // 获取足够多的标识符以创建多个批次
      .exec();
    
    if (!identifiers.length) {
      return { success: true, batches: [] };
    }
    
    // 按照文件ID分组
    const identifiersByFile: Record<string, IIdentifier[]> = {};
    for (const identifier of identifiers) {
      const fileId = identifier.file_id.toString();
      if (!identifiersByFile[fileId]) {
        identifiersByFile[fileId] = [];
      }
      identifiersByFile[fileId].push(identifier);
    }
    
    // 创建批次
    const batches: Array<{ id: string; identifiers: IIdentifier[] }> = [];
    let currentBatch: IIdentifier[] = [];
    let currentBatchSize = 0;
    
    // 优先处理小文件
    const fileIds = Object.keys(identifiersByFile);
    fileIds.sort((a, b) => {
      const sizeA = identifiersByFile[a].length;
      const sizeB = identifiersByFile[b].length;
      return sizeA - sizeB;
    });
    
    for (const fileId of fileIds) {
      const fileIdentifiers = identifiersByFile[fileId];
      
      // 如果当前文件的标识符加上现有批次会超过batchSize
      // 且当前批次不为空，则完成当前批次
      if (currentBatchSize > 0 && currentBatchSize + fileIdentifiers.length > batchSize) {
        batches.push({
          id: uuidv4(),
          identifiers: currentBatch
        });
        currentBatch = [];
        currentBatchSize = 0;
      }
      
      // 如果单个文件的标识符数量超过batchSize
      if (fileIdentifiers.length > batchSize) {
        // 将大文件分成多个批次
        for (let i = 0; i < fileIdentifiers.length; i += batchSize) {
          const batchChunk = fileIdentifiers.slice(i, i + batchSize);
          batches.push({
            id: uuidv4(),
            identifiers: batchChunk
          });
        }
      } else {
        // 添加到当前批次
        currentBatch = currentBatch.concat(fileIdentifiers);
        currentBatchSize += fileIdentifiers.length;
        
        // 如果达到batchSize，完成当前批次
        if (currentBatchSize >= batchSize) {
          batches.push({
            id: uuidv4(),
            identifiers: currentBatch
          });
          currentBatch = [];
          currentBatchSize = 0;
        }
      }
    }
    
    // 如果还有剩余的标识符，创建最后一个批次
    if (currentBatchSize > 0) {
      batches.push({
        id: uuidv4(),
        identifiers: currentBatch
      });
    }
    
    return { success: true, batches };
  } catch (error) {
    console.error('获取批处理标识符失败:', error);
    return { success: false, batches: [], error: error.message };
  }
}

/**
 * 更新标识符的名称和状态
 * @param identifierId 标识符ID
 * @param newName 新名称
 * @param status 新状态
 */
export async function updateIdentifier(
  identifierId: string,
  newName: string,
  status: 'completed' | 'failed' = 'completed'
): Promise<{ success: boolean; error?: string }> {
  try {
    await Identifier.findByIdAndUpdate(identifierId, {
      new_name: newName,
      status,
      updated_at: new Date()
    });
    return { success: true };
  } catch (error) {
    console.error(`更新标识符失败 [ID: ${identifierId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 批量更新标识符
 * @param updates 更新对象数组，包含ID和新名称
 */
export async function bulkUpdateIdentifiers(
  updates: Array<{ id: string; newName: string; status?: 'completed' | 'failed' }>
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const operations = updates.map(update => ({
      updateOne: {
        filter: { _id: update.id },
        update: { 
          new_name: update.newName, 
          status: update.status || 'completed',
          updated_at: new Date()
        }
      }
    }));
    
    const result = await Identifier.bulkWrite(operations);
    return { success: true, count: result.modifiedCount };
  } catch (error) {
    console.error('批量更新标识符失败:', error);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * 获取文件的所有标识符
 * @param fileId 文件ID
 */
export async function getFileIdentifiers(
  fileId: string
): Promise<{ success: boolean; identifiers: IIdentifier[]; error?: string }> {
  try {
    const identifiers = await Identifier.find({ file_id: fileId });
    return { success: true, identifiers };
  } catch (error) {
    console.error(`获取文件标识符失败 [FileID: ${fileId}]:`, error);
    return { success: false, identifiers: [], error: error.message };
  }
}

/**
 * 开始处理运行
 * @param config 配置信息
 * @param totalFiles 总文件数
 * @param projectId 项目ID
 */
export async function startProcessingRun(
  config: string,
  totalFiles: number,
  projectId: string = 'default'
): Promise<{ success: boolean; runId?: string; error?: string }> {
  try {
    const processingRun = new ProcessingRun({
      status: 'running',
      config,
      total_files: totalFiles,
      processed_files: 0,
      failed_files: 0,
      start_time: new Date(),
      project_id: projectId
    });
    
    await processingRun.save();
    return { success: true, runId: processingRun._id.toString() };
  } catch (error) {
    console.error('开始处理运行失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 完成处理运行
 * @param runId 运行ID
 * @param data 更新数据
 */
export async function completeProcessingRun(
  runId: string,
  data: {
    status: 'completed' | 'failed';
    error?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await ProcessingRun.findByIdAndUpdate(runId, {
      status: data.status,
      end_time: new Date(),
      error: data.error,
      updated_at: new Date()
    });
    return { success: true };
  } catch (error) {
    console.error(`完成处理运行失败 [RunID: ${runId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新处理运行进度
 * @param runId 运行ID
 * @param processedFiles 已处理文件数
 * @param failedFiles 失败文件数
 */
export async function updateProcessingRunProgress(
  runId: string,
  processedFiles: number,
  failedFiles: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await ProcessingRun.findByIdAndUpdate(runId, {
      processed_files: processedFiles,
      failed_files: failedFiles,
      updated_at: new Date()
    });
    return { success: true };
  } catch (error) {
    console.error(`更新处理运行进度失败 [RunID: ${runId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取处理运行信息
 * @param runId 运行ID
 */
export async function getProcessingRun(
  runId: string
): Promise<{ success: boolean; run?: IProcessingRun; error?: string }> {
  try {
    const run = await ProcessingRun.findById(runId);
    if (!run) {
      return { success: false, error: '处理运行不存在' };
    }
    return { success: true, run };
  } catch (error) {
    console.error(`获取处理运行失败 [RunID: ${runId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取按运行ID分组的已处理文件
 * @param runId 运行ID
 */
export async function getProcessedFilesByRunId(
  runId: string
): Promise<{ success: boolean; files: IFile[]; error?: string }> {
  try {
    // 获取该运行的处理配置
    const run = await ProcessingRun.findById(runId);
    if (!run) {
      return { success: false, files: [], error: '处理运行不存在' };
    }
    
    // 获取该项目的已处理文件
    const files = await File.find({
      project_id: run.project_id,
      status: 'completed'
    });
    
    return { success: true, files };
  } catch (error) {
    console.error(`获取已处理文件失败 [RunID: ${runId}]:`, error);
    return { success: false, files: [], error: error.message };
  }
}

/**
 * 创建OpenAI批处理作业记录
 * @param batchId 批次ID
 * @param jobId 作业ID
 * @param projectId 项目ID
 */
export async function createBatchJob(
  batchId: string,
  jobId: string,
  inputFilePath: string,
  totalRequests: number = 0,
  projectId: string = 'default'
): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date();
    const batch = new OpenAIBatch({
      batch_id: jobId,
      status: 'created',
      created_at: now,
      endpoint: 'https://api.openai.com/v1/batches',
      completion_window: '24h',
      total_requests: totalRequests,
      completed_requests: 0,
      failed_requests: 0,
      input_file_id: batchId,
      input_file_path: inputFilePath,
      events: [
        {
          timestamp: now,
          status: 'created',
          details: `已创建批处理作业，ID: ${jobId}`
        }
      ],
      project_id: projectId
    });
    
    await batch.save();
    return { success: true };
  } catch (error) {
    console.error(`创建批处理作业失败 [BatchID: ${batchId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新OpenAI批处理作业状态
 * @param jobId 作业ID
 * @param status 新状态
 * @param details 详细信息
 */
export async function updateBatchJobStatus(
  jobId: string,
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled',
  details?: string,
  outputFilePath?: string,
  errorMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const batch = await OpenAIBatch.findOne({ batch_id: jobId });
    if (!batch) {
      return { success: false, error: '批处理作业不存在' };
    }
    
    const update: any = {
      status,
      events: [
        ...batch.events,
        {
          timestamp: new Date(),
          status,
          details: details || `状态更新为: ${status}`
        }
      ]
    };
    
    if (status === 'completed' && outputFilePath) {
      update.output_file_path = outputFilePath;
      update.completion_time = new Date().toISOString();
    }
    
    if (status === 'failed' && errorMessage) {
      update.error = errorMessage;
    }
    
    await OpenAIBatch.findOneAndUpdate(
      { batch_id: jobId },
      update
    );
    
    return { success: true };
  } catch (error) {
    console.error(`更新批处理作业状态失败 [JobID: ${jobId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取待处理的OpenAI批处理作业
 * @param projectId 项目ID
 */
export async function getPendingBatchJobs(
  projectId: string = 'default'
): Promise<{ success: boolean; jobs: IOpenAIBatch[]; error?: string }> {
  try {
    const pendingJobs = await OpenAIBatch.find({
      project_id: projectId,
      status: { $in: ['created', 'in_progress'] }
    });
    
    return { success: true, jobs: pendingJobs };
  } catch (error) {
    console.error('获取待处理批处理作业失败:', error);
    return { success: false, jobs: [], error: error.message };
  }
}

/**
 * 创建本地批处理跟踪记录
 * @param openAIBatchId OpenAI批处理ID
 * @param fileIds 文件ID数组
 * @param identifierCount 标识符数量
 * @param tasksFilePath 任务文件路径
 * @param processingRunId 处理运行ID
 * @param projectId 项目ID
 */
export async function createLocalBatchTracker(
  openAIBatchId: string,
  type: 'small' | 'large' | 'ultra_large',
  fileIds: string[],
  identifierCount: number,
  tasksFilePath: string,
  processingRunId: string,
  projectId: string = 'default'
): Promise<{ success: boolean; trackerId?: string; error?: string }> {
  try {
    const tracker = new LocalBatchTracker({
      openai_batch_id: openAIBatchId,
      type,
      file_ids: fileIds.map(id => new Types.ObjectId(id)),
      identifier_count: identifierCount,
      tasks_file_path: tasksFilePath,
      processing_run_id: new Types.ObjectId(processingRunId),
      processing_start: new Date(),
      status: 'preparing',
      created_at: new Date(),
      updated_at: new Date(),
      project_id: projectId
    });
    
    await tracker.save();
    return { success: true, trackerId: tracker._id.toString() };
  } catch (error) {
    console.error(`创建本地批处理跟踪记录失败 [BatchID: ${openAIBatchId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新本地批处理跟踪记录
 * @param trackerId 跟踪记录ID
 * @param status 新状态
 * @param outputFilePath 输出文件路径
 * @param errorMessage 错误消息
 */
export async function updateLocalBatchTracker(
  trackerId: string,
  status: 'preparing' | 'submitting' | 'processing' | 'downloading' | 'applying' | 'completed' | 'failed',
  outputFilePath?: string,
  errorMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const update: any = {
      status,
      updated_at: new Date()
    };
    
    if (status === 'completed' || status === 'failed') {
      update.processing_end = new Date();
    }
    
    if (outputFilePath) {
      update.output_file_path = outputFilePath;
    }
    
    if (errorMessage) {
      update.error = errorMessage;
    }
    
    await LocalBatchTracker.findByIdAndUpdate(trackerId, update);
    return { success: true };
  } catch (error) {
    console.error(`更新本地批处理跟踪记录失败 [TrackerID: ${trackerId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取本地批处理跟踪记录
 * @param openAIBatchId OpenAI批处理ID
 */
export async function getLocalBatchTracker(
  openAIBatchId: string
): Promise<{ success: boolean; tracker?: ILocalBatchTracker; error?: string }> {
  try {
    const tracker = await LocalBatchTracker.findOne({ openai_batch_id: openAIBatchId });
    if (!tracker) {
      return { success: false, error: '本地批处理跟踪记录不存在' };
    }
    
    return { success: true, tracker };
  } catch (error) {
    console.error(`获取本地批处理跟踪记录失败 [BatchID: ${openAIBatchId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 保存批处理请求
 * @param customId 自定义ID
 * @param method 请求方法
 * @param url 请求URL
 * @param body 请求体
 * @param openAIBatchId OpenAI批处理ID
 * @param projectId 项目ID
 */
export async function saveBatchRequest(
  customId: string,
  method: string,
  url: string,
  body: any,
  openAIBatchId: string,
  projectId: string = 'default'
): Promise<{ success: boolean; requestId?: string; error?: string }> {
  try {
    const request = new BatchRequest({
      custom_id: customId,
      method,
      url,
      body,
      openai_batch_id: openAIBatchId,
      project_id: projectId
    });
    
    await request.save();
    return { success: true, requestId: request._id.toString() };
  } catch (error) {
    console.error(`保存批处理请求失败 [CustomID: ${customId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 保存批处理响应
 * @param requestId 请求ID
 * @param customId 自定义ID
 * @param response 响应对象
 * @param openAIBatchId OpenAI批处理ID
 */
export async function saveBatchResponse(
  requestId: string,
  customId: string,
  response: {
    status_code: number;
    request_id: string;
    body: any;
    error?: any;
  },
  openAIBatchId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const batchResponse = new BatchResponse({
      request_id: new Types.ObjectId(requestId),
      custom_id: customId,
      response,
      openai_batch_id: openAIBatchId
    });
    
    await batchResponse.save();
    return { success: true };
  } catch (error) {
    console.error(`保存批处理响应失败 [RequestID: ${requestId}]:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取批处理请求和响应
 * @param customId 自定义ID
 * @param openAIBatchId OpenAI批处理ID
 */
export async function getBatchRequestAndResponse(
  customId: string,
  openAIBatchId: string
): Promise<{ 
  success: boolean; 
  request?: IBatchRequest; 
  response?: IBatchResponse; 
  error?: string 
}> {
  try {
    const request = await BatchRequest.findOne({ 
      custom_id: customId, 
      openai_batch_id: openAIBatchId 
    });
    
    if (!request) {
      return { success: false, error: '批处理请求不存在' };
    }
    
    const response = await BatchResponse.findOne({ 
      custom_id: customId, 
      openai_batch_id: openAIBatchId 
    });
    
    return { success: true, request, response };
  } catch (error) {
    console.error(`获取批处理请求和响应失败 [CustomID: ${customId}]:`, error);
    return { success: false, error: error.message };
  }
} 