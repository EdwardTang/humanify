const fs = require('fs').promises;
const path = require('path');
const { Transform } = require('stream');
const beautify = require('js-beautify');

// Configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_MEMORY_USAGE = 1024 * 1024 * 1024; // 1GB memory limit

class DeobfuscatorTransform extends Transform {
    constructor(options = {}) {
        super({ ...options, objectMode: true });
        this.buffer = '';
        this.processedChunks = 0;
    }

    _transform(chunk, encoding, callback) {
        try {
            // Append new chunk to buffer
            this.buffer += chunk.toString();
            
            // Process complete JavaScript statements
            const statements = this.extractCompleteStatements(this.buffer);
            
            if (statements.length > 0) {
                // Process and push complete statements
                const deobfuscated = this.deobfuscateStatements(statements);
                this.push(deobfuscated);
                
                // Update progress
                this.processedChunks++;
                if (this.processedChunks % 10 === 0) {
                    console.log(`Processed ${this.processedChunks} chunks...`);
                    // Force garbage collection
                    if (global.gc) {
                        global.gc();
                    }
                }
            }
            
            callback();
        } catch (error) {
            callback(error);
        }
    }

    _flush(callback) {
        try {
            // Process any remaining buffer content
            if (this.buffer.length > 0) {
                const deobfuscated = this.deobfuscateStatements([this.buffer]);
                this.push(deobfuscated);
            }
            callback();
        } catch (error) {
            callback(error);
        }
    }

    extractCompleteStatements(code) {
        // Simple statement extraction - can be improved based on specific needs
        const statements = [];
        let depth = 0;
        let start = 0;

        for (let i = 0; i < code.length; i++) {
            switch (code[i]) {
                case '{':
                    depth++;
                    break;
                case '}':
                    depth--;
                    if (depth === 0) {
                        statements.push(code.slice(start, i + 1));
                        start = i + 1;
                    }
                    break;
                case ';':
                    if (depth === 0) {
                        statements.push(code.slice(start, i + 1));
                        start = i + 1;
                    }
                    break;
            }
        }

        // Update buffer to contain only incomplete statements
        this.buffer = code.slice(start);
        return statements;
    }

    deobfuscateStatements(statements) {
        return statements.map(stmt => {
            try {
                return beautify(stmt, {
                    indent_size: 2,
                    space_in_empty_paren: true,
                    preserve_newlines: true,
                    max_preserve_newlines: 2,
                });
            } catch (error) {
                console.error('Error deobfuscating statement:', error);
                return stmt; // Return original if deobfuscation fails
            }
        }).join('\n');
    }
}

async function deobfuscateFile(inputPath, outputPath) {
    try {
        console.log(`Starting deobfuscation of ${inputPath}`);
        console.log(`Memory limit set to ${MAX_MEMORY_USAGE / 1024 / 1024}MB`);

        const deobfuscator = new DeobfuscatorTransform();
        const writeStream = fs.createWriteStream(outputPath);

        // Set up error handlers
        deobfuscator.on('error', (error) => {
            console.error('Deobfuscation error:', error);
            writeStream.end();
        });

        writeStream.on('error', (error) => {
            console.error('Write stream error:', error);
        });

        // Process the file in chunks
        const fileHandle = await fs.open(inputPath, 'r');
        let position = 0;
        let bytesRead;

        do {
            const buffer = Buffer.alloc(CHUNK_SIZE);
            bytesRead = (await fileHandle.read(buffer, 0, CHUNK_SIZE, position)).bytesRead;
            
            if (bytesRead > 0) {
                // Check memory usage
                const memUsage = process.memoryUsage().heapUsed;
                if (memUsage > MAX_MEMORY_USAGE) {
                    if (global.gc) {
                        console.log('Memory threshold reached, triggering GC...');
                        global.gc();
                    }
                    // Small delay to allow GC to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Process chunk
                const chunk = buffer.slice(0, bytesRead);
                await new Promise((resolve, reject) => {
                    deobfuscator.write(chunk, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                position += bytesRead;
            }
        } while (bytesRead === CHUNK_SIZE);

        // Clean up
        await fileHandle.close();
        deobfuscator.end();

        // Set up completion handling
        return new Promise((resolve, reject) => {
            deobfuscator.pipe(writeStream);
            writeStream.on('finish', () => {
                console.log('Deobfuscation completed successfully!');
                resolve();
            });
            writeStream.on('error', reject);
        });
    } catch (error) {
        console.error('Fatal error during deobfuscation:', error);
        throw error;
    }
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error('Usage: node --expose-gc chunked_deobfuscate.js <input_file> <output_file>');
        process.exit(1);
    }

    const [inputFile, outputFile] = args;
    deobfuscateFile(inputFile, outputFile)
        .then(() => {
            console.log('Deobfuscation process completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Deobfuscation failed:', error);
            process.exit(1);
        });
} 