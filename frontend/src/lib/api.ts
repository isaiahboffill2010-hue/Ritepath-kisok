export type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: string | null;
  mime_type: string | null;
  previewable: boolean;
  content_url: string | null;
};

export type FileRoot = {
  id: string;
  label: string;
  kind: 'ritepath' | 'usb';
};

export type FilesResponse = {
  root_id: string;
  root_label: string;
  current_path: string;
  parent_path: string | null;
  roots: FileRoot[];
  items: FileEntry[];
};

export type VolumeResponse = {
  volume: number;
  muted: boolean;
};

export type WifiNetwork = {
  ssid: string;
  signal: number | null;
  security: string | null;
  connected: boolean;
};

export type WifiResponse = {
  connected: boolean;
  ssid: string | null;
  ip_address: string | null;
  signal: number | null;
  networks: WifiNetwork[];
  available: boolean;
  error: string | null;
};

export type SystemStatus = {
  hostname: string;
  platform: string;
  kernel: string;
  uptime_seconds: number;
  backend_time: string;
  safe_files_root: string;
};

class BackendOfflineError extends Error {
  constructor(message = 'RitePath Backend Offline') {
    super(message);
    this.name = 'BackendOfflineError';
  }
}

function getApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  return window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
}

function toApiUrl(path: string) {
  return `${getApiBaseUrl()}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(toApiUrl(path), {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'TypeError') {
      throw new BackendOfflineError();
    }
    throw error;
  }
}

export function isBackendOfflineError(error: unknown) {
  return error instanceof BackendOfflineError;
}

export async function fetchSystemStatus() {
  return requestJson<SystemStatus>('/api/system/status');
}

export async function fetchVolume() {
  return requestJson<VolumeResponse>('/api/volume');
}

export async function setVolume(volume: number) {
  return requestJson<VolumeResponse>('/api/volume', {
    method: 'POST',
    body: JSON.stringify({ volume }),
  });
}

export async function fetchWifi() {
  return requestJson<WifiResponse>('/api/wifi');
}

export async function connectWifi(ssid: string, password: string) {
  return requestJson<WifiResponse>('/api/wifi/connect', {
    method: 'POST',
    body: JSON.stringify({ ssid, password }),
  });
}

export async function fetchFileRoots() {
  return requestJson<{ roots: FileRoot[] }>('/api/files/roots');
}

export async function fetchFiles(root = 'ritepath', path = '') {
  const params = new URLSearchParams();
  params.set('root', root);
  if (path) {
    params.set('path', path);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  return requestJson<FilesResponse>(`/api/files${suffix}`);
}

export async function fetchFileContent(root: string, path: string) {
  const params = new URLSearchParams({ root, path });
  return fetch(toApiUrl(`/api/files/content?${params.toString()}`));
}

export function getGoogleSearchUrl(query?: string) {
  const trimmed = query?.trim();
  return trimmed ? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}` : 'https://www.google.com';
}

export { BackendOfflineError };
