import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const frontendDist = path.join(projectRoot, 'frontend', 'dist', 'index.html');
const preloadPath = path.join(__dirname, 'preload.mjs');

let backendProcess = null;
let mainWindow = null;

function startBackend() {
  if (backendProcess || process.env.RITEPATH_SKIP_BACKEND === '1') {
    return;
  }

  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
  backendProcess = spawn(
    pythonExecutable,
    ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  backendProcess.on('exit', () => {
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  backendProcess.kill();
  backendProcess = null;
}

function getAppUrl() {
  if (process.env.RITEPATH_DEV_SERVER_URL) {
    return process.env.RITEPATH_DEV_SERVER_URL;
  }

  return `file://${frontendDist}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    frame: false,
    title: 'RitePath',
    backgroundColor: '#050910',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(getAppUrl());
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
