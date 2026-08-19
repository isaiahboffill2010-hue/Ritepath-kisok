import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const desktopMain = path.join(projectRoot, 'desktop', 'main.mjs');
const frontendDir = path.join(projectRoot, 'frontend');
const frontendViteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const electronCli = require.resolve('electron/cli.js');
const pythonBinary = process.platform === 'win32' ? 'python' : 'python3';
const devServerUrl = 'http://127.0.0.1:5173';

const childProcesses = new Set();

function spawnTracked(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });

  childProcesses.add(child);
  child.on('exit', () => {
    childProcesses.delete(child);
  });
  return child;
}

function stopAll(exitCode = 0) {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  childProcesses.clear();
  process.exit(exitCode);
}

async function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Keep waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

spawnTracked(
  pythonBinary,
  ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'],
  { cwd: projectRoot },
);

spawnTracked(
  process.execPath,
  [frontendViteCli, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  { cwd: frontendDir, env: { ...process.env } },
);

try {
  await waitForServer(devServerUrl);
} catch (error) {
  console.error(error);
  stopAll(1);
}

const electron = spawnTracked(
  process.execPath,
  [electronCli, desktopMain],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      RITEPATH_DEV_SERVER_URL: devServerUrl,
    },
  },
);

electron.on('exit', (code) => stopAll(code ?? 0));
