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
});
