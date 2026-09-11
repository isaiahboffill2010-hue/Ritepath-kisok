import { contextBridge, ipcRenderer, shell } from 'electron';

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
