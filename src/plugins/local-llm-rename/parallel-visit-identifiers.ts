import { parseAsync, transformFromAstAsync, NodePath } from "@babel/core";
import * as babelTraverse from "@babel/traverse";
import { Identifier, toIdentifier, Node } from "@babel/types";
import * as os from 'os';

const traverse: typeof babelTraverse.default.default = (
  typeof babelTraverse.default === "function"
    ? babelTraverse.default
    : babelTraverse.default.default
) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- This hack is because pkgroll fucks up the import somehow

type Visitor = (name: string, scope: string) => Promise<string>;

// 获取CPU核心数，但限制最大并行度
const MAX_PARALLELISM = Math.min(os.cpus().length, 8);

/**
 * 并行处理所有标识符
 * 通过分块并行处理来提高大型文件的处理速度
 */
export async function visitAllIdentifiersParallel(
  code: string,
  visitor: Visitor,
  contextWindowSize: number,
  onProgress?: (percentageDone: number) => void,
  concurrency: number = MAX_PARALLELISM
) {
  // 解析AST
  const ast = await parseAsync(code, { sourceType: "unambiguous" });
  if (!ast) {
    throw new Error("Failed to parse code");
  }

  // 找到所有需要处理的作用域
  const scopes = await findScopes(ast);
  const numRenamesExpected = scopes.length;
  
  // 记录进度
  let processedCount = 0;
  const updateProgress = () => {
    processedCount++;
    onProgress?.(processedCount / numRenamesExpected);
  };

  console.log(`Found ${numRenamesExpected} identifiers to process`);
  console.log(`Using ${concurrency} parallel workers`);
  
  // 创建重命名映射和已访问集合
  const renameMap = new Map<string, string>();
  const visited = new Set<string>();

  // 将作用域分成多个批次
  const batchSize = Math.ceil(scopes.length / concurrency);
  const batches: NodePath<Identifier>[][] = [];
  
  for (let i = 0; i < scopes.length; i += batchSize) {
    batches.push(scopes.slice(i, i + batchSize));
  }
  
  console.log(`Created ${batches.length} batches with ~${batchSize} identifiers each`);
  
  // 并行处理每个批次
  await Promise.all(
    batches.map(async (batch, batchIndex) => {
      console.log(`Starting batch ${batchIndex + 1}/${batches.length}`);
      
      for (const smallestScope of batch) {
        // 检查是否已处理过该标识符
        const smallestScopeNode = smallestScope.node;
        if (smallestScopeNode.type !== "Identifier" || visited.has(smallestScopeNode.name)) {
          updateProgress();
          continue;
        }

        try {
          // 提取上下文代码
          const surroundingCode = await scopeToString(
            smallestScope,
            contextWindowSize
          );
          
          // 调用访问者函数获取新名称
          const renamed = await visitor(smallestScopeNode.name, surroundingCode);
          
          if (renamed !== smallestScopeNode.name) {
            // 确保新名称是有效标识符并且唯一
            let safeRenamed = toIdentifier(renamed);
            while (
              renameMap.has(safeRenamed) ||
              smallestScope.scope.hasBinding(safeRenamed)
            ) {
              safeRenamed = `_${safeRenamed}`;
            }
            
            // 存储重命名映射
            renameMap.set(smallestScopeNode.name, safeRenamed);
          }
          
          // 标记为已访问
          visited.add(smallestScopeNode.name);
        } catch (error) {
          console.error(`Error processing identifier ${smallestScopeNode.name}:`, error);
        }
        
        updateProgress();
      }
      
      console.log(`Completed batch ${batchIndex + 1}/${batches.length}`);
    })
  );
  
  // 应用所有重命名
  if (renameMap.size > 0) {
    console.log(`Applying ${renameMap.size} renames to the code`);
    
    // 创建一个遍历器应用所有重命名
    traverse(ast, {
      Identifier(path) {
        const name = path.node.name;
        if (renameMap.has(name) && path.scope.hasBinding(name)) {
          path.scope.rename(name, renameMap.get(name)!);
        }
      }
    });
  }
  
  // 完成进度
  onProgress?.(1);

  // 转换回代码
  const stringified = await transformFromAstAsync(ast);
  if (stringified?.code == null) {
    throw new Error("Failed to stringify code");
  }
  
  return stringified.code;
}

// 以下是辅助函数，保持与原始实现相同

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