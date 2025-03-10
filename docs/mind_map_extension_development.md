# Developing a Mind Map Extension for Guangbiao IDE

## Overview
This document tracks the development process of implementing a mind map visualization extension for Guangbiao IDE's Composer feature. The extension is designed to enhance the IDE's reasoning capabilities by providing visual representation of logical relationships.

## Development Log

### Phase 1: Extension Scaffold Creation (2024-03-21)

#### 1. Basic Directory Structure
```bash
mkdir -p squashfs-root/resources/app/extensions/guangbiao-mindmap/{src,webview,media}
```

Directory structure explanation:
- `src/`: Contains TypeScript source files
- `webview/`: Houses UI components and web assets
- `media/`: Stores icons and other media files

#### 2. Configuration Files

##### package.json
```json
{
  "name": "guangbiao-mindmap",
  "displayName": "Guangbiao Mind Map",
  "description": "Mind map visualization for Guangbiao's Composer",
  "version": "0.1.0",
  "publisher": "anysphere-security",
  "engines": {
    "vscode": "^1.63.0"
  },
  "categories": [
    "Visualization",
    "Other"
  ],
  "activationEvents": [
    "onCommand:guangbiao-mindmap.showMindMap"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "guangbiao-mindmap.showMindMap",
        "title": "Show Mind Map",
        "category": "Guangbiao Mind Map"
      }
    ],
    "viewsContainers": {
      "panel": [
        {
          "id": "guangbiao-mindmap-view",
          "title": "Guangbiao Mind Map",
          "icon": "media/mindmap.svg"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts"
  },
  "devDependencies": {
    "@types/node": "^16.11.7",
    "@types/vscode": "^1.63.0",
    "@typescript-eslint/eslint-plugin": "^5.30.0",
    "@typescript-eslint/parser": "^5.30.0",
    "eslint": "^8.13.0",
    "typescript": "^4.7.2"
  },
  "dependencies": {
    "react": "^17.0.2",
    "react-dom": "^17.0.2"
  }
}
```

##### tsconfig.json
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "lib": ["ES2020", "DOM"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react",
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

#### 3. Core Data Structures

##### src/types.ts
```typescript
export interface ComposerNode {
  id: string;
  type: 'thought' | 'action' | 'question' | 'conclusion';
  content: string;
  children: ComposerNode[];
  metadata: NodeMetadata;
}

export interface NodeMetadata {
  timestamp: number;
  confidence: number;
  source?: string;
  tags?: string[];
  status: 'active' | 'completed' | 'pending';
}

export interface MindMapState {
  nodes: ComposerNode[];
  selectedNodeId: string | null;
  expandedNodeIds: Set<string>;
  zoomLevel: number;
}

export type MindMapAction = 
  | { type: 'ADD_NODE'; parentId: string; node: ComposerNode }
  | { type: 'UPDATE_NODE'; nodeId: string; updates: Partial<ComposerNode> }
  | { type: 'DELETE_NODE'; nodeId: string }
  | { type: 'SELECT_NODE'; nodeId: string | null }
  | { type: 'TOGGLE_NODE'; nodeId: string }
  | { type: 'SET_ZOOM'; level: number };

export interface MindMapContextValue {
  state: MindMapState;
  dispatch: (action: MindMapAction) => void;
}
```

##### src/store.ts
```typescript
// See full implementation in the repository
// Implements React Context and Reducer for state management
```

#### 4. Pending Implementation

The following files need to be created next:

##### a. Extension Entry Point (src/extension.ts)
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register commands
  let disposable = vscode.commands.registerCommand('guangbiao-mindmap.showMindMap', () => {
    // Create and show webview
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
```

##### b. Webview Panel Manager (src/MindMapPanel.ts)
```typescript
import * as vscode from 'vscode';

export class MindMapPanel {
  public static currentPanel: MindMapPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    // Set up webview
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    // Create or focus panel
  }

  private _getHtmlForWebview() {
    // Return webview HTML content
  }
}
```

##### c. Webview React Components (webview/MindMapView.tsx)
```typescript
import React from 'react';
import { MindMapProvider } from '../src/store';
import { NodeGraph } from './components/NodeGraph';

export function MindMapView() {
  return (
    <MindMapProvider>
      <NodeGraph />
    </MindMapProvider>
  );
}
```

#### 5. Media Assets
- Create `media/mindmap.svg` for extension icon

## Next Steps
1. Implement the extension entry point
2. Create the webview panel manager
3. Develop React components for the mind map visualization
4. Set up communication between extension and webview
5. Implement mind map rendering and interaction logic

## Technical Decisions

### State Management
- Using React Context and Reducer for state management
- Hierarchical state updates for better performance
- Event-driven communication for async operations

### UI Implementation
- VSCode webview API for extension UI
- React for component management
- TypeScript for type safety

### Integration Strategy
- Leveraging VSCode extension API
- Reusing existing state management patterns
- Independent mind map renderer for modularity

## Performance Considerations
1. Optimizing state updates for large mind maps
2. Efficient rendering of complex node hierarchies
3. Smooth zooming and panning interactions
4. Memory management for large data structures 