#!/usr/bin/env node

/**
 * patch-cursor.js
 * 
 * 这个脚本帮助您修改Cursor应用中的文件并自动更新校验和。
 * 它接受文件路径和替换内容作为参数，执行替换后自动更新校验和。
 * 
 * 使用方法:
 *   node patch-cursor.js <文件路径> <查找字符串> <替换字符串>
 * 
 * 例如:
 *   node patch-cursor.js vs/workbench/api/node/extensionHostProcess.js "checkAuthentication" "noopAuthentication"
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// 解析命令行参数
if (process.argv.length < 5) {
  console.error('使用方法: node patch-cursor.js <文件路径> <查找字符串> <替换字符串>');
  process.exit(1);
}

const relativeFilePath = process.argv[2];
const searchString = process.argv[3];
const replaceString = process.argv[4];

// 设置基础路径 - 指向提取的应用程序目录
const appBasePath = path.join(process.cwd(), 'squashfs-root', 'usr', 'share', 'cursor', 'resources', 'app');
const productJsonPath = path.join(appBasePath, 'product.json');

// 检查文件路径是否是相对于out目录的
const fullPath = relativeFilePath.startsWith('vs/') 
  ? path.join(appBasePath, 'out', relativeFilePath)
  : path.join(appBasePath, relativeFilePath);

// 检查文件是否存在
if (!fs.existsSync(fullPath)) {
  console.error(`错误: 文件不存在: ${fullPath}`);
  process.exit(1);
}

// 检查product.json是否存在
if (!fs.existsSync(productJsonPath)) {
  console.error(`错误: product.json文件不存在: ${productJsonPath}`);
  process.exit(1);
}

console.log(`正在修改文件: ${fullPath}`);
console.log(`替换: "${searchString}" -> "${replaceString}"`);

// 读取文件内容
let fileContent = fs.readFileSync(fullPath, 'utf8');

// 检查搜索字符串是否存在于文件中
if (!fileContent.includes(searchString)) {
  console.error(`错误: 文件中未找到字符串 "${searchString}"`);
  process.exit(1);
}

// 执行替换
const oldContent = fileContent;
fileContent = fileContent.replace(new RegExp(searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceString);

// 写回文件
fs.writeFileSync(fullPath, fileContent, 'utf8');
console.log(`文件已修改`);

// 检查文件是否在product.json中有校验和
const checksumKey = relativeFilePath.startsWith('vs/') ? relativeFilePath : null;

if (checksumKey) {
  // 读取product.json
  const productJson = fs.readFileSync(productJsonPath, 'utf8');
  const product = JSON.parse(productJson);

  // 确保checksums字段存在
  if (!product.checksums || typeof product.checksums !== 'object') {
    console.error('警告: product.json中没有找到checksums字段，不更新校验和');
  } else {
    // 检查文件是否在checksums中
    if (checksumKey in product.checksums) {
      // 计算新的校验和
      const oldHash = product.checksums[checksumKey];
      const newHash = crypto
        .createHash('sha256')
        .update(Buffer.from(fileContent))
        .digest('base64')
        .replace(/=+$/, '');
      
      // 更新校验和
      console.log(`更新校验和: ${checksumKey}`);
      console.log(`  旧校验和: ${oldHash}`);
      console.log(`  新校验和: ${newHash}`);
      
      product.checksums[checksumKey] = newHash;
      
      // 写回product.json
      fs.writeFileSync(
        productJsonPath,
        JSON.stringify(product, null, 2),
        'utf8'
      );
      console.log(`已更新product.json中的校验和`);
    } else {
      console.log(`警告: 文件 ${checksumKey} 不在product.json的checksums中，不更新校验和`);
    }
  }
}

console.log('修补完成!'); 