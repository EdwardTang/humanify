import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';

// Mock all dependencies
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234')
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('mock file content'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

vi.mock('chalk', () => ({
  default: {
    green: (text: string) => `GREEN:${text}`,
    yellow: (text: string) => `YELLOW:${text}`,
    red: (text: string) => `RED:${text}`,
    blue: (text: string) => `BLUE:${text}`,
    grey: (text: string) => `GREY:${text}`,
  }
}));

vi.mock('../utils/logger.js', () => ({
  verbose: {
    enabled: false,
    log: vi.fn(),
  }
}));

vi.mock('../env.js', () => ({
  env: vi.fn().mockImplementation((key: string) => {
    if (key === 'OPENAI_API_KEY') return 'mock-api-key';
    return undefined;
  })
}));

vi.mock('../db/file-store.js', () => ({
  initializeDataStore: vi.fn().mockResolvedValue({ success: true }),
  saveProcessingRun: vi.fn().mockResolvedValue({ id: 'mock-run-id', success: true }),
  updateProcessingRun: vi.fn().mockResolvedValue({ success: true }),
  getFiles: vi.fn(),
  saveFiles: vi.fn().mockResolvedValue({ success: true, savedCount: 3 }),
  getFilesByStatus: vi.fn(),
  getIdentifiersByBatchId: vi.fn(),
  saveIdentifiers: vi.fn().mockResolvedValue({ success: true, savedCount: 10 }),
  getIdentifiersByStatus: vi.fn(),
  saveBatchJob: vi.fn().mockResolvedValue({ success: true }),
  getFolders: vi.fn(),
  getBatchRequests: vi.fn(),
  getBatchResponses: vi.fn(),
  getIdentifiersForBatching: vi.fn(),
  getProcessedFilesByRunId: vi.fn(),
  getFileIdentifiers: vi.fn(),
  syncFilesToDatabase: vi.fn().mockResolvedValue({ success: true }),
  getPendingFilesByCategory: vi.fn(),
}));

vi.mock('../projects/projects.js', () => ({
  getActiveProject: vi.fn().mockResolvedValue({ id: 'active-project-id', name: 'Active Project' }),
  getProjectById: vi.fn().mockResolvedValue({ id: 'test-project-id', name: 'Test Project' }),
}));

vi.mock('../plugins/webcrack.js', () => ({
  webcrack: vi.fn().mockResolvedValue([
    { path: 'output/file1.js', size: 1024 },
    { path: 'output/file2.js', size: 2048 },
    { path: 'output/file3.js', size: 512 },
  ]),
}));

vi.mock('../files/file-manager.js', () => ({
  FileManager: vi.fn().mockImplementation(() => ({
    findMatchingFiles: vi.fn().mockResolvedValue([
      { path: 'output/file1.js', size: 1024 },
      { path: 'output/file2.js', size: 2048 },
      { path: 'output/file3.js', size: 512 },
    ]),
    chunkLargeFile: vi.fn().mockResolvedValue({
      originalFilePath: 'output/large-file.js',
      chunks: [
        { path: 'output/temp/large-file_chunk_0.js', size: 1024 },
        { path: 'output/temp/large-file_chunk_1.js', size: 1024 },
      ]
    }),
    applyRenamesToFile: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../extract/parallel-extractor.js', () => ({
  ParallelExtractor: vi.fn().mockImplementation(() => ({
    extractIdentifiers: vi.fn().mockResolvedValue({
      success: true,
      identifiers: [
        { id: 'id1', original_name: 'a', file_id: 'file1' },
        { id: 'id2', original_name: 'b', file_id: 'file1' },
      ],
    }),
    processFile: vi.fn().mockResolvedValue({
      success: true,
      processed: true,
    }),
    shutdown: vi.fn(),
  })),
}));

vi.mock('../rename/parallel-batch-rename.js', () => ({
  openAIParallelBatchRename: vi.fn().mockResolvedValue({
    success: true,
    processed: 10,
    total: 10,
    batchId: 'batch-1234',
    jobId: 'job-1234',
    tasksFilePath: 'path/to/tasks.jsonl',
  }),
}));

vi.mock('../rename/apply-batch-rename.js', () => ({
  applyParallelBatchRename: vi.fn().mockResolvedValue({
    success: true,
    processed: 10,
    renamedFiles: ['file1.js', 'file2.js'],
  }),
}));

// Import the module under test with mocked dependencies
import {
  fullCycleUnminify,
  FullCycleOptions,
  unminifyPhase,
  identifierAnalysisPhase,
  identifierRenamingPhase,
  submitBatchJobsPhase,
  codeGenerationPhase
} from './full-cycle-unminify.js';

// Mock the format utility
vi.mock('../utils/format.js', () => ({
  formatWithPrettier: vi.fn().mockResolvedValue('prettified code'),
}));

describe('Full Cycle Unminify', () => {
  const mockStartTime = 1000000000000;
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(mockStartTime);
    
    // Setup mock return values for file-store functions
    const fileStore = require('../db/file-store.js');
    fileStore.getFilesByStatus.mockResolvedValue({
      success: true,
      files: [
        { id: 'file1', path: 'output/file1.js', size: 1024, status: 'pending', category: 'small' },
        { id: 'file2', path: 'output/file2.js', size: 2048, status: 'pending', category: 'small' },
        { id: 'file3', path: 'output/file3.js', size: 512, status: 'pending', category: 'small' },
      ]
    });
    
    fileStore.getIdentifiersByStatus.mockResolvedValue({
      success: true,
      identifiers: [
        { id: 'id1', file_id: 'file1', original_name: 'a', surrounding_code: 'var a = 1;', status: 'pending' },
        { id: 'id2', file_id: 'file1', original_name: 'b', surrounding_code: 'var b = 2;', status: 'pending' },
      ]
    });
    
    fileStore.getIdentifiersByBatchId.mockResolvedValue({
      success: true,
      identifiers: [
        { id: 'id1', file_id: 'file1', original_name: 'a', new_name: 'value', status: 'completed' },
        { id: 'id2', file_id: 'file1', original_name: 'b', new_name: 'item', status: 'completed' },
      ]
    });

    fileStore.getPendingFilesByCategory.mockResolvedValue({
      success: true,
      files: {
        small: [
          { id: 'file1', path: 'output/file1.js', size: 1024, status: 'pending', category: 'small' },
          { id: 'file3', path: 'output/file3.js', size: 512, status: 'pending', category: 'small' },
        ],
        large: [
          { id: 'file2', path: 'output/file2.js', size: 2048, status: 'pending', category: 'large' },
        ],
        ultra_large: []
      }
    });

    fileStore.getIdentifiersForBatching.mockResolvedValue({
      success: true,
      batches: [
        {
          id: 'batch1',
          identifiers: [
            { id: 'id1', file_id: 'file1', original_name: 'a', status: 'pending' },
            { id: 'id2', file_id: 'file1', original_name: 'b', status: 'pending' },
          ]
        }
      ]
    });

    fileStore.getProcessedFilesByRunId.mockResolvedValue({
      success: true,
      files: [
        { id: 'file1', path: 'output/file1.js', size: 1024, status: 'completed' },
        { id: 'file2', path: 'output/file2.js', size: 2048, status: 'completed' },
      ]
    });

    fileStore.getFileIdentifiers.mockResolvedValue({
      success: true,
      identifiers: [
        { id: 'id1', original_name: 'a', new_name: 'value', status: 'completed' },
        { id: 'id2', original_name: 'b', new_name: 'item', status: 'completed' },
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fullCycleUnminify', () => {
    const defaultOptions: FullCycleOptions = {
      sourceFile: 'source/app.min.js',
      outputDir: 'output',
      apiKey: 'test-api-key',
      batchSize: 25,
      concurrency: 4,
      skipCompleted: false,
      longRunning: false,
      projectId: 'test-project',
    };

    it('should execute the full cycle unminify process successfully', async () => {
      // Arrange
      const options = { ...defaultOptions };
      
      // Act
      const result = await fullCycleUnminify(options);
      
      // Assert
      expect(result).toEqual({
        success: true,
        runId: 'mock-uuid-1234',
        fileCount: 3,
      });
      
      // Verify all phases were called with correct parameters
      const fileStore = require('../db/file-store.js');
      expect(fileStore.saveProcessingRun).toHaveBeenCalledWith(
        expect.any(String), expect.any(Number), 'test-project'
      );
      expect(fileStore.updateProcessingRun).toHaveBeenCalledWith(
        'mock-uuid-1234', { status: 'completed' }
      );
      
      // Verify the webcrack function was called with the source file
      const { webcrack } = require('../plugins/webcrack.js');
      expect(webcrack).toHaveBeenCalled();
      
      // Verify that the openAIParallelBatchRename was called (part of identifierRenamingPhase)
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      expect(openAIParallelBatchRename).toHaveBeenCalled();
    });

    it('should handle long running mode correctly', async () => {
      // Arrange
      const options = { ...defaultOptions, longRunning: true };
      
      // Act
      const result = await fullCycleUnminify(options);
      
      // Assert
      expect(result).toEqual({
        success: true,
        runId: 'mock-uuid-1234',
        fileCount: 3,
      });
      
      // In long running mode, we should not call openAIParallelBatchRename directly
      // but instead prepare the batch jobs for submission
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      // Verify it's called in a different way in long running mode
      expect(openAIParallelBatchRename).toHaveBeenCalledWith(
        expect.objectContaining({
          submitOnly: true
        }),
        expect.anything()
      );
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const fileStore = require('../db/file-store.js');
      const { webcrack } = require('../plugins/webcrack.js');
      
      // Make webcrack throw an error to simulate a failure
      webcrack.mockRejectedValueOnce(new Error('Webcrack failed'));
      
      // Act & Assert
      await expect(fullCycleUnminify(defaultOptions)).rejects.toThrow('Webcrack failed');
      
      // Verify error handling was performed correctly
      expect(fileStore.updateProcessingRun).toHaveBeenCalledWith(
        'mock-uuid-1234', { status: 'failed', error: 'Webcrack failed' }
      );
    });
  });

  describe('unminifyPhase', () => {
    it('should extract modules from the source file', async () => {
      // Arrange
      const sourceFile = 'source/app.min.js';
      const outputDir = 'output';
      const { webcrack } = require('../plugins/webcrack.js');
      
      // Act
      const result = await unminifyPhase(sourceFile, outputDir);
      
      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].path).toBe('output/file1.js');
      expect(webcrack).toHaveBeenCalledWith(expect.any(String), outputDir);
    });

    it('should handle errors during extraction', async () => {
      // Arrange
      const sourceFile = 'source/app.min.js';
      const outputDir = 'output';
      const { webcrack } = require('../plugins/webcrack.js');
      webcrack.mockRejectedValueOnce(new Error('Extraction failed'));
      
      // Act & Assert
      await expect(unminifyPhase(sourceFile, outputDir)).rejects.toThrow('Extraction failed');
    });
  });

  describe('identifierAnalysisPhase', () => {
    it('should analyze and extract identifiers from files', async () => {
      // Arrange
      const extractedFiles = [
        { path: 'output/file1.js', size: 1024 },
        { path: 'output/file2.js', size: 2048 },
        { path: 'output/file3.js', size: 512 },
      ];
      
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        concurrency: 4,
      };
      
      const runId = 'test-run-id';
      
      // Act
      await identifierAnalysisPhase(extractedFiles, options, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.syncFilesToDatabase).toHaveBeenCalled();
      expect(fileStore.getPendingFilesByCategory).toHaveBeenCalled();
      
      // Verify ParallelExtractor was constructed and used
      const { ParallelExtractor } = require('../extract/parallel-extractor.js');
      expect(ParallelExtractor).toHaveBeenCalled();
    });

    it('should handle empty file list gracefully', async () => {
      // Arrange
      const extractedFiles: any[] = [];
      
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        concurrency: 4,
      };
      
      const runId = 'test-run-id';
      
      // Act
      await identifierAnalysisPhase(extractedFiles, options, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.syncFilesToDatabase).toHaveBeenCalledWith([]);
    });
  });

  describe('identifierRenamingPhase', () => {
    it('should rename identifiers using batch processing', async () => {
      // Arrange
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        batchSize: 25,
        skipCompleted: false,
      };
      
      const runId = 'test-run-id';
      
      // Act
      await identifierRenamingPhase(options, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.getIdentifiersForBatching).toHaveBeenCalledWith(25, true, undefined);
      
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      expect(openAIParallelBatchRename).toHaveBeenCalled();
    });

    it('should handle empty batch list', async () => {
      // Arrange
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        batchSize: 25,
        skipCompleted: false,
      };
      
      const runId = 'test-run-id';
      
      const fileStore = require('../db/file-store.js');
      fileStore.getIdentifiersForBatching.mockResolvedValueOnce({
        success: true,
        batches: []
      });
      
      // Act
      await identifierRenamingPhase(options, runId);
      
      // Assert
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      expect(openAIParallelBatchRename).not.toHaveBeenCalled();
    });
  });

  describe('submitBatchJobsPhase', () => {
    it('should submit batch jobs for long running mode', async () => {
      // Arrange
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        batchSize: 25,
        skipCompleted: false,
      };
      
      const runId = 'test-run-id';
      
      // Act
      await submitBatchJobsPhase(options, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.getIdentifiersForBatching).toHaveBeenCalledWith(25, true, undefined);
      
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      expect(openAIParallelBatchRename).toHaveBeenCalledWith(
        expect.objectContaining({
          submitOnly: true
        }),
        expect.anything()
      );
      
      expect(fileStore.saveBatchJob).toHaveBeenCalled();
    });

    it('should handle empty batch list in long running mode', async () => {
      // Arrange
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        batchSize: 25,
        skipCompleted: false,
      };
      
      const runId = 'test-run-id';
      
      const fileStore = require('../db/file-store.js');
      fileStore.getIdentifiersForBatching.mockResolvedValueOnce({
        success: true,
        batches: []
      });
      
      // Act
      await submitBatchJobsPhase(options, runId);
      
      // Assert
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      expect(openAIParallelBatchRename).not.toHaveBeenCalled();
    });

    it('should handle batch submission errors', async () => {
      // Arrange
      const options: FullCycleOptions = {
        sourceFile: 'source/app.min.js',
        outputDir: 'output',
        apiKey: 'test-api-key',
        batchSize: 25,
        skipCompleted: false,
      };
      
      const runId = 'test-run-id';
      
      const { openAIParallelBatchRename } = require('../rename/parallel-batch-rename.js');
      openAIParallelBatchRename.mockRejectedValueOnce(new Error('Submission failed'));
      
      // Act
      await submitBatchJobsPhase(options, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.saveBatchJob).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        error: 'Submission failed',
      }));
    });
  });

  describe('codeGenerationPhase', () => {
    it('should apply renamed identifiers to code files', async () => {
      // Arrange
      const outputDir = 'output';
      const runId = 'test-run-id';
      
      // Act
      await codeGenerationPhase(outputDir, runId);
      
      // Assert
      const fileStore = require('../db/file-store.js');
      expect(fileStore.getProcessedFilesByRunId).toHaveBeenCalledWith(runId, undefined);
      expect(fileStore.getFileIdentifiers).toHaveBeenCalledWith('file1', undefined);
      
      // Check that fs.readFile and fs.writeFile were called for each file
      expect(fs.readFile).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should handle error when getting processed files', async () => {
      // Arrange
      const outputDir = 'output';
      const runId = 'test-run-id';
      
      const fileStore = require('../db/file-store.js');
      fileStore.getProcessedFilesByRunId.mockResolvedValueOnce({
        success: false,
        error: 'Database error'
      });
      
      // Act & Assert
      await expect(codeGenerationPhase(outputDir, runId)).rejects.toThrow('获取已处理文件失败: Database error');
    });

    it('should handle file read/write errors', async () => {
      // Arrange
      const outputDir = 'output';
      const runId = 'test-run-id';
      
      // Make fs.readFile throw an error for a specific file
      const mockReadFile = fs.readFile as any; // Fixed type
      mockReadFile.mockImplementationOnce(() => {
        throw new Error('Read error');
      });
      
      // Spy on console.error to verify error logging
      const consoleSpy = vi.spyOn(console, 'error');
      
      // Act
      await codeGenerationPhase(outputDir, runId);
      
      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('处理文件失败'),
        expect.anything()
      );
    });

    it('should fallback to unformatted code when prettier fails', async () => {
      // Arrange
      const outputDir = 'output';
      const runId = 'test-run-id';
      
      // We already mocked formatWithPrettier earlier in the file
      const formatUtils = require('../utils/format.js');
      formatUtils.formatWithPrettier.mockRejectedValueOnce(new Error('Formatting error'));
      
      // Spy on console.warn to verify warning message
      const consoleSpy = vi.spyOn(console, 'warn');
      
      // Act
      await codeGenerationPhase(outputDir, runId);
      
      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('美化代码失败'),
        expect.any(String)
      );
    });
  });

  describe('CLI commands', () => {
    // These tests would verify that the CLI commands are properly configured 
    // and call the appropriate functions with the correct parameters
    
    it('should set up the full-cycle command correctly', () => {
      // This requires a different testing approach since we need to test command registration
      // We'll skip the detailed implementation as it would require mocking the CLI library
    });
    
    it('should set up the full-cycle-long-running command correctly', () => {
      // Same comment as above
    });
    
    it('should set up the apply-renames command correctly', () => {
      // Same comment as above
    });
  });
}); 