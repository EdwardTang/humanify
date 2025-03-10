import re
import string
import sys
from collections import Counter
import ast
import esprima  # For JavaScript parsing

def clean_text(text: str) -> str:
    """Clean text by converting to lowercase and removing punctuation."""
    text = text.lower()
    text = text.translate(str.maketrans('', '', string.punctuation))
    return text

def clean_js_text(text: str) -> str:
    """Clean JavaScript text by:
    1. Converting to lowercase
    2. Removing punctuation
    3. Normalizing whitespace
    4. Removing common JS keywords
    """
    # Common JS keywords to filter out
    js_keywords = {'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'class'}
    
    # Convert to lowercase and remove punctuation
    text = text.lower()
    text = text.translate(str.maketrans('', '', string.punctuation))
    
    # Normalize whitespace
    text = ' '.join(text.split())
    
    # Remove common JS keywords
    words = text.split()
    words = [w for w in words if w not in js_keywords]
    
    return ' '.join(words)

def extract_js_structure(code: str) -> list:
    """Extract structural elements from JavaScript code using esprima."""
    try:
        ast = esprima.parseModule(code, {'loc': True, 'range': True})
        structures = []
        
        for node in ast.body:
            if node.type == 'FunctionDeclaration':
                structures.append({
                    'type': 'function',
                    'name': node.id.name,
                    'start': node.range[0],
                    'end': node.range[1],
                    'code': code[node.range[0]:node.range[1]]
                })
            elif node.type == 'ClassDeclaration':
                structures.append({
                    'type': 'class',
                    'name': node.id.name,
                    'start': node.range[0],
                    'end': node.range[1],
                    'code': code[node.range[0]:node.range[1]]
                })
            # Add more node types as needed
            
        return structures
    except Exception as e:
        print(f"Warning: Failed to parse JavaScript: {e}", file=sys.stderr)
        return []

class DocumentChunk:
    def __init__(self, chunk_content: str, metadata: dict):
        """
        Initialize a document chunk with BM25 scoring capabilities.
        
        Args:
            chunk_content (str): The full chunk content including document and section info
            metadata (dict): Metadata about the chunk (filename, section, etc.)
        """
        self.chunk_content = chunk_content
        self.metadata = metadata
        
        # Process content for BM25 scoring
        if metadata.get('type') == 'javascript':
            self.clean_terms = clean_js_text(self.chunk_content).split()
        else:
            self.clean_terms = clean_text(self.chunk_content).split()
            
        self.term_freq = Counter(self.clean_terms)
        self.doc_len = len(self.clean_terms)

    def __repr__(self):
        return f"DocumentChunk(section={self.metadata.get('section', 'Unknown')}, content={self.chunk_content[:30]}...)"

    def __str__(self):
        return self.chunk_content

class DocumentSection:
    def __init__(self, filename: str, section_title: str, section_content: str):
        """
        Initialize a document section with metadata and content.
        
        Args:
            filename (str): Name of the source document
            section_title (str): Title of the section
            section_content (str): Full content of the section
        """
        self.filename = filename
        self.section_title = section_title
        self.section_content = section_content
        self.clean_section_title = clean_text(section_title)
        self.clean_section_content = clean_text(section_content)

    def __repr__(self):
        return f"DocumentSection(filename={self.filename}, section={self.section_title}, content={self.section_content[:50]}...)"

    def __str__(self):
        return f"Section '{self.section_title}' from {self.filename}"