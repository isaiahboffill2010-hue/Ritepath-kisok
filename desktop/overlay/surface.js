// RitePath floating window surface.
//
// One transparent overlay BrowserView hosts every floating window (the weather
// widget and any file viewers). That matters for three reasons:
//
//   * Input: two stacked full-screen overlay views would mean the top one
//     swallows everything, leaving the lower window visible but dead.
//   * Stability: the view's bounds are set by the main process when the surface
//     is attached and never change while windows are visible. A window's
//     position is therefore a pure compositor transform inside one renderer,
//     which is what keeps dragging frame-perfect (see the weather window notes).
//   * Cost: one transparent layer on the Raspberry Pi instead of one per window.
//
// Window z-order is plain CSS, so multiple windows work with no extra machinery.

const MIN_VISIBLE_X = 140; // horizontal sliver that must stay on screen
const HEADER_HEIGHT = 64;
const BOTTOM_RESERVED = 56; // keeps clear of the bottom Home gesture strip
const ISLAND_CLEARANCE = 62; // leaves the Dynamic Island visible above
const OPEN_ANIMATION_MS = 200;
const CASCADE_STEP = 28;
const MAX_FILE_WINDOWS = 5;
const MAX_TEXT_CHARACTERS = 400000;

const WINDOW_TYPES = {
  weather: {
    stateKey: 'weatherWindow',
    defaultSize: { width: 380, height: 560 },
    minSize: { width: 286, height: 300 },
    // No fixed maximum: the weather window may be resized all the way up to the
    // usable display. The only ceiling is the live viewport (see sizeLimits),
    // which comes from the current window bounds, so it follows the display and
    // orientation with nothing hardcoded.
    maxSize: null,
  },
  file: {
    stateKey: 'fileViewer',
    defaultSize: { width: 560, height: 640 },
    minSize: { width: 320, height: 320 },
    maxSize: { width: 1100, height: 1400 },
  },
};

const bridge = window.ritepathOverlay;
const surfaceEl = document.getElementById('surface');

const windows = new Map();
let viewport = { width: 0, height: 0 };
let topZ = 10;
let cascade = 0;
let latestWeather = null;
let weatherClockTimer = null;

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

/* ---------- geometry (shared by every window) ---------- */

function sizeLimits(type) {
  const config = WINDOW_TYPES[type];

  // The ceiling is always the usable display area reported by the shell, so a
  // window can grow to fill the screen in either orientation. Types that opt
  // into a fixed maxSize are additionally capped by it.
  const usableWidth = Math.max(config.minSize.width, viewport.width);
  const usableHeight = Math.max(config.minSize.height, viewport.height);

  const cappedWidth = config.maxSize
    ? Math.min(config.maxSize.width, usableWidth - 16)
    : usableWidth;
  const cappedHeight = config.maxSize
    ? Math.min(config.maxSize.height, usableHeight - BOTTOM_RESERVED - 16)
    : usableHeight;

  return {
    minWidth: Math.min(config.minSize.width, Math.max(220, usableWidth)),
    minHeight: Math.min(config.minSize.height, Math.max(220, usableHeight)),
    maxWidth: Math.max(config.minSize.width, cappedWidth),
    maxHeight: Math.max(config.minSize.height, cappedHeight),
  };
}

// Once a resize pushes a window past an edge, slide it back on screen - but only
// when it actually fits. This is what lets a drag of the bottom-right handle
// reach the full display instead of stopping short, while keeping the header and
// close button reachable.
function fitIntoViewport(size, pos) {
  return {
    x: size.width <= viewport.width ? Math.round(clamp(pos.x, 0, viewport.width - size.width)) : pos.x,
    y: size.height <= viewport.height ? Math.round(clamp(pos.y, 0, viewport.height - size.height)) : pos.y,
  };
}

function clampSize(type, next) {
  const limits = sizeLimits(type);
  return {
    width: Math.round(clamp(next.width, limits.minWidth, limits.maxWidth)),
    height: Math.round(clamp(next.height, limits.minHeight, limits.maxHeight)),
  };
}

// Keeps a usable part of every window on screen, wherever it is dragged, and is
// re-applied whenever the viewport changes (display/resolution change).
function clampPosition(size, pos) {
  return {
    x: Math.round(clamp(pos.x, MIN_VISIBLE_X - size.width, viewport.width - MIN_VISIBLE_X)),
    y: Math.round(clamp(pos.y, 0, Math.max(0, viewport.height - BOTTOM_RESERVED - HEADER_HEIGHT))),
  };
}

function centredPosition(size) {
  return clampPosition(size, {
    x: Math.round(viewport.width / 2 - size.width / 2),
    y: Math.round(Math.max(ISLAND_CLEARANCE, (viewport.height - BOTTOM_RESERVED - size.height) / 2)),
  });
}

function paint(win) {
  const width = `${win.size.width}px`;
  const height = `${win.size.height}px`;
  const transform = `translate3d(${win.position.x}px, ${win.position.y}px, 0)`;

  if (win.el.style.width !== width) {
    win.el.style.width = width;
  }

  if (win.el.style.height !== height) {
    win.el.style.height = height;
  }

  if (win.el.style.transform !== transform) {
    win.el.style.transform = transform;
  }
}

function focusWindow(win) {
  topZ += 1;
  win.zIndex = topZ;
  win.el.style.zIndex = String(topZ);
  win.focusedAt = Date.now();
}

function persistGeometry(win) {
  void bridge?.setWidgetState(WINDOW_TYPES[win.type].stateKey, {
    x: win.position.x,
    y: win.position.y,
    width: win.size.width,
    height: win.size.height,
  });
}

/* ---------- window chrome ---------- */

function buildWindowElement(win) {
  const el = document.createElement('section');
  el.className = 'weather-window';
  el.setAttribute('aria-label', win.title);

  const surface = document.createElement('div');
  surface.className = 'weather-surface';

  const header = document.createElement('header');
  header.className = 'weather-header';

  const grip = document.createElement('div');
  grip.className = 'weather-grip';
  grip.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'weather-header-text';

  const title = document.createElement('p');
  title.className = 'weather-place';
  title.textContent = win.title;

  const subtitle = document.createElement('p');
  subtitle.className = 'weather-updated';
  subtitle.textContent = win.subtitle ?? ' ';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'weather-close';
  close.setAttribute('aria-label', `Close ${win.title}`);
  close.textContent = '×';

  const body = document.createElement('div');
  body.className = 'weather-body';

  const resizeGrip = document.createElement('div');
  resizeGrip.className = 'resize-grip';
  resizeGrip.setAttribute('aria-hidden', 'true');
  resizeGrip.innerHTML = '<span></span><span></span><span></span>';

  text.append(title, subtitle);
  header.append(grip, text, close);
  surface.append(header, body, resizeGrip);
  el.append(surface);

  for (const direction of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${direction}`;
    handle.dataset.resize = direction;
    el.append(handle);
  }

  win.el = el;
  win.headerEl = header;
  win.titleEl = title;
  win.subtitleEl = subtitle;
  win.bodyEl = body;
  win.closeButton = close;

  return el;
}

/* ---------- drag + resize ---------- */
//
// Identical to the weather window's proven approach: the overlay view is never
// touched, pointer events are coalesced to one update per animation frame, and
// all maths uses screenX/screenY so it is independent of where the view sits.

function attachGestures(win) {
  let gesture = null;
  let framePending = false;
  let pointerSample = null;

  function runFrame() {
    framePending = false;

    if (!gesture || !pointerSample) {
      return;
    }

    const deltaX = pointerSample.x - gesture.startX;
    const deltaY = pointerSample.y - gesture.startY;

    if (gesture.mode === 'drag') {
      win.position = clampPosition(win.size, {
        x: gesture.origin.x + deltaX,
        y: gesture.origin.y + deltaY,
      });
    } else {
      const { direction } = gesture;

      win.size = clampSize(win.type, {
        width:
          gesture.size.width +
          (direction.includes('e') ? deltaX : direction.includes('w') ? -deltaX : 0),
        height:
          gesture.size.height +
          (direction.includes('s') ? deltaY : direction.includes('n') ? -deltaY : 0),
      });

      // Edges opposite the grabbed one stay put, so the window never jumps.
      const next = { ...gesture.origin };
      if (direction.includes('w')) {
        next.x = gesture.origin.x + (gesture.size.width - win.size.width);
      }
      if (direction.includes('n')) {
        next.y = gesture.origin.y + (gesture.size.height - win.size.height);
      }

      win.position = clampPosition(win.size, fitIntoViewport(win.size, next));
    }

    paint(win);
  }

  function begin(event, target, mode, direction) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    focusWindow(win);

    gesture = {
      pointerId: event.pointerId,
      target,
      mode,
      direction: direction ?? '',
      startX: event.screenX,
      startY: event.screenY,
      origin: { ...win.position },
      size: { ...win.size },
    };

    if (mode === 'drag') {
      win.headerEl.classList.add('is-dragging');
    } else {
      win.el.classList.add('is-resizing');
    }

    // Keeps the gesture alive when the finger leaves the header or handle.
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a best-effort safety net.
    }
  }

  function update(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    pointerSample = { x: event.screenX, y: event.screenY };

    if (framePending) {
      return;
    }

    framePending = true;
    requestAnimationFrame(runFrame);
  }

  function end(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const { target, pointerId } = gesture;
    gesture = null;
    pointerSample = null;
    win.headerEl.classList.remove('is-dragging');
    win.el.classList.remove('is-resizing');

    try {
      if (target?.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore unsupported pointers.
    }

    persistGeometry(win);
  }

  win.headerEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.weather-close')) {
      return;
    }

    begin(event, win.headerEl, 'drag');
  });
  win.headerEl.addEventListener('pointermove', update);
  win.headerEl.addEventListener('pointerup', end);
  win.headerEl.addEventListener('pointercancel', end);
  win.headerEl.addEventListener('lostpointercapture', end);

  for (const handle of win.el.querySelectorAll('.resize-handle')) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      begin(event, handle, 'resize', handle.dataset.resize);
    });
    handle.addEventListener('pointermove', update);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
  }

  // Touching anywhere in a window raises it above the others.
  win.el.addEventListener('pointerdown', () => focusWindow(win), true);
}

/* ---------- open / close ---------- */

async function restoreGeometry(win) {
  const config = WINDOW_TYPES[win.type];
  const saved = await bridge?.getWidgetState(config.stateKey);

  let size = { ...config.defaultSize };
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    size = { width: saved.width, height: saved.height };
  }
  win.size = clampSize(win.type, size);

  if (win.type === 'weather' && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    win.position = clampPosition(win.size, { x: saved.x, y: saved.y });
    return;
  }

  // File viewers cascade so a second window never lands exactly on the first.
  const base = centredPosition(win.size);
  const offset = cascade * CASCADE_STEP;
  cascade = (cascade + 1) % 5;
  win.position = clampPosition(win.size, { x: base.x + offset, y: base.y + offset });
}

async function openWindow(descriptor) {
  viewport = (await bridge?.getViewport()) ?? viewport;

  const existing = windows.get(descriptor.id);
  if (existing) {
    focusWindow(existing);
    return;
  }

  // Keep a lid on how many heavy viewers can be open on a Raspberry Pi.
  if (descriptor.type === 'file') {
    const openFiles = [...windows.values()].filter((win) => win.type === 'file');
    if (openFiles.length >= MAX_FILE_WINDOWS) {
      const oldest = openFiles.sort((a, b) => a.focusedAt - b.focusedAt)[0];
      closeWindow(oldest.id);
    }
  }

  const win = {
    id: descriptor.id,
    type: descriptor.type,
    title: descriptor.title ?? 'RitePath',
    subtitle: descriptor.subtitle ?? ' ',
    payload: descriptor.payload ?? {},
    focusedAt: Date.now(),
  };

  buildWindowElement(win);
  await restoreGeometry(win);

  windows.set(win.id, win);
  surfaceEl.append(win.el);
  focusWindow(win);
  paint(win);
  attachGestures(win);

  win.closeButton.addEventListener('click', () => closeWindow(win.id));

  if (win.type === 'weather') {
    renderWeatherWindow(win, latestWeather);
    void refreshWeather(win);
  } else {
    renderFileWindow(win);
  }

  requestAnimationFrame(() => win.el.classList.add('is-open'));
}

function closeWindow(id) {
  const win = windows.get(id);
  if (!win) {
    return;
  }

  persistGeometry(win);
  windows.delete(id);
  win.el.classList.remove('is-open');

  window.setTimeout(() => {
    win.el.remove();

    if (windows.size === 0) {
      // Nothing left to show: let the main process detach the overlay so it
      // stops intercepting input entirely.
      bridge?.surfaceEmpty();
    }
  }, OPEN_ANIMATION_MS);
}

/* ---------- shared rendering helpers ---------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- weather window ---------- */

function iconMarkup(condition, className, emojiClassName) {
  const icon = condition?.icon;
  if (typeof icon === 'string' && icon.startsWith('https://cdn.weatherapi.com/')) {
    return `<img class="${className}" src="${esc(icon)}" alt="" loading="lazy" />`;
  }

  return `<span class="${emojiClassName}">${esc(condition?.emoji ?? '🌡️')}</span>`;
}

function temperature(value) {
  return typeof value === 'number' ? `${value}°` : '--°';
}

function relativeTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) {
    return 'Updated just now';
  }

  if (minutes === 1) {
    return 'Updated 1 min ago';
  }

  if (minutes < 60) {
    return `Updated ${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'Updated 1 hour ago' : `Updated ${hours} hours ago`;
}

const WEATHER_ERRORS = {
  'no-key': 'No WeatherAPI key is configured. Add WEATHER_API_KEY to .env.local and restart RitePath.',
  'invalid-key': 'The WeatherAPI key was rejected. Check the key in .env.local.',
  'rate-limit': 'The WeatherAPI request limit has been reached. Weather will retry later.',
  'invalid-location': 'That weather location could not be found. Check WEATHER_LOCATION in .env.local.',
  'plan-restricted': 'This weather request is not available on the current WeatherAPI plan.',
  offline: 'RitePath cannot reach the weather service. Check the internet connection.',
  timeout: 'The weather service took too long to respond.',
  'server-error': 'The weather service is having problems. RitePath will retry automatically.',
  'bad-response': 'The weather service returned unexpected data.',
};

function renderStat(label, value) {
  return `
    <div class="weather-stat">
      <p class="weather-stat-label">${esc(label)}</p>
      <p class="weather-stat-value">${esc(value)}</p>
    </div>
  `;
}

function renderWeatherWindow(win, result) {
  if (!win || win.type !== 'weather') {
    return;
  }

  if (!result?.data) {
    win.titleEl.textContent = 'Weather';
    win.subtitleEl.textContent = '';
    const message = WEATHER_ERRORS[result?.error?.code] ?? 'Weather is unavailable right now.';
    win.bodyEl.innerHTML = `
      <div class="weather-empty">
        <div class="weather-empty-emoji">🌩️</div>
        <p class="weather-empty-title">Weather unavailable</p>
        <p class="weather-empty-note">${esc(message)}</p>
      </div>
    `;
    return;
  }

  const { location, current, today, hourly, daily } = result.data;

  win.titleEl.textContent = [location.name, location.region || location.country]
    .filter(Boolean)
    .join(', ');
  win.subtitleEl.textContent = relativeTime(result.fetchedAt);

  const stats = [
    renderStat('Feels like', temperature(current.feelsLikeF)),
    renderStat('Chance of rain', `${today.chanceOfRain ?? 0}%`),
    renderStat('Humidity', current.humidity === null ? '--' : `${current.humidity}%`),
    renderStat(
      'Wind',
      current.windMph === null ? '--' : `${current.windMph} mph ${current.windDir}`.trim(),
    ),
    renderStat('UV index', current.uv === null ? '--' : String(current.uv)),
    renderStat('Sunrise', today.sunrise ?? '--'),
    renderStat('Sunset', today.sunset ?? '--'),
  ].join('');

  const hours = hourly
    .map(
      (hour) => `
        <div class="weather-hour">
          <p class="weather-hour-time">${esc(hour.label)}</p>
          ${iconMarkup(hour.condition, 'weather-hour-icon', 'weather-hour-emoji')}
          <p class="weather-hour-temp">${esc(temperature(hour.tempF))}</p>
          <p class="weather-hour-rain">${esc(hour.chanceOfRain)}%</p>
        </div>
      `,
    )
    .join('');

  const days = daily
    .map(
      (day) => `
        <div class="weather-day">
          <span class="weather-day-name">${esc(day.label)}</span>
          ${iconMarkup(day.condition, 'weather-day-icon', 'weather-day-emoji')}
          <span class="weather-day-condition">${esc(day.condition.text)}</span>
          <span class="weather-day-rain">${esc(day.chanceOfRain)}%</span>
          <span class="weather-day-range">
            ${esc(temperature(day.maxF))} <span class="weather-day-min">${esc(
              temperature(day.minF),
            )}</span>
          </span>
        </div>
      `,
    )
    .join('');

  const staleNote = result.stale
    ? `<p class="weather-stale-note">${esc(
        result.error
          ? WEATHER_ERRORS[result.error.code] ?? 'Weather could not refresh.'
          : 'Showing saved weather.',
      )} ${esc(relativeTime(result.fetchedAt))}</p>`
    : '';

  win.bodyEl.innerHTML = `
    <div class="weather-top">
      <div class="weather-now">
        ${iconMarkup(current.condition, 'weather-now-icon', 'weather-now-emoji')}
        <div>
          <div class="weather-now-temp">${esc(temperature(current.tempF))}</div>
          <p class="weather-now-condition">${esc(current.condition.text)}</p>
          <p class="weather-now-range">H ${esc(temperature(today.maxF))} &nbsp; L ${esc(
            temperature(today.minF),
          )}</p>
        </div>
      </div>

      <div class="weather-stats">${stats}</div>
    </div>

    <p class="weather-section-title">Hourly</p>
    <div class="weather-hourly">${hours}</div>

    <p class="weather-section-title">${esc(daily.length)}-day forecast</p>
    <div>${days}</div>

    ${staleNote}
  `;
}

async function refreshWeather(win) {
  const result = await bridge?.getWeather({});
  latestWeather = result ?? latestWeather;
  renderWeatherWindow(win, latestWeather);
}

/* ---------- file viewer window ---------- */

function showViewerMessage(win, emoji, title, note) {
  win.bodyEl.innerHTML = `
    <div class="weather-empty">
      <div class="weather-empty-emoji">${esc(emoji)}</div>
      <p class="weather-empty-title">${esc(title)}</p>
      <p class="weather-empty-note">${esc(note)}</p>
    </div>
  `;
}

// USB content is untrusted. Images are decoded by Chromium, text is inserted
// with textContent (never innerHTML), and PDFs are handed to the built-in
// viewer inside a cross-origin iframe that has no preload and no Node access.
function renderFileWindow(win) {
  const { contentUrl, previewKind, name, mimeType } = win.payload;

  if (!contentUrl || !previewKind || previewKind === 'none') {
    showViewerMessage(
      win,
      '📄',
      'Preview not supported',
      `${name ?? 'This file'}${mimeType ? ` (${mimeType})` : ''} cannot be previewed safely in RitePath.`,
    );
    return;
  }

  win.bodyEl.innerHTML = '';
  win.bodyEl.classList.add('viewer-body');

  if (previewKind === 'image') {
    const frame = document.createElement('div');
    frame.className = 'viewer-image-frame';

    const image = document.createElement('img');
    image.className = 'viewer-image';
    image.alt = name ?? '';
    image.addEventListener('error', () => {
      showViewerMessage(
        win,
        '🔌',
        'USB drive disconnected',
        'This image could not be loaded. The drive may have been removed.',
      );
    });
    image.src = contentUrl;

    frame.append(image);
    win.bodyEl.append(frame);
    return;
  }

  if (previewKind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'viewer-pdf';
    frame.title = name ?? 'PDF';
    // Different origin from this page, and preloads do not run in subframes, so
    // the PDF cannot reach the context bridge or any Node API.
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = contentUrl;
    win.bodyEl.append(frame);
    return;
  }

  const pre = document.createElement('pre');
  pre.className = 'viewer-text';
  pre.textContent = 'Loading…';
  win.bodyEl.append(pre);

  fetch(contentUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(String(response.status));
      }

      const text = await response.text();
      // textContent, never innerHTML: USB text can never become live markup.
      pre.textContent =
        text.length > MAX_TEXT_CHARACTERS
          ? `${text.slice(0, MAX_TEXT_CHARACTERS)}\n\n[truncated]`
          : text;
    })
    .catch(() => {
      showViewerMessage(
        win,
        '🔌',
        'USB drive disconnected',
        'This file could not be read. The drive may have been removed.',
      );
    });
}

/* ---------- bridge wiring ---------- */

bridge?.onOpenWindow((descriptor) => {
  void openWindow(descriptor);
});

bridge?.onViewport((next) => {
  viewport = next;

  // Keep every window inside the visible screen after a resolution change.
  for (const win of windows.values()) {
    win.size = clampSize(win.type, win.size);
    win.position = clampPosition(win.size, win.position);
    paint(win);
  }
});

bridge?.onWeather((result) => {
  latestWeather = result;
  for (const win of windows.values()) {
    if (win.type === 'weather') {
      renderWeatherWindow(win, result);
    }
  }
});

// Refreshes the "Updated x min ago" label without touching the network.
weatherClockTimer = window.setInterval(() => {
  for (const win of windows.values()) {
    if (win.type === 'weather' && latestWeather?.fetchedAt) {
      win.subtitleEl.textContent = relativeTime(latestWeather.fetchedAt);
    }
  }
}, 30000);

window.addEventListener('unload', () => window.clearInterval(weatherClockTimer));

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());
