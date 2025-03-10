// jest.config.js
export default {
  // 测试环境使用Node.js环境
  testEnvironment: 'node',
  
  // 转换文件，将TypeScript文件转换为JavaScript
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // TypeScript配置
      tsconfig: 'tsconfig.json',
      // 使用ESM模式
      useESM: true
    }]
  },
  
  // 模块路径映射
  moduleNameMapper: {
    // 处理ES模块导入
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  
  // 扩展名设置
  extensionsToTreatAsEsm: ['.ts'],
  
  // 测试匹配模式
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.js'
  ],
  
  // 测试覆盖率设置
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/types/**',
    '!src/**/*.d.ts'
  ],
  
  // 不收集覆盖率的文件
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/tests/'
  ],
  
  // 覆盖率报告格式
  coverageReporters: ['text', 'lcov', 'html'],
  
  // 最小覆盖率要求
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60
    }
  },
  
  // 全局变量设置（对应浏览器中常见的全局变量）
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  
  // 超时设置
  testTimeout: 10000,
  
  // 显示详细测试信息
  verbose: true,
  
  // 允许使用异步测试和回调混合
  testRunner: 'jest-circus/runner'
}; 