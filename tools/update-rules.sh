#!/bin/bash

# 脚本名称: update-rules.sh
# 描述: 自动备份和更新 .cursor/rules 目录中的 hack-the-earth.mdc 文件
# 用法: ./update-rules.sh

# 定义颜色代码，用于美化输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}开始备份和更新规则文件...${NC}"

# 检查规则文件目录是否存在
if [ ! -d "../.cursor/rules" ]; then
  echo "错误: ../.cursor/rules 目录不存在!"
  exit 1
fi

# 备份当前的 hack-the-earth.mdc 文件
if [ -f "../.cursor/rules/hack-the-earth.mdc" ]; then
  echo "备份 hack-the-earth.mdc 到 hack-the-earth.mdc.backup..."
  cp ../.cursor/rules/hack-the-earth.mdc ../.cursor/rules/hack-the-earth.mdc.backup
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}备份成功!${NC}"
  else
    echo "备份失败!"
    exit 1
  fi
else
  echo "警告: hack-the-earth.mdc 文件不存在，跳过备份步骤"
fi

# 更新 hack-the-earth.mdc 文件
if [ -f "../.cursor/rules/hack-the-earth.mdc.wip" ]; then
  echo "更新 hack-the-earth.mdc 从 hack-the-earth.mdc.wip..."
  cp ../.cursor/rules/hack-the-earth.mdc.wip ../.cursor/rules/hack-the-earth.mdc
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}更新成功!${NC}"
  else
    echo "更新失败!"
    exit 1
  fi
else
  echo "错误: hack-the-earth.mdc.wip 文件不存在!"
  exit 1
fi

echo -e "${GREEN}所有操作完成!${NC}" 