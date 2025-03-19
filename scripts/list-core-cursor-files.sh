#!/bin/bash
#
# List and categorize JavaScript files in the Cursor app
# This script analyzes the Cursor app structure and produces a structured markdown output
# with key files organized by their functionality.
#
# Usage: ./list-core-cursor-files.sh [path/to/cursor_app] [output_file.md]
# If no path is provided, defaults to ./cursor_0.47.4_app
# If no output file is provided, prints to stdout (terminal)

# Get the directory path from command line argument or use default
CURSOR_DIR=${1:-"./cursor_0.47.4_app"}

# Check if directory exists
if [ ! -d "$CURSOR_DIR" ]; then
    echo "Error: Directory '$CURSOR_DIR' does not exist." >&2
    echo "Usage: $0 [path/to/cursor_app] [output_file.md]" >&2
    exit 1
fi

# Convert to absolute path
CURSOR_DIR=$(cd "$CURSOR_DIR" && pwd)

# Get output file if provided
OUTPUT_FILE=$2

# Function to output content (either to file or stdout)
output() {
    if [ -n "$OUTPUT_FILE" ]; then
        echo "$1" >> "$OUTPUT_FILE"
    else
        echo "$1"
    fi
}

output_raw() {
    if [ -n "$OUTPUT_FILE" ]; then
        cat >> "$OUTPUT_FILE"
    else
        cat
    fi
}

# If output file is provided, create/clear it
if [ -n "$OUTPUT_FILE" ]; then
    # Create directory if it doesn't exist
    OUTPUT_DIR=$(dirname "$OUTPUT_FILE")
    mkdir -p "$OUTPUT_DIR"
    
    # Clear/create the file
    : > "$OUTPUT_FILE"
    echo "Analyzing files in: $CURSOR_DIR" >&2
    echo "Output will be saved to: $OUTPUT_FILE" >&2
else
    echo "Analyzing files in: $CURSOR_DIR"
fi

# Print header
output "# Cursor App Files"
output ""
output "JavaScript files in \`$CURSOR_DIR\` categorized according to functionality."
output ""

# Core Application Files (Category 1)
output "## 1. Core Application Files"
output ""
for file in "$CURSOR_DIR/out/bootstrap-fork.js" "$CURSOR_DIR/out/cli.js" "$CURSOR_DIR/out/main.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/bootstrap-fork.js") output "- \`$rel_path\` - Core bootstrapping functionality" ;;
            "out/cli.js") output "- \`$rel_path\` - Command line interface" ;;
            "out/main.js") output "- \`$rel_path\` - Main application entry point" ;;
        esac
    fi
done
output ""

# Base System Files (Category 2)
output "## 2. Base System Files"
output ""
for file in "$CURSOR_DIR/out/vs/base/parts/sandbox/electron-sandbox/preload-aux.js" "$CURSOR_DIR/out/vs/base/parts/sandbox/electron-sandbox/preload.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/vs/base/parts/sandbox/electron-sandbox/preload-aux.js") output "- \`$rel_path\` - Auxiliary sandbox preload" ;;
            "out/vs/base/parts/sandbox/electron-sandbox/preload.js") output "- \`$rel_path\` - Main sandbox preload" ;;
        esac
    fi
done
output ""

# Editor Core (Category 3)
output "## 3. Editor Core"
output ""
for file in "$CURSOR_DIR/out/vs/editor/common/services/editorSimpleWorkerMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        output "- \`$rel_path\` - Editor worker functionality"
    fi
done
output ""

# Code/Electron Integration (Category 4)
output "## 4. Code/Electron Integration"
output ""
for file in "$CURSOR_DIR/out/vs/code/electron-sandbox/processExplorer/processExplorer.js" \
           "$CURSOR_DIR/out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js" \
           "$CURSOR_DIR/out/vs/code/electron-sandbox/workbench/workbench.js" \
           "$CURSOR_DIR/out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js" \
           "$CURSOR_DIR/out/vs/code/node/cliProcessMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/vs/code/electron-sandbox/processExplorer/processExplorer.js") output "- \`$rel_path\` - Process explorer UI" ;;
            "out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js") output "- \`$rel_path\` - Process explorer main" ;;
            "out/vs/code/electron-sandbox/workbench/workbench.js") output "- \`$rel_path\` - Main workbench UI" ;;
            "out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js") output "- \`$rel_path\` - Shared process handling" ;;
            "out/vs/code/node/cliProcessMain.js") output "- \`$rel_path\` - CLI process management" ;;
        esac
    fi
done
output ""

# Platform Services (Category 5)
output "## 5. Platform Services"
output ""
for file in "$CURSOR_DIR/out/vs/platform/files/node/watcher/watcherMain.js" \
           "$CURSOR_DIR/out/vs/platform/profiling/electron-sandbox/profileAnalysisWorkerMain.js" \
           "$CURSOR_DIR/out/vs/platform/terminal/node/ptyHostMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/vs/platform/files/node/watcher/watcherMain.js") output "- \`$rel_path\` - File system watcher" ;;
            "out/vs/platform/profiling/electron-sandbox/profileAnalysisWorkerMain.js") output "- \`$rel_path\` - Profiling analysis" ;;
            "out/vs/platform/terminal/node/ptyHostMain.js") output "- \`$rel_path\` - Terminal PTY host" ;;
        esac
    fi
done
output ""

# Workbench API and Extensions (Category 6)
output "## 6. Workbench API and Extensions"
output ""
for file in "$CURSOR_DIR/out/vs/workbench/api/node/extensionHostProcess.js" \
           "$CURSOR_DIR/out/vs/workbench/api/worker/extensionHostWorkerMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/vs/workbench/api/node/extensionHostProcess.js") output "- \`$rel_path\` - Extension host process" ;;
            "out/vs/workbench/api/worker/extensionHostWorkerMain.js") output "- \`$rel_path\` - Extension host worker" ;;
        esac
    fi
done
output ""

# Webview and Browser Components (Category 7)
output "## 7. Webview and Browser Components"
output ""
for file in "$CURSOR_DIR/out/vs/workbench/contrib/webview/browser/pre/service-worker.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        output "- \`$rel_path\` - Webview service worker"
    fi
done
output ""

# Language and Text Processing (Category 8)
output "## 8. Language and Text Processing"
output ""
for file in "$CURSOR_DIR/out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorkerMain.js" \
           "$CURSOR_DIR/out/vs/workbench/contrib/output/common/outputLinkComputerMain.js" \
           "$CURSOR_DIR/out/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorkerMain.js" \
           "$CURSOR_DIR/out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        case "$rel_path" in
            "out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorkerMain.js") output "- \`$rel_path\` - Notebook processing" ;;
            "out/vs/workbench/contrib/output/common/outputLinkComputerMain.js") output "- \`$rel_path\` - Output link processing" ;;
            "out/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorkerMain.js") output "- \`$rel_path\` - Language detection" ;;
            "out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js") output "- \`$rel_path\` - Text tokenization" ;;
        esac
    fi
done
output ""

# Search Services (Category 9)
output "## 9. Search Services"
output ""
for file in "$CURSOR_DIR/out/vs/workbench/services/search/worker/localFileSearchMain.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        output "- \`$rel_path\` - Local file search"
    fi
done
output ""

# Main UI (Category 10)
output "## 10. Main UI"
output ""
for file in "$CURSOR_DIR/out/vs/workbench/workbench.desktop.main.js"; do
    if [ -f "$file" ]; then
        rel_path=${file#$CURSOR_DIR/}
        output "- \`$rel_path\` - Desktop workbench main"
    fi
done
output ""

# Additional uncategorized JS files
output "## Additional JavaScript Files"
output ""
output "Files found through direct scanning:"

# Using exclusion patterns from list-cursor-files.sh
pushd "$CURSOR_DIR" > /dev/null
find . -type f \
    -name "*.js" \
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
    | sort | while read -r file; do
    rel_path=${file#./}
    # Skip already categorized files
    if [[ "$rel_path" == "out/bootstrap-fork.js" || 
          "$rel_path" == "out/cli.js" || 
          "$rel_path" == "out/main.js" ||
          "$rel_path" == "out/vs/base/parts/sandbox/electron-sandbox/preload-aux.js" ||
          "$rel_path" == "out/vs/base/parts/sandbox/electron-sandbox/preload.js" ||
          "$rel_path" == "out/vs/editor/common/services/editorSimpleWorkerMain.js" ||
          "$rel_path" == "out/vs/code/electron-sandbox/processExplorer/processExplorer.js" ||
          "$rel_path" == "out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js" ||
          "$rel_path" == "out/vs/code/electron-sandbox/workbench/workbench.js" ||
          "$rel_path" == "out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js" ||
          "$rel_path" == "out/vs/code/node/cliProcessMain.js" ||
          "$rel_path" == "out/vs/platform/files/node/watcher/watcherMain.js" ||
          "$rel_path" == "out/vs/platform/profiling/electron-sandbox/profileAnalysisWorkerMain.js" ||
          "$rel_path" == "out/vs/platform/terminal/node/ptyHostMain.js" ||
          "$rel_path" == "out/vs/workbench/api/node/extensionHostProcess.js" ||
          "$rel_path" == "out/vs/workbench/api/worker/extensionHostWorkerMain.js" ||
          "$rel_path" == "out/vs/workbench/contrib/webview/browser/pre/service-worker.js" ||
          "$rel_path" == "out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorkerMain.js" ||
          "$rel_path" == "out/vs/workbench/contrib/output/common/outputLinkComputerMain.js" ||
          "$rel_path" == "out/vs/workbench/services/languageDetection/browser/languageDetectionSimpleWorkerMain.js" ||
          "$rel_path" == "out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js" ||
          "$rel_path" == "out/vs/workbench/services/search/worker/localFileSearchMain.js" ||
          "$rel_path" == "out/vs/workbench/workbench.desktop.main.js" ]]; then
        continue
    fi
    
    if [ -n "$OUTPUT_FILE" ]; then
        echo "- \`$rel_path\`" >> "$OUTPUT_FILE"
    else
        echo "- \`$rel_path\`"
    fi
done
popd > /dev/null
output ""

# Add Cursor Extensions section
output "## 11. Cursor Extensions"
output ""
output "Cursor-specific extensions found:"
pushd "$CURSOR_DIR" > /dev/null
find ./extensions -type f -name "*.js" | grep -i "cursor" | sort | while read -r file; do
    rel_path=${file#./}
    # Count number of path segments with "cursor" in them
    cursor_segment_count=$(echo "$rel_path" | tr '/' '\n' | grep -i "cursor" | wc -l)
    # Only include files where exactly one path segment contains "cursor"
    if [[ $cursor_segment_count -eq 1 ]]; then
        if [ -n "$OUTPUT_FILE" ]; then
            echo "- \`$rel_path\`" >> "$OUTPUT_FILE"
        else
            echo "- \`$rel_path\`"
        fi
    fi
done
popd > /dev/null
output ""

if [ -n "$OUTPUT_FILE" ]; then
    echo "Analysis complete! Results saved to: $OUTPUT_FILE" >&2
fi

exit 0 