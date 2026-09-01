import { useState, useRef } from 'react';

type AddAppModalProps = {
  onClose: () => void;
  onAdd: (app: { url: string; logo: string; backgroundColor: string }) => Promise<void>;
};

export function AddAppModal({ onClose, onAdd }: AddAppModalProps) {
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Only PNG, JPG, or WebP images are supported');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be smaller than 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setLogo(e.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!validateUrl(url)) {
      return;
    }

    if (!logo) {
      setError('Please upload a logo');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onAdd({
        url: new URL(url).toString(),
        logo,
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
            <label htmlFor="logo">App Logo</label>
            <div className="logo-upload">
              {logo ? (
                <div className="logo-preview">
                  <img src={logo} alt="Logo preview" />
                  <button
                    type="button"
                    onClick={() => {
                      setLogo(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="logo-remove"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="logo-upload-button"
                >
                  Upload Logo
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
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
