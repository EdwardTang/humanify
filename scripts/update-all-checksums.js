#!/usr/bin/env node

/**
 * update-all-checksums.js
 * 
 * 这个脚本会更新Cursor应用程序中所有在product.json中列出的文件的校验和。
 * 适用于当您修改了多个文件后需要更新所有校验和的情况。
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// 设置基础路径 - 指向提取的应用程序目录
const appBasePath = path.join(process.cwd(), 'squashfs-root', 'usr', 'share', 'cursor', 'resources', 'app');
const productJsonPath = path.join(appBasePath, 'product.json');

// 检查product.json是否存在
if (!fs.existsSync(productJsonPath)) {
  console.error(`错误: product.json文件不存在: ${productJsonPath}`);
  process.exit(1);
}

// 读取product.json
const productJson = fs.readFileSync(productJsonPath, 'utf8');
const product = JSON.parse(productJson);

// 确保checksums字段存在
if (!product.checksums || typeof product.checksums !== 'object') {
  console.error('错误: product.json中没有找到checksums字段');
  process.exit(1);
}

console.log('开始更新所有校验和...');
console.log(`在product.json中找到 ${Object.keys(product.checksums).length} 个需要校验的文件`);

// 统计信息
let updated = 0;
let skipped = 0;
let errors = 0;

// 遍历checksums中的每个文件
for (const relativePath in product.checksums) {
  const fullPath = path.join(appBasePath, ...relativePath.split('/'));
  
  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    console.error(`跳过: 文件不存在: ${fullPath}`);
    skipped++;
    continue;
  }
  
  try {
    // 读取文件内容
    const contents = fs.readFileSync(fullPath);
    
    // 计算新的校验和
    const oldHash = product.checksums[relativePath];
    const newHash = crypto
      .createHash('sha256')
      .update(contents)
      .digest('base64')
      .replace(/=+$/, '');
    
    // 如果校验和发生变化，则更新
    if (oldHash !== newHash) {
      console.log(`更新: ${relativePath}`);
      console.log(`  旧校验和: ${oldHash}`);
      console.log(`  新校验和: ${newHash}`);
      product.checksums[relativePath] = newHash;
      updated++;
    } else {
      console.log(`未变化: ${relativePath}`);
      skipped++;
    }
  } catch (err) {
    console.error(`错误处理文件 ${relativePath}: ${err.message}`);
    errors++;
  }
}

// 写回product.json
if (updated > 0) {
  fs.writeFileSync(
    productJsonPath,
    JSON.stringify(product, null, 2),
    'utf8'
  );
  console.log(`已更新product.json中的校验和`);
}

// 打印统计信息
console.log('------------------------');
console.log('操作完成!');
console.log(`更新: ${updated} 个文件`);
console.log(`跳过: ${skipped} 个文件`);
console.log(`错误: ${errors} 个文件`);

if (errors > 0) {
  process.exit(1);
} 