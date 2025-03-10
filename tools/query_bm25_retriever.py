import os
import sys
import pickle
import re
from collections import Counter
from typing import Dict, List, Tuple
from tools.document import DocumentChunk, DocumentSection, clean_text, extract_js_structure

# Define the directory containing the code files
output_dir = 'cursor_redteam/workspace/squashfs-root/resources/app/out/vs'

# Define a file to save the retriever state
retriever_file = 'bm25_retriever.pkl'

# Function to split sections into chunks of a maximum size respecting sentence boundaries
CHUNK_SIZE = 2000

# Binary file extensions to skip
BINARY_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.mp3', '.mp4', 
    '.wav', '.ogg', '.pdf', '.ttf', '.woff', '.woff2', '.eot',
    '.scpt', '.scptd'
}

def is_binary_file(filename):
    """Check if a file is likely to be binary based on extension."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in BINARY_EXTENSIONS

def is_text_content(content, sample_size=1024):
    """Heuristic to check if content appears to be text."""
    try:
        # Try to decode a sample of the content as UTF-8
        sample = content[:sample_size]
        sample.decode('utf-8')
        return True
    except UnicodeDecodeError:
        return False

def split_into_sentences(text):
    """Simple sentence splitter using common delimiters."""
    # Split on common sentence delimiters
    delimiters = r'[.!?]\s+'
    sentences = re.split(delimiters, text)
    # Filter out empty sentences and strip whitespace
    return [s.strip() for s in sentences if s.strip()]

def split_into_sections(content):
    sections = []
    current_section = []
    section_title = None

    for line in content.splitlines():
        match = re.match(r'^(#+)\s+(.*)', line)
        # Only consider headers with ## or more and titles with at least 5 characters
        if match and len(match.group(1)) > 1 and len(match.group(2).strip()) >= 5:
            # When we find a new section header, save the previous section if it has content
            if current_section and section_title:  # Only save if we have both title and content
                # Exclude the title line and strip whitespace
                section_content = '\n'.join(current_section[1:]).strip()
                if section_content:  # Only save if there's actual content
                    sections.append((section_title, section_content))
            # Use the section header line
            section_title = match.group(2).strip()
            current_section = []
        current_section.append(line)

    # Don't forget the last section
    if current_section and section_title:  # Only save if we have both title and content
        # Exclude the title line and strip whitespace
        section_content = '\n'.join(current_section[1:]).strip()
        if section_content:  # Only save if there's actual content
            sections.append((section_title, section_content))

    return sections

def split_into_chunks(section, metadata):
    section_title, section_content = section

    # Skip empty sections
    if not section_content.strip():
        return []

    # Special handling for JavaScript files
    if metadata.get('type') == 'javascript':
        chunks = []
        structures = extract_js_structure(section_content)

        # If we can't parse the structure, fall back to basic chunking
        if not structures:
            return split_into_basic_chunks(section, metadata)

        # Create chunks for each structural element
        for struct in structures:
            chunk_title = f"{struct['type']} {struct['name']}"
            chunk_metadata = {
                **metadata,
                'section': chunk_title,
                'type': 'javascript',
                'js_type': struct['type'],
                'js_name': struct['name']
            }

            full_chunk = f"Document: {metadata['filename']}\nSection: {chunk_title}\nType: {struct['type']}\nName: {struct['name']}\nSnippet:\n{struct['code']}"
            chunks.append(DocumentChunk(
                chunk_content=full_chunk, metadata=chunk_metadata))

        return chunks

    # For non-JavaScript files, use basic chunking
    return split_into_basic_chunks(section, metadata)

def split_into_basic_chunks(section, metadata):
    section_title, section_content = section
    try:
        sentences = split_into_sentences(section_content)
    except Exception as e:
        print(f"Error splitting section '{section_title}' into sentences: {e}")
        return []

    chunks = []
    current_chunk = []
    current_length = 0

    for sentence in sentences:
        # If sentence is too long, break it into smaller parts
        if len(sentence) > CHUNK_SIZE:
            words = sentence.split()
            for i in range(0, len(words), 100):
                word_chunk = ' '.join(words[i:i+100])
                if current_length + len(word_chunk) > CHUNK_SIZE and current_chunk:
                    chunk_text = ' '.join(current_chunk)
                    full_chunk = f"Document: {metadata['filename']}\nSection: {section_title}\nSnippet: {chunk_text}"
                    chunks.append(DocumentChunk(
                        chunk_content=full_chunk, metadata=metadata))
                    current_chunk = [word_chunk]
                    current_length = len(word_chunk)
                else:
                    current_chunk.append(word_chunk)
                    current_length += len(word_chunk) + 1
        else:
            if current_length + len(sentence) > CHUNK_SIZE and current_chunk:
                chunk_text = ' '.join(current_chunk)
                full_chunk = f"Document: {metadata['filename']}\nSection: {section_title}\nSnippet: {chunk_text}"
                chunks.append(DocumentChunk(
                    chunk_content=full_chunk, metadata=metadata))
                current_chunk = [sentence]
                current_length = len(sentence)
            else:
                current_chunk.append(sentence)
                current_length += len(sentence) + 1

    if current_chunk:
        chunk_text = ' '.join(current_chunk)
        full_chunk = f"Document: {metadata['filename']}\nSection: {section_title}\nSnippet: {chunk_text}"
        chunks.append(DocumentChunk(
            chunk_content=full_chunk, metadata=metadata))

    return chunks

def main():
    # Check for --refresh argument
    refresh = '--refresh' in sys.argv
    
    # If retriever state exists and no refresh requested, exit
    if os.path.exists(retriever_file) and not refresh:
        print("Retriever state already exists. Use --refresh to rebuild.")
        return
        
    documents = []
    term_document_freq = {}
    
    # Process files recursively
    print(f"Starting to process files in {output_dir} and its subdirectories...")
    
    # Track statistics
    stats = {
        'total_files': 0,
        'processed_files': 0,
        'skipped_binary': 0,
        'skipped_other': 0,
        'failed_parse': 0
    }
    
    for root, dirs, files in os.walk(output_dir):
        for filename in files:
            stats['total_files'] += 1
            file_path = os.path.join(root, filename)
            
            # Skip non-text files
            if not os.path.isfile(file_path):
                stats['skipped_other'] += 1
                continue
                
            # Skip known binary files
            if is_binary_file(filename):
                stats['skipped_binary'] += 1
                continue
                
            # Get relative path for display
            rel_path = os.path.relpath(file_path, output_dir)
            print(f"Processing {rel_path}...")
            
            try:
                # First try to read file in binary mode to check content
                with open(file_path, 'rb') as f:
                    raw_content = f.read()
                    if not is_text_content(raw_content):
                        print(f"  Skipping binary file: {rel_path}")
                        stats['skipped_binary'] += 1
                        continue
                
                # If it looks like text, decode and process
                content = raw_content.decode('utf-8')
                
                # Handle JavaScript files
                if filename.endswith('.js'):
                    section_title = 'JavaScript Code'
                    section_metadata = {
                        'filename': rel_path,  # Use relative path in metadata
                        'section': section_title,
                        'type': 'javascript'
                    }
                    chunks = split_into_chunks((section_title, content), section_metadata)
                
                # Handle Markdown files
                elif filename.endswith('.md') and not filename.endswith('_toc.md'):
                    sections = split_into_sections(content)
                    chunks = []
                    for section_title, section_content in sections:
                        section_metadata = {
                            'filename': rel_path,  # Use relative path in metadata
                            'section': section_title,
                            'type': 'markdown'
                        }
                        chunks.extend(split_into_chunks((section_title, section_content), section_metadata))
                else:
                    # Skip non-JS/MD files
                    stats['skipped_other'] += 1
                    continue
                
                # Update document frequencies
                for chunk in chunks:
                    for term in set(chunk.clean_terms):
                        term_document_freq[term] = term_document_freq.get(term, 0) + 1
                
                documents.extend(chunks)
                print(f"  Added {len(chunks)} chunks from {rel_path}")
                stats['processed_files'] += 1
                
            except Exception as e:
                print(f"Error processing {rel_path}: {str(e)}", file=sys.stderr)
                stats['failed_parse'] += 1
                continue
    
    # Calculate average document length
    avgdl = sum(doc.doc_len for doc in documents) / len(documents) if documents else 0
    N = len(documents)
    
    # Print statistics
    print("\nProcessing Statistics:")
    print(f"Total files found: {stats['total_files']}")
    print(f"Successfully processed: {stats['processed_files']}")
    print(f"Skipped binary files: {stats['skipped_binary']}")
    print(f"Skipped other files: {stats['skipped_other']}")
    print(f"Failed to parse: {stats['failed_parse']}")
    
    # Save state
    print(f"\nSaving {N} chunks from {len(term_document_freq)} unique terms to {retriever_file}...")
    with open(retriever_file, 'wb') as f:
        pickle.dump({
            'documents': documents,
            'term_document_freq': term_document_freq,
            'avgdl': avgdl,
            'N': N
        }, f)
    
    print(f"Done! Processed {N} chunks in total.")

if __name__ == "__main__":
    main()
