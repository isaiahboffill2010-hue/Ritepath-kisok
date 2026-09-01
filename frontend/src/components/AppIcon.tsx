type AppIconProps = {
  label: string;
  accent: 'blue' | 'slate' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan';
  ariaLabel: string;
  icon: string;
  variant?: 'home' | 'drawer';
  onClick: () => void;
};

export function AppIcon({ label, accent, ariaLabel, icon, variant = 'home', onClick }: AppIconProps) {
  const isImageIcon = icon.startsWith('/') || icon.includes('.');
  const iconClass = isImageIcon ? 'image' : icon;

  return (
    <button
      type="button"
      className={`app-icon app-icon--${accent} app-icon--${variant}`}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className={`app-icon-badge app-icon-badge--${iconClass}`} aria-hidden="true">
        {icon === 'google' && <span className="google-letter">G</span>}
        {icon === 'settings' && (
          <svg viewBox="0 0 24 24" role="presentation">
            <path d="M19.14 12.94a7.7 7.7 0 0 0 .05-.94 7.7 7.7 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.9 2h-3.8a.5.5 0 0 0-.49.41l-.36 2.54a7.2 7.2 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L3.71 8.47a.5.5 0 0 0 .12.64l2.03 1.58a7.7 7.7 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.37 1.05.68 1.63.94l.36 2.54a.5.5 0 0 0 .49.41h3.8a.5.5 0 0 0 .49-.41l.36-2.54c.58-.26 1.13-.57 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.25A3.25 3.25 0 1 1 12 8.75a3.25 3.25 0 0 1 0 6.5Z" />
          </svg>
        )}
        {icon === 'files' && (
          <svg viewBox="0 0 24 24" role="presentation">
            <path d="M4.5 5.75A2.25 2.25 0 0 1 6.75 3.5h4.46c.6 0 1.17.24 1.59.66l1.54 1.59c.41.42.98.66 1.57.66h1.34A2.25 2.25 0 0 1 19.5 8.67v8.58a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 17.25V5.75Zm2.5 2.25v8.5h10V8H15.9a3.2 3.2 0 0 1-2.24-.92l-1.1-1.08H6.75a.25.25 0 0 0-.25.25Z" />
          </svg>
        )}
        {isImageIcon && (
          <img
            src={icon}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
      </span>
      <span className="app-icon-label">{label}</span>
    </button>
  );
}
