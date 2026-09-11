import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchFileRoots,
  fetchFiles,
  isBackendOfflineError,
  type FileEntry,
  type FileRoot,
  type FilesResponse,
} from '../lib/api';
import { StatusBar } from '../components/StatusBar';
import { NavigationBar } from '../components/NavigationBar';

type FilesScreenProps = {
  time: string;
  onHomeClick: () => void;
};

// How often we re-check which removable drives are connected. Plugging a drive
// in or pulling it out is picked up without restarting RitePath.
const DRIVE_POLL_MS = 3000;
const DOUBLE_TAP_MS = 450;

function formatBytes(bytes: number | null) {
  if (bytes === null) {
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

function iconFor(entry: FileEntry) {
  switch (entry.preview_kind) {
    case 'folder':
      return '\u{1F4C1}';
    case 'image':
      return '\u{1F5BC}\u{FE0F}';
    case 'pdf':
      return '\u{1F4D5}';
    case 'text':
      return '\u{1F4DD}';
    default:
      return '\u{1F4C4}';
  }
}

function typeLabel(entry: FileEntry) {
  if (entry.is_dir) {
    return 'Folder';
  }

  const parts = entry.name.split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'File';

  switch (entry.preview_kind) {
    case 'image':
      return `${extension} image`;
    case 'pdf':
      return 'PDF';
    case 'text':
      return `${extension} text`;
    default:
      return extension;
  }
}

export function FilesScreen({ time, onHomeClick }: FilesScreenProps) {
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [data, setData] = useState<FilesResponse | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastTapRef = useRef<{ path: string; at: number } | null>(null);

  // Poll for connected removable drives.
  useEffect(() => {
    let active = true;

    async function pollDrives() {
      try {
        const result = await fetchFileRoots();
        if (!active) {
          return;
        }

        setRoots(result.roots);
        setError(null);

        setCurrentRoot((previous) => {
          if (previous && result.roots.some((root) => root.id === previous)) {
            return previous;
          }

          // Either nothing was selected yet, or the drive we were browsing was
          // unplugged: fall back to whatever is still connected.
          return result.roots[0]?.id ?? null;
        });
      } catch (pollError) {
        if (!active) {
          return;
        }

        setRoots([]);
        setCurrentRoot(null);
        setError(isBackendOfflineError(pollError) ? 'RitePath Backend Offline' : null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void pollDrives();
    const timer = window.setInterval(() => void pollDrives(), DRIVE_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Reset the browsing position whenever the drive changes or disappears.
  useEffect(() => {
    setCurrentPath('');
    setSelected(null);
    if (!currentRoot) {
      setData(null);
    }
  }, [currentRoot]);

  const loadFolder = useCallback(async () => {
    if (!currentRoot) {
      return;
    }

    try {
      const result = await fetchFiles(currentRoot, currentPath);
      setData(result);
      setError(null);
    } catch (loadError) {
      if (isBackendOfflineError(loadError)) {
        setError('RitePath Backend Offline');
        return;
      }

      // The folder (or the whole drive) went away while we were browsing it.
      setData(null);
      if (currentPath) {
        setCurrentPath('');
      } else {
        setError('This folder is no longer available.');
      }
    }
  }, [currentPath, currentRoot]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  function openEntry(entry: FileEntry) {
    if (entry.is_dir) {
      setSelected(null);
      setCurrentPath(entry.path);
      return;
    }

    if (!currentRoot) {
      return;
    }

    void window.ritepath?.openFileViewer({
      rootId: currentRoot,
      path: entry.path,
      name: entry.name,
      previewKind: entry.preview_kind,
      mimeType: entry.mime_type,
      subtitle: [typeLabel(entry), formatBytes(entry.size)].filter(Boolean).join(' · '),
    });
  }

  // Folders open on a single tap. Files need a double tap (or the Open button)
  // so a stray touch never launches a viewer.
  function handleEntryTap(entry: FileEntry) {
    if (entry.is_dir) {
      openEntry(entry);
      return;
    }

    const previous = lastTapRef.current;
    const now = Date.now();
    lastTapRef.current = { path: entry.path, at: now };

    if (previous && previous.path === entry.path && now - previous.at < DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      openEntry(entry);
      return;
    }

    setSelected(entry);
  }

  const items = data?.items ?? [];
  const hasDrive = Boolean(currentRoot);

  return (
    <div className="kiosk-content kiosk-content--app">
      <StatusBar time={time} />

      <div className="app-topline">
        <button type="button" className="app-back-button" onClick={onHomeClick}>
          Home
        </button>
        <div className="app-title-block">
          <p className="launcher-label">Files</p>
          <h1>USB Files</h1>
          <p className="launcher-subtitle">Browse files on a connected USB drive.</p>
        </div>
      </div>

      {roots.length > 1 ? (
        <div className="app-root-strip" aria-label="Connected USB drives">
          {roots.map((root) => (
            <button
              type="button"
              key={root.id}
              className={`app-root-chip ${root.id === currentRoot ? 'app-root-chip--active' : ''}`}
              onClick={() => setCurrentRoot(root.id)}
            >
              {root.label}
            </button>
          ))}
        </div>
      ) : null}

      {hasDrive ? (
        <div className="app-path-row" aria-label="Current folder path">
          <span className="app-path-chip">
            {data?.root_label ?? 'USB Drive'} / {data?.current_path || ''}
          </span>
          {data && data.parent_path !== null ? (
            <button
              type="button"
              className="app-path-button"
              onClick={() => {
                setSelected(null);
                setCurrentPath(data.parent_path ?? '');
              }}
            >
              Up one level
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="app-banner app-banner--warning">{error}</div> : null}

      {!hasDrive && !loading && !error ? (
        <section className="usb-empty" aria-label="No USB drive connected">
          <div className="usb-empty__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path d="M13 3v8h2V7l2 2v2h-2v2h-2v6.5a1.5 1.5 0 0 1-3 0V13H8v-2H6V8l2-2v4h2V3h3z" />
            </svg>
          </div>
          <h2 className="usb-empty__title">Insert a USB drive</h2>
          <p className="usb-empty__note">
            Connected USB drives appear here automatically. RitePath Files only shows removable
            storage.
          </p>
        </section>
      ) : null}

      {hasDrive ? (
        <section className="file-list" aria-label="Files and folders">
          {items.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`file-row ${entry.is_dir ? 'file-row--folder' : ''} ${
                selected?.path === entry.path ? 'file-row--selected' : ''
              }`}
              onClick={() => handleEntryTap(entry)}
              onDoubleClick={() => openEntry(entry)}
            >
              <div className="file-row__icon" aria-hidden="true">
                {iconFor(entry)}
              </div>
              <div className="file-row__body">
                <div className="file-row__title">
                  <span>{entry.name}</span>
                  <span className="file-row__type">{typeLabel(entry)}</span>
                </div>
                <div className="file-row__meta">
                  <span>{formatBytes(entry.size)}</span>
                  {!entry.is_dir && !entry.previewable ? <span>Preview not supported</span> : null}
                </div>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {hasDrive && items.length === 0 && !error ? (
        <div className="app-banner">This folder is empty.</div>
      ) : null}

      {selected ? (
        <div className="file-actions" role="group" aria-label="Selected file actions">
          <span className="file-actions__name">{selected.name}</span>
          <button
            type="button"
            className="app-path-button"
            onClick={() => openEntry(selected)}
            disabled={!selected.previewable}
          >
            {selected.previewable ? 'Open' : 'Preview not supported'}
          </button>
        </div>
      ) : null}

      <NavigationBar onHomeClick={onHomeClick} />
    </div>
  );
}
