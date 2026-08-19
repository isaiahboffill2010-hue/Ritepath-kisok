import { contextBridge, shell } from 'electron';

contextBridge.exposeInMainWorld('ritepath', {
  openExternal: async (url) => {
    await shell.openExternal(url);
  },
});
