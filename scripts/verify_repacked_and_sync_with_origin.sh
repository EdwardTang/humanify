#!/bin/bash

# Set paths
ORIGINAL_ROOT="/workspaces/guangbiao_sourcecode/original_extract/squashfs-root"
SUCCESSFUL_ROOT="/workspaces/guangbiao_sourcecode/repack_extract/squashfs-root"
RUNTIME_PATH="/workspaces/guangbiao_sourcecode/successful_runtime"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Step 1: Verifying directory structure...${NC}"
diff -r "$ORIGINAL_ROOT" "$SUCCESSFUL_ROOT" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Directory structures match${NC}"
else
    echo -e "${RED}✗ Directory structures differ${NC}"
    echo "Running detailed comparison..."
    diff -r "$ORIGINAL_ROOT" "$SUCCESSFUL_ROOT" | grep "Only in"
fi

echo -e "\n${YELLOW}Step 2: Synchronizing file permissions...${NC}"
cd "$ORIGINAL_ROOT" || exit 1
find . -type f -exec chmod --reference="$SUCCESSFUL_ROOT/{}" "{}" \; 2>/dev/null
find . -type d -exec chmod --reference="$SUCCESSFUL_ROOT/{}" "{}" \; 2>/dev/null

echo -e "\n${YELLOW}Step 3: Verifying symbolic links...${NC}"
find "$ORIGINAL_ROOT" -type l -exec ls -l {} \; > original_links.txt
find "$SUCCESSFUL_ROOT" -type l -exec ls -l {} \; > successful_links.txt
diff original_links.txt successful_links.txt
rm original_links.txt successful_links.txt

echo -e "\n${YELLOW}Step 4: Creating new AppImage...${NC}"
cd "/workspaces/guangbiao_sourcecode"
mksquashfs "$ORIGINAL_ROOT" squashfs-tmp.img -comp gzip -b 1M -noappend -all-root -no-xattrs

echo -e "\n${YELLOW}Step 5: Adding runtime and setting permissions...${NC}"
cat "$RUNTIME_PATH" > cursor_repack_verified.AppImage
cat squashfs-tmp.img >> cursor_repack_verified.AppImage
chmod +x cursor_repack_verified.AppImage
rm squashfs-tmp.img

echo -e "\n${YELLOW}Step 6: Verifying final AppImage...${NC}"
file cursor_repack_verified.AppImage
ls -lh cursor_repack_verified.AppImage

echo -e "\n${GREEN}Verification and synchronization complete!${NC}" 