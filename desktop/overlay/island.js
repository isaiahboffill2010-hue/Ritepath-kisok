// RitePath Dynamic Island.
//
// Runs inside a transparent overlay BrowserView pinned above the launcher and
// above any opened web app. The view is only ever as large as the pill itself
// (plus room for its shadow), so it never covers content it does not need to.
//
// The pill is horizontally centred inside its view and the view is horizontally
// centred on the screen, which means the pill stays visually locked to the top
// centre even while the view is being resized. It is not draggable by design.

const SHADOW_MARGIN = 26;
const ISLAND_TOP = 10;
const COLLAPSED = { width: 152, height: 40 };
const EXPANDED = { width: 268, height: 96 };
const COLLAPSE_ANIMATION_MS = 280;
const AUTO_COLLAPSE_MS = 5000;

const bridge = window.ritepathOverlay;
const islandEl = document.getElementById('island');
const iconEl = document.getElementById('island-icon');
const emojiEl = document.getElementById('island-emoji');
const tempEl = document.getElementById('island-temp');
const optionEmojiEl = document.getElementById('island-option-emoji');
const weatherOption = document.getElementById('island-weather-option');

let viewport = { width: 0, height: 0 };
let expanded = false;
let shrinkTimer = null;
let autoCollapseTimer = null;

function rectFor(isExpanded) {
  const size = isExpanded ? EXPANDED : COLLAPSED;
  const width = size.width + SHADOW_MARGIN * 2;
  const height = size.height + SHADOW_MARGIN * 2;

  return {
    x: Math.round(viewport.width / 2 - width / 2),
    y: ISLAND_TOP - SHADOW_MARGIN,
    width,
    height,
  };
}

async function applyBounds(isExpanded) {
  if (!bridge) {
    return;
  }

  await bridge.setHitArea(rectFor(isExpanded));
}

function clearTimers() {
  window.clearTimeout(shrinkTimer);
  window.clearTimeout(autoCollapseTimer);
  shrinkTimer = null;
  autoCollapseTimer = null;
}

async function setExpanded(next) {
  if (expanded === next) {
    if (next) {
      scheduleAutoCollapse();
    }
    return;
  }

  expanded = next;
  clearTimers();

  if (next) {
    // Grow the view first so the expanding pill is never clipped mid-animation.
    await applyBounds(true);
    islandEl.classList.add('is-expanded');
    scheduleAutoCollapse();
    return;
  }

  islandEl.classList.remove('is-expanded');
  shrinkTimer = window.setTimeout(() => {
    if (!expanded) {
      void applyBounds(false);
    }
  }, COLLAPSE_ANIMATION_MS);
}

function scheduleAutoCollapse() {
  window.clearTimeout(autoCollapseTimer);
  autoCollapseTimer = window.setTimeout(() => {
    void setExpanded(false);
  }, AUTO_COLLAPSE_MS);
}

function renderWeather(result) {
  const current = result?.data?.current;

  if (!current || typeof current.tempF !== 'number') {
    tempEl.textContent = '--°';
    iconEl.classList.remove('is-visible');
    emojiEl.textContent = '🌡️';
    optionEmojiEl.textContent = '🌡️';
    return;
  }

  tempEl.textContent = `${current.tempF}°`;
  emojiEl.textContent = current.condition?.emoji ?? '🌡️';
  optionEmojiEl.textContent = current.condition?.emoji ?? '🌡️';

  const icon = current.condition?.icon;
  if (typeof icon === 'string' && icon.startsWith('https://')) {
    iconEl.src = icon;
  } else {
    iconEl.classList.remove('is-visible');
  }
}

// If the icon cannot be fetched (offline) the emoji fallback stays visible.
iconEl.addEventListener('load', () => iconEl.classList.add('is-visible'));
iconEl.addEventListener('error', () => iconEl.classList.remove('is-visible'));

islandEl.addEventListener('click', (event) => {
  if (event.target.closest('.island-option')) {
    return;
  }

  void setExpanded(!expanded);
});

weatherOption.addEventListener('click', () => {
  bridge?.openWeather();
  void setExpanded(false);
});

bridge?.onViewport((next) => {
  viewport = next;
  void applyBounds(expanded);
});

bridge?.onWeather(renderWeather);

bridge?.onReset(() => {
  void setExpanded(false);
});

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());

async function init() {
  if (!bridge) {
    return;
  }

  // Pull the screen size directly so the pill is centred even if the viewport
  // broadcast is missed while this page is still loading.
  viewport = (await bridge.getViewport()) ?? viewport;
  await applyBounds(false);

  const result = await bridge.getWeather({});
  renderWeather(result);
}

void init();
