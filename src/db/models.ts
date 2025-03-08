import mongoose, { Schema, Document, model, Model, Types } from 'mongoose';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 连接到MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:example@localhost:27017/';
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'humanify';

const DB_URI = `${MONGODB_URI.endsWith('/') ? MONGODB_URI.slice(0, -1) : MONGODB_URI}/${MONGODB_DATABASE}`;

// 连接数据库
export async function connectDB() {
  try {
    await mongoose.connect(DB_URI);
    console.log('MongoDB 连接成功');
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    process.exit(1);
  }
}

// 文件模型接口
export interface IFile extends Document {
  path: string;
  file_name: string;
  file_type: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  category: 'small' | 'large' | 'ultra_large';
  chunk_count?: number;
  last_processing_time?: number;
  last_processing_error?: string;
  created_at: Date;
  updated_at: Date;
  project_id: string;
}

// 文件块模型接口
export interface IChunk extends Document {
  file_id: Types.ObjectId;
  chunk_index: number;
  content: string;
  created_at: Date;
  updated_at: Date;
  project_id: string;
}

// 标识符模型接口
export interface IIdentifier extends Document {
  file_id: Types.ObjectId;
  chunk_id?: Types.ObjectId;
  original_name: string;
  new_name?: string;
  surrounding_code: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  custom_id: string;
  batch_id?: string;
  created_at: Date;
  updated_at: Date;
  project_id: string;
}

// 处理运行模型接口
export interface IProcessingRun extends Document {
  status: 'running' | 'completed' | 'failed';
  config: string;
  total_files: number;
  processed_files: number;
  failed_files: number;
  start_time: Date;
  end_time?: Date;
  error?: string;
  project_id: string;
}

// 性能指标模型接口
export interface IPerformanceMetric extends Document {
  run_id: Types.ObjectId;
  metric_name: string;
  value: number;
  unit: string;
  metadata?: Record<string, any>;
  created_at: Date;
  project_id: string;
}

// 批处理事件模型接口
export interface IBatchEvent {
  timestamp: Date;
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled';
  details?: string;
}

// OpenAI批处理模型接口
export interface IOpenAIBatch extends Document {
  batch_id: string; // OpenAI批处理ID
  status: 'created' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled';
  created_at: Date;
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
  events: IBatchEvent[];
  error?: string;
  project_id: string;
}

// 批处理请求模型接口
export interface IBatchRequest extends Document {
  custom_id: string;
  method: string;
  url: string;
  body: any;
  openai_batch_id: string;
  project_id: string;
}

// 批处理响应模型接口
export interface IBatchResponse extends Document {
  request_id: Types.ObjectId; // 关联的请求ID
  custom_id: string;
  response: {
    status_code: number;
    request_id: string;
    body: any;
    error?: any;
  };
  openai_batch_id: string;
}

// 本地批处理跟踪模型接口
export interface ILocalBatchTracker extends Document {
  openai_batch_id: string;
  type: 'small' | 'large' | 'ultra_large';
  file_ids: Types.ObjectId[];
  identifier_count: number;
  tasks_file_path: string;
  output_file_path?: string;
  processing_run_id: Types.ObjectId;
  processing_start: Date;
  processing_end?: Date;
  status: 'preparing' | 'submitting' | 'processing' | 'downloading' | 'applying' | 'completed' | 'failed';
  error?: string;
  created_at: Date;
  updated_at: Date;
  project_id: string;
}

// 文件模型Schema
const FileSchema = new Schema<IFile>({
  path: { type: String, required: true, index: true },
  file_name: { type: String, required: true },
  file_type: { type: String, required: true },
  size: { type: Number, required: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  category: { 
    type: String, 
    required: true, 
    enum: ['small', 'large', 'ultra_large'],
    index: true
  },
  chunk_count: { type: Number },
  last_processing_time: { type: Number },
  last_processing_error: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  project_id: { type: String, required: true, index: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 文件块模型Schema
const ChunkSchema = new Schema<IChunk>({
  file_id: { type: Schema.Types.ObjectId, ref: 'File', required: true, index: true },
  chunk_index: { type: Number, required: true },
  content: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  project_id: { type: String, required: true, index: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 标识符模型Schema
const IdentifierSchema = new Schema<IIdentifier>({
  file_id: { type: Schema.Types.ObjectId, ref: 'File', required: true, index: true },
  chunk_id: { type: Schema.Types.ObjectId, ref: 'Chunk', index: true },
  original_name: { type: String, required: true },
  new_name: { type: String },
  surrounding_code: { type: String, required: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  custom_id: { type: String, required: true, unique: true },
  batch_id: { type: String, index: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  project_id: { type: String, required: true, index: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 处理运行模型Schema
const ProcessingRunSchema = new Schema<IProcessingRun>({
  status: { 
    type: String, 
    required: true, 
    enum: ['running', 'completed', 'failed'],
    default: 'running',
    index: true
  },
  config: { type: String, required: true },
  total_files: { type: Number, required: true, default: 0 },
  processed_files: { type: Number, required: true, default: 0 },
  failed_files: { type: Number, required: true, default: 0 },
  start_time: { type: Date, required: true, default: Date.now },
  end_time: { type: Date },
  error: { type: String },
  project_id: { type: String, required: true, index: true }
});

// 性能指标模型Schema
const PerformanceMetricSchema = new Schema<IPerformanceMetric>({
  run_id: { type: Schema.Types.ObjectId, ref: 'ProcessingRun', required: true, index: true },
  metric_name: { type: String, required: true },
  value: { type: Number, required: true },
  unit: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now },
  project_id: { type: String, required: true, index: true }
}, {
  timestamps: { createdAt: 'created_at' }
});

// 批处理事件模型Schema（子文档，不作为单独的集合）
const BatchEventSchema = new Schema<IBatchEvent>({
  timestamp: { type: Date, required: true, default: Date.now },
  status: { 
    type: String, 
    required: true, 
    enum: ['created', 'in_progress', 'finalizing', 'completed', 'failed', 'cancelled']
  },
  details: { type: String }
});

// OpenAI批处理模型Schema
const OpenAIBatchSchema = new Schema<IOpenAIBatch>({
  batch_id: { type: String, required: true, unique: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['created', 'in_progress', 'finalizing', 'completed', 'failed', 'cancelled'],
    index: true
  },
  created_at: { type: Date, required: true, default: Date.now },
  endpoint: { type: String, required: true },
  completion_window: { type: String, required: true },
  completion_time: { type: String },
  total_requests: { type: Number, required: true, default: 0 },
  completed_requests: { type: Number, required: true, default: 0 },
  failed_requests: { type: Number, required: true, default: 0 },
  input_file_id: { type: String, required: true },
  input_file_path: { type: String, required: true },
  output_file_id: { type: String },
  output_file_path: { type: String },
  error_file_path: { type: String },
  events: [BatchEventSchema],
  error: { type: String },
  project_id: { type: String, required: true, index: true }
});

// 批处理请求模型Schema
const BatchRequestSchema = new Schema<IBatchRequest>({
  custom_id: { type: String, required: true, unique: true },
  method: { type: String, required: true },
  url: { type: String, required: true },
  body: { type: Schema.Types.Mixed, required: true },
  openai_batch_id: { type: String, required: true, index: true },
  project_id: { type: String, required: true, index: true }
});

// 批处理响应模型Schema
const BatchResponseSchema = new Schema<IBatchResponse>({
  request_id: { type: Schema.Types.ObjectId, ref: 'BatchRequest', required: true, index: true },
  custom_id: { type: String, required: true, index: true },
  response: {
    status_code: { type: Number, required: true },
    request_id: { type: String, required: true },
    body: { type: Schema.Types.Mixed },
    error: { type: Schema.Types.Mixed }
  },
  openai_batch_id: { type: String, required: true, index: true }
});

// 本地批处理跟踪模型Schema
const LocalBatchTrackerSchema = new Schema<ILocalBatchTracker>({
  openai_batch_id: { type: String, required: true, index: true },
  type: { 
    type: String, 
    required: true, 
    enum: ['small', 'large', 'ultra_large'],
    index: true
  },
  file_ids: [{ type: Schema.Types.ObjectId, ref: 'File' }],
  identifier_count: { type: Number, required: true, default: 0 },
  tasks_file_path: { type: String, required: true },
  output_file_path: { type: String },
  processing_run_id: { type: Schema.Types.ObjectId, ref: 'ProcessingRun', required: true, index: true },
  processing_start: { type: Date, required: true, default: Date.now },
  processing_end: { type: Date },
  status: { 
    type: String, 
    required: true, 
    enum: ['preparing', 'submitting', 'processing', 'downloading', 'applying', 'completed', 'failed'],
    default: 'preparing',
    index: true
  },
  error: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  project_id: { type: String, required: true, index: true }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// 创建和导出模型
export const File: Model<IFile> = mongoose.models.File || model<IFile>('File', FileSchema);
export const Chunk: Model<IChunk> = mongoose.models.Chunk || model<IChunk>('Chunk', ChunkSchema);
export const Identifier: Model<IIdentifier> = mongoose.models.Identifier || model<IIdentifier>('Identifier', IdentifierSchema);
export const ProcessingRun: Model<IProcessingRun> = mongoose.models.ProcessingRun || model<IProcessingRun>('ProcessingRun', ProcessingRunSchema);
export const PerformanceMetric: Model<IPerformanceMetric> = mongoose.models.PerformanceMetric || model<IPerformanceMetric>('PerformanceMetric', PerformanceMetricSchema);
export const OpenAIBatch: Model<IOpenAIBatch> = mongoose.models.OpenAIBatch || model<IOpenAIBatch>('OpenAIBatch', OpenAIBatchSchema);
export const BatchRequest: Model<IBatchRequest> = mongoose.models.BatchRequest || model<IBatchRequest>('BatchRequest', BatchRequestSchema);
export const BatchResponse: Model<IBatchResponse> = mongoose.models.BatchResponse || model<IBatchResponse>('BatchResponse', BatchResponseSchema);
export const LocalBatchTracker: Model<ILocalBatchTracker> = mongoose.models.LocalBatchTracker || model<ILocalBatchTracker>('LocalBatchTracker', LocalBatchTrackerSchema);

// 导出数据库连接实例
export const db = mongoose.connection;

// 断开连接函数
export async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('MongoDB 连接已关闭');
  } catch (error) {
    console.error('关闭 MongoDB 连接时出错:', error);
  }
}

// 确保在应用退出时关闭数据库连接
process.on('SIGINT', async () => {
  await disconnectDB();
  process.exit(0);
}); 