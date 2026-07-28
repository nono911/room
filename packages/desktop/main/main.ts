import { app, BrowserWindow, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { isAllowedExternalUrl, isAllowedRendererNavigation } from './navigation-security.js';
import {
  registerWorkspaceIpc,
  registerDiscussionsIpc,
  registerTasksIpc,
  registerAgentsIpc,
  registerProvidersIpc,
  registerMcpIpc,
  registerFilesIpc,
  registerRunControlIpc,
  registerTeamsIpc,
  interruptRunsForOwner
} from './ipc/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, '../renderer');

// Register app:// scheme as standard and secure to support ES Modules
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url, isDev)) {
      event.preventDefault();
    }
  });

  if (isDev) {
    net.fetch('http://localhost:5173')
      .then(() => {
        mainWindow?.loadURL('http://localhost:5173');
      })
      .catch(() => {
        console.log('[Electron] Dev server not running on port 5173. Falling back to built renderer files.');
        mainWindow?.loadURL('app://localhost/index.html');
      });
  } else {
    mainWindow.loadURL('app://localhost/index.html'); // Load using custom protocol
  }
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Captured up front: webContents is already destroyed once 'closed' fires.
  const runOwnerId = mainWindow.webContents.id;
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Runs outlive the window on macOS, where closing does not quit the app.
    interruptRunsForOwner(runOwnerId);
  });
}

function resolveRendererAssetPath(rawPath: string): string {
  const decodedPath = decodeURIComponent(rawPath || '/index.html');
  const normalizedPath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
  const candidate = path.resolve(rendererRoot, `.${normalizedPath}`);
  const rel = path.relative(rendererRoot, candidate);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid app resource path.');
  }

  return candidate;
}

// Register all IPC handlers
registerWorkspaceIpc(() => mainWindow);
registerDiscussionsIpc();
registerTasksIpc();
registerAgentsIpc();
registerProvidersIpc();
registerMcpIpc();
registerFilesIpc();
registerRunControlIpc();
registerTeamsIpc();

app.whenReady().then(async () => {
  // Register custom protocol handler to resolve files from renderer output
  protocol.handle('app', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const requestPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
      const safePath = resolveRendererAssetPath(requestPath);
      
      const fileBuffer = await fs.readFile(safePath);
      const ext = path.extname(safePath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.html') mimeType = 'text/html';
      else if (ext === '.js') mimeType = 'application/javascript';
      else if (ext === '.css') mimeType = 'text/css';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else if (ext === '.json') mimeType = 'application/json';
      else if (ext === '.ico') mimeType = 'image/x-icon';

      return new Response(fileBuffer, {
        headers: { 'content-type': mimeType }
      });
    } catch (error) {
      console.warn('[Electron] Rejected app:// path request:', error);
      return new Response('Forbidden', { status: 403 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
