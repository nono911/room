---
name: room-electron-dev
description: Guidelines and checklists for developing, testing, and securing the ROOM Electron application and renderer code.
---

# ROOM Electron Desktop App Development Guideline

Use this skill when modifying or debugging the Electron application (`packages/desktop/`).

## Architectural Organization
- **Main Process (`packages/desktop/main/main.ts` or similar)**: Handles system integration, window creation, lifecycle, native APIs, file systems, and registers IPC event listeners.
- **Preload Script (`packages/desktop/main/preload.js`)**: Serves as the secure bridge. Exposes limited, specific APIs using `contextBridge`.
- **Renderer Process (`packages/desktop/renderer/src/`)**: The React/Vite UI. Has no direct access to Node.js or native APIs. Communicates exclusively via window-exposed APIs.

---

## Secure IPC Pattern (Checklist)

### 1. Preload Exposition
NEVER expose the raw `ipcRenderer` to the renderer. Expose explicit function wrappers instead:

```javascript
// packages/desktop/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanWorkspace: (path) => ipcRenderer.invoke('workspace:scan', path),
  onScanProgress: (callback) => {
    const subscription = (event, progress) => callback(progress);
    ipcRenderer.on('workspace:scan-progress', subscription);
    return () => ipcRenderer.removeListener('workspace:scan-progress', subscription);
  }
});
```

### 2. Main Process Listeners
Handle requests securely. Validate arguments (e.g., ensure paths remain inside the workspace and do not contain traversal attempts):

```typescript
// packages/desktop/main/main.ts
import { ipcMain } from 'electron';
import path from 'path';

ipcMain.handle('workspace:scan', async (event, workspacePath: string) => {
  // Validate path to prevent traversal
  const resolvedPath = path.resolve(workspacePath);
  if (!resolvedPath.startsWith(process.cwd())) {
    throw new Error('Access denied: path is outside the allowed directory.');
  }
  
  // Perform operation...
  return scanDirectory(resolvedPath);
});
```

---

## Development & Packaging Commands
- Run local development server (Vite + Electron CLI watcher):
  ```bash
  rtk npm run dev:desktop
  ```
- Build the production assets for renderer & main:
  ```bash
  rtk npm run build:desktop
  ```
- Package desktop application into `.app` or native formats:
  ```bash
  rtk npm run package:desktop
  ```
- Check TypeScript types inside desktop package:
  ```bash
  rtk npm run typecheck -w packages/desktop
  ```
