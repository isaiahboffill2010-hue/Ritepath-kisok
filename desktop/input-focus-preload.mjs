import { ipcRenderer } from 'electron';

// Reports to the RitePath shell whether the page's focused element is editable,
// so the on-screen keyboard knows when to appear and which WebContents owns
// keyboard input.
//
// SECURITY: this file deliberately exposes nothing to the page. There is no
// contextBridge call and no global is assigned, so a website cannot reach
// ipcRenderer or any RitePath IPC channel - it can only be observed by us.
//
// PRIVACY: only *whether* the field is editable and a coarse kind are ever sent.
// The field's value is never read, so nothing typed - including passwords - is
// seen, stored or transmitted by this script.

const NON_EDITABLE_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'image',
  'range',
  'color',
  'hidden',
]);

function describe(element) {
  if (!element || element.nodeType !== 1) {
    return { editable: false };
  }

  const tag = element.tagName;

  if (tag === 'TEXTAREA') {
    return { editable: true, kind: 'textarea' };
  }

  if (tag === 'INPUT') {
    const type = String(element.type || 'text').toLowerCase();
    if (NON_EDITABLE_INPUT_TYPES.has(type) || element.readOnly || element.disabled) {
      return { editable: false };
    }

    return { editable: true, kind: type };
  }

  if (element.isContentEditable) {
    return { editable: true, kind: 'contenteditable' };
  }

  return { editable: false };
}

let lastEditable = null;

function report() {
  const state = describe(document.activeElement);

  // Only tell the shell when the answer actually changes, so ordinary taps on
  // page text and buttons cause no traffic at all.
  if (state.editable === lastEditable) {
    return;
  }

  lastEditable = state.editable;
  ipcRenderer.send('ritepath:input-focus', state);
}

document.addEventListener('focusin', report, true);

// Focus often moves between two editable fields; settling on the next tick
// avoids closing and reopening the keyboard in between.
document.addEventListener('focusout', () => setTimeout(report, 0), true);

window.addEventListener('pagehide', () => {
  lastEditable = false;
  ipcRenderer.send('ritepath:input-focus', { editable: false });
});

// Sent by the shell when the keyboard takes or gives back space, so the field
// being typed into is never left hidden behind it.
//
// --ritepath-keyboard-inset is published for RitePath's own stylesheets to use
// (for example to pad a screen while the keyboard is up). Setting a custom
// property has no effect on pages that do not reference it, so this is inert for
// third-party sites.
ipcRenderer.on('ritepath:reveal-focused', (_event, info) => {
  const inset = Number(info?.inset) || 0;
  document.documentElement.style.setProperty('--ritepath-keyboard-inset', `${inset}px`);

  if (inset <= 0) {
    return;
  }

  const element = document.activeElement;
  if (element && typeof element.scrollIntoView === 'function') {
    try {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      // Some elements refuse to scroll; the keyboard still works.
    }
  }
});
