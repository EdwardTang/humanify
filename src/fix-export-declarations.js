#!/usr/bin/env node

/**
 * Fix Export Declarations Script
 * 
 * This script fixes common JavaScript parsing issues with export statements
 * by adding placeholder declarations for exported variables that are not defined.
 */

import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import { fileURLToPath } from 'url';

// Fix for ESM compatibility
const traverse = _traverse.default;
const generate = _generate.default;

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const sourceFile = args[0];
const outputFile = args[1] || (sourceFile ? sourceFile + '.fixed.js' : null);

if (!sourceFile) {
  console.error('Usage: node fix-export-declarations.js <source-file> [output-file]');
  process.exit(1);
}

// Load the source file
let sourceCode;
try {
  sourceCode = fs.readFileSync(sourceFile, 'utf8');
  console.log(`Loaded source file: ${sourceFile} (${sourceCode.length} bytes)`);
} catch (err) {
  console.error(`Error reading source file: ${err.message}`);
  process.exit(1);
}

// Find exports and missing declarations
function fixExportDeclarations(code) {
  // First pass: collect all identifier definitions
  const declaredIdentifiers = new Set();
  let ast;
  
  try {
    // Try parsing with module type first
    ast = parser.parse(code, {
      sourceType: 'module',
      allowUndeclaredExports: true,
      plugins: ['jsx', 'typescript']
    });
  } catch (e) {
    try {
      // Fallback to script type
      ast = parser.parse(code, {
        sourceType: 'script',
        allowUndeclaredExports: true,
        plugins: ['jsx']
      });
    } catch (err) {
      console.error(`Could not parse file: ${err.message}`);
      return code; // Return original code if cannot parse
    }
  }
  
  // Collect all declared variables
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type === 'Identifier') {
        declaredIdentifiers.add(path.node.id.name);
      }
    },
    FunctionDeclaration(path) {
      if (path.node.id) {
        declaredIdentifiers.add(path.node.id.name);
      }
    },
    ClassDeclaration(path) {
      if (path.node.id) {
        declaredIdentifiers.add(path.node.id.name);
      }
    },
    AssignmentExpression(path) {
      if (path.node.left.type === 'Identifier') {
        declaredIdentifiers.add(path.node.left.name);
      }
    }
  });
  
  // Collect exported identifiers that are not declared
  const undeclaredExports = new Set();
  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.specifiers) {
        path.node.specifiers.forEach(specifier => {
          if (specifier.local && specifier.local.name) {
            const name = specifier.local.name;
            if (!declaredIdentifiers.has(name)) {
              undeclaredExports.add(name);
            }
          }
        });
      }
    }
  });
  
  // If no undeclared exports, return original code
  if (undeclaredExports.size === 0) {
    console.log('No undeclared exports found. File is already valid.');
    return code;
  }
  
  // Add declarations for undeclared exports at the beginning of the file
  console.log(`Found ${undeclaredExports.size} undeclared exports: ${Array.from(undeclaredExports).join(', ')}`);
  let declarations = '';
  undeclaredExports.forEach(name => {
    declarations += `var ${name} = {}; /* Placeholder for undeclared export */\n`;
  });
  
  return declarations + code;
}

// Process the file
const fixedCode = fixExportDeclarations(sourceCode);

// Write the fixed file
try {
  fs.writeFileSync(outputFile, fixedCode);
  console.log(`Fixed file written to: ${outputFile}`);
} catch (err) {
  console.error(`Error writing fixed file: ${err.message}`);
  process.exit(1);
} 