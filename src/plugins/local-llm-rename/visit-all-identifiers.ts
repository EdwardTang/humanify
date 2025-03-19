import { parseAsync, transformFromAstAsync, NodePath } from "@babel/core";
import * as babelTraverse from "@babel/traverse";
import { Identifier, toIdentifier, Node } from "@babel/types";

const traverse: typeof babelTraverse.default.default = (
  typeof babelTraverse.default === "function"
    ? babelTraverse.default
    : babelTraverse.default.default
) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- This hack is because pkgroll fucks up the import somehow

type Visitor = (name: string, scope: string, scopeId: string) => Promise<string>;

// Interface to represent a scoped identifier
export interface ScopedIdentifier {
  name: string;
  scopeId: string;
  scopeDescription: string;
}

// Generate a unique scope ID based on the path and binding context
function generateScopeId(path: NodePath<Identifier>): string {
  const scope = path.scope;
  const bindingPath = scope.getBinding(path.node.name)?.path;
  const scopeLocation = path.node.loc ? 
    `${path.node.loc.start.line}:${path.node.loc.start.column}` : 
    `${path.node.start || 0}`;
  
  // Create a unique scope ID including the type of declaration and location
  const scopeType = bindingPath?.parent.type || "global";
  const parentFunction = path.findParent(p => 
    p.isFunctionDeclaration() || 
    p.isFunctionExpression() || 
    p.isArrowFunctionExpression()
  );
  
  // Include function name if available for more readable scope IDs
  const funcName = parentFunction?.isFunctionDeclaration() && 
    parentFunction.node.id ? 
    parentFunction.node.id.name : 
    "anonymous";
  
  return `${scopeType}:${funcName}:${scopeLocation}`;
}

// Generate a human-readable description of the scope
function describeScopeContext(path: NodePath<Identifier>): string {
  const parentFunction = path.findParent(p => 
    p.isFunctionDeclaration() || 
    p.isFunctionExpression() || 
    p.isArrowFunctionExpression()
  );
  
  if (parentFunction) {
    // For function declarations, include the name
    if (parentFunction.isFunctionDeclaration() && parentFunction.node.id) {
      return `function ${parentFunction.node.id.name}`;
    }
    
    // For method definitions, include class/object name if possible
    const parentClass = parentFunction.findParent(p => p.isClassDeclaration() || p.isObjectExpression());
    if (parentClass?.isClassDeclaration() && parentClass.node.id) {
      return `method in class ${parentClass.node.id.name}`;
    }
    
    // For anonymous functions, try to infer purpose from variable assignment
    const variableDeclarator = parentFunction.findParent(p => p.isVariableDeclarator());
    if (variableDeclarator?.isVariableDeclarator() && variableDeclarator.node.id.type === "Identifier") {
      return `function assigned to ${variableDeclarator.node.id.name}`;
    }
    
    return "anonymous function";
  }
  
  // For top-level variables
  const program = path.findParent(p => p.isProgram());
  if (program) {
    return "global scope";
  }
  
  // For block-scoped variables
  const block = path.findParent(p => p.isBlockStatement());
  if (block) {
    return "block scope";
  }
  
  return "unknown scope";
}

export async function visitAllIdentifiers(
  code: string,
  visitor: Visitor,
  contextWindowSize: number,
  onProgress?: (percentageDone: number) => void
) {
  const ast = await parseAsync(code, { sourceType: "unambiguous" });
  const renames = new Set<string>();
  const visited = new Map<string, Set<string>>(); // Map from identifier name to set of scope IDs

  if (!ast) {
    throw new Error("Failed to parse code");
  }

  const scopes = await findScopes(ast);
  const numRenamesExpected = scopes.length;

  for (const smallestScope of scopes) {
    const scopeId = generateScopeId(smallestScope);
    const scopeDescription = describeScopeContext(smallestScope);
    
    if (hasVisited(smallestScope, scopeId, visited)) continue;

    const smallestScopeNode = smallestScope.node;
    if (smallestScopeNode.type !== "Identifier") {
      throw new Error("No identifiers found");
    }

    const surroundingCode = await scopeToString(
      smallestScope,
      contextWindowSize
    );
    
    // Pass the scope ID and description to the visitor
    const renamed = await visitor(
      smallestScopeNode.name, 
      surroundingCode,
      `${smallestScopeNode.name}:${scopeId}`
    );
    
    if (renamed !== smallestScopeNode.name) {
      let safeRenamed = toIdentifier(renamed);
      while (
        renames.has(safeRenamed) ||
        smallestScope.scope.hasBinding(safeRenamed)
      ) {
        safeRenamed = `_${safeRenamed}`;
      }
      renames.add(safeRenamed);

      smallestScope.scope.rename(smallestScopeNode.name, safeRenamed);
    }
    markVisited(smallestScope, scopeId, visited);

    onProgress?.(visited.size / numRenamesExpected);
  }
  onProgress?.(1);

  const stringified = await transformFromAstAsync(ast);
  if (stringified?.code == null) {
    throw new Error("Failed to stringify code");
  }
  return stringified.code;
}

function findScopes(ast: Node): NodePath<Identifier>[] {
  const scopes: [nodePath: NodePath<Identifier>, scopeSize: number][] = [];
  traverse(ast, {
    BindingIdentifier(path) {
      const bindingBlock = closestSurroundingContextPath(path).scope.block;
      const pathSize = bindingBlock.end! - bindingBlock.start!;

      scopes.push([path, pathSize]);
    }
  });

  scopes.sort((a, b) => b[1] - a[1]);

  return scopes.map(([nodePath]) => nodePath);
}

function hasVisited(path: NodePath<Identifier>, scopeId: string, visited: Map<string, Set<string>>) {
  const name = path.node.name;
  const scopeSet = visited.get(name);
  return scopeSet?.has(scopeId) || false;
}

function markVisited(
  path: NodePath<Identifier>,
  scopeId: string,
  visited: Map<string, Set<string>>
) {
  const name = path.node.name;
  if (!visited.has(name)) {
    visited.set(name, new Set());
  }
  visited.get(name)!.add(scopeId);
}

async function scopeToString(
  path: NodePath<Identifier>,
  contextWindowSize: number
) {
  const surroundingPath = closestSurroundingContextPath(path);
  const code = `${surroundingPath}`; // Implements a hidden `.toString()`
  if (code.length < contextWindowSize) {
    return code;
  }
  if (surroundingPath.isProgram()) {
    const start = path.node.start ?? 0;
    const end = path.node.end ?? code.length;
    if (end < contextWindowSize / 2) {
      return code.slice(0, contextWindowSize);
    }
    if (start > code.length - contextWindowSize / 2) {
      return code.slice(-contextWindowSize);
    }

    return code.slice(
      start - contextWindowSize / 2,
      end + contextWindowSize / 2
    );
  } else {
    return code.slice(0, contextWindowSize);
  }
}

function closestSurroundingContextPath(
  path: NodePath<Identifier>
): NodePath<Node> {
  const programOrBindingNode = path.findParent(
    (p) => p.isProgram() || path.node.name in p.getOuterBindingIdentifiers()
  )?.scope.path;
  return programOrBindingNode ?? path.scope.path;
}
