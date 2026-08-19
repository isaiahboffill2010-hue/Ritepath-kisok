import { useEffect, useRef, useState } from 'react';
import { StatusBar } from './StatusBar';
import { AppIcon } from './AppIcon';
import { NavigationBar } from './NavigationBar';

type AppDrawerProps = {
  isOpen: boolean;
  time: string;
  onHomeClick: () => void;
  onGoogleClick: () => void;
  onSettingsClick: () => void;
  onFilesClick: () => void;
};

export function AppDrawer({
  isOpen,
  time,
  onHomeClick,
  onGoogleClick,
  onSettingsClick,
  onFilesClick,
}: AppDrawerProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);
  const openFrameRef = useRef<number | null>(null);
  const autoCloseRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      openFrameRef.current = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });
      if (autoCloseRef.current !== null) {
        window.clearTimeout(autoCloseRef.current);
      }
      autoCloseRef.current = window.setTimeout(() => {
        onHomeClick();
      }, 5000);
      return;
    }

    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (autoCloseRef.current !== null) {
      window.clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }

    setIsVisible(false);
  }, [isOpen, onHomeClick]);

  function handleTransitionEnd() {
    if (!isOpen) {
      setShouldRender(false);
    }
  }

  if (!shouldRender) {
    return null;
  }

  return (
    <section
      className={`app-drawer ${isVisible ? 'app-drawer--open' : ''}`}
      aria-hidden={!isVisible}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="app-drawer__scrim" aria-hidden="true" />
      <div className="app-drawer__sheet">
        <StatusBar time={time} />

        <div className="app-drawer__header">
          <div>
            <p className="app-drawer__eyebrow">All Apps</p>
            <h2 className="app-drawer__title">Swipe down to close</h2>
          </div>
          <div className="drawer-handle" aria-hidden="true" />
        </div>

        <section className="app-drawer__grid" aria-label="All apps">
          <AppIcon
            label="Google"
            accent="blue"
            ariaLabel="Google app"
            icon="google"
            variant="drawer"
            onClick={onGoogleClick}
          />
          <AppIcon
            label="Settings"
            accent="slate"
            ariaLabel="Settings app"
            icon="settings"
            variant="drawer"
            onClick={onSettingsClick}
          />
          <AppIcon
            label="Files"
            accent="green"
            ariaLabel="Files app"
            icon="files"
            variant="drawer"
            onClick={onFilesClick}
          />
        </section>

        <div className="app-drawer__spacer" />
        <NavigationBar onHomeClick={onHomeClick} />
      </div>
    </section>
  );
}
