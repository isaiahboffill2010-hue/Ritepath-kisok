import { contextBridge, ipcRenderer } from 'electron';

// Shared bridge for the RitePath shell overlays (Dynamic Island + weather window).
//
// Only sanitized weather data crosses this boundary - the WeatherAPI key stays
// in the main process and is never exposed to any renderer.
contextBridge.exposeInMainWorld('ritepathOverlay', {
  // Asks the main process to resize this overlay view. Resolves with the rect
  // that was actually applied, so the page can correct itself if the request was
  // clamped to the screen.
  setHitArea: (rect) => ipcRenderer.invoke('ritepath:overlay-hit-area', rect),
  getWeather: (options) => ipcRenderer.invoke('ritepath:weather-get', options ?? {}),
  getViewport: () => ipcRenderer.invoke('ritepath:overlay-viewport-get'),
  openWeather: () => {
    ipcRenderer.send('ritepath:weather-open');
  },
  closeWeather: () => {
    ipcRenderer.send('ritepath:weather-close');
  },
  // Local-only widget geometry (position/size). Never leaves the device.
  getWidgetState: (key) => ipcRenderer.invoke('ritepath:widget-state-get', key),
  setWidgetState: (key, value) => ipcRenderer.invoke('ritepath:widget-state-set', key, value),
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
