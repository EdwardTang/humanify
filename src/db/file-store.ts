import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// 获取当前模块的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 项目信息接口
export interface ProjectInfo {
  id: string;
  name: string;
  version: string;
  distro: string;
  author: string;
  description?: string;
  node_version?: string;
  electron_version?: string;
  repository?: string;
  main_file?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 文件信息接口
export interface FileInfo {
  id: string;
  path: string;
  file_name: string;
  file_type: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  category: 'small' | 'large' | 'ultra_large';
  chunk_count?: number;
  last_processing_time?: number;
  last_processing_error?: string;
  created_at: string;
  updated_at: string;
  project_id: string;
}

// 文件块接口
export interface ChunkInfo {
  id: string;
  file_id: string;
  chunk_index: number;
  content: string;
  created_at: string;
  updated_at: string;
  project_id: string;
}

// 标识符接口
export interface IdentifierInfo {
  id: string;
  file_id: string;
  chunk_id?: string;
  original_name: string;
  new_name?: string;
  surrounding_code: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  custom_id: string;
  batch_id?: string;
  created_at: string;
  updated_at: string;
  project_id: string;
}

// 处理运行接口
export interface ProcessingRunInfo {
  id: string;
  status: 'running' | 'completed' | 'failed';
  config: string;
  total_files: number;
  processed_files: number;
  failed_files: number;
  start_time: string;
  end_time?: string;
  error?: string;
  project_id: string;
}

// 性能指标接口
export interface PerformanceMetricInfo {
  id: string;
  run_id: string;
  metric_name: string;
  value: number;
  unit: string;
  metadata?: Record<string, any>;
  created_at: string;
  project_id: string;
}

// 批处理事件接口
export interface BatchEventInfo {
  timestamp: string;
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled';
  details?: string;
}

// OpenAI批处理接口
export interface OpenAIBatchInfo {
  id: string;
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  endpoint: string;
  completion_window: string;
  completion_time?: string;
  total_requests: number;
  completed_requests: number;
  failed_requests: number;
  input_file_id: string;
  input_file_path: string;
  output_file_id?: string;
  output_file_path?: string;
  error_file_path?: string;
  events: BatchEventInfo[];
  error?: string;
  project_id: string;
}

// 批处理请求接口
export interface BatchRequestInfo {
  id: string;
  custom_id: string;
  method: string;
  url: string;
  body: any;
  openai_batch_id: string;
  project_id: string;
}

// 批处理响应接口
export interface BatchResponseInfo {
  id: string;
  request_id: string;
  custom_id: string;
  response: {
    status_code: number;
    request_id: string;
    body: any;
    error?: any;
  };
  openai_batch_id: string;
  project_id: string;
}

// 本地批处理跟踪接口
export interface LocalBatchTrackerInfo {
  id: string;
  openai_batch_id: string;
  type: 'small' | 'large' | 'ultra_large';
  file_ids: string[];
  identifier_count: number;
  tasks_file_path: string;
  output_file_path?: string;
  processing_run_id: string;
  processing_start: string;
  processing_end?: string;
  status: 'preparing' | 'submitting' | 'processing' | 'downloading' | 'applying' | 'completed' | 'failed';
  error?: string;
  created_at: string;
  updated_at: string;
  project_id: string;
}

/**
 * 确保数据存储目录存在
 */
async function ensureDataDirExists(): Promise<void> {
  try {
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
  } catch (error: any) {
    console.error('创建数据目录失败:', error);
    throw error;
  }
}

/**
 * 读取项目列表
 */
export async function getProjects(): Promise<ProjectInfo[]> {
  await ensureDataDirExists();
  
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    // 如果文件不存在或为空，返回空数组
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error('读取项目列表失败:', error);
    throw error;
  }
}

/**
 * 写入项目列表
 */
async function saveProjects(projects: ProjectInfo[]): Promise<void> {
  await ensureDataDirExists();
  
  try {
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  } catch (error: any) {
    console.error('保存项目列表失败:', error);
    throw error;
  }
}

/**
 * 添加或更新项目
 */
export async function saveProject(project: Omit<ProjectInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<ProjectInfo> {
  const projects = await getProjects();
  const now = new Date().toISOString();
  
  // 查找现有项目
  const existingIndex = project.id 
    ? projects.findIndex(p => p.id === project.id)
    : projects.findIndex(p => p.name === project.name && p.version === project.version);
  
  // 如果项目已存在，更新它
  if (existingIndex >= 0) {
    const existingProject = projects[existingIndex];
    const updatedProject = {
      ...existingProject,
      ...project,
      id: existingProject.id, // 保留原始ID
      created_at: existingProject.created_at, // 保留创建时间
      updated_at: now,
    };
    
    // 如果将此项目设置为活动项目，则将其他项目设置为非活动
    if (updatedProject.is_active) {
      projects.forEach((p, i) => {
        if (i !== existingIndex) {
          p.is_active = false;
        }
      });
    }
    
    projects[existingIndex] = updatedProject;
    await saveProjects(projects);
    
    return updatedProject;
  } 
  // 否则，创建新项目
  else {
    const newProject: ProjectInfo = {
      ...project as any,
      id: project.id || uuidv4(),
      created_at: now,
      updated_at: now,
    };
    
    // 如果将此项目设置为活动项目，则将其他项目设置为非活动
    if (newProject.is_active) {
      projects.forEach(p => {
        p.is_active = false;
      });
    }
    
    projects.push(newProject);
    await saveProjects(projects);
    
    return newProject;
  }
}

/**
 * 获取活动项目
 */
export async function getActiveProject(): Promise<ProjectInfo | null> {
  const projects = await getProjects();
  return projects.find(p => p.is_active) || null;
}

/**
 * 根据ID获取项目
 */
export async function getProjectById(id: string): Promise<ProjectInfo | null> {
  const projects = await getProjects();
  return projects.find(p => p.id === id) || null;
}

/**
 * 删除项目
 */
export async function deleteProject(id: string): Promise<boolean> {
  const projects = await getProjects();
  const newProjects = projects.filter(p => p.id !== id);
  
  if (newProjects.length !== projects.length) {
    await saveProjects(newProjects);
    return true;
  }
  
  return false;
}

/**
 * 设置活动项目
 */
export async function setActiveProject(id: string): Promise<boolean> {
  const projects = await getProjects();
  let found = false;
  
  projects.forEach(p => {
    if (p.id === id) {
      p.is_active = true;
      found = true;
    } else {
      p.is_active = false;
    }
  });
  
  if (found) {
    await saveProjects(projects);
  }
  
  return found;
}

// 通用的文件存储函数
async function saveToJsonFile<T>(dir: string, id: string, data: T): Promise<void> {
  await ensureDataDirExists();
  const filePath = path.join(dir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// 通用的文件读取函数
async function readFromJsonFile<T>(dir: string, id: string): Promise<T | null> {
  try {
    const filePath = path.join(dir, `${id}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// 通用的列表获取函数
async function listJsonFiles<T>(dir: string): Promise<T[]> {
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    const results: T[] = [];
    for (const file of jsonFiles) {
      const filePath = path.join(dir, file);
      const data = await fs.readFile(filePath, 'utf-8');
      results.push(JSON.parse(data) as T);
    }
    
    return results;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// 通用的删除函数
async function deleteJsonFile(dir: string, id: string): Promise<boolean> {
  try {
    const filePath = path.join(dir, `${id}.json`);
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

// 文件相关操作
export async function saveFile(file: Omit<FileInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<FileInfo> {
  const now = new Date().toISOString();
  const newFile: FileInfo = {
    ...file,
    id: file.id || uuidv4(),
    created_at: file.id ? (await readFromJsonFile<FileInfo>(FILES_DIR, file.id))?.created_at || now : now,
    updated_at: now
  };
  
  await saveToJsonFile(FILES_DIR, newFile.id, newFile);
  return newFile;
}

export async function getFileById(id: string): Promise<FileInfo | null> {
  return readFromJsonFile<FileInfo>(FILES_DIR, id);
}

export async function getFilesByProjectId(projectId: string): Promise<FileInfo[]> {
  const allFiles = await listJsonFiles<FileInfo>(FILES_DIR);
  return allFiles.filter(file => file.project_id === projectId);
}

export async function deleteFile(id: string): Promise<boolean> {
  return deleteJsonFile(FILES_DIR, id);
}

// 文件块相关操作
export async function saveChunk(chunk: Omit<ChunkInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<ChunkInfo> {
  const now = new Date().toISOString();
  const newChunk: ChunkInfo = {
    ...chunk,
    id: chunk.id || uuidv4(),
    created_at: chunk.id ? (await readFromJsonFile<ChunkInfo>(CHUNKS_DIR, chunk.id))?.created_at || now : now,
    updated_at: now
  };
  
  await saveToJsonFile(CHUNKS_DIR, newChunk.id, newChunk);
  return newChunk;
}

export async function getChunkById(id: string): Promise<ChunkInfo | null> {
  return readFromJsonFile<ChunkInfo>(CHUNKS_DIR, id);
}

export async function getChunksByFileId(fileId: string): Promise<ChunkInfo[]> {
  const allChunks = await listJsonFiles<ChunkInfo>(CHUNKS_DIR);
  return allChunks.filter(chunk => chunk.file_id === fileId);
}

export async function deleteChunk(id: string): Promise<boolean> {
  return deleteJsonFile(CHUNKS_DIR, id);
}

// 标识符相关操作
export async function saveIdentifier(identifier: Omit<IdentifierInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<IdentifierInfo> {
  const now = new Date().toISOString();
  const newIdentifier: IdentifierInfo = {
    ...identifier,
    id: identifier.id || uuidv4(),
    created_at: identifier.id ? (await readFromJsonFile<IdentifierInfo>(IDENTIFIERS_DIR, identifier.id))?.created_at || now : now,
    updated_at: now
  };
  
  await saveToJsonFile(IDENTIFIERS_DIR, newIdentifier.id, newIdentifier);
  return newIdentifier;
}

export async function getIdentifierById(id: string): Promise<IdentifierInfo | null> {
  return readFromJsonFile<IdentifierInfo>(IDENTIFIERS_DIR, id);
}

export async function getIdentifiersByFileId(fileId: string): Promise<IdentifierInfo[]> {
  const allIdentifiers = await listJsonFiles<IdentifierInfo>(IDENTIFIERS_DIR);
  return allIdentifiers.filter(identifier => identifier.file_id === fileId);
}

export async function getIdentifiersByBatchId(batchId: string): Promise<IdentifierInfo[]> {
  const allIdentifiers = await listJsonFiles<IdentifierInfo>(IDENTIFIERS_DIR);
  return allIdentifiers.filter(identifier => identifier.batch_id === batchId);
}

export async function deleteIdentifier(id: string): Promise<boolean> {
  return deleteJsonFile(IDENTIFIERS_DIR, id);
}

// 处理运行相关操作
export async function saveProcessingRun(run: Omit<ProcessingRunInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<ProcessingRunInfo> {
  const now = new Date().toISOString();
  const newRun: ProcessingRunInfo = {
    ...run,
    id: run.id || uuidv4(),
    start_time: run.start_time || now,
    total_files: run.total_files || 0,
    processed_files: run.processed_files || 0,
    failed_files: run.failed_files || 0
  };
  
  await saveToJsonFile(PROCESSING_RUNS_DIR, newRun.id, newRun);
  return newRun;
}

export async function getProcessingRunById(id: string): Promise<ProcessingRunInfo | null> {
  return readFromJsonFile<ProcessingRunInfo>(PROCESSING_RUNS_DIR, id);
}

export async function getProcessingRunsByProjectId(projectId: string): Promise<ProcessingRunInfo[]> {
  const allRuns = await listJsonFiles<ProcessingRunInfo>(PROCESSING_RUNS_DIR);
  return allRuns.filter(run => run.project_id === projectId);
}

export async function deleteProcessingRun(id: string): Promise<boolean> {
  return deleteJsonFile(PROCESSING_RUNS_DIR, id);
}

// 性能指标相关操作
export async function savePerformanceMetric(metric: Omit<PerformanceMetricInfo, 'id' | 'created_at'> & { id?: string }): Promise<PerformanceMetricInfo> {
  const now = new Date().toISOString();
  const newMetric: PerformanceMetricInfo = {
    ...metric,
    id: metric.id || uuidv4(),
    created_at: now
  };
  
  await saveToJsonFile(PERFORMANCE_METRICS_DIR, newMetric.id, newMetric);
  return newMetric;
}

export async function getPerformanceMetricsByRunId(runId: string): Promise<PerformanceMetricInfo[]> {
  const allMetrics = await listJsonFiles<PerformanceMetricInfo>(PERFORMANCE_METRICS_DIR);
  return allMetrics.filter(metric => metric.run_id === runId);
}

// OpenAI批处理相关操作
export async function saveOpenAIBatch(batch: Omit<OpenAIBatchInfo, 'created_at'> & { created_at?: string }): Promise<OpenAIBatchInfo> {
  const now = new Date().toISOString();
  const newBatch: OpenAIBatchInfo = {
    ...batch,
    created_at: batch.created_at || now
  };
  
  await saveToJsonFile(OPENAI_BATCHES_DIR, newBatch.id, newBatch);
  return newBatch;
}

export async function getOpenAIBatchById(id: string): Promise<OpenAIBatchInfo | null> {
  return readFromJsonFile<OpenAIBatchInfo>(OPENAI_BATCHES_DIR, id);
}

export async function getOpenAIBatchesByProjectId(projectId: string): Promise<OpenAIBatchInfo[]> {
  const allBatches = await listJsonFiles<OpenAIBatchInfo>(OPENAI_BATCHES_DIR);
  return allBatches.filter(batch => batch.project_id === projectId);
}

export async function deleteOpenAIBatch(id: string): Promise<boolean> {
  return deleteJsonFile(OPENAI_BATCHES_DIR, id);
}

// 批处理请求相关操作
export async function saveBatchRequest(request: Omit<BatchRequestInfo, 'id'> & { id?: string }): Promise<BatchRequestInfo> {
  const newRequest: BatchRequestInfo = {
    ...request,
    id: request.id || uuidv4()
  };
  
  await saveToJsonFile(BATCH_REQUESTS_DIR, newRequest.id, newRequest);
  return newRequest;
}

export async function getBatchRequestById(id: string): Promise<BatchRequestInfo | null> {
  return readFromJsonFile<BatchRequestInfo>(BATCH_REQUESTS_DIR, id);
}

export async function getBatchRequestsByBatchId(batchId: string): Promise<BatchRequestInfo[]> {
  const allRequests = await listJsonFiles<BatchRequestInfo>(BATCH_REQUESTS_DIR);
  return allRequests.filter(request => request.openai_batch_id === batchId);
}

// 批处理响应相关操作
export async function saveBatchResponse(response: Omit<BatchResponseInfo, 'id'> & { id?: string }): Promise<BatchResponseInfo> {
  const newResponse: BatchResponseInfo = {
    ...response,
    id: response.id || uuidv4()
  };
  
  await saveToJsonFile(BATCH_RESPONSES_DIR, newResponse.id, newResponse);
  return newResponse;
}

export async function getBatchResponseById(id: string): Promise<BatchResponseInfo | null> {
  return readFromJsonFile<BatchResponseInfo>(BATCH_RESPONSES_DIR, id);
}

export async function getBatchResponsesByBatchId(batchId: string): Promise<BatchResponseInfo[]> {
  const allResponses = await listJsonFiles<BatchResponseInfo>(BATCH_RESPONSES_DIR);
  return allResponses.filter(response => response.openai_batch_id === batchId);
}

// 本地批处理跟踪相关操作
export async function saveLocalBatchTracker(tracker: Omit<LocalBatchTrackerInfo, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<LocalBatchTrackerInfo> {
  const now = new Date().toISOString();
  const newTracker: LocalBatchTrackerInfo = {
    ...tracker,
    id: tracker.id || uuidv4(),
    created_at: tracker.id ? (await readFromJsonFile<LocalBatchTrackerInfo>(LOCAL_BATCH_TRACKERS_DIR, tracker.id))?.created_at || now : now,
    updated_at: now
  };
  
  await saveToJsonFile(LOCAL_BATCH_TRACKERS_DIR, newTracker.id, newTracker);
  return newTracker;
}

export async function getLocalBatchTrackerById(id: string): Promise<LocalBatchTrackerInfo | null> {
  return readFromJsonFile<LocalBatchTrackerInfo>(LOCAL_BATCH_TRACKERS_DIR, id);
}

export async function getLocalBatchTrackersByRunId(runId: string): Promise<LocalBatchTrackerInfo[]> {
  const allTrackers = await listJsonFiles<LocalBatchTrackerInfo>(LOCAL_BATCH_TRACKERS_DIR);
  return allTrackers.filter(tracker => tracker.processing_run_id === runId);
}

export async function getLocalBatchTrackersByStatus(status: LocalBatchTrackerInfo['status']): Promise<LocalBatchTrackerInfo[]> {
  const allTrackers = await listJsonFiles<LocalBatchTrackerInfo>(LOCAL_BATCH_TRACKERS_DIR);
  return allTrackers.filter(tracker => tracker.status === status);
}

// 初始化数据存储
export async function initializeDataStore(): Promise<void> {
  await ensureDataDirExists();
  console.log('数据存储已初始化');
}

// 数据库连接状态检查（兼容性函数）
export async function isConnected(): Promise<boolean> {
  try {
    await ensureDataDirExists();
    return true;
  } catch (error) {
    return false;
  }
}

// 关闭数据库连接（兼容性函数）
export async function disconnectDB(): Promise<void> {
  // 文件存储不需要关闭连接，此函数仅为兼容性而保留
  return;
} 