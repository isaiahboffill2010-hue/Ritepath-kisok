import { app, BrowserView, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles } from './env.mjs';
import { configureWeather, getWeather, loadCachedWeather, WEATHER_REFRESH_MS } from './weather.mjs';
import { configureWidgetState, getWidgetState, setWidgetState } from './widget-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const frontendDist = path.join(projectRoot, 'frontend', 'dist', 'index.html');
const preloadPath = path.join(__dirname, 'preload.mjs');
const navOverlayPreloadPath = path.join(__dirname, 'overlay', 'nav-preload.mjs');
const navOverlayHtml = path.join(__dirname, 'overlay', 'nav-overlay.html');
const overlayPreloadPath = path.join(__dirname, 'overlay', 'overlay-preload.mjs');
const islandHtml = path.join(__dirname, 'overlay', 'island.html');
const weatherHtml = path.join(__dirname, 'overlay', 'weather.html');

// Reads WEATHER_API_KEY (and the optional WEATHER_LOCATION) into the main
// process only. The key never leaves this process.
loadEnvFiles(projectRoot);

// Height of the always-present gesture strip, and of the temporarily enlarged
// hit area that keeps an in-progress swipe attached to the overlay.
const NAV_COLLAPSED_HEIGHT = 44;
const NAV_EXPANDED_HEIGHT = 220;

// Follow-up passes after a display/orientation change, in ms.
const SHELL_LAYOUT_SETTLE_DELAYS = [0, 60, 250, 750];

let backendProcess = null;
let mainWindow = null;
let googleView = null;
let googleViewAttached = false;
let googleGesture = null;
let navOverlayView = null;
let navOverlayAttached = false;
let navOverlayExpanded = false;
let islandView = null;
let weatherView = null;
let weatherViewAttached = false;
let weatherViewReady = false;
let weatherRefreshTimer = null;

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
      // Note: Swipe-up no longer closes the web app. User must press Home button.
      // This prevents accidental closure while scrolling/interacting with web content.
      return;
    }

    if (mouse.type === 'mouseUp') {
      googleGesture = null;
    }
  });

  return googleView;
}

// Shared factory for the transparent shell overlays (Dynamic Island, weather).
// Each overlay is a BrowserView kept just large enough for what it draws, so the
// launcher and any opened web app stay interactive around it.
function createOverlayView(htmlFile) {
  const view = new BrowserView({
    webPreferences: {
      preload: overlayPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      transparent: true,
    },
  });

  view.setBackgroundColor('#00000000');
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void view.webContents.loadFile(htmlFile);

  return view;
}

function sendViewport(view) {
  if (!mainWindow || !view || view.webContents.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.getContentBounds();
  view.webContents.send('ritepath:overlay-viewport', {
    width: bounds.width,
    height: bounds.height,
  });
}

function ensureIslandOverlay() {
  if (islandView) {
    return islandView;
  }

  islandView = createOverlayView(islandHtml);
  islandView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  islandView.webContents.once('did-finish-load', () => sendViewport(islandView));

  return islandView;
}

function showIslandOverlay() {
  if (!mainWindow) {
    return;
  }

  const view = ensureIslandOverlay();
  mainWindow.addBrowserView(view);
  sendViewport(view);
}

function ensureWeatherOverlay() {
  if (weatherView) {
    return weatherView;
  }

  weatherView = createOverlayView(weatherHtml);
  weatherView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  weatherViewReady = false;

  // On the very first open the page is still loading, and messages sent to a
  // renderer that has not registered its listeners yet are dropped. Replaying
  // them here is what stops the window from laying itself out against an
  // unknown screen size.
  weatherView.webContents.once('did-finish-load', () => {
    weatherViewReady = true;
    sendViewport(weatherView);

    if (weatherViewAttached) {
      weatherView.webContents.send('ritepath:overlay-reset');
    }
  });

  return weatherView;
}

function showWeatherOverlay() {
  if (!mainWindow) {
    return;
  }

  const view = ensureWeatherOverlay();
  if (!weatherViewAttached) {
    mainWindow.addBrowserView(view);
    weatherViewAttached = true;
  }

  sendViewport(view);
  raiseOverlays();

  if (weatherViewReady) {
    view.webContents.send('ritepath:overlay-reset');
  }
}

function hideWeatherOverlay() {
  if (!mainWindow || !weatherView || !weatherViewAttached) {
    return;
  }

  mainWindow.removeBrowserView(weatherView);
  weatherViewAttached = false;
}

// Keeps the shell overlays above opened web apps. The bottom Home navigation is
// raised last so it always wins over the weather window.
function raiseOverlays() {
  if (!mainWindow) {
    return;
  }

  if (weatherView && weatherViewAttached) {
    mainWindow.setTopBrowserView(weatherView);
  }

  // The island sits above the weather overlay so the pill stays tappable while
  // the weather window is open.
  if (islandView) {
    mainWindow.setTopBrowserView(islandView);
  }

  if (navOverlayView && navOverlayAttached) {
    mainWindow.setTopBrowserView(navOverlayView);
  }
}

function broadcastWeather(result) {
  for (const view of [islandView, weatherView]) {
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send('ritepath:weather-update', result);
    }
  }
}

// Weather must never be able to stop the kiosk from running, so every refresh is
// fire-and-forget and failures only ever surface as a state inside the widget.
async function refreshWeather({ force = false } = {}) {
  try {
    const result = await getWeather({ force });
    broadcastWeather(result);
    return result;
  } catch {
    return {
      ok: false,
      stale: false,
      fetchedAt: null,
      data: null,
      error: { code: 'unavailable', message: 'Weather unavailable' },
    };
  }
}

function startWeatherRefresh() {
  if (weatherRefreshTimer) {
    return;
  }

  weatherRefreshTimer = setInterval(() => {
    void refreshWeather({ force: true });
  }, WEATHER_REFRESH_MS);
}

function ensureNavOverlay() {
  if (navOverlayView) {
    return navOverlayView;
  }

  navOverlayView = new BrowserView({
    webPreferences: {
      preload: navOverlayPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      transparent: true,
    },
  });

  navOverlayView.setBackgroundColor('#00000000');
  navOverlayView.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  void navOverlayView.webContents.loadFile(navOverlayHtml);

  return navOverlayView;
}

function resizeNavOverlay() {
  if (!mainWindow || !navOverlayView || !navOverlayAttached) {
    return;
  }

  const bounds = mainWindow.getContentBounds();
  const height = Math.min(
    navOverlayExpanded ? NAV_EXPANDED_HEIGHT : NAV_COLLAPSED_HEIGHT,
    bounds.height,
  );

  navOverlayView.setBounds({
    x: 0,
    y: Math.max(0, bounds.height - height),
    width: bounds.width,
    height,
  });
}

function showNavOverlay() {
  if (!mainWindow) {
    return;
  }

  const view = ensureNavOverlay();
  if (!navOverlayAttached) {
    mainWindow.addBrowserView(view);
    navOverlayAttached = true;
  }

  navOverlayExpanded = false;
  // Keep the navigation control above the opened web app at all times.
  raiseOverlays();
  resizeNavOverlay();
  view.webContents.send('ritepath:nav-reset');
}

function hideNavOverlay() {
  if (!mainWindow || !navOverlayView || !navOverlayAttached) {
    return;
  }

  mainWindow.removeBrowserView(navOverlayView);
  navOverlayAttached = false;
  navOverlayExpanded = false;
}

// The content area an opened web app is expected to fill. Overlays (Dynamic
// Island, weather, bottom Home gesture) float above the app rather than taking
// space from it, so the app view owns the whole rect. Everything is derived from
// the live window bounds - no resolution is ever assumed.
function getAppViewBounds() {
  const bounds = mainWindow.getContentBounds();

  return {
    x: 0,
    y: 0,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

// Sizing an opened web app is a full rect assignment, never a delta. The
// previous implementation also called setAutoResize({ width, height }), which
// Electron applies natively as an offset against the view's *previous* size and
// which cannot touch x/y at all - so once the view had been laid out for
// landscape it could not recover its origin after the display turned portrait.
function resizeGoogleView() {
  if (!mainWindow || !googleView || !googleViewAttached) {
    return;
  }

  googleView.setBounds(getAppViewBounds());
}

// A frameless kiosk window is placed on Windows with an explicit position taken
// when it entered fullscreen, and it is not refitted the way a maximized window
// is when the display rotates. Without this the window itself keeps reporting
// landscape content bounds, so every view laid out from them stays landscape too.
// Only ever a correction toward the current display, so when the geometry is
// already right (the working landscape case) this is a no-op.
function refitWindowToDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!mainWindow.isKiosk() && !mainWindow.isFullScreen()) {
    return;
  }

  const current = mainWindow.getBounds();
  const target = screen.getDisplayMatching(current).bounds;

  if (
    current.x === target.x &&
    current.y === target.y &&
    current.width === target.width &&
    current.height === target.height
  ) {
    return;
  }

  mainWindow.setBounds(target);
}

// Single place that re-derives every piece of shell geometry from the current
// window. Shared by the launcher, Google and custom web apps alike.
function layoutShell() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  resizeGoogleView();
  resizeNavOverlay();
  sendViewport(islandView);
  sendViewport(weatherView);

  if (process.env.RITEPATH_DEBUG_LAYOUT === '1') {
    const content = mainWindow.getContentBounds();
    console.log(
      '[ritepath:layout] content=%dx%d app=%s',
      content.width,
      content.height,
      googleViewAttached ? JSON.stringify(googleView?.getBounds()) : 'detached',
    );
  }
}

// During an orientation change Windows reports the window's new size over
// several messages, so the first read can still be the old landscape rect.
// Re-running the layout on the following ticks settles it. Re-laying out is pure
// geometry - the opened page is never reloaded and keeps its session.
function scheduleShellLayout() {
  refitWindowToDisplay();
  layoutShell();

  for (const delay of SHELL_LAYOUT_SETTLE_DELAYS) {
    setTimeout(() => {
      refitWindowToDisplay();
      layoutShell();
    }, delay);
  }
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
  showNavOverlay();
  raiseOverlays();
}

function hideGoogleView() {
  hideNavOverlay();

  if (!mainWindow || !googleView || !googleViewAttached) {
    return;
  }

  mainWindow.removeBrowserView(googleView);
  googleViewAttached = false;
  googleGesture = null;
}

// The real Home action: close whatever web app is open and hand control back to
// the RitePath launcher. No synthetic Escape key involved.
function goHome() {
  hideGoogleView();

  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send('ritepath:go-home');
  mainWindow.webContents.focus();
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
  const handleWindowResize = () => {
    layoutShell();
  };

  mainWindow.on('resize', handleWindowResize);
  mainWindow.on('enter-full-screen', handleWindowResize);
  mainWindow.on('leave-full-screen', handleWindowResize);
  mainWindow.on('unmaximize', handleWindowResize);
  mainWindow.on('maximize', handleWindowResize);
  // Rotation can move the window without changing its size, which never emits
  // 'resize'.
  mainWindow.on('move', handleWindowResize);
  mainWindow.on('closed', () => {
    googleViewAttached = false;
    googleView = null;
    googleGesture = null;
    navOverlayAttached = false;
    navOverlayExpanded = false;
    navOverlayView = null;
    islandView = null;
    weatherView = null;
    weatherViewAttached = false;
    mainWindow = null;
  });

  mainWindow.loadURL(getAppUrl());
  showIslandOverlay();
}

ipcMain.on('ritepath:open-google', (_event, url) => {
  showGoogleView(typeof url === 'string' ? url : 'https://www.google.com/');
});

ipcMain.on('ritepath:close-google', () => {
  hideGoogleView();
});

ipcMain.on('ritepath:nav-hit-area', (_event, expanded) => {
  if (!navOverlayAttached) {
    return;
  }

  navOverlayExpanded = Boolean(expanded);
  resizeNavOverlay();

  if (!navOverlayExpanded && googleViewAttached) {
    // Give input focus back to the web app once the control shrinks away.
    googleView?.webContents.focus();
  }
});

ipcMain.on('ritepath:nav-home', () => {
  goHome();
});

// Overlays ask for their own bounds; the rect is clamped to the window so an
// overlay can never end up partly off screen.
function applyOverlayBounds(sender, rect) {
  if (!mainWindow) {
    return null;
  }

  const view = [islandView, weatherView].find(
    (candidate) => candidate && candidate.webContents === sender,
  );
  if (!view) {
    return null;
  }

  const bounds = mainWindow.getContentBounds();
  const width = Math.max(1, Math.min(Math.round(rect?.width ?? 1), bounds.width));
  const height = Math.max(1, Math.min(Math.round(rect?.height ?? 1), bounds.height));
  const applied = {
    x: Math.max(0, Math.min(Math.round(rect?.x ?? 0), bounds.width - width)),
    y: Math.max(0, Math.min(Math.round(rect?.y ?? 0), bounds.height - height)),
    width,
    height,
  };

  view.setBounds(applied);
  return applied;
}

ipcMain.handle('ritepath:overlay-hit-area', (event, rect) => {
  return applyOverlayBounds(event.sender, rect);
});


// Overlays pull the current screen size on demand instead of relying on a
// broadcast arriving before they need it.
ipcMain.handle('ritepath:overlay-viewport-get', () => {
  if (!mainWindow) {
    return { width: 0, height: 0 };
  }

  const bounds = mainWindow.getContentBounds();
  return { width: bounds.width, height: bounds.height };
});

ipcMain.handle('ritepath:weather-get', async (_event, options) => {
  return refreshWeather({ force: Boolean(options?.force) });
});

ipcMain.on('ritepath:weather-open', () => {
  showWeatherOverlay();
});

ipcMain.on('ritepath:weather-close', () => {
  hideWeatherOverlay();
});

// Local-only geometry store so the weather window reopens where the user left it.
ipcMain.handle('ritepath:widget-state-get', async (_event, key) => {
  return getWidgetState(String(key ?? ''));
});

ipcMain.handle('ritepath:widget-state-set', async (_event, key, value) => {
  await setWidgetState(String(key ?? ''), value);
  return true;
});

app.whenReady().then(() => {
  startBackend();
  configureWeather({ cacheFile: path.join(app.getPath('userData'), 'weather-cache.json') });
  configureWidgetState({ stateFile: path.join(app.getPath('userData'), 'widget-state.json') });
  createWindow();

  // Orientation changes are a display event, not a window event: a fullscreen
  // kiosk window is not guaranteed to emit 'resize' when the screen rotates, so
  // without these the shell would keep whatever layout it last had.
  screen.on('display-metrics-changed', scheduleShellLayout);
  screen.on('display-added', scheduleShellLayout);
  screen.on('display-removed', scheduleShellLayout);

  // Show the last known weather immediately, then refresh in the background.
  void loadCachedWeather().then(broadcastWeather);
  void refreshWeather({ force: true });
  startWeatherRefresh();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopBackend();
  if (weatherRefreshTimer) {
    clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = null;
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
