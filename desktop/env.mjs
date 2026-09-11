import fs from 'node:fs';

// Dependency-free .env loader.
//
// Values are only ever written into process.env - they are never logged, and
// never leave the main process. Existing environment variables win, so a real
// environment variable can always override the file (useful on the Pi).
function parseEnvFile(filePath) {
  let raw;

  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted && value.length >= 2) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFiles(projectRoot) {
  // .env.local first so it takes precedence over a shared .env.
  parseEnvFile(`${projectRoot}/.env.local`);
  parseEnvFile(`${projectRoot}/.env`);
}
