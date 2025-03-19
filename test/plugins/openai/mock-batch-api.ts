import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Simulated batch job states
interface MockBatchJob {
  id: string;
  status: 'created' | 'processing' | 'completed' | 'failed' | 'expired';
  input_file_id: string;
  output_file_id: string | null;
  created_at: string;
  updated_at: string;
  error: any | null;
}

// Storage for mock batch jobs and files
const mockBatchJobs = new Map<string, MockBatchJob>();
const mockFiles = new Map<string, { content: Buffer, purpose: string }>();

// Configuration options
interface MockBatchApiOptions {
  port?: number;
  tempDir?: string;
  successRate?: number;
  processingTime?: number;
  failureMode?: 'none' | 'random' | 'specific-identifiers';
  failedIdentifiers?: string[];
}

/**
 * Starts a mock OpenAI Batch API server for testing batch processing
 */
export async function startMockBatchApi({
  port = 3000,
  tempDir = './.humanify-mock-api',
  successRate = 0.9, // 90% success rate by default
  processingTime = 2000, // 2 seconds processing time
  failureMode = 'random',
  failedIdentifiers = []
}: MockBatchApiOptions = {}) {
  const app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.text({ type: 'application/jsonl' }));
  
  // Ensure temp directory exists
  await fs.mkdir(tempDir, { recursive: true });
  
  // Files API endpoints
  app.post('/v1/files', async (req, res) => {
    try {
      const fileId = uuidv4();
      const purpose = req.body.purpose || 'unknown';
      
      // Store file content
      const fileContent = Buffer.from(req.body.file);
      mockFiles.set(fileId, { content: fileContent, purpose });
      
      // Save to disk for debugging
      const filePath = path.join(tempDir, `${fileId}.jsonl`);
      await fs.writeFile(filePath, fileContent);
      
      res.json({
        id: fileId,
        object: 'file',
        purpose,
        created_at: Math.floor(Date.now() / 1000)
      });
    } catch (error) {
      console.error('Error processing file upload:', error);
      res.status(500).json({ error: { message: 'Error uploading file' }});
    }
  });
  
  app.get('/v1/files/:fileId/content', async (req, res) => {
    const fileId = req.params.fileId;
    const file = mockFiles.get(fileId);
    
    if (!file) {
      return res.status(404).json({ error: { message: 'File not found' }});
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.content);
  });
  
  // Batches API endpoints
  app.post('/v1/batches', async (req, res) => {
    try {
      const batchId = uuidv4();
      const inputFileId = req.body.input_file_id;
      
      if (!mockFiles.has(inputFileId)) {
        return res.status(404).json({ error: { message: 'Input file not found' }});
      }
      
      const job: MockBatchJob = {
        id: batchId,
        status: 'created',
        input_file_id: inputFileId,
        output_file_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null
      };
      
      mockBatchJobs.set(batchId, job);
      
      // Process the batch asynchronously
      processBatch(batchId, inputFileId, { 
        successRate, 
        processingTime, 
        tempDir,
        failureMode,
        failedIdentifiers
      });
      
      res.json(job);
    } catch (error) {
      console.error('Error creating batch:', error);
      res.status(500).json({ error: { message: 'Error creating batch' }});
    }
  });
  
  app.get('/v1/batches/:batchId', (req, res) => {
    const batchId = req.params.batchId;
    const job = mockBatchJobs.get(batchId);
    
    if (!job) {
      return res.status(404).json({ error: { message: 'Batch job not found' }});
    }
    
    res.json(job);
  });
  
  // Start the server
  const server = app.listen(port, () => {
    console.log(`Mock OpenAI Batch API running at http://localhost:${port}`);
  });
  
  return server;
}

/**
 * Process a mock batch job asynchronously
 */
async function processBatch(
  batchId: string, 
  inputFileId: string, 
  { 
    successRate, 
    processingTime,
    tempDir,
    failureMode,
    failedIdentifiers 
  }: { 
    successRate: number; 
    processingTime: number;
    tempDir: string;
    failureMode: 'none' | 'random' | 'specific-identifiers';
    failedIdentifiers: string[];
  }
) {
  try {
    // Update status to processing
    const job = mockBatchJobs.get(batchId);
    if (!job) return;
    
    job.status = 'processing';
    job.updated_at = new Date().toISOString();
    mockBatchJobs.set(batchId, job);
    
    // Get the input file content
    const inputFile = mockFiles.get(inputFileId);
    if (!inputFile) {
      job.status = 'failed';
      job.error = { message: 'Input file not found' };
      job.updated_at = new Date().toISOString();
      mockBatchJobs.set(batchId, job);
      return;
    }
    
    // Parse the input file content (JSONL format)
    const lines = inputFile.content.toString().split('\n').filter(line => line.trim());
    const requests = lines.map(line => JSON.parse(line));
    
    // Wait for processing time to simulate real API
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Process each request and generate results
    const results = requests.map(request => {
      const customId = request.custom_id;
      let shouldSucceed = true;
      
      // Determine if this request should succeed or fail
      if (failureMode === 'random') {
        shouldSucceed = Math.random() < successRate;
      } else if (failureMode === 'specific-identifiers') {
        // Extract the identifier name from the request
        const body = JSON.parse(request.body);
        const promptContent = body.messages[0].content;
        const identifierMatch = promptContent.match(/\`([a-zA-Z0-9_$]+)\`/);
        const identifier = identifierMatch ? identifierMatch[1] : null;
        
        if (identifier && failedIdentifiers.includes(identifier)) {
          shouldSucceed = false;
        }
      }
      
      if (shouldSucceed) {
        // Generate a renamed identifier
        const originalName = extractOriginalNameFromRequest(request);
        const newName = generateMockRenamedIdentifier(originalName);
        
        return {
          custom_id: customId,
          response: {
            id: uuidv4(),
            body: {
              choices: [
                {
                  message: {
                    content: JSON.stringify({ newName })
                  }
                }
              ]
            }
          }
        };
      } else {
        // Generate an error response
        return {
          custom_id: customId,
          error: {
            message: 'Mock API error: Failed to process rename request'
          }
        };
      }
    });
    
    // Write the results to a file
    const outputFileId = uuidv4();
    const outputContent = Buffer.from(results.map(result => JSON.stringify(result)).join('\n'));
    mockFiles.set(outputFileId, { content: outputContent, purpose: 'batch_result' });
    
    // Save to disk for debugging
    const filePath = path.join(tempDir, `${outputFileId}.jsonl`);
    await fs.writeFile(filePath, outputContent);
    
    // Update the job status
    job.status = 'completed';
    job.output_file_id = outputFileId;
    job.updated_at = new Date().toISOString();
    mockBatchJobs.set(batchId, job);
  } catch (error) {
    console.error('Error processing batch:', error);
    
    // Update job to failed status
    const job = mockBatchJobs.get(batchId);
    if (job) {
      job.status = 'failed';
      job.error = { message: 'Internal server error' };
      job.updated_at = new Date().toISOString();
      mockBatchJobs.set(batchId, job);
    }
  }
}

/**
 * Extract the original name from a request
 */
function extractOriginalNameFromRequest(request: any): string {
  try {
    const body = JSON.parse(request.body);
    const promptContent = body.messages[0].content;
    const identifierMatch = promptContent.match(/\`([a-zA-Z0-9_$]+)\`/);
    return identifierMatch ? identifierMatch[1] : 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Generate a mock renamed identifier
 */
function generateMockRenamedIdentifier(originalName: string): string {
  // Dictionary of common prefixes for different types
  const prefixes = {
    a: 'array',
    b: 'boolean',
    n: 'number',
    s: 'string',
    o: 'object',
    f: 'function',
    e: 'event',
    i: 'index',
    c: 'count',
    t: 'temp',
    el: 'element',
    p: 'parameter',
    v: 'value'
  };
  
  // If the original name starts with a common prefix, expand it
  for (const [prefix, expansion] of Object.entries(prefixes)) {
    if (originalName.startsWith(prefix) && originalName !== prefix) {
      const restOfName = originalName.slice(prefix.length);
      // Capitalize first letter of the rest
      const capitalizedRest = restOfName.charAt(0).toUpperCase() + restOfName.slice(1);
      return expansion + capitalizedRest;
    }
  }
  
  // For single letter variables, add a descriptive word
  if (originalName.length === 1) {
    const prefixExpansion = prefixes[originalName as keyof typeof prefixes];
    if (prefixExpansion) {
      return prefixExpansion + 'Value';
    }
  }
  
  // For others, add a descriptive suffix
  return originalName + 'Value';
}

// If this file is run directly, start the mock server
if (import.meta.url === `file://${process.argv[1]}`) {
  startMockBatchApi().catch(error => {
    console.error('Failed to start mock API server:', error);
    process.exit(1);
  });
} 