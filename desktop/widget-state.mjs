import fs from 'node:fs/promises';

// Small local store for shell widget geometry (position/size of the floating
// weather window). Purely local to this device - nothing here ever leaves the
// machine and it never requires a network connection.
let stateFilePath = null;
let state = null;
let writeQueue = Promise.resolve();

export function configureWidgetState({ stateFile }) {
  stateFilePath = stateFile;
}

async function load() {
  if (state) {
    return state;
  }

  try {
    const raw = await fs.readFile(stateFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    state = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing or corrupt state simply means "use the defaults".
    state = {};
  }

  return state;
}

export async function getWidgetState(key) {
  const all = await load();
  const value = all[key];
  return value && typeof value === 'object' ? value : null;
}

export async function setWidgetState(key, value) {
  const all = await load();

  if (!value || typeof value !== 'object') {
    return;
  }

  // Only ever persist a plain numeric rect.
  const rect = {};
  for (const field of ['x', 'y', 'width', 'height']) {
    if (Number.isFinite(Number(value[field]))) {
      rect[field] = Math.round(Number(value[field]));
    }
  }

  all[key] = rect;

  // Serialize writes so rapid resize/drag events cannot interleave.
  writeQueue = writeQueue.then(async () => {
    if (!stateFilePath) {
      return;
    }

    try {
      const tempPath = `${stateFilePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(all), 'utf8');
      await fs.rename(tempPath, stateFilePath);
    } catch {
      // Persisting geometry is best-effort only.
    }
  });

  await writeQueue;
}
