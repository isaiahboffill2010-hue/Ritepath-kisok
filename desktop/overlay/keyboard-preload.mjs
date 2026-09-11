import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the RitePath on-screen keyboard overlay.
//
// This preload is only ever attached to the keyboard's own local page, and the
// main process additionally checks that key events come from that exact
// WebContents - so a website cannot drive the system keyboard even if it somehow
// obtained the channel name.
contextBridge.exposeInMainWorld('ritepathKeyboard', {
  // A single key press. The payload carries a character or a named key plus
  // modifier flags; nothing is buffered, logged or persisted anywhere.
  press: (payload) => {
    ipcRenderer.send('ritepath:keyboard-key', payload);
  },
  hide: () => {
    ipcRenderer.send('ritepath:keyboard-hide');
  },
  onLayout: (callback) => {
    const listener = (_event, layout) => callback(layout);
    ipcRenderer.on('ritepath:keyboard-layout', listener);
    return () => {
      ipcRenderer.removeListener('ritepath:keyboard-layout', listener);
    };
  },
});
