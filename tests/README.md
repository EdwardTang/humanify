# Humanify 测试指南

本目录包含了 Humanify 项目的测试文件，包括单元测试和集成测试。

## 测试结构

```
tests/
├── unit/                      # 单元测试
│   ├── file-store.test.ts     # 文件存储模块测试
│   ├── full-cycle-unminify.test.ts # 全周期解混淆测试
│   ├── cli-options.test.ts    # 命令行选项测试
│   └── db-adapter.test.ts     # 数据库适配器测试
│
├── integration/               # 集成测试
│   └── full-cycle-workflow.test.ts # 端到端工作流测试
│
├── fixtures/                  # 测试数据
│   └── sample.min.js          # 样本混淆文件
│
├── run-tests.js               # 测试运行器脚本
└── README.md                  # 本文件
```

## 运行测试

### 安装依赖

确保已安装所有开发依赖：

```bash
npm install
```

### 运行所有单元测试

```bash
npm test
# 或者
npm run test:unit
```

### 运行特定的测试文件

```bash
npm run test:run -- --file tests/unit/full-cycle-unminify.test.ts
```

### 运行集成测试

集成测试需要设置 `OPENAI_API_KEY` 环境变量，并启用 `TEST_INTEGRATION` 标志：

```bash
OPENAI_API_KEY=sk-your-api-key TEST_INTEGRATION=true npm run test:integration
```

### 生成测试覆盖率报告

```bash
npm run test:coverage
```

覆盖率报告会生成在 `coverage/` 目录下。

### 观察模式

在开发过程中，可以使用观察模式，当文件变更时自动运行测试：

```bash
npm run test:watch
```

## 编写新测试

### 单元测试

单元测试应该关注单一功能单元，模拟所有外部依赖。例如：

```typescript
import { jest } from '@jest/globals';
import { myFunction } from '../../src/module';

jest.mock('../../src/dependencies', () => ({
  dependency: jest.fn().mockReturnValue('mocked value')
}));

describe('My Function', () => {
  it('should do something specific', () => {
    const result = myFunction();
    expect(result).toBe('expected value');
  });
});
```

### 集成测试

集成测试应该测试多个组件的交互，验证端到端工作流。为了节省API调用成本，应该使用小样本和简短超时：

```typescript
describe('Integration Test', () => {
  it('should process a file end to end', async () => {
    // 安排测试环境
    // ...
    
    // 执行被测函数
    const result = await processFile('sample.js');
    
    // 验证结果
    expect(result.success).toBe(true);
  }, 30000); // 设置超时时间
});
```

## 测试最佳实践

1. **隔离测试环境**：每个测试应该是独立的，不应该依赖于其他测试的状态。

2. **模拟外部依赖**：单元测试中，所有外部依赖（文件系统、数据库、API调用等）都应该被模拟。

3. **测试边缘情况**：包括空输入、无效输入、超大输入等。

4. **断言具体结果**：测试断言应该具体、可验证，避免模糊的条件。

5. **合理使用超时**：对于异步测试，设置合理的超时时间。

6. **清理测试资源**：测试完成后，清理所有临时创建的资源（文件、数据库记录等）。

7. **分组和描述**：使用`describe`和`it`来组织和描述测试，使测试报告易于理解。

## 常见问题

### 测试运行太慢

- 减少集成测试的数量和范围
- 使用更小的测试样本
- 增加并行测试运行 (`jest --maxWorkers=4`)

### Mock不工作

- 确保mock定义在模块导入之前
- 检查路径是否正确
- 使用`jest.spyOn`来监视方法调用

### 测试失败但没有清晰错误

- 添加更详细的错误信息到断言中：`expect(x).toBe(y, 'custom error message')`
- 使用`console.log`来查看中间值 