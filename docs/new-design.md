```md
# CLI Command: Unminify a Folder (and All Subdirectories)

This document explains how to **unminify a folder and its subdirectories** containing `.js` files using the refined CLI design. It provides a **single command** with options to handle **batch processing** vs. **standard** single-pass processing. By default, it will **recursively scan** the specified folder, discover `.js` files, and perform unminification and (optionally) identifier renaming.

---

## 1. Basic Usage

Use the following command (example name: `humanify openai`) with the new `--inputDir` option pointing to the folder you want to unminify:

```bash
humanify openai \
  --inputDir ./your-js-folder \
  --model gpt-4-mini
```

### What It Does

1. **Recursively scans** the `./your-js-folder` directory for `.js` files.
2. **Unminifies** each file using the built-in unminify phase (e.g., `webcrack` or other tools).
3. **Extracts identifiers** that need renaming (if applicable).
4. **Applies** identifier renaming inline or in one pass (non-batch mode).

> **Tip:** By default, all `.js` files in subdirectories are included, but you can adjust filters (e.g., ignore `node_modules`) by adding an `--exclude` option if supported in your environment.

---

## 2. Batch Processing Mode

If you have large files or want to use **OpenAI batch submission**, add the `--batch-processing` flag:

```bash
humanify openai \
  --inputDir ./your-js-folder \
  --model gpt-4-mini \
  --batch-processing \
  --batch-size 50 \
  --poll-interval 30000
```

### Description of Options

- **`--batch-processing`**: Enables grouping of identifiers into batches for a single or limited set of OpenAI API requests.  
- **`--batch-size 50`**: Sets the number of identifiers per batch request.  
- **`--poll-interval 30000`**: Sets the polling interval (in ms) to check the status of each batch job.

**Why Batch Mode?**  
- **Efficiency**: Reduce per-identifier overhead by submitting them in groups.  
- **Scalability**: Useful for very large codebases or extremely minified files with numerous short identifiers.

---

## 3. Additional Command Options

Below are some other commonly used flags. Adjust them as needed:

1. **`--outputDir <path>`**  
   - Specify where the unminified or renamed `.js` files should be written.  
   - Defaults to writing results in place or to a `dist` directory, depending on your internal config.

2. **`--exclude <pattern>`**  
   - When available, specify a glob or folder name to exclude (e.g. `node_modules`) from scanning.  
   - Useful for skipping third-party libraries or build artifacts.

3. **`--verbose`**  
   - Print detailed logs of each step for debugging or progress monitoring.

4. **`--apiKey <key>`**  
   - Provide your OpenAI (or other LLM provider) API key if not configured in an environment variable.

---

## 4. Example End-to-End Flow

**Scenario**: You have a large project folder called `my-js-app/` with minified and uglified `.js` code scattered in subfolders. You want to unminify & rename identifiers using batch mode.

1. **Prepare**:  
   - Ensure you have a valid OpenAI API key.  
   - Confirm the `humanify openai` CLI is installed or set up locally.

2. **Run the Command**:

   ```bash
   humanify openai \
     --inputDir ./my-js-app \
     --outputDir ./my-js-app-unminified \
     --model gpt-4 \
     --batch-processing \
     --batch-size 40 \
     --poll-interval 45000 \
     --verbose \
     --apiKey sk-1234abcd...
   ```

3. **What Happens Internally**:  
   - **Scan** all subdirectories of `my-js-app` for `.js` files (ignoring any `--exclude` patterns).  
   - **Unminify** each file (splitting up large bundles if necessary).  
   - **Extract** any short, mangled, or suspiciously named identifiers.  
   - **Group** them in batches of 40 per request, sending these to OpenAI’s LLM.  
   - **Poll** every 45 seconds to check if the batch job is complete.  
   - **Apply** the new names to the unminified `.js` files and place them into `./my-js-app-unminified`.

4. **Completion**:  
   - Once finished, you’ll see logs indicating the number of files processed, the number of identifiers renamed, and final success or failure.  
   - If any errors occur (e.g., network issues, LLM errors), they’ll be logged to help you retry or diagnose the failure.

---

## 5. Best Practices

- **Exclude `node_modules`**: Avoid scanning third-party dependencies.  
- **Adjust Batch Size**: For extremely large code, bigger batches can save time, but be mindful of LLM token limits.  
- **Database Persistence**: If the system uses a central DB (recommended, better_sqlite), each run is tracked under a unique `ProcessingRun` in the `projects` → `runs` → `files` hierarchy. This ensures you can resume or audit as needed.

---

## 6. Conclusion

With the above CLI interface and options, we can **effortlessly unminify and rename** all `.js` files in a given folder (and its subfolders). Toggling between **standard** and **batch** modes ensures flexibility for both small and massive codebases. This unified approach reduces mental overhead, simplifies maintenance, and provides a clear path to advanced workflows (e.g., incremental runs, partial reprocessing, or more sophisticated identifier-lifecycle management).
```