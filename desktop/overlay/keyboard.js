// RitePath on-screen keyboard.
//
// The keyboard never holds the text being typed. Each press is delivered
// straight to whichever WebContents the shell knows owns the focused editable
// element, so the real field (Google's search box, a login form, a RitePath
// input) keeps focus and receives genuine key events. Nothing is buffered,
// logged or persisted here - that is what keeps password fields safe.

const bridge = window.ritepathKeyboard;
const rowsEl = document.getElementById('keyboard-rows');

const CAPS_DOUBLE_TAP_MS = 400;
const REPEAT_GUARD_MS = 90;

// A key is either a character (with an optional shifted form) or a named key.
const key = (lower, upper) => ({ lower, upper: upper ?? lower.toUpperCase() });
const action = (label, name, options = {}) => ({ label, name, action: true, ...options });

const HIDE_ICON =
  '<svg viewBox="0 0 24 24" role="presentation"><path d="M4 5h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 3v2h2V8H6zm4 0v2h2V8h-2zm4 0v2h2V8h-2zm4 0v2h2V8h-2zM6 11v2h12v-2H6zm6 11-4-4h8l-4 4z"/></svg>';

const LETTER_ROWS = [
  [
    action('Esc', 'Escape', { wide: true }),
    key('q'), key('w'), key('e'), key('r'), key('t'),
    key('y'), key('u'), key('i'), key('o'), key('p'),
    action('⌫', 'Backspace', { wide: true }),
  ],
  [
    action('Tab', 'Tab', { wide: true }),
    key('a'), key('s'), key('d'), key('f'), key('g'),
    key('h'), key('j'), key('k'), key('l'), key(';', ':'),
    action('Enter', 'Enter', { wide: true, accent: true }),
  ],
  [
    action('⇧', 'Shift', { wide: true, toggle: 'shift' }),
    key('z'), key('x'), key('c'), key('v'), key('b'),
    key('n'), key('m'), key(',', '<'), key('.', '>'), key('/', '?'),
    action('⇧', 'Shift', { wide: true, toggle: 'shift' }),
  ],
  [
    action('&123', 'Symbols', { wide: true, layer: 'symbols' }),
    action('Ctrl', 'Control', { toggle: 'control' }),
    action('Alt', 'Alt', { toggle: 'alt' }),
    { lower: ' ', upper: ' ', label: 'space', space: true },
    action(HIDE_ICON, 'HideKeyboard', { html: true }),
    action('←', 'Left'),
    action('→', 'Right'),
  ],
];

const SYMBOL_ROWS = [
  [
    key('1', '¹'), key('2'), key('3'), key('4'), key('5'),
    key('6'), key('7'), key('8'), key('9'), key('0'),
    action('⌫', 'Backspace', { wide: true }),
  ],
  [
    key('@'), key('#'), key('$'), key('%'), key('&'), key('*'),
    key('-'), key('_'), key('+'), key('='),
    action('Enter', 'Enter', { wide: true, accent: true }),
  ],
  [
    key('/'), key('\\'), key(':'), key(';'), key("'"), key('"'),
    key('('), key(')'), key('['), key(']'), key('!'), key('?'),
  ],
  [
    action('ABC', 'Letters', { wide: true, layer: 'letters' }),
    key('~'), key('`'), key('|'), key('<'), key('>'),
    { lower: ' ', upper: ' ', label: 'space', space: true },
    key(','), key('.'),
    action(HIDE_ICON, 'HideKeyboard', { html: true }),
    action('←', 'Left'),
    action('→', 'Right'),
  ],
];

const state = {
  layer: 'letters',
  shift: false,
  capsLock: false,
  control: false,
  alt: false,
  lastShiftAt: 0,
  lastPressAt: 0,
};

function glyphFor(entry) {
  if (entry.action) {
    return entry.label;
  }

  if (entry.space) {
    return 'space';
  }

  return state.shift || state.capsLock ? entry.upper : entry.lower;
}

function render() {
  const rows = state.layer === 'letters' ? LETTER_ROWS : SYMBOL_ROWS;
  rowsEl.innerHTML = '';

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';

    for (const entry of row) {
      const button = document.createElement('button');
      button.type = 'button';

      const classes = ['key'];
      if (entry.action) {
        classes.push('key--action');
      }
      if (entry.wide) {
        classes.push('key--wide');
      }
      if (entry.space) {
        classes.push('key--space');
      }
      if (entry.accent) {
        classes.push('key--accent');
      }

      if (entry.toggle === 'shift') {
        if (state.capsLock) {
          classes.push('is-locked');
        } else if (state.shift) {
          classes.push('is-latched');
        }
      }

      if (entry.toggle === 'control' && state.control) {
        classes.push('is-latched');
      }

      if (entry.toggle === 'alt' && state.alt) {
        classes.push('is-latched');
      }

      button.className = classes.join(' ');

      const glyph = document.createElement('span');
      glyph.className = 'key__glyph';
      if (entry.html) {
        glyph.innerHTML = entry.label;
      } else {
        glyph.textContent = glyphFor(entry);
      }
      button.append(glyph);

      // Show the shifted character as a hint on punctuation keys.
      if (!entry.action && !entry.space && entry.upper !== entry.lower && state.layer === 'letters') {
        const isLetter = /^[a-z]$/.test(entry.lower);
        if (!isLetter) {
          const hint = document.createElement('span');
          hint.className = 'key__hint';
          hint.textContent = state.shift || state.capsLock ? entry.lower : entry.upper;
          button.append(hint);
        }
      }

      bindKey(button, entry);
      rowEl.append(button);
    }

    rowsEl.append(rowEl);
  }
}

function modifiers() {
  return {
    shift: state.shift || state.capsLock,
    control: state.control,
    alt: state.alt,
  };
}

function clearOneShotModifiers() {
  let changed = false;

  if (state.shift && !state.capsLock) {
    state.shift = false;
    changed = true;
  }

  if (state.control) {
    state.control = false;
    changed = true;
  }

  if (state.alt) {
    state.alt = false;
    changed = true;
  }

  if (changed) {
    render();
  }
}

function handleShift() {
  const now = Date.now();

  // Double-tapping Shift locks it - the usual touchscreen Caps Lock gesture.
  if (now - state.lastShiftAt < CAPS_DOUBLE_TAP_MS) {
    state.capsLock = !state.capsLock;
    state.shift = false;
  } else if (state.capsLock) {
    state.capsLock = false;
    state.shift = false;
  } else {
    state.shift = !state.shift;
  }

  state.lastShiftAt = now;
  render();
}

function press(entry) {
  if (entry.action) {
    switch (entry.name) {
      case 'Shift':
        handleShift();
        return;
      case 'Control':
        state.control = !state.control;
        render();
        return;
      case 'Alt':
        state.alt = !state.alt;
        render();
        return;
      case 'Symbols':
      case 'Letters':
        state.layer = entry.layer;
        render();
        return;
      case 'HideKeyboard':
        bridge?.hide();
        return;
      default:
        bridge?.press({ key: entry.name, ...modifiers() });
        clearOneShotModifiers();
        return;
    }
  }

  const text = entry.space ? ' ' : glyphFor(entry);
  bridge?.press({ text, ...modifiers() });
  clearOneShotModifiers();
}

function bindKey(button, entry) {
  // pointerdown gives immediate feedback and works for both touch and mouse.
  // preventDefault stops the press from moving focus or starting a scroll.
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const now = Date.now();
    if (now - state.lastPressAt < REPEAT_GUARD_MS) {
      return;
    }
    state.lastPressAt = now;

    button.classList.add('is-pressed');
    press(entry);
  });

  const release = () => button.classList.remove('is-pressed');
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

const keyboardEl = document.getElementById('keyboard');

bridge?.onLayout((layout) => {
  render();

  if (layout?.visible === false) {
    keyboardEl.classList.remove('is-open');
    return;
  }

  // Next frame, so the slide-up animates from its off-screen starting position.
  requestAnimationFrame(() => keyboardEl.classList.add('is-open'));
});

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());

render();
