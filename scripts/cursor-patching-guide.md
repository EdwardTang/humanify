# Cursor 修改与校验和更新指南

本文档介绍如何修改 Cursor 应用程序并正确更新校验和，以便修改后的应用能够正常运行。

## 背景

Cursor 应用使用文件校验和来验证程序完整性。如果修改了应用程序文件但没有更新相应的校验和，应用可能会在启动时出现错误或崩溃。

所有的校验和都保存在 `product.json` 文件中，格式如下：

```json
"checksums": {
  "vs/workbench/workbench.desktop.main.js": "2qyyhmrGlw4BETbI9kqQIxkEKm3MhnGbA+Cs8Z5esMc",
  "vs/workbench/workbench.desktop.main.css": "fO4QN/fKbUMt90cHVf+bivS+J+gPSKW19jstxlE2TrM",
  ...
}
```

## 准备工作

1. 确保已经使用 `cursor-auto-update.js` 脚本下载并提取了 Cursor 应用程序
2. 所有文件应该都位于 `squashfs-root/usr/share/cursor/resources/app` 目录下
3. 确保目录可写

## 工具介绍

我们提供了三个脚本来帮助您修改 Cursor 并更新校验和：

1. **update-checksum.js** - 更新单个文件的校验和
2. **update-all-checksums.js** - 更新所有文件的校验和
3. **patch-cursor.js** - 修改文件内容并自动更新校验和

## 1. 更新单个文件的校验和

如果您已经手动修改了一个文件，可以使用 `update-checksum.js` 脚本更新它的校验和：

```bash
node update-checksum.js
```

脚本会自动：
- 计算 `vs/workbench/workbench.desktop.main.js` 文件的新校验和
- 更新 `product.json` 中对应的校验和

## 2. 更新所有文件的校验和

如果您修改了多个文件，可以使用 `update-all-checksums.js` 脚本一次性更新所有校验和：

```bash
node update-all-checksums.js
```

脚本会：
- 检查 `product.json` 中列出的所有文件
- 计算每个文件的新校验和
- 只更新发生变化的校验和

## 3. 修改文件并自动更新校验和

这个脚本允许您通过简单的命令修改文件内容并自动更新校验和：

```bash
node patch-cursor.js <文件路径> <查找字符串> <替换字符串>
```

例如，禁用身份验证检查：

```bash
node patch-cursor.js vs/workbench/api/node/extensionHostProcess.js "checkAuthentication" "noopAuthentication"
```

注意：
- `文件路径` 是相对于 `resources/app/out` 的路径（如果以 `vs/` 开头）
- 否则视为相对于 `resources/app` 的路径

## 常见修改示例

### 禁用身份验证检查

```bash
node patch-cursor.js vs/workbench/api/node/extensionHostProcess.js "await checkAuthentication" "// await checkAuthentication"
```

### 修改网络请求 URL

```bash
node patch-cursor.js vs/workbench/workbench.desktop.main.js "https://api.cursor.sh" "https://your-custom-api.com"
```

## 注意事项

1. 务必备份原始文件，以便在出现问题时能够恢复
2. 在大幅度修改代码前先理解其功能
3. 使用 `--core` 模式提取的 Cursor 应用只包含核心 AI 功能，不是完整应用

## 排错

如果修改后的 Cursor 无法启动：

1. 检查 console 日志中是否有校验和错误
2. 确认所有修改的文件都已更新校验和
3. 考虑使用 `update-all-checksums.js` 确保所有校验和都是正确的
4. 如果问题仍然存在，恢复备份并尝试更小范围的修改 