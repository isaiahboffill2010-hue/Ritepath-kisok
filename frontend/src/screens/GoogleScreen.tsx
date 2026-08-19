import { useEffect, useRef } from 'react';

type GoogleScreenProps = {
  url: string;
  onHomeClick: () => void;
};

export function GoogleScreen({ url, onHomeClick }: GoogleScreenProps) {
  const webviewRef = useRef<HTMLElement | null>(null);

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

  return (
    <div className="google-fullscreen" aria-label="Google inside RitePath">
      <webview ref={webviewRef} className="google-webview" src={url} partition="persist:ritepath-google" />

      <button type="button" className="google-home-float" onClick={onHomeClick} aria-label="Return home">
        Home
      </button>
    </div>
  );
}
