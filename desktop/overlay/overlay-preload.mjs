import { contextBridge, ipcRenderer } from 'electron';

// Shared bridge for the RitePath shell overlays (Dynamic Island + the floating
// window surface).
//
// Only sanitized data crosses this boundary: the WeatherAPI key stays in the
// main process, and file viewers receive a URL plus metadata rather than any
// filesystem handle.
contextBridge.exposeInMainWorld('ritepathOverlay', {
  // Asks the main process to resize this overlay view. Resolves with the rect
  // that was actually applied, so the page can correct itself if the request was
  // clamped to the screen. Used by the Dynamic Island; the window surface is
  // sized by the main process instead.
  setHitArea: (rect) => ipcRenderer.invoke('ritepath:overlay-hit-area', rect),
  getWeather: (options) => ipcRenderer.invoke('ritepath:weather-get', options ?? {}),
  getViewport: () => ipcRenderer.invoke('ritepath:overlay-viewport-get'),
  openWeather: () => {
    ipcRenderer.send('ritepath:weather-open');
  },
  // Told by the surface once its last window closes, so the overlay can be
  // detached and stop intercepting input.
  surfaceEmpty: () => {
    ipcRenderer.send('ritepath:surface-empty');
  },
  // Local-only widget geometry (position/size). Never leaves the device.
  getWidgetState: (key) => ipcRenderer.invoke('ritepath:widget-state-get', key),
  setWidgetState: (key, value) => ipcRenderer.invoke('ritepath:widget-state-set', key, value),
  onOpenWindow: (callback) => {
    const listener = (_event, descriptor) => callback(descriptor);
    ipcRenderer.on('ritepath:surface-open-window', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:surface-open-window', listener);
    };
  },
  onWeather: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ritepath:weather-update', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:weather-update', listener);
    };
  },
  onViewport: (callback) => {
    const listener = (_event, viewport) => callback(viewport);
    ipcRenderer.on('ritepath:overlay-viewport', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:overlay-viewport', listener);
    };
  },
  onReset: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ritepath:overlay-reset', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:overlay-reset', listener);
    };
  },
});
