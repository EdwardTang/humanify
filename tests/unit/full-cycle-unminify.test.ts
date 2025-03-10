// @ts-nocheck
// tests/unit/full-cycle-unminify.test.ts
import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// 导入前先设置模拟，确保模拟在导入前生效
jest.mock('fs/promises');
jest.mock('uuid');
jest.mock('../../src/db/file-store.js', () => ({
  initializeDataStore: jest.fn().mockResolvedValue(true),
  saveProcessingRun: jest.fn().mockResolvedValue({ id: 'mock-run-id' }),
  deleteProcessingRun: jest.fn().mockResolvedValue(true),
  getFiles: jest.fn(),
  saveFiles: jest.fn().mockResolvedValue({ success: true }),
  getIdentifiersByBatchId: jest.fn(),
  getIdentifiers: jest.fn(),
  getFilesByRunId: jest.fn(),
  updateIdentifier: jest.fn().mockResolvedValue({ success: true }),
  createBatchJob: jest.fn().mockResolvedValue({ success: true, id: 'mock-batch-job-id' })
}));
jest.mock('../../src/plugins/webcrack.js', () => ({
  webcrack: jest.fn()
}));
jest.mock('../../src/files/file-manager.js', () => ({
  FileManager: jest.fn().mockImplementation(() => ({
    findMatchingFiles: jest.fn().mockResolvedValue([]),
    chunkLargeFile: jest.fn().mockResolvedValue(true),
    applyRenamesToFile: jest.fn().mockResolvedValue(true)
  }))
}));
jest.mock('../../src/extract/parallel-extractor.js', () => ({
  ParallelExtractor: jest.fn().mockImplementation(() => ({
    extractIdentifiers: jest.fn().mockResolvedValue([]),
    processFile: jest.fn().mockResolvedValue(true),
    shutdown: jest.fn()
  }))
}));
jest.mock('../../src/rename/batch-optimizer.js', () => ({
  BatchOptimizer: jest.fn().mockImplementation(() => ({
    processBatch: jest.fn().mockResolvedValue({ 
      processed: 10, 
      total: 10, 
      success: true 
    }),
    submitBatchJob: jest.fn().mockResolvedValue({ 
      jobId: 'mock-job-id', 
      success: true 
    })
  }))
}));
jest.mock('../../src/process/category-processor.js', () => ({
  processFilesByCategory: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../../src/plugins/prettier.js', () => {
  return jest.fn().mockImplementation(code => Promise.resolve(code));
});
jest.mock('../../src/utils/helpers.js', () => ({
  ensureFileExists: jest.fn(),
  escapeRegExp: jest.fn().mockImplementation(str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  formatTime: jest.fn().mockImplementation(seconds => `${seconds.toFixed(2)}s`)
}));
jest.mock('../../src/projects/projects.js', () => ({
  getActiveProject: jest.fn().mockResolvedValue({
    id: 'mock-project-id',
    name: 'Mock Project'
  }),
  getProjectById: jest.fn().mockResolvedValue({
    id: 'mock-project-id',
    name: 'Mock Project'
  })
}));
jest.mock('../../src/utils/logger.js', () => ({
  verbose: { log: jest.fn(), enabled: false }
}));

// 现在导入被测试的模块
// 注意：只导入导出的函数，内部函数我们将通过 fullCycleUnminify 的行为间接测试
import { fullCycleUnminify } from '../../src/commands/full-cycle-unminify.js';

// Mock UUID to return a consistent ID for testing
(uuidv4 as jest.Mock).mockReturnValue('mock-run-id');

describe('Full Cycle Unminify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fullCycleUnminify', () => {
    const mockOptions = {
      sourceFile: 'source.min.js',
      outputDir: 'output',
      apiKey: 'test-api-key',
      projectId: 'test-project',
      skipCompleted: true,
      cacheResults: true,
      batchSize: 25,
      concurrency: 4
    };

    let webcrackMock;
    let fileStore;

    beforeEach(() => {
      // 使用 jest.requireMock 获取已模拟的模块
      webcrackMock = jest.requireMock('../../src/plugins/webcrack.js').webcrack;
      fileStore = jest.requireMock('../../src/db/file-store.js');

      webcrackMock.mockResolvedValue([
        { path: 'output/file1.js', size: 1000 },
        { path: 'output/file2.js', size: 2000 }
      ]);

      fileStore.getFiles.mockResolvedValue({
        success: true,
        files: [
          { id: 'file1', path: 'output/file1.js', size: 1000, category: 'small' },
          { id: 'file2', path: 'output/file2.js', size: 2000, category: 'large' }
        ]
      });
    });

    it('should execute the full cycle successfully', async () => {
      const result = await fullCycleUnminify(mockOptions);
      
      // 验证流程正确执行
      expect(fileStore.initializeDataStore).toHaveBeenCalled();
      expect(fileStore.saveProcessingRun).toHaveBeenCalledWith(
        expect.any(String), // JSON stringified options
        1,
        'test-project'
      );
      expect(webcrackMock).toHaveBeenCalledWith('source.min.js', 'output');
      
      // 验证结果
      expect(result).toEqual({
        success: true,
        runId: 'mock-run-id',
        fileCount: 2
      });
    });

    it('should handle errors and report them properly', async () => {
      // 让webcrackMock抛出错误
      webcrackMock.mockRejectedValueOnce(new Error('Test error'));

      await expect(fullCycleUnminify(mockOptions)).rejects.toThrow('Test error');
      
      // 验证错误处理
      expect(fileStore.deleteProcessingRun).toHaveBeenCalledWith(
        'mock-run-id',
        expect.objectContaining({
          status: 'failed',
          error: 'Test error'
        })
      );
    });

    it('should support long-running mode', async () => {
      const longRunningOptions = {
        ...mockOptions,
        longRunning: true
      };

      const result = await fullCycleUnminify(longRunningOptions);
      
      // 验证结果
      expect(result).toEqual({
        success: true,
        runId: 'mock-run-id',
        fileCount: 2
      });
    });
  });
}); 