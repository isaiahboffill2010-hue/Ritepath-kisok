import { useState } from 'react';

type AddAppModalProps = {
  onClose: () => void;
  onAdd: (app: { url: string; backgroundColor: string }) => Promise<void>;
};

export function AddAppModal({ onClose, onAdd }: AddAppModalProps) {
  const [url, setUrl] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validateUrl(urlString: string): boolean {
    if (!urlString.trim()) {
      setError('URL is required');
      return false;
    }

    try {
      const parsed = new URL(urlString);

      // Only allow http and https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('Only HTTPS URLs are allowed');
        return false;
      }

      // Prefer HTTPS
      if (parsed.protocol !== 'https:') {
        setError('Please use HTTPS (e.g., https://example.com)');
        return false;
      }

      return true;
    } catch {
      setError('Invalid URL format');
      return false;
    }
  }


  async function handleSubmit() {
    if (!validateUrl(url)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onAdd({
        url: new URL(url).toString(),
        backgroundColor
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add app');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Your Own App</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="url">Website URL</label>
            <input
              id="url"
              type="text"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="color">Button Color</label>
            <div className="color-picker">
              <input
                id="color"
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="color-input"
              />
              <span className="color-display" style={{ background: backgroundColor }} />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary" disabled={loading}>
            Cancel
          </button>
          <button onClick={handleSubmit} className="button-primary" disabled={loading}>
            {loading ? 'Adding...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
