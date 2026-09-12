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
const surfaceHtml = path.join(__dirname, 'overlay', 'surface.html');
const keyboardHtml = path.join(__dirname, 'overlay', 'keyboard.html');
const keyboardPreloadPath = path.join(__dirname, 'overlay', 'keyboard-preload.mjs');
const inputFocusPreloadPath = path.join(__dirname, 'input-focus-preload.mjs');

// The backend serves USB file content. File viewers are given a URL on this
// origin rather than any filesystem path or handle.
const BACKEND_ORIGIN = 'http://127.0.0.1:8000';

// Reads WEATHER_API_KEY (and the optional WEATHER_LOCATION) into the main
// process only. The key never leaves this process.
loadEnvFiles(projectRoot);

// Height of the always-present gesture strip, and of the temporarily enlarged
// hit area that keeps an in-progress swipe attached to the overlay.
// Named keys the on-screen keyboard may send, mapped to the codes Electron's
// sendInputEvent understands. Anything not in this table is ignored.
const NAMED_KEYS = {
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Delete: 'Delete',
  Left: 'Left',
  Right: 'Right',
  Up: 'Up',
  Down: 'Down',
  Home: 'Home',
  End: 'End',
};

const NAV_COLLAPSED_HEIGHT = 44;
const NAV_EXPANDED_HEIGHT = 220;

// Follow-up passes after a display/orientation change, in ms.
const SHELL_LAYOUT_SETTLE_DELAYS = [0, 60, 250, 750];
let shellLayoutTimers = [];

let backendProcess = null;
let mainWindow = null;
let googleView = null;
let googleViewAttached = false;
let googleGesture = null;
let navOverlayView = null;
let navOverlayAttached = false;
let navOverlayExpanded = false;
let islandView = null;
let surfaceView = null;
let surfaceViewAttached = false;
let surfaceViewReady = false;
let pendingSurfaceWindows = [];
let weatherRefreshTimer = null;
let keyboardView = null;
let keyboardAttached = false;
// The WebContents that owns the focused editable element. Remembered here in the
// main process so tapping the keyboard - which necessarily moves view focus -
// can never lose track of where the typing should go.
let keyboardTarget = null;
// Height the keyboard is currently taking from the bottom of the screen. Every
// other view derives its bounds from this, so nothing is ever hardcoded and the
// normal fullscreen geometry returns exactly when the keyboard closes.
let keyboardInset = 0;
let keyboardHideTimer = null;
const KEYBOARD_ANIMATION_MS = 230;

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
      // Reports only *that* an editable element gained focus, so the on-screen
      // keyboard can open. It exposes nothing to the page - see the file header.
      preload: inputFocusPreloadPath,
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

// Shared factory for the transparent shell overlays (Dynamic Island, floating
// window surface).
//
// contextIsolation stays on and nodeIntegration stays off. `plugins` enables
// Chromium's built-in PDF viewer, which renders untrusted PDFs out-of-process
// in its own sandbox; preloads do not run in subframes, so a PDF or any other
// embedded content cannot reach the context bridge.
function createOverlayView(htmlFile, { plugins = false } = {}) {
  const view = new BrowserView({
    webPreferences: {
      preload: overlayPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      sandbox: false,
      transparent: true,
      plugins,
    },
  });

  view.setBackgroundColor('#00000000');
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Untrusted content must never be able to navigate the overlay itself away
  // from its local page.
  view.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  void view.webContents.loadFile(htmlFile);

  return view;
}

function sendViewport(view) {
  if (!mainWindow || !view || view.webContents.isDestroyed()) {
    return;
  }

  const bounds = getShellBounds();
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

function ensureSurfaceOverlay() {
  if (surfaceView) {
    return surfaceView;
  }

  surfaceView = createOverlayView(surfaceHtml, { plugins: true });
  surfaceView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  surfaceViewReady = false;

  // On the first open the page is still loading, and messages sent to a
  // renderer that has not registered its listeners yet are dropped. Anything
  // requested before then is replayed here.
  surfaceView.webContents.once('did-finish-load', () => {
    surfaceViewReady = true;
    sendViewport(surfaceView);

    const queued = pendingSurfaceWindows;
    pendingSurfaceWindows = [];
    for (const descriptor of queued) {
      surfaceView.webContents.send('ritepath:surface-open-window', descriptor);
    }
  });

  return surfaceView;
}

function resizeSurfaceOverlay() {
  if (!mainWindow || !surfaceView || !surfaceViewAttached) {
    return;
  }

  // The surface always covers the screen while it is attached, and is never
  // resized while a window is visible - that is what keeps dragging stable.
  const bounds = getShellBounds();
  surfaceView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
}

// Opens one floating window (weather or a file viewer) on the shared surface.
function openSurfaceWindow(descriptor) {
  if (!mainWindow) {
    return;
  }

  const view = ensureSurfaceOverlay();
  if (!surfaceViewAttached) {
    mainWindow.addBrowserView(view);
    surfaceViewAttached = true;
  }

  resizeSurfaceOverlay();
  sendViewport(view);
  raiseOverlays();

  if (surfaceViewReady) {
    view.webContents.send('ritepath:surface-open-window', descriptor);
  } else {
    pendingSurfaceWindows.push(descriptor);
  }
}

// Called once the surface reports that its last window has closed, so it stops
// intercepting input for the rest of the screen.
function hideSurfaceOverlay() {
  if (!mainWindow || !surfaceView || !surfaceViewAttached) {
    return;
  }

  mainWindow.removeBrowserView(surfaceView);
  surfaceViewAttached = false;
}

/* ---------- on-screen keyboard ---------- */

// Derived from the live window, never from a fixed resolution: a short landscape
// screen gives the keyboard a larger share than a tall portrait one, and the
// result is clamped so keys stay finger-sized either way.
function keyboardHeightFor(bounds) {
  const ratio = bounds.width >= bounds.height ? 0.44 : 0.34;
  return Math.round(Math.min(Math.max(bounds.height * ratio, 190), 560));
}

function ensureKeyboardView() {
  if (keyboardView) {
    return keyboardView;
  }

  keyboardView = new BrowserView({
    webPreferences: {
      preload: keyboardPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      transparent: true,
    },
  });

  keyboardView.setBackgroundColor('#00000000');
  keyboardView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void keyboardView.webContents.loadFile(keyboardHtml);

  return keyboardView;
}

function showKeyboard() {
  if (!mainWindow) {
    return;
  }

  const view = ensureKeyboardView();

  // A pending slide-down was interrupted by a new focus: keep the view attached.
  if (keyboardHideTimer) {
    clearTimeout(keyboardHideTimer);
    keyboardHideTimer = null;
  }

  if (!keyboardAttached) {
    if (!mainWindow.getBrowserViews().includes(view)) {
      mainWindow.addBrowserView(view);
    }
    keyboardAttached = true;
  }

  // Sizes the keyboard and re-derives every other view against the new inset.
  layoutShell();
  raiseOverlays();

  // Once the space is taken, ask the page to bring the focused field into view.
  if (keyboardTarget && !keyboardTarget.isDestroyed()) {
    keyboardTarget.send('ritepath:reveal-focused', { inset: keyboardInset });
  }
}

function hideKeyboard() {
  if (!mainWindow || !keyboardView || !keyboardAttached) {
    return;
  }

  keyboardAttached = false;
  keyboardInset = 0;

  // Let the keyboard slide back down before the view goes away.
  const view = keyboardView;
  view.webContents.send('ritepath:keyboard-layout', { visible: false });

  if (keyboardHideTimer) {
    clearTimeout(keyboardHideTimer);
  }

  keyboardHideTimer = setTimeout(() => {
    keyboardHideTimer = null;
    if (mainWindow && !mainWindow.isDestroyed() && keyboardView === view && !keyboardAttached) {
      mainWindow.removeBrowserView(view);
    }
  }, KEYBOARD_ANIMATION_MS);

  // Restores the exact pre-keyboard bounds, portrait or landscape.
  layoutShell();

  if (keyboardTarget && !keyboardTarget.isDestroyed()) {
    keyboardTarget.send('ritepath:reveal-focused', { inset: 0 });
  }
}

// Delivers one key to whichever WebContents owns the focused editable element.
//
// The target is focused first because tapping the keyboard overlay moves view
// focus to the keyboard; restoring it means the real field - Google's search box
// included - receives genuine key events rather than text being pasted in.
//
// Nothing here is logged or stored: the payload is used and discarded.
function deliverKey(payload) {
  const target = keyboardTarget;
  if (!target || target.isDestroyed()) {
    return;
  }

  const modifiers = [];
  if (payload?.shift) {
    modifiers.push('shift');
  }
  if (payload?.control) {
    modifiers.push('control');
  }
  if (payload?.alt) {
    modifiers.push('alt');
  }

  target.focus();

  const text = typeof payload?.text === 'string' ? payload.text : null;
  if (text && [...text].length === 1) {
    target.sendInputEvent({ type: 'keyDown', keyCode: text, modifiers });
    target.sendInputEvent({ type: 'char', keyCode: text, modifiers });
    target.sendInputEvent({ type: 'keyUp', keyCode: text, modifiers });
    return;
  }

  const named = NAMED_KEYS[payload?.key];
  if (!named) {
    return;
  }

  target.sendInputEvent({ type: 'keyDown', keyCode: named, modifiers });
  target.sendInputEvent({ type: 'keyUp', keyCode: named, modifiers });
}

// Keeps the shell overlays above opened web apps. The bottom Home navigation is
// raised last so it always wins - including over the keyboard.
function raiseOverlays() {
  if (!mainWindow) {
    return;
  }

  if (surfaceView && surfaceViewAttached) {
    mainWindow.setTopBrowserView(surfaceView);
  }

  // The island sits above the window surface so the pill stays tappable while
  // floating windows are open.
  if (islandView) {
    mainWindow.setTopBrowserView(islandView);
  }

  if (keyboardView && keyboardAttached) {
    mainWindow.setTopBrowserView(keyboardView);
  }

  if (navOverlayView && navOverlayAttached) {
    mainWindow.setTopBrowserView(navOverlayView);
  }
}

function broadcastWeather(result) {
  for (const view of [islandView, surfaceView]) {
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

  const bounds = getShellBounds();
  const height = Math.min(
    navOverlayExpanded ? NAV_EXPANDED_HEIGHT : NAV_COLLAPSED_HEIGHT,
    bounds.height,
  );

  // While the keyboard is open the Home gesture strip rides directly above it,
  // so swiping up for Home keeps working instead of being covered.
  const bottom = Math.max(height, bounds.height - keyboardInset);

  navOverlayView.setBounds({
    x: 0,
    y: Math.max(0, bottom - height),
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

// Single source of truth for the shell's usable area.
//
// Normally this is simply the window's content bounds. In kiosk/fullscreen the
// window *is* the display by definition, so the display is trusted instead: on a
// Raspberry Pi whose screen is already rotated when Electron starts, the window
// can report stale landscape content bounds, and anything laid out from them
// ends up short. Reading the display removes that dependency entirely.
//
// Nothing is hardcoded and no aspect ratio is involved - both branches report the
// live dimensions of whatever screen the window is currently on, so laptop
// landscape, portrait panels and future resolutions all work from the same code.
function getShellBounds() {
  const content = mainWindow.getContentBounds();

  if (mainWindow.isKiosk() || mainWindow.isFullScreen()) {
    const display = screen.getDisplayMatching(mainWindow.getBounds()).bounds;
    return { width: display.width, height: display.height };
  }

  return { width: content.width, height: content.height };
}

// The content area an opened web app is expected to fill. Overlays (Dynamic
// Island, weather, bottom Home gesture) float above the app rather than taking
// space from it, so the app view owns the whole rect. Everything is derived from
// the live window bounds - no resolution is ever assumed.
function getAppViewBounds() {
  const bounds = getShellBounds();

  return {
    x: 0,
    y: 0,
    width: Math.max(1, bounds.width),
    // The on-screen keyboard takes space from the bottom while it is open, so
    // the page reflows and the focused field stays visible. keyboardInset is 0
    // whenever the keyboard is closed, which restores the exact fullscreen rect.
    height: Math.max(1, bounds.height - keyboardInset),
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

  // The keyboard is laid out first because every other view's bounds are derived
  // from the space it leaves behind.
  if (keyboardAttached && keyboardView) {
    const bounds = getShellBounds();
    const height = Math.min(keyboardHeightFor(bounds), bounds.height);
    keyboardInset = height;
    keyboardView.setBounds({
      x: 0,
      y: Math.max(0, bounds.height - height),
      width: bounds.width,
      height,
    });
    keyboardView.webContents.send('ritepath:keyboard-layout', {
      width: bounds.width,
      height,
      visible: true,
    });
  }

  resizeGoogleView();
  resizeNavOverlay();
  resizeSurfaceOverlay();
  sendViewport(islandView);
  sendViewport(surfaceView);

  if (process.env.RITEPATH_DEBUG_LAYOUT === '1') {
    // content and shell differing is the signature of the bug this guards
    // against: the window reporting one size while the display is another.
    const content = mainWindow.getContentBounds();
    const shell = getShellBounds();
    console.log(
      '[ritepath:layout] content=%dx%d shell=%dx%d app=%s',
      content.width,
      content.height,
      shell.width,
      shell.height,
      googleViewAttached ? JSON.stringify(googleView?.getBounds()) : 'detached',
    );
  }
}

// During an orientation change Windows reports the window's new size over
// several messages, so the first read can still be the old landscape rect.
// Re-running the layout on the following ticks settles it. Re-laying out is pure
// geometry - the opened page is never reloaded and keeps its session.
function scheduleShellLayout() {
  // Coalesce: a burst of resize/move/display events must not stack several
  // settle sequences on top of each other.
  for (const timer of shellLayoutTimers) {
    clearTimeout(timer);
  }

  refitWindowToDisplay();
  layoutShell();

  shellLayoutTimers = SHELL_LAYOUT_SETTLE_DELAYS.map((delay) =>
    setTimeout(() => {
      refitWindowToDisplay();
      layoutShell();
    }, delay),
  );
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
  // Not a single resizeGoogleView(): a BrowserView does not follow the window
  // the way the window's own webContents does, so reading the bounds once at
  // open time is exactly how a stale rect gets frozen in. Settling over the
  // following ticks costs nothing and never reloads the page.
  scheduleShellLayout();
  void view.webContents.loadURL(targetUrl);
  showNavOverlay();
  raiseOverlays();
}

function hideGoogleView() {
  hideNavOverlay();

  // A web app's field cannot still be focused once the app is gone.
  if (googleView && keyboardTarget === googleView.webContents) {
    keyboardTarget = null;
    hideKeyboard();
  }

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
  // scheduleShellLayout rather than layoutShell: a resize can also be the tail
  // end of a rotation, so the window may still need refitting to the display.
  // refitWindowToDisplay is a no-op once the geometry already matches, so this
  // settles rather than looping.
  const handleWindowResize = () => {
    scheduleShellLayout();
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
    surfaceView = null;
    surfaceViewAttached = false;
    surfaceViewReady = false;
    pendingSurfaceWindows = [];
    keyboardView = null;
    keyboardAttached = false;
    keyboardTarget = null;
    keyboardInset = 0;
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

  const view = [islandView, surfaceView].find(
    (candidate) => candidate && candidate.webContents === sender,
  );
  if (!view) {
    return null;
  }

  const bounds = getShellBounds();
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

  const bounds = getShellBounds();
  return { width: bounds.width, height: bounds.height };
});

ipcMain.handle('ritepath:weather-get', async (_event, options) => {
  return refreshWeather({ force: Boolean(options?.force) });
});

ipcMain.on('ritepath:weather-open', () => {
  openSurfaceWindow({ id: 'weather', type: 'weather', title: 'Weather' });
});

// The surface owns its own windows; it tells us when the last one has gone so
// the overlay can be detached and stop intercepting input.
ipcMain.on('ritepath:surface-empty', () => {
  hideSurfaceOverlay();
});

// Opens a USB file in a floating viewer. The renderer only ever passes an
// already-validated root id and relative path; the backend re-validates both and
// refuses anything that is not previewable, so no filesystem path is trusted
// from here.
ipcMain.on('ritepath:open-file-viewer', (_event, file) => {
  const rootId = String(file?.rootId ?? '');
  const relativePath = String(file?.path ?? '');
  const previewKind = String(file?.previewKind ?? 'none');
  const name = String(file?.name ?? 'File');

  if (!rootId || !relativePath) {
    return;
  }

  const query = new URLSearchParams({ root: rootId, path: relativePath });
  const contentUrl = `${BACKEND_ORIGIN}/api/files/content?${query.toString()}`;

  openSurfaceWindow({
    id: `file:${rootId}:${relativePath}`,
    type: 'file',
    title: name,
    subtitle: String(file?.subtitle ?? ''),
    payload: {
      contentUrl,
      previewKind,
      name,
      mimeType: file?.mimeType ? String(file.mimeType) : null,
    },
  });
});

// A page reports that its focused element became (or stopped being) editable.
// Only RitePath's own preload can send this - websites have no access to it.
ipcMain.on('ritepath:input-focus', (event, info) => {
  if (info?.editable) {
    keyboardTarget = event.sender;
    showKeyboard();
    return;
  }

  // Ignore blur reports from a page that is not the current target, so moving
  // between fields in one page cannot be closed by a stale message.
  if (keyboardTarget === event.sender) {
    hideKeyboard();
  }
});

// Key presses are only ever accepted from the keyboard overlay itself.
ipcMain.on('ritepath:keyboard-key', (event, payload) => {
  if (!keyboardView || event.sender !== keyboardView.webContents) {
    return;
  }

  deliverKey(payload);
});

ipcMain.on('ritepath:keyboard-hide', (event) => {
  if (!keyboardView || event.sender !== keyboardView.webContents) {
    return;
  }

  hideKeyboard();
});

// Local-only geometry store so floating windows reopen where the user left them.
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

  // A Raspberry Pi whose screen is already rotated when Electron starts never
  // emits a display event, so without this the shell would keep whatever
  // geometry the window happened to report while it was still being mapped.
  scheduleShellLayout();

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
