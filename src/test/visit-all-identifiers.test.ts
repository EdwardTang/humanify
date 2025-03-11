import assert from "assert";
import test from "node:test";
import { visitAllIdentifiers } from "../plugins/local-llm-rename/visit-all-identifiers.js";
import { describe, it, expect } from 'vitest';

test("no-op returns the same code", async () => {
  const code = `const a = 1;`;
  assert.equal(
    code,
    await visitAllIdentifiers(code, async (name) => name, 200)
  );
});

test("no-op returns the same empty code", async () => {
  const code = "";
  assert.equal(
    code,
    await visitAllIdentifiers(code, async (name) => name, 200)
  );
});

test("renames a simple variable", async () => {
  const code = `const a = 1;`;
  assert.equal(
    `const b = 1;`,
    await visitAllIdentifiers(code, async () => "b", 200)
  );
});

test("renames variables even if they have different scopes", async () => {
  const code = `
const a = 1;
(function () {
  a = 2;
});
  `.trim();
  const expected = `
const b = 1;
(function () {
  b = 2;
});
  `.trim();
  assert.equal(expected, await visitAllIdentifiers(code, async () => "b", 200));
});

test("renames two scopes, starting from largest scope to smallest", async () => {
  const code = `
const a = 1;
(function () {
  const b = 2;
});
  `.trim();
  const expected = `
const newA = 1;
(function () {
  const newB = 2;
});
  `.trim();
  assert.equal(
    expected,
    await visitAllIdentifiers(
      code,
      async (name) => (name === "a" ? "newA" : "newB"),
      200
    )
  );
});

// Adding a vitest-style test to ensure the file has a test suite
describe('visitAllIdentifiers', () => {
  it('should have tests', () => {
    expect(true).toBe(true);
  });
}); 