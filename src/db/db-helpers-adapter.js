/**
 * 数据库适配器：将file-store的API适配为dbHelpers的API
 * 这个适配器帮助我们平滑地从dbHelpers迁移到file-store
 */

import path from 'path';
import * as fileStore from './file-store.js';

/**
 * 初始化数据库
 * @returns {Promise<void>}
 */
export async function initializeDatabase() {
  return fileStore.initializeDataStore();
}

/**
 * 检查数据库连接
 * @returns {Promise<boolean>}
 */
export async function isConnected() {
  return fileStore.isConnected();
}

/**
 * 关闭数据库连接
 * @returns {Promise<void>}
 */
export async function disconnectDB() {
  return fileStore.disconnectDB();
}

/**
 * 开始处理运行
 * @param {string} configJson - 配置JSON字符串
 * @param {number} totalFiles - 总文件数量
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 处理运行对象
 */
export async function startProcessingRun(configJson, totalFiles, projectId) {
  return fileStore.saveProcessingRun({
    status: 'running',
    config: configJson,
    total_files: totalFiles,
    processed_files: 0,
    failed_files: 0,
    project_id: projectId || '',
    start_time: new Date().toISOString()
  });
}

/**
 * 完成处理运行
 * @param {string} runId - 处理运行ID
 * @param {object} options - 选项对象，包含status和可选的error
 * @returns {Promise<object>} 更新后的处理运行对象
 */
export async function completeProcessingRun(runId, options) {
  const run = await fileStore.getProcessingRunById(runId);
  if (!run) {
    throw new Error(`处理运行不存在: ${runId}`);
  }
  
  return fileStore.saveProcessingRun({
    ...run,
    status: options.status,
    end_time: new Date().toISOString(),
    error: options.error
  });
}

/**
 * 同步文件到数据库
 * @param {Array<object>} fileObjects - 文件对象数组
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 同步结果
 */
export async function syncFilesToDatabase(fileObjects, projectId) {
  const results = [];
  for (const fileObj of fileObjects) {
    // 确定文件类别
    let category = 'small';
    if (fileObj.size > 500000) {
      category = fileObj.size > 2000000 ? 'ultra_large' : 'large';
    }
    
    // 从路径中提取文件名和类型
    const fileName = path.basename(fileObj.path);
    const fileType = path.extname(fileObj.path).slice(1);
    
    // 保存文件
    const savedFile = await fileStore.saveFile({
      path: fileObj.path,
      file_name: fileName,
      file_type: fileType,
      size: fileObj.size,
      status: 'pending',
      category,
      project_id: projectId || ''
    });
    
    results.push(savedFile);
  }
  
  return { success: true, files: results };
}

/**
 * 按类别获取待处理文件
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 分类文件结果
 */
export async function getPendingFilesByCategory(projectId) {
  // 获取所有属于项目的文件
  const allFiles = projectId ? 
    await fileStore.getFilesByProjectId(projectId) : 
    await fileStore.getProjects().then(projects => {
      const activeProject = projects.find(p => p.is_active);
      return activeProject ? fileStore.getFilesByProjectId(activeProject.id) : [];
    });
  
  // 按状态过滤
  const pendingFiles = allFiles.filter(file => file.status === 'pending');
  
  // 按类别分组
  const result = {
    small: pendingFiles.filter(file => file.category === 'small'),
    large: pendingFiles.filter(file => file.category === 'large'),
    ultra_large: pendingFiles.filter(file => file.category === 'ultra_large')
  };
  
  return { success: true, files: result };
}

/**
 * 获取批处理的标识符
 * @param {number} batchSize - 批次大小
 * @param {boolean} skipCompleted - 是否跳过已完成的标识符
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 批处理标识符结果
 */
export async function getIdentifiersForBatching(batchSize, skipCompleted, projectId) {
  // 获取所有待处理的标识符
  let allFiles = [];
  if (projectId) {
    allFiles = await fileStore.getFilesByProjectId(projectId);
  } else {
    const activeProject = await fileStore.getActiveProject();
    if (activeProject) {
      allFiles = await fileStore.getFilesByProjectId(activeProject.id);
    }
  }
  
  // 收集所有标识符
  let allIdentifiers = [];
  for (const file of allFiles) {
    const fileIdentifiers = await fileStore.getIdentifiersByFileId(file.id);
    allIdentifiers = [...allIdentifiers, ...fileIdentifiers.filter(id => id.status === 'pending')];
  }
  
  // 如果需要跳过已完成的标识符
  if (skipCompleted) {
    // 获取所有已完成标识符
    const completedIdentifiers = new Set();
    for (const file of allFiles) {
      const fileIdentifiers = await fileStore.getIdentifiersByFileId(file.id);
      fileIdentifiers
        .filter(id => id.status === 'completed')
        .forEach(id => completedIdentifiers.add(id.original_name));
    }
    
    // 过滤掉原始名称已经处理过的标识符
    allIdentifiers = allIdentifiers.filter(id => !completedIdentifiers.has(id.original_name));
  }
  
  // 按批次大小分组
  const batches = [];
  for (let i = 0; i < allIdentifiers.length; i += batchSize) {
    const batchIdentifiers = allIdentifiers.slice(i, i + batchSize);
    batches.push({
      id: `batch-${i / batchSize}`,
      identifiers: batchIdentifiers
    });
  }
  
  return { success: true, batches, total: allIdentifiers.length };
}

/**
 * 创建批处理作业
 * @param {string} batchId - 批次ID
 * @param {string} jobId - 作业ID
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 批处理跟踪对象
 */
export async function createBatchJob(batchId, jobId, projectId) {
  return fileStore.saveLocalBatchTracker({
    openai_batch_id: jobId,
    type: 'small',
    file_ids: [],
    identifier_count: 0,
    tasks_file_path: '',
    processing_run_id: batchId,
    processing_start: new Date().toISOString(),
    status: 'processing',
    project_id: projectId || ''
  });
}

/**
 * 获取已处理文件
 * @param {string} runId - 处理运行ID
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 文件结果
 */
export async function getProcessedFilesByRunId(runId, projectId) {
  // 根据运行ID获取批处理跟踪
  const trackers = await fileStore.getLocalBatchTrackersByRunId(runId);
  
  // 获取所有涉及的文件ID
  const fileIds = new Set();
  trackers.forEach(tracker => {
    tracker.file_ids.forEach(id => fileIds.add(id));
  });
  
  // 获取所有文件
  const files = [];
  for (const fileId of fileIds) {
    const file = await fileStore.getFileById(fileId);
    if (file && (!projectId || file.project_id === projectId)) {
      files.push(file);
    }
  }
  
  return { success: true, files };
}

/**
 * 获取文件标识符
 * @param {string} fileId - 文件ID
 * @param {string} [projectId] - 项目ID
 * @returns {Promise<object>} 标识符结果
 */
export async function getFileIdentifiers(fileId, projectId) {
  const identifiers = await fileStore.getIdentifiersByFileId(fileId);
  
  // 过滤特定项目的标识符（如果指定了项目ID）
  const filteredIdentifiers = projectId
    ? identifiers.filter(id => id.project_id === projectId)
    : identifiers;
  
  return { success: true, identifiers: filteredIdentifiers };
} 