# Humanify 测试套件

这个目录包含了 Humanify 项目的测试代码。测试使用 Node.js 的内置测试模块，可以方便地运行单元测试和集成测试。

## 测试文件

主要测试文件包括：

- `file-store.test.ts` - 测试 `file-store.js` 模块的基本功能
- `db-adapter.test.ts` - 测试 `db-helpers-adapter.js` 适配器的功能
- `full-cycle-unminify.test.js` - 集成测试，测试完整的解混淆和重命名流程
- `db-helpers.test.ts` - 测试 MongoDB 数据库辅助函数

## 运行测试

你可以使用内置的测试运行脚本来运行测试：

```bash
# 运行所有测试
node src/test/run-tests.js

# 运行特定测试文件
node src/test/run-tests.js file-store.test.js
```

或者直接使用 Node.js 的测试命令：

```bash
# 运行单个测试文件
node --test src/test/file-store.test.js

# 在 watch 模式下运行测试
node --test --watch src/test/file-store.test.js
```

## 适配器使用说明

我们提供了一个适配器，允许在代码中将 `file-store.js` 的 API 当作 `db-helpers.js` 的 API 使用，这样可以平滑地从 MongoDB 迁移到文件存储。

### 使用方法

1. 在你的代码中，将：

```javascript
import * as dbHelpers from '../db/db-helpers.js';
```

替换为：

```javascript
import * as dbHelpers from '../db/db-helpers-adapter.js';
```

2. 所有的 API 调用将保持不变，适配器会自动将调用映射到 `file-store.js` 中的相应函数。

### 适配器功能

适配器提供了以下功能的映射：

- `initializeDatabase()` -> `initializeDataStore()`
- `startProcessingRun(config, totalFiles, projectId)` -> `saveProcessingRun(...)`
- `completeProcessingRun(runId, options)` -> 获取运行并更新状态
- `syncFilesToDatabase(fileObjects, projectId)` -> 使用 `saveFile()` 保存多个文件
- `getPendingFilesByCategory(projectId)` -> 获取并过滤文件
- `getIdentifiersForBatching(batchSize, skipCompleted, projectId)` -> 组织标识符到批次
- `createBatchJob(batchId, jobId, projectId)` -> `saveLocalBatchTracker(...)`
- `getProcessedFilesByRunId(runId, projectId)` -> 获取处理过的文件
- `getFileIdentifiers(fileId, projectId)` -> `getIdentifiersByFileId(fileId)`

## 隔离测试

所有测试都使用临时目录进行操作，不会影响实际的数据文件。每个测试文件创建自己的测试目录，测试完成后会自动清理。 