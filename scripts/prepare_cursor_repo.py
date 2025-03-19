#!/usr/bin/env python3

import os
import re
import hashlib
import argparse
import requests
import json
import time
import sys
import uuid
import shutil
from pathlib import Path
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Try to import OpenAI client, install if not available
try:
    import openai
    from openai import OpenAI
except ImportError:
    print("OpenAI client not found. Installing...")
    import subprocess
    # Use uv for package installation in uv virtual environments
    uv_path = os.environ.get('UV_PATH', '/home/yongbing/.local/bin/uv')
    if os.path.exists(uv_path):
        subprocess.check_call([uv_path, "pip", "install", "openai"])
    else:
        # Fall back to pip if uv is not available
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "openai"])
        except subprocess.CalledProcessError:
            subprocess.check_call(["pip", "install", "openai"])
    import openai
    from openai import OpenAI

# Configuration
SOURCE_DIR = "cursor_0.47.6_app"  # Default source directory
BASE_UPLOAD_DIR = "../file_uploads"  # Base directory for all uploads
MAX_CHUNK_SIZE = 1024  # Maximum bytes per chunk (1KB)
OVERLAP_BYTES = 100  # Number of bytes to overlap between chunks
MAX_FILENAME_LENGTH = 100  # Maximum length for filenames
MAX_RETRIES = 3

def get_run_dir():
    """Generate a unique run directory based on timestamp and run ID."""
    pct_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = str(uuid.uuid4())[:8]  # Use first 8 characters of UUID
    run_dir = f"{pct_timestamp}_{run_id}"
    return run_dir

def setup_run_directories(base_dir, dry_run=False):
    """Create and return paths for the current run."""
    run_dir = get_run_dir()
    full_run_dir = os.path.join(base_dir, run_dir)
    output_dir = os.path.join(full_run_dir, "js")
    index_file = os.path.join(full_run_dir, "file_index.md")
    upload_history_dir = os.path.join(full_run_dir, "upload_history")
    
    if not dry_run:
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs(upload_history_dir, exist_ok=True)
        
        # Create an index file
        with open(index_file, 'w', encoding='utf-8') as f:
            f.write("# JavaScript File Index\n\n")
            f.write("This file maps between chunked JavaScript filenames and their original names.\n\n")
            f.write("| Chunked Filename | Original Name |\n")
            f.write("|-----------------|---------------|\n")
    
    return output_dir, index_file, upload_history_dir

def get_safe_filename(file_path, is_chunk=False, chunk_num=None, total_chunks=None):
    """Convert a file path to a safe filename, optionally adding chunk information."""
    # Replace directory separators with underscores
    safe_name = file_path.replace('/', '_').replace('\\', '_')
    
    # Add chunk information if this is a chunk
    if is_chunk and chunk_num is not None and total_chunks is not None:
        base, ext = os.path.splitext(safe_name)
        safe_name = f"{base}_chunk_{chunk_num}_of_{total_chunks}{ext}"
    
    return safe_name

def is_js_file(filename):
    """Check if a file is a JavaScript file."""
    return filename.lower().endswith('.js')

def find_js_files_iteratively(source_dir):
    """Find JavaScript files in a directory and its subdirectories iteratively."""
    js_files = []
    dirs_queue = deque([source_dir])
    
    while dirs_queue:
        current_dir = dirs_queue.popleft()
        try:
            with os.scandir(current_dir) as entries:
                for entry in entries:
                    if entry.is_file() and is_js_file(entry.name):
                        js_files.append(entry.path)
                    elif entry.is_dir():
                        dirs_queue.append(entry.path)
        except (PermissionError, OSError) as e:
            print(f"Warning: Could not access {current_dir}: {e}")
    
    return js_files

def chunk_js_file(file_path, output_dir, index_file_path, dry_run=False):
    """Process a JavaScript file and create chunks if needed."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Get relative path from source directory
        rel_path = os.path.relpath(file_path)
        
        # If content is small enough, just copy it
        if len(content) <= MAX_CHUNK_SIZE:
            # Create safe filename without chunk suffix
            safe_name = get_safe_filename(rel_path, is_chunk=False)
            output_path = os.path.join(output_dir, safe_name)
            
            if not dry_run:
                # Create directory if needed
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                # Write content
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                # Update index file
                with open(index_file_path, 'a', encoding='utf-8') as index_file:
                    index_file.write(f"| {safe_name} | {rel_path} |\n")
            else:
                print(f"Would write file: {output_path}")
            
            return 1
        
        # Split content into chunks
        chunks = []
        current_chunk = []
        current_size = 0
        
        for line in content.splitlines():
            line_size = len(line.encode('utf-8'))
            if current_size + line_size > MAX_CHUNK_SIZE and current_chunk:
                chunks.append('\n'.join(current_chunk))
                current_chunk = [line]
                current_size = line_size
            else:
                current_chunk.append(line)
                current_size += line_size
        
        if current_chunk:
            chunks.append('\n'.join(current_chunk))
        
        # Write chunks to files
        total_chunks = len(chunks)
        for i, chunk in enumerate(chunks, 1):
            # Create safe filename with chunk suffix
            safe_name = get_safe_filename(rel_path, is_chunk=True, chunk_num=i, total_chunks=total_chunks)
            output_path = os.path.join(output_dir, safe_name)
            
            if not dry_run:
                # Create directory if needed
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                # Write chunk
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(chunk)
                
                # Update index file
                with open(index_file_path, 'a', encoding='utf-8') as index_file:
                    index_file.write(f"| {safe_name} | {rel_path} |\n")
            else:
                print(f"Would write chunk {i}/{total_chunks}: {output_path}")
        
        return total_chunks
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return 0

def upload_file(file_path, api_key, purpose="user_data"):
    """Upload a file to OpenAI API with retry logic."""
    for attempt in range(MAX_RETRIES):
        try:
            with open(file_path, 'rb') as f:
                response = requests.post(
                    "https://api.openai.com/v1/files",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": f},
                    data={"purpose": purpose}
                )
            
            if response.status_code == 200:
                result = response.json()
                return result, None
            else:
                error = f"Error {response.status_code}: {response.text}"
                print(f"Attempt {attempt+1}/{MAX_RETRIES} failed for {file_path}: {error}")
        except Exception as e:
            error = str(e)
            print(f"Attempt {attempt+1}/{MAX_RETRIES} failed for {file_path}: {error}")
        
        if attempt < MAX_RETRIES - 1:
            sleep_time = 1 * (2 ** attempt)  # Exponential backoff
            print(f"Retrying in {sleep_time} seconds...")
            time.sleep(sleep_time)
    
    return None, error

def upload_files_concurrently(file_paths, api_key, max_workers=10, dry_run=False):
    """Upload multiple files concurrently."""
    if dry_run:
        print("\nWould upload files with these parameters:")
        print(f"  Number of files: {len(file_paths)}")
        print(f"  Concurrent workers: {max_workers}")
        print(f"  API key: {'*' * 8}{api_key[-4:] if api_key else 'Not provided'}")
        return {}
    
    results = {}
    total_files = len(file_paths)
    completed = 0
    start_time = time.time()
    
    print(f"Starting upload of {total_files} files with {max_workers} workers...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_path = {
            executor.submit(upload_file, path, api_key): path 
            for path in file_paths
        }
        
        for future in as_completed(future_to_path):
            path = future_to_path[future]
            try:
                result = future.result()
                results[path] = result
            except Exception as e:
                results[path] = (None, str(e))
            
            completed += 1
            elapsed = time.time() - start_time
            rate = completed / elapsed if elapsed > 0 else 0
            eta = (total_files - completed) / rate if rate > 0 else "unknown"
            eta_str = f"{eta:.1f} seconds" if isinstance(eta, float) else eta
            
            if completed % 10 == 0 or completed == total_files:
                print(f"Progress: {completed}/{total_files} files ({(completed/total_files)*100:.1f}%) | "
                      f"Speed: {rate:.2f} files/sec | ETA: {eta_str}")
    
    return results

def save_upload_history(results, history_file, dry_run=False):
    """Save upload results to a history file."""
    history = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "files": {}
    }
    
    for path, (response, error) in results.items():
        history["files"][path] = {
            "status": "success" if response else "failed",
            "file_id": response.get("id") if response else None,
            "error": error
        }
    
    if not dry_run:
        os.makedirs(os.path.dirname(history_file), exist_ok=True)
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2)
    else:
        print("\nWould save upload history:")
        print(f"  File: {history_file}")
        print("  Contents:")
        print(json.dumps(history, indent=2))
    
    return history

def get_files_to_upload(args, output_dir, upload_history_dir, dry_run=False):
    """Determine which files to upload based on user input."""
    history_files = []
    if not dry_run and os.path.exists(upload_history_dir):
        history_files = sorted(
            [f for f in os.listdir(upload_history_dir) if f.startswith("upload_history_")],
            reverse=True
        )
    
    if history_files and not dry_run:
        choice = input("Do you want to upload all files (a) or only retry previously failed uploads (f)? ").lower()
        if choice == 'f':
            # Retry failed uploads from the most recent history
            latest_history_file = os.path.join(upload_history_dir, history_files[0])
            try:
                with open(latest_history_file, 'r', encoding='utf-8') as f:
                    history = json.load(f)
                
                failed_files = []
                for path, info in history["files"].items():
                    if info["status"] == "failed" and os.path.exists(path):
                        failed_files.append(path)
                
                if failed_files:
                    print(f"Found {len(failed_files)} previously failed files to retry.")
                    return failed_files
                else:
                    print("No failed uploads found in the most recent history.")
            except Exception as e:
                print(f"Error reading history file: {e}")
    
    # Default: list all files that would be uploaded
    all_files = []
    if not dry_run:
        for root, _, files in os.walk(output_dir):
            for file in files:
                all_files.append(os.path.join(root, file))
    else:
        # In dry-run mode, simulate the files that would be found
        print("\nWould scan for files in:")
        print(f"  {output_dir}")
    
    if dry_run:
        print(f"\nWould find and upload files matching pattern: *.js")
    else:
        print(f"Found {len(all_files)} files to upload.")
    
    return all_files

def validate_file_size(file_path, warn_size_mb=50):
    """Validate file size and warn if it's larger than specified size."""
    size_bytes = os.path.getsize(file_path)
    size_mb = size_bytes / (1024 * 1024)
    
    if size_mb > warn_size_mb:
        print(f"Warning: {file_path} is {size_mb:.1f}MB. This may be too large for the OpenAI API.")
        choice = input("Do you want to continue with this file? (y/n): ").lower()
        return choice == 'y'
    return True

def verify_file_copy(src_path, dst_path):
    """Verify that the file was copied correctly using checksums."""
    try:
        with open(src_path, 'rb') as f:
            src_hash = hashlib.md5(f.read()).hexdigest()
        with open(dst_path, 'rb') as f:
            dst_hash = hashlib.md5(f.read()).hexdigest()
        return src_hash == dst_hash
    except Exception as e:
        print(f"Error verifying copy of {src_path}: {e}")
        return False

def copy_js_files_to_output(source_dir, output_dir, index_file_path, dry_run=False):
    """Copy JavaScript files to output directory without chunking."""
    js_files = find_js_files_iteratively(source_dir)
    total_files = len(js_files)
    print(f"Found {total_files} JavaScript files.")
    
    if dry_run:
        print("\nDry run - would process these files:")
        total_size = 0
        for file_path in js_files:
            size_bytes = os.path.getsize(file_path)
            size_mb = size_bytes / (1024 * 1024)
            total_size += size_bytes
            rel_path = os.path.relpath(file_path, source_dir)
            safe_name = get_safe_filename(rel_path, is_chunk=False)
            output_path = os.path.join(output_dir, safe_name)
            print(f"  {file_path} ({size_mb:.1f}MB) -> {output_path}")
        print(f"\nTotal size: {total_size / (1024*1024):.1f}MB")
        return []
    
    copied_files = []
    skipped_files = []
    failed_files = []
    total_size = 0
    
    for idx, file_path in enumerate(js_files, 1):
        try:
            # Progress update
            print(f"\rProcessing file {idx}/{total_files} ({(idx/total_files)*100:.1f}%)...", end='')
            
            # Validate file size
            if not validate_file_size(file_path):
                print(f"\nSkipping {file_path} due to size.")
                skipped_files.append(file_path)
                continue
            
            # Get relative path from source directory
            rel_path = os.path.relpath(file_path, source_dir)
            # Create safe filename without chunk suffix
            safe_name = get_safe_filename(rel_path, is_chunk=False)
            # Create output path
            output_path = os.path.join(output_dir, safe_name)
            
            # Create directory if needed
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # Handle symlinks
            if os.path.islink(file_path):
                link_target = os.readlink(file_path)
                os.symlink(link_target, output_path)
            else:
                # Copy file with metadata
                shutil.copy2(file_path, output_path)
            
            # Verify copy
            if verify_file_copy(file_path, output_path):
                copied_files.append(output_path)
                total_size += os.path.getsize(output_path)
                
                # Add to index
                with open(index_file_path, 'a', encoding='utf-8') as index_file:
                    index_file.write(f"| {safe_name} | {rel_path} |\n")
            else:
                print(f"\nWarning: Failed to verify copy of {file_path}")
                failed_files.append(file_path)
                
        except Exception as e:
            print(f"\nError copying {file_path}: {e}")
            failed_files.append(file_path)
    
    # Print final statistics
    print("\n\nCopy Statistics:")
    print(f"Successfully copied: {len(copied_files)} files ({total_size / (1024*1024):.1f}MB)")
    if skipped_files:
        print(f"Skipped: {len(skipped_files)} files")
        print("Skipped files:")
        for f in skipped_files:
            print(f"  {f}")
    if failed_files:
        print(f"Failed: {len(failed_files)} files")
        print("Failed files:")
        for f in failed_files:
            print(f"  {f}")
    
    return copied_files

def create_and_upload_to_vector_store(files_to_upload, vector_store_name, api_key, dry_run=False):
    """Create a vector store and upload files to it."""
    if dry_run:
        print(f"\nWould create vector store '{vector_store_name}' and upload {len(files_to_upload)} files to it")
        print(f"  - Would use OpenAI API key: {'*' * 8}{api_key[-4:] if api_key else 'Not provided'}")
        print(f"  - Would upload {len(files_to_upload)} files to the vector store")
        return None, None
    
    print(f"Creating vector store '{vector_store_name}'...")
    
    # Initialize OpenAI client
    client = OpenAI(api_key=api_key)
    
    try:
        # Create vector store
        vector_store = client.vector_stores.create(name=vector_store_name)
        print(f"Vector store created with ID: {vector_store.id}")
        
        # Open all files for upload
        print(f"Preparing {len(files_to_upload)} files for upload to vector store...")
        
        # We need to perform batched uploads to avoid memory issues with too many open files
        batch_size = 20  # Adjust based on expected file size
        results = []
        
        for i in range(0, len(files_to_upload), batch_size):
            batch = files_to_upload[i:i+batch_size]
            print(f"Processing batch {i//batch_size + 1}/{(len(files_to_upload) + batch_size - 1)//batch_size} ({len(batch)} files)...")
            
            # Open files and create file streams
            file_streams = []
            try:
                for path in batch:
                    try:
                        file_streams.append(open(path, "rb"))
                    except Exception as e:
                        print(f"Error opening file {path}: {e}")
                        continue
                
                # Upload batch and poll for completion
                if file_streams:
                    print(f"Uploading batch of {len(file_streams)} files to vector store...")
                    file_batch = client.vector_stores.file_batches.upload_and_poll(
                        vector_store_id=vector_store.id, 
                        files=file_streams
                    )
                    print(f"Batch uploaded with status: {file_batch.status}")
                    print(f"File counts: {file_batch.file_counts}")
                    results.append((file_batch, None))
                else:
                    print("No files to upload in this batch")
                    results.append((None, "No files to upload"))
            finally:
                # Close all open file streams
                for fs in file_streams:
                    try:
                        fs.close()
                    except:
                        pass
        
        # Get final status
        try:
            # Get the latest status of the vector store
            final_vector_store = client.vector_stores.retrieve(vector_store.id)
            return final_vector_store, results
        except Exception as e:
            print(f"Error retrieving final vector store status: {e}")
            return vector_store, results
            
    except Exception as e:
        error_msg = f"Error creating/uploading to vector store: {str(e)}"
        print(error_msg)
        return None, error_msg

def save_vector_store_history(vector_store, results, history_dir, dry_run=False):
    """Save vector store results to a history file."""
    history_file = os.path.join(history_dir, f"vector_store_history_{time.strftime('%Y%m%d_%H%M%S')}.json")
    
    history = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "vector_store_id": vector_store.id if vector_store else None,
        "vector_store_name": vector_store.name if vector_store else None,
        "batches": []
    }
    
    for batch_result, error in results:
        if batch_result:
            # Handle the FileCounts object by converting it to a dictionary safely
            file_counts_dict = {}
            if hasattr(batch_result, 'file_counts'):
                # Try different approaches to convert FileCounts to dict
                if hasattr(batch_result.file_counts, '_asdict'):
                    file_counts_dict = batch_result.file_counts._asdict()
                elif hasattr(batch_result.file_counts, '__dict__'):
                    file_counts_dict = batch_result.file_counts.__dict__
                else:
                    # Manual conversion by extracting attributes
                    try:
                        # Attempt to get common attributes
                        potential_attrs = ['total', 'pending', 'succeeded', 'failed', 'rejected']
                        for attr in potential_attrs:
                            if hasattr(batch_result.file_counts, attr):
                                file_counts_dict[attr] = getattr(batch_result.file_counts, attr)
                    except Exception as e:
                        print(f"Warning: Could not convert file_counts: {e}")
                        file_counts_dict = {"error": "Could not convert FileCounts object"}
            
            history["batches"].append({
                "batch_id": batch_result.id,
                "status": batch_result.status,
                "file_counts": file_counts_dict
            })
        elif error:
            history["batches"].append({
                "error": error
            })
    
    if not dry_run:
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2)
        print(f"Vector store history saved to {history_file}")
    else:
        print("\nWould save vector store history:")
        print(f"  File: {history_file}")
        print("  Contents:")
        print(json.dumps(history, indent=2))
    
    return history

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Chunk JavaScript files and optionally upload to OpenAI API')
    parser.add_argument('--source', default=SOURCE_DIR, help='Source directory containing JavaScript files')
    parser.add_argument('--base-dir', default=BASE_UPLOAD_DIR, help='Base directory for file uploads')
    parser.add_argument('--upload', action='store_true', help='Upload files to OpenAI Files API')
    parser.add_argument('--api-key', help='OpenAI API key (will use OPENAI_API_KEY from .env if not provided)')
    parser.add_argument('--threads', type=int, default=10, help='Number of concurrent upload threads')
    parser.add_argument('--skip-chunking', action='store_true', help='Skip chunking and only upload files')
    parser.add_argument('--chunk-threads', type=int, default=5, help='Number of concurrent chunking threads')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without actually doing it')
    parser.add_argument('--warn-size', type=float, default=50.0, 
                       help='File size in MB above which to warn (default: 50MB)')
    # New vector store options
    parser.add_argument('--create-vector-store', metavar='NAME', help='Create a vector store with the given name and upload files to it')
    
    args = parser.parse_args()
    
    if args.dry_run:
        print("\nDRY RUN MODE - No files will be created or modified\n")
    
    # Setup directories for this run
    output_dir, index_file_path, upload_history_dir = setup_run_directories(args.base_dir, args.dry_run)
    
    if args.dry_run:
        print(f"Would create run directory structure:")
        print(f"  Output directory: {output_dir}")
        print(f"  Index file: {index_file_path}")
        print(f"  Upload history directory: {upload_history_dir}\n")
    
    # Check if we're only uploading
    if args.skip_chunking:
        # Copy JavaScript files to output directory without chunking
        files = copy_js_files_to_output(args.source, output_dir, index_file_path, args.dry_run)
    else:
        # Find all JavaScript files in the source directory
        print(f"Scanning for JavaScript files in {args.source}...")
        js_files = find_js_files_iteratively(args.source)
        print(f"Found {len(js_files)} JavaScript files.")
        
        if args.dry_run:
            print("\nWould process these files:")
            for file_path in js_files:
                size_mb = os.path.getsize(file_path) / (1024 * 1024)
                print(f"  {file_path} ({size_mb:.1f}MB)")
            print()
        
        # Process each JavaScript file
        total_chunks = 0
        
        # Process files concurrently
        with ThreadPoolExecutor(max_workers=args.chunk_threads) as executor:
            futures = [
                executor.submit(chunk_js_file, file_path, output_dir, index_file_path, args.dry_run) 
                for file_path in js_files
            ]
            
            for future in as_completed(futures):
                try:
                    chunk_count = future.result()
                    total_chunks += chunk_count
                except Exception as e:
                    print(f"Error during chunking: {e}")
        
        print(f"Would create {total_chunks} chunk files from {len(js_files)} JavaScript files." if args.dry_run else
              f"Created {total_chunks} chunk files from {len(js_files)} JavaScript files.")
    
    # Get the API key with priority: command line > environment > prompt
    api_key = args.api_key or os.getenv('OPENAI_API_KEY')
    if not api_key and not args.dry_run and (args.upload or args.create_vector_store):
        api_key = input("Enter your OpenAI API key: ")
        if not api_key:
            print("No API key provided. Exiting.")
            sys.exit(1)
    
    # Get list of files to upload
    files_to_upload = get_files_to_upload(args, output_dir, upload_history_dir, args.dry_run)
    if not files_to_upload and not args.dry_run and (args.upload or args.create_vector_store):
        print("No files to upload. Exiting.")
        sys.exit(0)
    
    # Handle file uploads if requested
    if args.upload:
        if not args.dry_run:
            # Confirm with user
            confirm = input(f"Ready to upload {len(files_to_upload)} files to OpenAI API. Continue? (y/n): ").lower()
            if confirm != 'y':
                print("Upload cancelled. Exiting.")
                sys.exit(0)
            
            # Upload files concurrently
            start_time = time.time()
            results = upload_files_concurrently(files_to_upload, api_key, args.threads)
            elapsed = time.time() - start_time
            
            # Save upload history
            history_file = os.path.join(upload_history_dir, f"upload_history_{time.strftime('%Y%m%d_%H%M%S')}.json")
            history = save_upload_history(results, history_file)
            
            # Print summary
            success_count = sum(1 for info in history["files"].values() if info["status"] == "success")
            print(f"\nUpload complete in {elapsed:.2f} seconds.")
            print(f"{success_count}/{len(files_to_upload)} files uploaded successfully.")
            if success_count < len(files_to_upload):
                print(f"{len(files_to_upload) - success_count} files failed. See {history_file} for details.")
            print(f"Upload history saved to {history_file}")
        else:
            # Simulate upload process
            print("\nWould upload files to OpenAI API:")
            print(f"  - Would use API key from environment or prompt")
            print(f"  - Would upload files concurrently with {args.threads} threads")
            print(f"  - Would save upload history to {upload_history_dir}")
            print(f"  - Would display upload statistics")
    
    # Create vector store and upload files if requested
    if args.create_vector_store:
        if not args.dry_run:
            # Confirm with user
            confirm = input(f"Ready to create vector store '{args.create_vector_store}' and upload {len(files_to_upload)} files to it. Continue? (y/n): ").lower()
            if confirm != 'y':
                print("Vector store creation cancelled. Exiting.")
                sys.exit(0)
            
            # Create vector store and upload files
            print(f"Creating vector store and uploading {len(files_to_upload)} files...")
            start_time = time.time()
            vector_store, results = create_and_upload_to_vector_store(files_to_upload, args.create_vector_store, api_key)
            elapsed = time.time() - start_time
            
            if vector_store:
                print(f"\nVector store creation and upload complete in {elapsed:.2f} seconds.")
                print(f"Vector store ID: {vector_store.id}")
                print(f"Vector store name: {vector_store.name}")
                
                # Save vector store history
                history = save_vector_store_history(vector_store, results, upload_history_dir)
            else:
                print("Vector store creation failed.")
        else:
            # Simulate vector store creation
            print(f"\nWould create vector store '{args.create_vector_store}':")
            print(f"  - Would use API key from environment or prompt")
            print(f"  - Would upload {len(files_to_upload)} files to the vector store")
            print(f"  - Would save vector store history to {upload_history_dir}")
            print(f"  - Would display vector store statistics")
    
    print("Processing complete." if not args.dry_run else "Dry run complete - no files were modified.")

if __name__ == "__main__":
    main() 