// MongoDB initialization script based on the Staged-Unminify-System-Design
db = db.getSiblingDB('humanify');

// Create collections
db.createCollection('files');
db.createCollection('chunks');
db.createCollection('identifiers');
db.createCollection('processingRuns');
db.createCollection('performanceMetrics');
db.createCollection('openAIBatches');
db.createCollection('batchRequests');
db.createCollection('batchResponses');
db.createCollection('localBatchTrackers');

// Create indexes for better performance
// Files collection
db.files.createIndex({ "path": 1 }, { unique: true });
db.files.createIndex({ "status": 1 });
db.files.createIndex({ "category": 1 });
db.files.createIndex({ "project_id": 1 });

// Chunks collection
db.chunks.createIndex({ "file_id": 1, "chunk_index": 1 }, { unique: true });
db.chunks.createIndex({ "project_id": 1 });

// Identifiers collection
db.identifiers.createIndex({ "file_id": 1 });
db.identifiers.createIndex({ "custom_id": 1 }, { unique: true });
db.identifiers.createIndex({ "status": 1 });
db.identifiers.createIndex({ "batch_id": 1 });
db.identifiers.createIndex({ "project_id": 1 });

// Processing runs collection
db.processingRuns.createIndex({ "status": 1 });
db.processingRuns.createIndex({ "project_id": 1 });

// Performance metrics collection
db.performanceMetrics.createIndex({ "run_id": 1 });
db.performanceMetrics.createIndex({ "project_id": 1 });

// OpenAI batches collection
db.openAIBatches.createIndex({ "id": 1 }, { unique: true });
db.openAIBatches.createIndex({ "status": 1 });
db.openAIBatches.createIndex({ "project_id": 1 });

// Batch requests collection
db.batchRequests.createIndex({ "custom_id": 1 }, { unique: true });
db.batchRequests.createIndex({ "openai_batch_id": 1 });
db.batchRequests.createIndex({ "project_id": 1 });

// Batch responses collection
db.batchResponses.createIndex({ "custom_id": 1 }, { unique: true });
db.batchResponses.createIndex({ "openai_batch_id": 1 });

// Local batch trackers collection
db.localBatchTrackers.createIndex({ "openai_batch_id": 1 }, { unique: true });
db.localBatchTrackers.createIndex({ "processing_run_id": 1 });
db.localBatchTrackers.createIndex({ "status": 1 });
db.localBatchTrackers.createIndex({ "project_id": 1 });

print("MongoDB initialization completed successfully!"); 