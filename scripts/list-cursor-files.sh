#!/bin/bash

# List all files in the specified cursor app directory while excluding specific patterns
# This script is used to get a clean list of relevant files without configuration, language features,
# and other auxiliary files that are not core to the application.
#
# Usage: ./list-cursor-files.sh [path/to/cursor_app]
# If no path is provided, defaults to ./cursor_0.47.4_app

# Get the directory path from command line argument or use default
CURSOR_DIR=${1:-"./cursor_0.47.5_app"}

# Check if directory exists
if [ ! -d "$CURSOR_DIR" ]; then
    echo "Error: Directory '$CURSOR_DIR' does not exist."
    echo "Usage: $0 [path/to/cursor_app]"
    exit 1
fi

# Convert to absolute path
CURSOR_DIR=$(cd "$CURSOR_DIR" && pwd)
echo "Listing files in: $CURSOR_DIR"

cd "$CURSOR_DIR" && find . -type f \
    ! -path "*/node_modules/*" \
    ! -path "*/node_modules.asar/*" \
    ! -name "package.json" \
    ! -name "package.nls.json" \
    ! -name "product.json" \
    ! -name "tsconfig.json" \
    ! -name "LICENSE.txt" \
    ! -name "configurationEditingMain.js" \
    ! -name "coffeescript.tmLanguage.json" \
    ! -name "*tmLanguage*" \
    ! -name "cssClientMain.js" \
    ! -path "*/debug-auto*" \
    ! -path "*/debug-server*" \
    ! -path "*/emmet/*" \
    ! -path "*-language-feature*" \
    ! -path "*cssServer*" \
    ! -name "*theme.json" \
    ! -name "nls*.json" \
    ! -name "*.patch" \
    | sort | cat