import { app, BrowserWindow, protocol, net } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { applyApiKeysToEnvironment } from './ipc/shared.js';
import {
  registerWorkspaceIpc,
  registerDiscussionsIpc,
  registerTasksIpc,
  registerAgentsIpc,
  registerProvidersIpc,
  registerMcpIpc,
  registerFilesIpc
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

  const isDev = !app.isPackaged;
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

  mainWindow.on('closed', () => {
    mainWindow = null;
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

app.whenReady().then(async () => {
  await applyApiKeysToEnvironment();

  // Register custom protocol handler to resolve files from renderer output
  protocol.handle('app', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const requestPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
      const safePath = resolveRendererAssetPath(requestPath);
      return net.fetch(`file://${safePath}`);
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
