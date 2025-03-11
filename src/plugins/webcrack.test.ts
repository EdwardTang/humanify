import { describe, it, expect } from 'vitest';
import { unminifyCode } from './webcrack.js';

describe('webcrack', () => {
  it('should use fallback implementation when webcrack package is not available', async () => {
    // Simple minified code
    const minifiedCode = 'function a(b,c){return b+c}console.log(a(1,2));';
    
    // Unminify the code
    const result = await unminifyCode(minifiedCode);
    
    // Check that unminification did something (should at least remove semicolons and add spaces)
    expect(result).not.toBe(minifiedCode);
    expect(result.length).toBeGreaterThan(minifiedCode.length);
    
    // Verify that the result contains the function name and parameter names
    expect(result).toContain('function a');
    expect(result).toContain('b, c');
  });
  
  it('should handle empty code', async () => {
    const result = await unminifyCode('');
    expect(result).toBe('');
  });
  
  it('should handle null or undefined gracefully', async () => {
    // @ts-ignore - Testing invalid input
    const result1 = await unminifyCode(null);
    expect(result1).toBe('');
    
    // @ts-ignore - Testing invalid input
    const result2 = await unminifyCode(undefined);
    expect(result2).toBe('');
  });
}); 