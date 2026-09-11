import { contextBridge, ipcRenderer, shell } from 'electron';

// Gives the RitePath launcher (Settings, Files, Add Your Own App, ...) the same
// editable-focus reporting as opened web apps, so the on-screen keyboard behaves
// identically everywhere. Exposes nothing to the page.
import './input-focus-preload.mjs';

contextBridge.exposeInMainWorld('ritepath', {
  openExternal: async (url) => {
    await shell.openExternal(url);
  },
  openGoogle: async (url) => {
    ipcRenderer.send('ritepath:open-google', url);
  },
  closeGoogle: async () => {
    ipcRenderer.send('ritepath:close-google');
  },
  // Opens a USB file in a floating RitePath viewer window. Only metadata and an
  // already-validated root id + relative path are passed; the backend validates
  // them again before any bytes are served.
  openFileViewer: async (file) => {
    ipcRenderer.send('ritepath:open-file-viewer', file);
  },
  onGoHome: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ritepath:go-home', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:go-home', listener);
    };
  },
  onOpenDrawer: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ritepath:open-drawer', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:open-drawer', listener);
    };
  },
});
