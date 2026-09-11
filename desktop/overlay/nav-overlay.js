// Android-style bottom gesture handle for the RitePath kiosk.
//
// This page runs inside a transparent BrowserView that the main process keeps
// pinned above any opened web app. Collapsed, the view is only a thin strip at
// the bottom of the screen, so it barely intercepts the page underneath. While a
// pointer is down the main process grows the strip, which is what lets a swipe
// that travels upwards out of the strip keep arriving here.
//
// Gesture maths uses screenX/screenY: the view's own coordinate origin moves
// when the hit area grows mid-gesture, but screen coordinates stay stable.

const REVEAL_DISTANCE = 26; // upward travel (px) that reveals the Home control
const TAP_DISTANCE = 14; // movement below this counts as a tap, not a swipe
const AUTO_HIDE_MS = 2000; // hide again after this much inactivity

const root = document.getElementById('nav-root');
const homeButton = document.getElementById('nav-home');
const bridge = window.ritepathNav;

let gesture = null;
let isRevealed = false;
let hideTimer = null;

function setHitArea(expanded) {
  bridge?.setHitArea(expanded);
}

function scheduleHide() {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(collapse, AUTO_HIDE_MS);
}

function reveal() {
  if (!isRevealed) {
    isRevealed = true;
    root.classList.add('is-revealed');
    setHitArea(true);
  }

  scheduleHide();
}

function collapse() {
  window.clearTimeout(hideTimer);
  hideTimer = null;
  isRevealed = false;
  root.classList.remove('is-revealed');
  setHitArea(false);
}

function releaseCapture(pointerId) {
  try {
    if (document.documentElement.hasPointerCapture(pointerId)) {
      document.documentElement.releasePointerCapture(pointerId);
    }
  } catch {
    // Capture is a best-effort safety net; ignore unsupported pointers.
  }
}

document.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  gesture = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    maxDistance: 0,
  };

  if (isRevealed) {
    // Any touch on the revealed control keeps it alive for another window.
    scheduleHide();
    return;
  }

  // Grow the hit area immediately so the rest of the swipe lands on this view.
  setHitArea(true);
  try {
    document.documentElement.setPointerCapture(event.pointerId);
  } catch {
    // Ignore: the enlarged hit area alone is usually enough.
  }
});

document.addEventListener('pointermove', (event) => {
  if (!gesture || gesture.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.screenX - gesture.startX;
  const deltaY = event.screenY - gesture.startY;
  gesture.maxDistance = Math.max(gesture.maxDistance, Math.abs(deltaX) + Math.abs(deltaY));

  if (isRevealed) {
    scheduleHide();
    return;
  }

  // Forgiving: any mostly-upward travel counts, from anywhere in the strip.
  if (deltaY <= -REVEAL_DISTANCE && Math.abs(deltaY) >= Math.abs(deltaX)) {
    reveal();
  }
});

function endGesture(event) {
  if (!gesture || gesture.pointerId !== event.pointerId) {
    return;
  }

  const wasTap = gesture.maxDistance < TAP_DISTANCE;
  releaseCapture(event.pointerId);
  gesture = null;

  if (isRevealed) {
    scheduleHide();
    return;
  }

  if (wasTap) {
    // A plain tap on the handle reveals Home too - swiping is not mandatory.
    reveal();
    return;
  }

  // Swipe went nowhere: shrink back to the thin strip.
  setHitArea(false);
}

document.addEventListener('pointerup', endGesture);
document.addEventListener('pointercancel', endGesture);

homeButton.addEventListener('click', () => {
  collapse();
  bridge?.goHome();
});

bridge?.onReset(() => {
  gesture = null;
  collapse();
});

// Never let the overlay page itself scroll, drag or show a context menu.
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());
