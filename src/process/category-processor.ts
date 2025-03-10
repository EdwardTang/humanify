import { verbose } from '../utils/logger.js';
import { FileManager } from '../files/file-manager.js';
import { ParallelExtractor } from '../extract/parallel-extractor.js';
import * as dbHelpers from '../db/db-helpers-adapter.js';

/**
 * 按照文件大小分类处理文件，优化内存使用和处理效率
 */
export async function processFilesByCategory(
  files: any[],
  extractor: ParallelExtractor,
  fileManager: FileManager,
  runId: string,
  projectId?: string
): Promise<void> {
  // 按类别分组文件
  const smallFiles = files.filter(f => f.category === 'small');
  const largeFiles = files.filter(f => f.category === 'large');
  const ultraLargeFiles = files.filter(f => f.category === 'ultra_large');

  // 显示处理信息
  verbose.log(`按类别分组文件:`);
  verbose.log(`- 小文件: ${smallFiles.length} 个`);
  verbose.log(`- 大文件: ${largeFiles.length} 个`);
  verbose.log(`- 超大文件: ${ultraLargeFiles.length} 个`);

  // 1. 先处理小文件 (并行处理)
  if (smallFiles.length > 0) {
    console.log(`\n处理 ${smallFiles.length} 个小文件 (并行)`);
    await processFiles(smallFiles, extractor, runId, projectId);
  }

  // 2. 再处理大文件 (使用较小的并行度)
  if (largeFiles.length > 0) {
    console.log(`\n处理 ${largeFiles.length} 个大文件`);
    await processFiles(largeFiles, extractor, runId, projectId);
  }

  // 3. 最后处理超大文件 (单个处理，避免内存问题)
  if (ultraLargeFiles.length > 0) {
    console.log(`\n处理 ${ultraLargeFiles.length} 个超大文件 (分块)`);
    
    for (const file of ultraLargeFiles) {
      console.log(`处理超大文件: ${file.path} (${formatFileSize(file.size)})`);
      
      try {
        // 将大文件分块
        const { chunks } = await fileManager.chunkLargeFile(file.path);
        console.log(`已将文件分为 ${chunks.length} 个块`);
        
        // 更新文件状态
        await dbHelpers.updateFile(file.id, {
          status: 'processing',
          chunk_count: chunks.length
        }, projectId);
        
        // 创建文件块
        const chunkIds = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkId = await dbHelpers.createFileChunk({
            file_id: file.id,
            chunk_index: i,
            content: chunks[i],
            project_id: projectId || 'default'
          });
          chunkIds.push(chunkId);
        }
        
        // 处理每个块
        for (let i = 0; i < chunks.length; i++) {
          console.log(`处理块 ${i + 1}/${chunks.length}`);
          
          // 从块中提取标识符
          const identifiers = await extractIdentifiersFromChunk(chunks[i], file.id, chunkIds[i], projectId);
          
          // 保存标识符到数据库
          for (const identifier of identifiers) {
            await dbHelpers.createIdentifier({
              file_id: file.id,
              chunk_id: chunkIds[i],
              original_name: identifier.name,
              surrounding_code: identifier.surroundingCode,
              status: 'pending',
              custom_id: `${file.id}_${chunkIds[i]}_${identifier.name}`,
              project_id: projectId || 'default'
            });
          }
        }
        
        // 更新文件状态为完成
        await dbHelpers.updateFile(file.id, {
          status: 'completed'
        }, projectId);
      } catch (error: any) {
        console.error(`处理超大文件 ${file.path} 失败: ${error.message}`);
        
        // 更新文件状态为失败
        await dbHelpers.updateFile(file.id, {
          status: 'failed',
          last_processing_error: error.message
        }, projectId);
      }
    }
  }
}

/**
 * 处理一组文件
 */
async function processFiles(
  files: any[],
  extractor: ParallelExtractor,
  runId: string,
  projectId?: string
): Promise<void> {
  // 设置进度计数器
  let processed = 0;
  let total = files.length;
  let failed = 0;
  
  // 处理进度回调
  extractor.on('progress', (data) => {
    processed++;
    if (data.hasError) {
      failed++;
    }
    
    const percentage = Math.round((processed / total) * 100);
    console.log(`处理进度: ${processed}/${total} 文件 (${percentage}%), 失败: ${failed}`);
  });
  
  // 处理每个文件
  const tasks = [];
  for (const file of files) {
    // 更新文件状态为处理中
    await dbHelpers.updateFile(file.id, {
      status: 'processing'
    }, projectId);
    
    // 添加处理任务
    tasks.push(
      extractor.processFile(file)
        .then(async (result) => {
          if (result.error) {
            // 更新文件状态为失败
            await dbHelpers.updateFile(file.id, {
              status: 'failed',
              last_processing_error: result.error
            }, projectId);
            return;
          }
          
          // 保存标识符到数据库
          for (const identifier of result.identifiers) {
            await dbHelpers.createIdentifier({
              file_id: file.id,
              original_name: identifier.name,
              surrounding_code: identifier.surroundingCode,
              status: 'pending',
              custom_id: `${file.id}_${identifier.name}`,
              project_id: projectId || 'default'
            });
          }
          
          // 更新文件状态为完成
          await dbHelpers.updateFile(file.id, {
            status: 'completed'
          }, projectId);
        })
        .catch(async (error) => {
          console.error(`处理文件 ${file.path} 失败: ${error.message}`);
          
          // 更新文件状态为失败
          await dbHelpers.updateFile(file.id, {
            status: 'failed',
            last_processing_error: error.message
          }, projectId);
        })
    );
  }
  
  // 等待所有任务完成
  await Promise.all(tasks);
  
  // 关闭处理器
  await extractor.shutdown();
}

/**
 * 从代码块中提取标识符
 */
async function extractIdentifiersFromChunk(
  chunk: string,
  fileId: string,
  chunkId: string,
  projectId?: string
): Promise<{ name: string, surroundingCode: string }[]> {
  // 使用简单的正则表达式提取标识符
  // 在实际应用中，应使用AST解析器获取更准确的结果
  const identifierRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const keywords = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in',
    'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await', 'implements',
    'package', 'protected', 'interface', 'private', 'public', 'true', 'false', 'null', 'undefined'
  ]);
  
  const identifiers = new Set<string>();
  const result: { name: string, surroundingCode: string }[] = [];
  
  // 提取所有标识符
  let match;
  while ((match = identifierRegex.exec(chunk)) !== null) {
    const name = match[0];
    
    // 跳过关键字和已处理的标识符
    if (keywords.has(name) || identifiers.has(name)) {
      continue;
    }
    
    identifiers.add(name);
    
    // 提取上下文
    const startPos = Math.max(0, match.index - 100);
    const endPos = Math.min(chunk.length, match.index + name.length + 100);
    const surroundingCode = chunk.substring(startPos, endPos);
    
    result.push({
      name,
      surroundingCode
    });
  }
  
  return result;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
} 