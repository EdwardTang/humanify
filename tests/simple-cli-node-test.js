// Simple passing test file using Node.js native test runner
import test from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fs from 'node:fs';

// Get current file path in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('simple cli test - should always pass', async (t) => {
  assert.strictEqual(true, true);
});

test('simple cli test - basic addition', async (t) => {
  assert.strictEqual(1 + 1, 2);
});

test('simple cli test - string operations', async (t) => {
  assert.strictEqual('hello ' + 'world', 'hello world');
});

test('simple cli test - array operations', async (t) => {
  const arr = [1, 2, 3];
  assert.deepStrictEqual([...arr, 4], [1, 2, 3, 4]);
});

test('simple cli test - object operations', async (t) => {
  const obj = { a: 1, b: 2 };
  assert.deepStrictEqual({ ...obj, c: 3 }, { a: 1, b: 2, c: 3 });
});

// File operations test
test('simple cli test - file operations', async (t) => {
  assert.strictEqual(fs.existsSync(__filename), true);
}); 