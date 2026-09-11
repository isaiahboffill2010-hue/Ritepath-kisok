// RitePath floating weather window.
//
// Lives in its own transparent overlay BrowserView. While the widget is open
// that view covers the screen and is never moved or resized, which is what makes
// dragging frame-perfect - see the comment on fullScreenRect() below. Closing
// the widget detaches the view again, so it only intercepts input while it is
// actually on screen.
//
// Drag/resize maths uses screenX/screenY so it stays correct regardless of where
// the view happens to sit.

const SHADOW_MARGIN = 26;
const DEFAULT_SIZE = { width: 380, height: 560 };
const MIN_SIZE = { width: 286, height: 300 };
const MAX_SIZE = { width: 760, height: 940 };
const MIN_VISIBLE_X = 140; // horizontal sliver that must stay on screen
const HEADER_HEIGHT = 64;
const BOTTOM_RESERVED = 56; // keeps clear of the bottom Home gesture strip
const OPEN_ANIMATION_MS = 200;
const STATE_KEY = 'weatherWindow';

const bridge = window.ritepathOverlay;
const windowEl = document.getElementById('weather-window');
const headerEl = document.getElementById('weather-header');
const placeEl = document.getElementById('weather-place');
const updatedEl = document.getElementById('weather-updated');
const bodyEl = document.getElementById('weather-body');
const closeButton = document.getElementById('weather-close');

let viewport = { width: 0, height: 0 };
let size = { ...DEFAULT_SIZE };
let position = null; // screen coordinates of the window's top-left corner
let gesture = null; // active drag or resize
let viewRect = null; // bounds currently applied to this overlay view
let framePending = false;
let pointerSample = null;
let latest = null;
let updatedTimer = null;
let restored = false;

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

// The widget may never be larger than the space actually available.
function sizeLimits() {
  return {
    minWidth: Math.min(MIN_SIZE.width, Math.max(200, viewport.width - 16)),
    minHeight: Math.min(MIN_SIZE.height, Math.max(200, viewport.height - 16)),
    maxWidth: Math.max(MIN_SIZE.width, Math.min(MAX_SIZE.width, viewport.width - 16)),
    maxHeight: Math.max(
      MIN_SIZE.height,
      Math.min(MAX_SIZE.height, viewport.height - BOTTOM_RESERVED - 16),
    ),
  };
}

function clampSize(next) {
  const limits = sizeLimits();
  return {
    width: Math.round(clamp(next.width, limits.minWidth, limits.maxWidth)),
    height: Math.round(clamp(next.height, limits.minHeight, limits.maxHeight)),
  };
}

// Keeps a usable part of the window on screen wherever it is dragged, and is
// re-applied whenever the viewport changes (display/resolution change).
function clampPosition(pos) {
  return {
    x: Math.round(clamp(pos.x, MIN_VISIBLE_X - size.width, viewport.width - MIN_VISIBLE_X)),
    y: Math.round(clamp(pos.y, 0, Math.max(0, viewport.height - BOTTOM_RESERVED - HEADER_HEIGHT))),
  };
}

const ISLAND_CLEARANCE = 62; // leaves the Dynamic Island visible above it

// Opens centred on screen, nudged down so it never sits under the island.
function defaultPosition() {
  return clampPosition({
    x: Math.round(viewport.width / 2 - size.width / 2),
    y: Math.round(
      Math.max(ISLAND_CLEARANCE, (viewport.height - BOTTOM_RESERVED - size.height) / 2),
    ),
  });
}

// The overlay view is pinned to the whole screen for as long as the widget is
// open and is never resized or moved again until it closes.
//
// This is the whole trick behind stable dragging: the window's position on
// screen is (view origin + CSS transform), and those two are owned by different
// processes, so they can never be updated in the same frame. Changing the view
// while the window is visible therefore always produces a visible mismatch.
// Keeping the view perfectly still means position is a pure compositor
// transform inside one renderer - frame-perfect, with no IPC during a gesture.
function fullScreenRect() {
  return { x: 0, y: 0, width: viewport.width, height: viewport.height };
}

// Placed with a transform so moving it never triggers layout or a repaint of
// the transparent overlay layer.
function paint() {
  if (!viewRect || !position) {
    return;
  }

  // Only write styles that actually changed: while dragging, the size is
  // identical frame to frame, so this writes the transform and nothing else.
  const width = `${size.width}px`;
  const height = `${size.height}px`;
  const transform = `translate3d(${position.x - viewRect.x}px, ${position.y - viewRect.y}px, 0)`;

  if (windowEl.style.width !== width) {
    windowEl.style.width = width;
  }

  if (windowEl.style.height !== height) {
    windowEl.style.height = height;
  }

  if (windowEl.style.transform !== transform) {
    windowEl.style.transform = transform;
  }
}

function applyViewRect(rect) {
  viewRect = rect;
  paint();
}

async function syncBounds() {
  if (!bridge || !position) {
    return;
  }

  const requested = fullScreenRect();
  const applied = (await bridge.setHitArea(requested)) ?? requested;
  applyViewRect(applied);
}

function persistGeometry() {
  if (!bridge || !position) {
    return;
  }

  void bridge.setWidgetState(STATE_KEY, {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  });
}

/* ---------- rendering ---------- */

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

// Only WeatherAPI's own CDN icons are ever loaded.
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

const ERROR_MESSAGES = {
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

function renderUnavailable(error) {
  const message = ERROR_MESSAGES[error?.code] ?? 'Weather is unavailable right now.';
  bodyEl.innerHTML = `
    <div class="weather-empty">
      <div class="weather-empty-emoji">🌩️</div>
      <p class="weather-empty-title">Weather unavailable</p>
      <p class="weather-empty-note">${esc(message)}</p>
    </div>
  `;
}

function renderStat(label, value) {
  return `
    <div class="weather-stat">
      <p class="weather-stat-label">${esc(label)}</p>
      <p class="weather-stat-value">${esc(value)}</p>
    </div>
  `;
}

function render(result) {
  latest = result;

  if (!result?.data) {
    placeEl.textContent = 'Weather';
    updatedEl.textContent = '';
    renderUnavailable(result?.error);
    return;
  }

  const { location, current, today, hourly, daily } = result.data;

  placeEl.textContent = [location.name, location.region || location.country]
    .filter(Boolean)
    .join(', ');
  updatedEl.textContent = relativeTime(result.fetchedAt);

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
          ? ERROR_MESSAGES[result.error.code] ?? 'Weather could not refresh.'
          : 'Showing saved weather.',
      )} ${esc(relativeTime(result.fetchedAt))}</p>`
    : '';

  bodyEl.innerHTML = `
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

/* ---------- drag + resize ---------- */

// Neither gesture touches the overlay view. Dragging is a compositor-only
// transform; resizing additionally changes the window element's own width and
// height. Pointer events are coalesced to one update per animation frame so a
// high-rate mouse cannot queue up more work than the display can show.

function beginGesture(event, target, mode, direction) {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  gesture = {
    pointerId: event.pointerId,
    target,
    mode,
    direction: direction ?? '',
    startX: event.screenX,
    startY: event.screenY,
    origin: { ...position },
    size: { ...size },
  };

  if (mode === 'drag') {
    headerEl.classList.add('is-dragging');
  } else {
    windowEl.classList.add('is-resizing');
  }

  // Keeps the gesture alive when the finger leaves the header or handle.
  try {
    target.setPointerCapture(event.pointerId);
  } catch {
    // Capture is a best-effort safety net.
  }
}

function updateGesture(event) {
  if (!gesture || gesture.pointerId !== event.pointerId) {
    return;
  }

  pointerSample = { x: event.screenX, y: event.screenY };

  if (framePending) {
    return;
  }

  framePending = true;
  requestAnimationFrame(runGestureFrame);
}

function runGestureFrame() {
  framePending = false;

  if (!gesture || !pointerSample) {
    return;
  }

  const deltaX = pointerSample.x - gesture.startX;
  const deltaY = pointerSample.y - gesture.startY;

  if (gesture.mode === 'drag') {
    position = clampPosition({
      x: gesture.origin.x + deltaX,
      y: gesture.origin.y + deltaY,
    });
  } else {
    const { direction } = gesture;

    size = clampSize({
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
      next.x = gesture.origin.x + (gesture.size.width - size.width);
    }
    if (direction.includes('n')) {
      next.y = gesture.origin.y + (gesture.size.height - size.height);
    }

    position = clampPosition(next);
  }

  paint();
}

function endGesture(event) {
  if (!gesture || gesture.pointerId !== event.pointerId) {
    return;
  }

  const { target, pointerId } = gesture;
  gesture = null;
  pointerSample = null;
  headerEl.classList.remove('is-dragging');
  windowEl.classList.remove('is-resizing');

  try {
    if (target?.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // Ignore unsupported pointers.
  }

  persistGeometry();
}

headerEl.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.weather-close')) {
    return;
  }

  beginGesture(event, headerEl, 'drag');
});
headerEl.addEventListener('pointermove', updateGesture);
headerEl.addEventListener('pointerup', endGesture);
headerEl.addEventListener('pointercancel', endGesture);
headerEl.addEventListener('lostpointercapture', endGesture);

for (const handle of document.querySelectorAll('.resize-handle')) {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    beginGesture(event, handle, 'resize', handle.dataset.resize);
  });
  handle.addEventListener('pointermove', updateGesture);
  handle.addEventListener('pointerup', endGesture);
  handle.addEventListener('pointercancel', endGesture);
  handle.addEventListener('lostpointercapture', endGesture);
}

/* ---------- open / close ---------- */

function requestClose() {
  windowEl.classList.remove('is-open');
  persistGeometry();
  window.setTimeout(() => bridge?.closeWeather(), OPEN_ANIMATION_MS);
}

closeButton.addEventListener('click', requestClose);

// Because the overlay covers the screen while the widget is open, a tap on the
// empty area around the window is a dismiss rather than a dead spot.
document.addEventListener('pointerdown', (event) => {
  if (!position || event.target.closest('.weather-window')) {
    return;
  }

  requestClose();
});

async function restoreGeometry() {
  if (restored) {
    return;
  }

  restored = true;

  const saved = await bridge?.getWidgetState(STATE_KEY);
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    size = clampSize({ width: saved.width, height: saved.height });
  }

  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    position = clampPosition({ x: saved.x, y: saved.y });
  }
}

async function open() {
  // Always know the real screen size before computing geometry.
  viewport = (await bridge?.getViewport()) ?? viewport;
  size = clampSize(size);
  await restoreGeometry();
  position = clampPosition(position ?? defaultPosition());

  await syncBounds();

  // Refreshes the "Updated x min ago" label without touching the network.
  window.clearInterval(updatedTimer);
  updatedTimer = window.setInterval(() => {
    if (latest?.fetchedAt) {
      updatedEl.textContent = relativeTime(latest.fetchedAt);
    }
  }, 30000);

  const result = await bridge.getWeather({});
  render(result);

  requestAnimationFrame(() => windowEl.classList.add('is-open'));
}

bridge?.onReset(() => {
  void open();
});

bridge?.onViewport((next) => {
  viewport = next;
  size = clampSize(size);

  if (position) {
    // Keep the widget inside the visible screen after a resolution change.
    position = clampPosition(position);
    void syncBounds();
  }
});

bridge?.onWeather((result) => {
  if (position) {
    render(result);
  }
});

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());
