// tests/fixtures/MockCommand.js
// 一个简单的 Command 模拟类，用于测试
export class MockCommand {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this._options = [];
    this._actions = [];
  }

  description(desc) {
    this.desc = desc;
    return this;
  }

  option(flags, description, defaultValue) {
    this._options.push({ flags, description, defaultValue });
    return this;
  }

  requiredOption(flags, description) {
    this._options.push({ flags, description, required: true });
    return this;
  }

  action(fn) {
    this._actions.push(fn);
    return this;
  }
}

// 导出一个简单的工厂函数，用于创建命令
export function createCommand(name, options) {
  return new MockCommand(name, options);
} 