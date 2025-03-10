import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as dbHelpers from '../db/db-helpers-adapter.js';
import { 
  File, 
  Identifier, 
  ProcessingRun, 
  OpenAIBatch,
  LocalBatchTracker,
  connectDB,
  disconnectDB
} from '../db/models.js';

// 声明变量来存储MongoDB内存服务器实例
let mongoServer: MongoMemoryServer;

// 测试数据
const testFile = {
  path: '/test/path/file.js',
  size: 1024
};

const testIdentifiers = [
  {
    original_name: 'a',
    surrounding_code: 'function a() { return 1; }',
    custom_id: 'test-id-1'
  },
  {
    original_name: 'b',
    surrounding_code: 'const b = 2;',
    custom_id: 'test-id-2'
  }
];

describe('Database Helpers', async () => {
  before(async () => {
    // 创建MongoDB内存服务器实例
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    
    // 连接到内存数据库
    await mongoose.connect(mongoUri);
    console.log('Connected to in-memory test database');
  });

  after(async () => {
    // 断开连接
    await mongoose.disconnect();
    // 停止MongoDB内存服务器
    await mongoServer.stop();
    console.log('Disconnected from in-memory test database and stopped server');
  });

  beforeEach(async () => {
    // 清空集合
    await File.deleteMany({});
    await Identifier.deleteMany({});
    await ProcessingRun.deleteMany({});
    await OpenAIBatch.deleteMany({});
    await LocalBatchTracker.deleteMany({});
  });

  describe('File Operations', async () => {
    it('should sync files to database', async () => {
      const result = await dbHelpers.syncFilesToDatabase([testFile]);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 1);
      
      const files = await File.find({});
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].path, testFile.path);
      assert.strictEqual(files[0].size, testFile.size);
      assert.strictEqual(files[0].status, 'pending');
    });

    it('should get pending files by category', async () => {
      // 创建测试文件
      await File.create({
        path: '/test/small.js',
        file_name: 'small.js',
        file_type: 'js',
        size: 1024,
        category: 'small',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });
      
      await File.create({
        path: '/test/large.js',
        file_name: 'large.js',
        file_type: 'js',
        size: 102400,
        category: 'large',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.getPendingFilesByCategory();
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.files?.small.length, 1);
      assert.strictEqual(result.files?.large.length, 1);
      assert.strictEqual(result.files?.ultra_large.length, 0);
    });

    it('should update file status', async () => {
      // 创建测试文件
      const file = await File.create({
        path: '/test/file.js',
        file_name: 'file.js',
        file_type: 'js',
        size: 1024,
        category: 'small',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.updateFileStatus(
        file._id.toString(), 
        'completed',
        100,
        undefined
      );
      
      assert.strictEqual(result.success, true);
      
      const updatedFile = await File.findById(file._id);
      assert.strictEqual(updatedFile?.status, 'completed');
      assert.strictEqual(updatedFile?.last_processing_time, 100);
    });
  });

  describe('Identifier Operations', async () => {
    it('should create identifiers', async () => {
      // 创建测试文件
      const file = await File.create({
        path: '/test/file.js',
        file_name: 'file.js',
        file_type: 'js',
        size: 1024,
        category: 'small',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.createIdentifiers(
        testIdentifiers,
        file._id.toString()
      );
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 2);
      
      const identifiers = await Identifier.find({});
      assert.strictEqual(identifiers.length, 2);
      assert.strictEqual(identifiers[0].original_name, testIdentifiers[0].original_name);
      assert.strictEqual(identifiers[1].original_name, testIdentifiers[1].original_name);
    });

    it('should get identifiers for batching', async () => {
      // 创建测试文件
      const file = await File.create({
        path: '/test/file.js',
        file_name: 'file.js',
        file_type: 'js',
        size: 1024,
        category: 'small',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      // 创建测试标识符
      await Identifier.create({
        file_id: file._id,
        original_name: 'a',
        surrounding_code: 'function a() { return 1; }',
        status: 'pending',
        custom_id: 'test-id-1',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });
      
      await Identifier.create({
        file_id: file._id,
        original_name: 'b',
        surrounding_code: 'const b = 2;',
        status: 'pending',
        custom_id: 'test-id-2',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.getIdentifiersForBatching(10);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.batches.length, 1);
      assert.strictEqual(result.batches[0].identifiers.length, 2);
    });

    it('should update identifier', async () => {
      // 创建测试文件
      const file = await File.create({
        path: '/test/file.js',
        file_name: 'file.js',
        file_type: 'js',
        size: 1024,
        category: 'small',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      // 创建测试标识符
      const identifier = await Identifier.create({
        file_id: file._id,
        original_name: 'a',
        surrounding_code: 'function a() { return 1; }',
        status: 'pending',
        custom_id: 'test-id-1',
        created_at: new Date(),
        updated_at: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.updateIdentifier(
        identifier._id.toString(),
        'functionA',
        'completed'
      );
      
      assert.strictEqual(result.success, true);
      
      const updatedIdentifier = await Identifier.findById(identifier._id);
      assert.strictEqual(updatedIdentifier?.new_name, 'functionA');
      assert.strictEqual(updatedIdentifier?.status, 'completed');
    });
  });

  describe('Processing Run Operations', async () => {
    it('should start processing run', async () => {
      const result = await dbHelpers.startProcessingRun(
        JSON.stringify({ test: true }),
        10
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.runId);
      
      const run = await ProcessingRun.findById(result.runId);
      assert.strictEqual(run?.status, 'running');
      assert.strictEqual(run?.total_files, 10);
    });

    it('should complete processing run', async () => {
      // 创建测试处理运行
      const run = await ProcessingRun.create({
        status: 'running',
        config: JSON.stringify({ test: true }),
        total_files: 10,
        processed_files: 0,
        failed_files: 0,
        start_time: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.completeProcessingRun(
        run._id.toString(),
        { status: 'completed' }
      );
      
      assert.strictEqual(result.success, true);
      
      const updatedRun = await ProcessingRun.findById(run._id);
      assert.strictEqual(updatedRun?.status, 'completed');
      assert.ok(updatedRun?.end_time);
    });

    it('should update processing run progress', async () => {
      // 创建测试处理运行
      const run = await ProcessingRun.create({
        status: 'running',
        config: JSON.stringify({ test: true }),
        total_files: 10,
        processed_files: 0,
        failed_files: 0,
        start_time: new Date(),
        project_id: 'default'
      });

      const result = await dbHelpers.updateProcessingRunProgress(
        run._id.toString(),
        5,
        1
      );
      
      assert.strictEqual(result.success, true);
      
      const updatedRun = await ProcessingRun.findById(run._id);
      assert.strictEqual(updatedRun?.processed_files, 5);
      assert.strictEqual(updatedRun?.failed_files, 1);
    });
  });

  // 批处理作业相关测试可以根据实际需要添加
  // 这里只是一个基础的测试框架
}); 