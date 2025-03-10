const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// 设置基础路径 - 指向提取的应用程序目录
const appBasePath = path.join(process.cwd(), 'squashfs-root', 'usr', 'share', 'cursor', 'resources', 'app');

// 设置文件路径
const fileToUpdate = 'vs/workbench/workbench.desktop.main.js';
const fullPath = path.join(appBasePath, 'out', fileToUpdate);
const productJsonPath = path.join(appBasePath, 'product.json');

// 检查文件是否存在
if (!fs.existsSync(fullPath)) {
  console.error(`错误: 文件不存在: ${fullPath}`);
  process.exit(1);
}

if (!fs.existsSync(productJsonPath)) {
  console.error(`错误: product.json 文件不存在: ${productJsonPath}`);
  process.exit(1);
}

console.log(`更新文件校验和: ${fullPath}`);
console.log(`product.json 位置: ${productJsonPath}`);

// 读取文件内容
const contents = fs.readFileSync(fullPath);

// 计算校验和
const hash = crypto
  .createHash('sha256')
  .update(contents)
  .digest('base64')
  .replace(/=+$/, '');

console.log(`计算出的新校验和: ${hash}`);

// 读取 product.json
const productJson = fs.readFileSync(productJsonPath, 'utf8');
const product = JSON.parse(productJson);

// 显示当前校验和
console.log(`当前校验和: ${product.checksums[fileToUpdate]}`);

// 更新校验和
product.checksums[fileToUpdate] = hash;

// 写回 product.json
fs.writeFileSync(
  productJsonPath,
  JSON.stringify(product, null, 2),
  'utf8'
);

console.log(`已更新 product.json 中的校验和`);
console.log(`完成!`); 