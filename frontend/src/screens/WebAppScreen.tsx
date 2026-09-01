import { useEffect, useRef } from 'react';
import { webApps } from '../config/webApps';

type WebAppScreenProps = {
  appId: string;
  onHomeClick: () => void;
};

export function WebAppScreen({ appId, onHomeClick }: WebAppScreenProps) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const app = webApps.find(a => a.id === appId);

  useEffect(() => {
    const webview = webviewRef.current as (HTMLElement & { setZoomFactor?: (zoomFactor: number) => void }) | null;
    if (!webview) {
      return;
    }

    const handleDomReady = () => {
      webview.setZoomFactor?.(1.25);
    };

    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, []);

  if (!app) {
    return (
      <div className="webview-error" aria-label="App not found">
        <p>App not found</p>
        <button type="button" onClick={onHomeClick}>Return Home</button>
      </div>
    );
  }

  return (
    <div className="webapp-fullscreen" aria-label={`${app.name} inside RitePath`}>
      <webview
        ref={webviewRef}
        className="webapp-webview"
        src={app.url}
        partition={`persist:ritepath-${appId}`}
      />

      <button type="button" className="webapp-home-float" onClick={onHomeClick} aria-label="Return home">
        Home
      </button>
    </div>
  );
}
