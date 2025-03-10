from smolagents import Tool
import os
import pickle
import string
from collections import Counter
import math
from itertools import groupby
import nltk
from tools.document import DocumentChunk, clean_text, clean_js_text


class BM25RetrieverTool(Tool):
    name = "bm25_retriever"
    description = "A tool that retrieves the most relevant documents and snippets therefrom, along with the sections the snippets are in, using BM25 scoring. Optimized for both general text and JavaScript code search."
    inputs = {
        "query": {
            "type": "string",
            "description": "The search query to find relevant document sections and snippets."
        },
        "num_snippets": {
            "type": "integer",
            "description": "The number of relevant snippets to return, maximum 5.",
            "default": 5,
            "nullable": True
        },
        "js_only": {
            "type": "boolean",
            "description": "Whether to search only in JavaScript files.",
            "default": False,
            "nullable": True
        }
    }
    output_type = "string"

    def __init__(self, output_dir='cursor_redteam/workspace/squashfs-root/resources/app/out/vs', retriever_file='bm25_retriever.pkl'):
        super().__init__()
        self.output_dir = output_dir
        self.retriever_file = retriever_file
        self.documents = []
        self.avgdl = 0
        self.N = 0
        self.term_document_freq = {}
        self.k1 = 1.5
        self.b = 0.75
        self.is_initialized = False
        self.load_retriever_state()
        self.is_initialized = True

    def load_retriever_state(self):
        if os.path.exists(self.retriever_file):
            try:
                print(f"Loading retriever state from {self.retriever_file}...")
                with open(self.retriever_file, 'rb') as f:
                    state = pickle.load(f)
                    self.documents = state.get('documents', [])
                    self.term_document_freq = state.get('term_document_freq', {})
                    self.avgdl = state.get('avgdl', 0)
                    self.N = state.get('N', 0)
                print(f"Loaded {self.N} documents with {len(self.term_document_freq)} unique terms.")
            except Exception as e:
                print(f"Error loading retriever state: {e}")
                self.documents = []
                self.term_document_freq = {}
                self.avgdl = 0
                self.N = 0

    def forward(self, query: str, num_snippets: int = 5, js_only: bool = False):
        num_snippets = min(num_snippets, 5)  # Ensure the maximum is 5
        if not query:
            return ""
            
        # Filter documents if js_only is True
        docs_to_search = [doc for doc in self.documents if not js_only or doc.metadata.get('type') == 'javascript']
        if js_only:
            print(f"Searching only in JavaScript files ({len(docs_to_search)} documents)...")
        else:
            print(f"Searching in all files ({len(docs_to_search)} documents)...")
        
        results = self.bm25_score(query, docs_to_search)[:num_snippets]
        results.sort(key=lambda doc: (doc[0].metadata['filename'], doc[0].metadata.get('js_type', ''), doc[0].metadata.get('js_name', '')))
        grouped_results = groupby(results, key=lambda doc: doc[0].metadata['filename'])

        output = []
        for doc_name, group in grouped_results:
            output.append(f"========== {doc_name} ==========")
            
            # Load table of contents for markdown files
            if doc_name.endswith('.md'):
                toc_file_path = os.path.join(self.output_dir, doc_name.rsplit('.', 1)[0] + '_toc.md')
                if os.path.exists(toc_file_path):
                    with open(toc_file_path, 'r', encoding='utf-8') as toc_file:
                        toc_content = toc_file.read()
                        output.append("Table of Contents:")
                        output.append(toc_content)
                        output.append("\n---\n")
            
            # Process each chunk
            for doc, score in group:
                # For JavaScript, include type and name in the output
                if doc.metadata.get('type') == 'javascript':
                    js_type = doc.metadata.get('js_type', 'Unknown Type')
                    js_name = doc.metadata.get('js_name', 'Unknown Name')
                    output.append(f"Type: {js_type}")
                    output.append(f"Name: {js_name}")
                
                section_title = doc.metadata.get('section', 'Unknown Section')
                output.append(f"Section: {section_title}")
                output.append(f"Relevant Content:\n{doc.chunk_content}")
                output.append(f"Score: {score:.1f}")
                output.append("\n---\n")
            
            output.append("\n==========\n")
        
        if not output:
            return "No matching documents found."
            
        return "\n".join(output)

    def bm25_score(self, query, documents):
        # Clean query based on document type
        if any(doc.metadata.get('type') == 'javascript' for doc in documents):
            query_terms = clean_js_text(query).split()
            print(f"Using JavaScript-optimized query cleaning: {' '.join(query_terms)}")
        else:
            query_terms = clean_text(query).split()
            
        doc_scores = []
        
        for doc in documents:
            score = 0
            for term in query_terms:
                if term in doc.term_freq:
                    df = self.term_document_freq.get(term, 1)
                    idf = math.log((self.N - df + 0.5) / (df + 0.5) + 1)
                    tf = doc.term_freq[term]
                    score += idf * ((tf * (self.k1 + 1)) / (tf + self.k1 * (1 - self.b + self.b * (doc.doc_len / self.avgdl))))
                    
                    # Boost score for JavaScript function/class names that match query terms
                    if doc.metadata.get('type') == 'javascript' and term in doc.metadata.get('js_name', '').lower():
                        score *= 1.5
                        print(f"Boosted score for term '{term}' in {doc.metadata.get('js_name')}")
            
            if score > 0:  # Only include documents with non-zero scores
                doc_scores.append((doc, score))
        
        return sorted(doc_scores, key=lambda x: x[1], reverse=True)

    @staticmethod
    def clean_text(text):
        text = text.lower()
        text = text.translate(str.maketrans('', '', string.punctuation))
        return text

if __name__ == "__main__":
    # Example usage:
    bm25_tool = BM25RetrieverTool()
    
    # Search in all documents
    results = bm25_tool.forward("function handleRequest", num_snippets=3)
    print("General search results:")
    print(results)
    
    # Search only in JavaScript files
    results = bm25_tool.forward("function handleRequest", num_snippets=3, js_only=True)
    print("\nJavaScript-only search results:")
    print(results) 