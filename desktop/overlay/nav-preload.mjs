import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ritepathNav', {
  // Asks the main process to grow/shrink the overlay's hit area so an in-progress
  // swipe keeps being delivered to this view instead of the web page underneath.
  setHitArea: (expanded) => {
    ipcRenderer.send('ritepath:nav-hit-area', Boolean(expanded));
  },
  goHome: () => {
    ipcRenderer.send('ritepath:nav-home');
  },
  onReset: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ritepath:nav-reset', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:nav-reset', listener);
    };
  },
});
