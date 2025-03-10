/**
 * 文件存储 - 模拟版本
 * 这个文件提供了一个简化的文件存储API，用于测试适配器
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// 数据存储目录
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data-store');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const FILES_DIR = path.join(DATA_DIR, 'files');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const IDENTIFIERS_DIR = path.join(DATA_DIR, 'identifiers');
const PROCESSING_RUNS_DIR = path.join(DATA_DIR, 'processing-runs');
const PERFORMANCE_METRICS_DIR = path.join(DATA_DIR, 'performance-metrics');
const OPENAI_BATCHES_DIR = path.join(DATA_DIR, 'openai-batches');
const BATCH_REQUESTS_DIR = path.join(DATA_DIR, 'batch-requests');
const BATCH_RESPONSES_DIR = path.join(DATA_DIR, 'batch-responses');
const LOCAL_BATCH_TRACKERS_DIR = path.join(DATA_DIR, 'local-batch-trackers');

// 确保数据目录存在
async function ensureDataDirExists() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
  await fs.mkdir(IDENTIFIERS_DIR, { recursive: true });
  await fs.mkdir(PROCESSING_RUNS_DIR, { recursive: true });
  await fs.mkdir(PERFORMANCE_METRICS_DIR, { recursive: true });
  await fs.mkdir(OPENAI_BATCHES_DIR, { recursive: true });
  await fs.mkdir(BATCH_REQUESTS_DIR, { recursive: true });
  await fs.mkdir(BATCH_RESPONSES_DIR, { recursive: true });
  await fs.mkdir(LOCAL_BATCH_TRACKERS_DIR, { recursive: true });
  
  // 确保项目文件存在
  try {
    await fs.access(PROJECTS_FILE);
  } catch (error) {
    // 文件不存在，创建空的项目列表
    await fs.writeFile(PROJECTS_FILE, '[]');
  }
}

// 获取项目列表
export async function getProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// 保存项目列表
async function saveProjects(projects) {
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// 保存项目
export async function saveProject(project) {
  const now = new Date().toISOString();
  const newProject = {
    ...project,
    id: project.id || uuidv4(),
    created_at: project.created_at || now,
    updated_at: now
  };
  
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === newProject.id);
  
  if (index !== -1) {
    // 更新现有项目
    projects[index] = newProject;
  } else {
    // 添加新项目
    projects.push(newProject);
  }
  
  await saveProjects(projects);
  return newProject;
}

// 获取当前活动项目
export async function getActiveProject() {
  const projects = await getProjects();
  return projects.find(p => p.is_active) || null;
}

// 根据ID获取项目
export async function getProjectById(id) {
  const projects = await getProjects();
  return projects.find(p => p.id === id) || null;
}

// 删除项目
export async function deleteProject(id) {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === id);
  
  if (index === -1) {
    return false;
  }
  
  projects.splice(index, 1);
  await saveProjects(projects);
  return true;
}

// 设置活动项目
export async function setActiveProject(id) {
  const projects = await getProjects();
  
  // 清除所有项目的活动状态
  for (const project of projects) {
    project.is_active = false;
  }
  
  // 设置指定项目为活动状态
  const targetProject = projects.find(p => p.id === id);
  if (!targetProject) {
    return false;
  }
  
  targetProject.is_active = true;
  await saveProjects(projects);
  return true;
}

// 通用JSON文件保存函数
async function saveToJsonFile(dir, id, data) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2));
}

// 通用JSON文件读取函数
async function readFromJsonFile(dir, id) {
  try {
    const data = await fs.readFile(path.join(dir, `${id}.json`), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

// 通用JSON文件列表函数
async function listJsonFiles(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    const result = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        result.push(JSON.parse(content));
      } catch (error) {
        // 忽略无法解析的文件
      }
    }
    
    return result;
  } catch (error) {
    return [];
  }
}

// 通用JSON文件删除函数
async function deleteJsonFile(dir, id) {
  try {
    await fs.unlink(path.join(dir, `${id}.json`));
    return true;
  } catch (error) {
    return false;
  }
}

// 保存文件信息
export async function saveFile(file) {
  const now = new Date().toISOString();
  const newFile = {
    ...file,
    id: file.id || uuidv4(),
    created_at: file.created_at || now,
    updated_at: now
  };
  
  await saveToJsonFile(FILES_DIR, newFile.id, newFile);
  return newFile;
}

// 根据ID获取文件
export async function getFileById(id) {
  return readFromJsonFile(FILES_DIR, id);
}

// 获取项目的所有文件
export async function getFilesByProjectId(projectId) {
  const files = await listJsonFiles(FILES_DIR);
  return files.filter(file => file.project_id === projectId);
}

// 删除文件
export async function deleteFile(id) {
  return deleteJsonFile(FILES_DIR, id);
}

// 保存分块信息
export async function saveChunk(chunk) {
  const now = new Date().toISOString();
  const newChunk = {
    ...chunk,
    id: chunk.id || uuidv4(),
    created_at: chunk.created_at || now,
    updated_at: now
  };
  
  await saveToJsonFile(CHUNKS_DIR, newChunk.id, newChunk);
  return newChunk;
}

// 根据ID获取分块
export async function getChunkById(id) {
  return readFromJsonFile(CHUNKS_DIR, id);
}

// 获取文件的所有分块
export async function getChunksByFileId(fileId) {
  const chunks = await listJsonFiles(CHUNKS_DIR);
  return chunks.filter(chunk => chunk.file_id === fileId);
}

// 删除分块
export async function deleteChunk(id) {
  return deleteJsonFile(CHUNKS_DIR, id);
}

// 保存标识符信息
export async function saveIdentifier(identifier) {
  const now = new Date().toISOString();
  const newIdentifier = {
    ...identifier,
    id: identifier.id || uuidv4(),
    created_at: identifier.created_at || now,
    updated_at: now
  };
  
  await saveToJsonFile(IDENTIFIERS_DIR, newIdentifier.id, newIdentifier);
  return newIdentifier;
}

// 根据ID获取标识符
export async function getIdentifierById(id) {
  return readFromJsonFile(IDENTIFIERS_DIR, id);
}

// 获取文件的所有标识符
export async function getIdentifiersByFileId(fileId) {
  const identifiers = await listJsonFiles(IDENTIFIERS_DIR);
  return identifiers.filter(identifier => identifier.file_id === fileId);
}

// 获取批次的所有标识符
export async function getIdentifiersByBatchId(batchId) {
  const identifiers = await listJsonFiles(IDENTIFIERS_DIR);
  return identifiers.filter(identifier => identifier.batch_id === batchId);
}

// 删除标识符
export async function deleteIdentifier(id) {
  return deleteJsonFile(IDENTIFIERS_DIR, id);
}

// 保存处理运行信息
export async function saveProcessingRun(run) {
  const now = new Date().toISOString();
  const newRun = {
    ...run,
    id: run.id || uuidv4(),
    created_at: run.created_at || now,
    updated_at: now
  };
  
  await saveToJsonFile(PROCESSING_RUNS_DIR, newRun.id, newRun);
  return newRun;
}

// 根据ID获取处理运行
export async function getProcessingRunById(id) {
  return readFromJsonFile(PROCESSING_RUNS_DIR, id);
}

// 获取项目的所有处理运行
export async function getProcessingRunsByProjectId(projectId) {
  const runs = await listJsonFiles(PROCESSING_RUNS_DIR);
  return runs.filter(run => run.project_id === projectId);
}

// 删除处理运行
export async function deleteProcessingRun(id) {
  return deleteJsonFile(PROCESSING_RUNS_DIR, id);
}

// 保存性能指标
export async function savePerformanceMetric(metric) {
  const now = new Date().toISOString();
  const newMetric = {
    ...metric,
    id: metric.id || uuidv4(),
    created_at: now
  };
  
  await saveToJsonFile(PERFORMANCE_METRICS_DIR, newMetric.id, newMetric);
  return newMetric;
}

// 获取运行的所有性能指标
export async function getPerformanceMetricsByRunId(runId) {
  const metrics = await listJsonFiles(PERFORMANCE_METRICS_DIR);
  return metrics.filter(metric => metric.run_id === runId);
}

// 保存OpenAI批处理信息
export async function saveOpenAIBatch(batch) {
  const now = new Date().toISOString();
  const newBatch = {
    ...batch,
    created_at: batch.created_at || now
  };
  
  await saveToJsonFile(OPENAI_BATCHES_DIR, newBatch.id, newBatch);
  return newBatch;
}

// 根据ID获取OpenAI批处理
export async function getOpenAIBatchById(id) {
  return readFromJsonFile(OPENAI_BATCHES_DIR, id);
}

// 获取项目的所有OpenAI批处理
export async function getOpenAIBatchesByProjectId(projectId) {
  const batches = await listJsonFiles(OPENAI_BATCHES_DIR);
  return batches.filter(batch => batch.project_id === projectId);
}

// 删除OpenAI批处理
export async function deleteOpenAIBatch(id) {
  return deleteJsonFile(OPENAI_BATCHES_DIR, id);
}

// 保存批处理请求
export async function saveBatchRequest(request) {
  const newRequest = {
    ...request,
    id: request.id || uuidv4()
  };
  
  await saveToJsonFile(BATCH_REQUESTS_DIR, newRequest.id, newRequest);
  return newRequest;
}

// 根据ID获取批处理请求
export async function getBatchRequestById(id) {
  return readFromJsonFile(BATCH_REQUESTS_DIR, id);
}

// 获取批处理的所有请求
export async function getBatchRequestsByBatchId(batchId) {
  const requests = await listJsonFiles(BATCH_REQUESTS_DIR);
  return requests.filter(request => request.openai_batch_id === batchId);
}

// 保存批处理响应
export async function saveBatchResponse(response) {
  const newResponse = {
    ...response,
    id: response.id || uuidv4()
  };
  
  await saveToJsonFile(BATCH_RESPONSES_DIR, newResponse.id, newResponse);
  return newResponse;
}

// 根据ID获取批处理响应
export async function getBatchResponseById(id) {
  return readFromJsonFile(BATCH_RESPONSES_DIR, id);
}

// 获取批处理的所有响应
export async function getBatchResponsesByBatchId(batchId) {
  const responses = await listJsonFiles(BATCH_RESPONSES_DIR);
  return responses.filter(response => response.openai_batch_id === batchId);
}

// 保存本地批处理跟踪信息
export async function saveLocalBatchTracker(tracker) {
  const now = new Date().toISOString();
  const newTracker = {
    ...tracker,
    id: tracker.id || uuidv4(),
    created_at: tracker.created_at || now,
    updated_at: now
  };
  
  await saveToJsonFile(LOCAL_BATCH_TRACKERS_DIR, newTracker.id, newTracker);
  return newTracker;
}

// 根据ID获取本地批处理跟踪
export async function getLocalBatchTrackerById(id) {
  return readFromJsonFile(LOCAL_BATCH_TRACKERS_DIR, id);
}

// 获取运行的所有本地批处理跟踪
export async function getLocalBatchTrackersByRunId(runId) {
  const trackers = await listJsonFiles(LOCAL_BATCH_TRACKERS_DIR);
  return trackers.filter(tracker => tracker.processing_run_id === runId);
}

// 获取指定状态的所有本地批处理跟踪
export async function getLocalBatchTrackersByStatus(status) {
  const trackers = await listJsonFiles(LOCAL_BATCH_TRACKERS_DIR);
  return trackers.filter(tracker => tracker.status === status);
}

// Initialize the data store
export async function initializeDataStore() {
  await ensureDataDirExists();
  console.log('数据存储已初始化');
}

// 数据库连接状态检查
export async function isConnected() {
  try {
    await ensureDataDirExists();
    return true;
  } catch (error) {
    return false;
  }
}

// 关闭数据库连接
export async function disconnectDB() {
  // 文件存储不需要关闭连接
  return;
}

/**
 * Initialize the database connection and setup
 */
export const initializeDataStore = async () => {
  return { success: true };
};

/**
 * Save a processing run to the database
 */
export const saveProcessingRun = async (config, totalFiles, projectId) => {
  return { id: 'run-id', success: true };
};

/**
 * Update a processing run in the database
 */
export const updateProcessingRun = async (runId, updateData) => {
  return { success: true };
};

/**
 * Save files to the database
 */
export const saveFiles = async (files, projectId) => {
  return { success: true, savedCount: files.length };
};

/**
 * Sync files to the database (add or update)
 */
export const syncFilesToDatabase = async (files, projectId) => {
  return { success: true, savedCount: files.length };
};

/**
 * Get pending files grouped by category (small, large, ultra_large)
 */
export const getPendingFilesByCategory = async (projectId) => {
  return { 
    success: true, 
    files: {
      small: [],
      large: [],
      ultra_large: []
    }
  };
};

/**
 * Get identifiers ready for batching
 */
export const getIdentifiersForBatching = async (batchSize, skipCompleted, projectId) => {
  return { success: true, batches: [] };
};

/**
 * Save a batch job to the database
 */
export const saveBatchJob = async (batchJob) => {
  return { success: true, id: 'batch-job-id' };
};

/**
 * Get files that have been processed
 */
export const getProcessedFilesByRunId = async (runId, projectId) => {
  return { success: true, files: [] };
};

/**
 * Get identifiers for a specific file
 */
export const getFileIdentifiers = async (fileId, projectId) => {
  return { success: true, identifiers: [] };
};

/**
 * Get identifiers by batch ID
 */
export const getIdentifiersByBatchId = async (batchId, projectId) => {
  return { success: true, identifiers: [] };
};

/**
 * Save identifiers to the database
 */
export const saveIdentifiers = async (identifiers, projectId) => {
  return { success: true, savedCount: identifiers.length };
};

/**
 * Get files by their status
 */
export const getFilesByStatus = async (status, projectId) => {
  return { success: true, files: [] };
};

/**
 * Get identifiers by their status
 */
export const getIdentifiersByStatus = async (status, projectId) => {
  return { success: true, identifiers: [] };
};

/**
 * Get all files
 */
export const getFiles = async (projectId) => {
  return { success: true, files: [] };
};

/**
 * Get all folders
 */
export const getFolders = async (projectId) => {
  return { success: true, folders: [] };
};

/**
 * Get batch requests
 */
export const getBatchRequests = async (projectId) => {
  return { success: true, requests: [] };
};

/**
 * Get batch responses
 */
export const getBatchResponses = async (projectId) => {
  return { success: true, responses: [] };
}; 