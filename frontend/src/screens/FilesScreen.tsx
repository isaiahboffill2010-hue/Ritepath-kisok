import { useEffect, useState } from 'react';
import {
  fetchFileContent,
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

type PreviewState = {
  entry: FileEntry;
  textContent: string | null;
};

function formatBytes(bytes: number | null) {
  if (bytes === null) {
    return 'Unknown size';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(value: string | null) {
  if (!value) {
    return 'Unknown time';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

function extensionLabel(entry: FileEntry) {
  if (entry.is_dir) {
    return 'Folder';
  }

  const parts = entry.name.split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  if (entry.mime_type?.startsWith('image/')) {
    return 'Image';
  }
  if (entry.mime_type?.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'log'].includes(extension)) {
    return 'Text';
  }
  if (entry.mime_type === 'application/pdf' || extension === 'pdf') {
    return 'PDF';
  }
  return extension ? extension.toUpperCase() : 'File';
}

export function FilesScreen({ time, onHomeClick }: FilesScreenProps) {
  const [data, setData] = useState<FilesResponse | null>(null);
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [currentRoot, setCurrentRoot] = useState('ritepath');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    let mounted = true;

    fetchFileRoots()
      .then((result) => {
        if (!mounted) {
          return;
        }

        setRoots(result.roots);
        if (result.roots.length > 0 && !result.roots.some((root) => root.id === currentRoot)) {
          setCurrentRoot(result.roots[0].id);
        }
      })
      .catch(() => {
        if (mounted) {
          setRoots([]);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    fetchFiles(currentRoot, currentPath)
      .then((result) => {
        if (mounted) {
          setData(result);
        }
      })
      .catch((requestError) => {
        if (mounted) {
          setError(isBackendOfflineError(requestError) ? 'RitePath Backend Offline' : 'Unable to load files.');
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [currentPath, currentRoot]);

  async function handleFileClick(entry: FileEntry) {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
      return;
    }

    if (!entry.previewable || !entry.content_url) {
      setPreview({ entry, textContent: null });
      return;
    }

    if (entry.mime_type?.startsWith('text/')) {
      const response = await fetchFileContent(currentRoot, entry.path);
      const textContent = await response.text();
      setPreview({ entry, textContent });
      return;
    }

    setPreview({ entry, textContent: null });
  }

  return (
    <div className="kiosk-content kiosk-content--app">
      <StatusBar time={time} />

      <div className="app-topline">
        <button type="button" className="app-back-button" onClick={onHomeClick}>
          Home
        </button>
        <div className="app-title-block">
          <p className="launcher-label">Files</p>
          <h1>RitePath Files</h1>
          <p className="launcher-subtitle">Browse the designated RitePath folder and safe USB drives.</p>
        </div>
      </div>

      {roots.length > 0 ? (
        <div className="app-root-strip" aria-label="Available storage roots">
          {roots.map((root) => (
            <button
              type="button"
              key={root.id}
              className={`app-root-chip ${root.id === currentRoot ? 'app-root-chip--active' : ''}`}
              onClick={() => {
                setCurrentRoot(root.id);
                setCurrentPath('');
                setPreview(null);
              }}
            >
              {root.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="app-path-row" aria-label="Current folder path">
        <span className="app-path-chip">{data?.root_label ?? 'RitePath Files'} / {data?.current_path || '/'}</span>
        {data?.parent_path ? (
          <button type="button" className="app-path-button" onClick={() => setCurrentPath(data.parent_path ?? '')}>
            Up one level
          </button>
        ) : null}
      </div>

      {error ? <div className="app-banner app-banner--warning">{error}</div> : null}
      {loading ? <div className="app-banner">Loading files...</div> : null}

      <section className="file-list" aria-label="Files and folders">
        {(data?.items ?? []).map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`file-row ${entry.is_dir ? 'file-row--folder' : ''}`}
            onClick={() => void handleFileClick(entry)}
          >
            <div className="file-row__icon" aria-hidden="true">
              {entry.is_dir ? '📁' : '📄'}
            </div>
            <div className="file-row__body">
              <div className="file-row__title">
                <span>{entry.name}</span>
                <span className="file-row__type">{extensionLabel(entry)}</span>
              </div>
              <div className="file-row__meta">
                <span>{formatBytes(entry.size)}</span>
                <span>{formatModified(entry.modified)}</span>
              </div>
            </div>
          </button>
        ))}
      </section>

      {!loading && !error && (data?.items.length ?? 0) === 0 ? <div className="app-banner">This folder is empty.</div> : null}

      <NavigationBar onHomeClick={onHomeClick} />

      {preview ? (
        <div className="preview-modal" role="dialog" aria-modal="true" aria-label={`Preview ${preview.entry.name}`}>
          <div className="preview-modal__panel">
            <div className="preview-modal__header">
              <div>
                <p className="launcher-label">Preview</p>
                <h2>{preview.entry.name}</h2>
              </div>
              <button type="button" className="app-back-button" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <div className="preview-modal__content">
              {preview.entry.mime_type?.startsWith('image/') && preview.entry.content_url ? (
                <img className="preview-image" src={preview.entry.content_url} alt={preview.entry.name} />
              ) : preview.entry.mime_type === 'application/pdf' && preview.entry.content_url ? (
                <iframe className="preview-frame" src={preview.entry.content_url} title={preview.entry.name} />
              ) : preview.textContent !== null ? (
                <pre className="preview-text">{preview.textContent}</pre>
              ) : (
                <div className="app-banner">Preview not supported for this file type yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
