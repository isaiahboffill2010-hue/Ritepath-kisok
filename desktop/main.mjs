import { app, BrowserView, BrowserWindow, ipcMain, shell } from 'electron';
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
let googleView = null;
let googleViewAttached = false;
let googleGesture = null;

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

function ensureGoogleView() {
  if (googleView) {
    return googleView;
  }

  googleView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  googleView.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  googleView.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || (input.alt && input.key === 'ArrowLeft'))) {
      event.preventDefault();
      hideGoogleView();
      googleGesture = null;
    }
  });
  googleView.webContents.on('before-mouse-event', (event, mouse) => {
    if (mouse.type === 'mouseDown' && mouse.x <= 80 && mouse.y <= 80) {
      event.preventDefault();
      hideGoogleView();
      googleGesture = null;
      return;
    }

    if (mouse.type === 'mouseDown') {
      const bounds = mainWindow?.getContentBounds();
      googleGesture = {
        startX: mouse.x,
        startY: mouse.y,
        active: !bounds || mouse.y >= bounds.height - 120,
      };
      return;
    }

    if (mouse.type === 'mouseMove') {
      if (!googleGesture?.active) {
        return;
      }

      const deltaX = mouse.x - googleGesture.startX;
      const deltaY = mouse.y - googleGesture.startY;
      if (deltaY <= -90 && Math.abs(deltaX) <= 60) {
        event.preventDefault();
        googleGesture = null;
        openDrawerFromGoogle();
      }
      return;
    }

    if (mouse.type === 'mouseUp') {
      googleGesture = null;
    }
  });

  return googleView;
}

function resizeGoogleView() {
  if (!mainWindow || !googleView || !googleViewAttached) {
    return;
  }

  const bounds = mainWindow.getContentBounds();
  googleView.setBounds({
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height,
  });
  googleView.setAutoResize({
    width: true,
    height: true,
  });
}

function showGoogleView(url) {
  if (!mainWindow) {
    return;
  }

  const view = ensureGoogleView();
  const targetUrl = url || 'https://www.google.com/';

  if (googleViewAttached) {
    mainWindow.removeBrowserView(view);
    googleViewAttached = false;
  }

  mainWindow.setBackgroundColor('#ffffff');
  mainWindow.addBrowserView(view);
  googleViewAttached = true;
  resizeGoogleView();
  void view.webContents.loadURL(targetUrl);
}

function hideGoogleView() {
  if (!mainWindow || !googleView || !googleViewAttached) {
    return;
  }

  mainWindow.removeBrowserView(googleView);
  googleViewAttached = false;
  googleGesture = null;
}

function openDrawerFromGoogle() {
  hideGoogleView();
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send('ritepath:open-drawer');
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
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('resize', resizeGoogleView);
  mainWindow.on('enter-full-screen', resizeGoogleView);
  mainWindow.on('leave-full-screen', resizeGoogleView);
  mainWindow.on('unmaximize', resizeGoogleView);
  mainWindow.on('maximize', resizeGoogleView);
  mainWindow.on('closed', () => {
    googleViewAttached = false;
    googleView = null;
    googleGesture = null;
    mainWindow = null;
  });

  mainWindow.loadURL(getAppUrl());
}

ipcMain.on('ritepath:open-google', (_event, url) => {
  showGoogleView(typeof url === 'string' ? url : 'https://www.google.com/');
});

ipcMain.on('ritepath:close-google', () => {
  hideGoogleView();
});

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
