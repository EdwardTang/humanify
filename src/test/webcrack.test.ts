import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrack } from '../plugins/webcrack.js';
import fs from 'fs/promises';
import path from 'path';

describe('webcrack', () => {
  const outputDir = path.join(process.cwd(), '.tmp-test-output');
  
  // Cleanup before each test
  beforeEach(async () => {
    // Create the output directory if it doesn't exist
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's fine
    }
  });

  it('should use fallback implementation when webcrack package is not available', async () => {
    // Simple minified code
    const minifiedCode = 'function a(b,c){return b+c}console.log(a(1,2));';
    
    // Call webcrack function
    const result = await webcrack(minifiedCode, outputDir);
    
    // Verify that webcrack returns file information
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
    
    // Each result should have a path property
    result.forEach(file => {
      expect(file).toHaveProperty('path');
      expect(file.path.includes(outputDir)).toBe(true);
    });
  });
  
  it('should handle empty code', async () => {
    const result = await webcrack('', outputDir);
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
  });
  
  it('should handle null or undefined gracefully', async () => {
    // @ts-ignore - Testing invalid input
    const result1 = await webcrack(null, outputDir);
    expect(result1).toBeInstanceOf(Array);
    
    // @ts-ignore - Testing invalid input
    const result2 = await webcrack(undefined, outputDir);
    expect(result2).toBeInstanceOf(Array);
  });
}); 