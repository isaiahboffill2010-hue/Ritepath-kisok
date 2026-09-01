import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { AppDrawer } from './components/AppDrawer';
import { HomeScreen } from './screens/HomeScreen';
import { FilesScreen } from './screens/FilesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AddAppModal } from './screens/AddAppModal';
import { fetchCustomApps, addCustomApp, type CustomApp } from './lib/api';

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

type GestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  isVertical: boolean;
  openedOrClosed: boolean;
};

type ScreenView = 'home' | 'files' | 'settings';

const SWIPE_THRESHOLD = 90;
const START_ZONE_HEIGHT = 120;
const VERTICAL_LOCK_DISTANCE = 14;
const HORIZONTAL_TOLERANCE = 60;

export default function App() {
  const [time, setTime] = useState(() => formatTime(new Date()));
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [screenView, setScreenView] = useState<ScreenView>('home');
  const [customApps, setCustomApps] = useState<CustomApp[]>([]);
  const [showAddAppModal, setShowAddAppModal] = useState(false);
  const gestureRef = useRef<GestureState | null>(null);
  const suppressClicksUntilRef = useRef(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTime(formatTime(new Date()));
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = window.ritepath?.onOpenDrawer(() => {
      setScreenView('home');
      setIsDrawerOpen(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    void fetchCustomApps().then(setCustomApps).catch(() => setCustomApps([]));
  }, []);

  function openDrawer() {
    if (screenView !== 'home') {
      return;
    }
    setIsDrawerOpen(true);
  }

  function closeDrawer() {
    setIsDrawerOpen(false);
  }

  function suppressClicksFor(ms: number) {
    suppressClicksUntilRef.current = performance.now() + ms;
  }

  function goHome() {
    setScreenView('home');
    closeDrawer();
  }

  function openFiles() {
    setScreenView('files');
    closeDrawer();
  }

  function openSettings() {
    setScreenView('settings');
    closeDrawer();
  }

  function openGoogle(url = 'https://www.google.com/') {
    void window.ritepath?.openGoogle(url);
    closeDrawer();
  }

  function openRitePath() {
    void window.ritepath?.openGoogle('https://ritepath.app/');
    closeDrawer();
  }

  function openCustomApp(url: string) {
    void window.ritepath?.openGoogle(url);
    closeDrawer();
  }

  async function handleAddApp(app: { url: string; logo: string; backgroundColor: string }) {
    try {
      const newApp = await addCustomApp(app);
      setCustomApps([...customApps, newApp]);
      setShowAddAppModal(false);
    } catch (error) {
      console.error('Failed to add app:', error);
      throw error;
    }
  }

  function handlePointerDownCapture(event: PointerEvent<HTMLElement>) {
    if (screenView !== 'home') {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const startedInBottomZone = !isDrawerOpen && event.clientY >= window.innerHeight - START_ZONE_HEIGHT;
    if (!isDrawerOpen && !startedInBottomZone) {
      return;
    }

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isVertical: false,
      openedOrClosed: false,
    };
  }

  function handlePointerMoveCapture(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.openedOrClosed) {
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const totalDistance = Math.abs(deltaX) + Math.abs(deltaY);

    if (!gesture.isVertical && totalDistance >= VERTICAL_LOCK_DISTANCE) {
      gesture.isVertical = Math.abs(deltaY) >= Math.abs(deltaX);
    }

    if (!gesture.isVertical || Math.abs(deltaX) > HORIZONTAL_TOLERANCE) {
      return;
    }

    if (!isDrawerOpen && deltaY <= -SWIPE_THRESHOLD) {
      gesture.openedOrClosed = true;
      suppressClicksFor(700);
      openDrawer();
      gestureRef.current = null;
      return;
    }

    if (isDrawerOpen && deltaY >= SWIPE_THRESHOLD) {
      gesture.openedOrClosed = true;
      suppressClicksFor(700);
      closeDrawer();
      gestureRef.current = null;
    }
  }

  function clearGesture(pointerId: number) {
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId === pointerId) {
      gestureRef.current = null;
    }
  }

  function handlePointerUpCapture(event: PointerEvent<HTMLElement>) {
    clearGesture(event.pointerId);
  }

  function handlePointerCancelCapture(event: PointerEvent<HTMLElement>) {
    clearGesture(event.pointerId);
  }

  function handleClickCapture(event: MouseEvent<HTMLElement>) {
    if (performance.now() >= suppressClicksUntilRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <main
      className="kiosk-shell"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={handlePointerCancelCapture}
      onClickCapture={handleClickCapture}
    >
      <div className="kiosk-backdrop" aria-hidden="true" />

      <section
        className="kiosk-screen"
        aria-label="RitePath Kiosk home screen"
      >
        {screenView === 'home' ? (
          <HomeScreen
            time={time}
            onGoogleClick={() => openGoogle()}
            onSettingsClick={openSettings}
            onFilesClick={openFiles}
            onRitePathClick={openRitePath}
            customApps={customApps}
            onCustomAppClick={openCustomApp}
            onAddAppClick={() => setShowAddAppModal(true)}
          />
        ) : null}

        {screenView === 'files' ? <FilesScreen time={time} onHomeClick={goHome} /> : null}

        {screenView === 'settings' ? <SettingsScreen time={time} onHomeClick={goHome} /> : null}

      </section>

      {screenView === 'home' ? (
        <AppDrawer
          isOpen={isDrawerOpen}
          time={time}
          onHomeClick={goHome}
          onGoogleClick={() => openGoogle()}
          onSettingsClick={openSettings}
          onFilesClick={openFiles}
        />
      ) : null}

      {showAddAppModal ? (
        <AddAppModal onClose={() => setShowAddAppModal(false)} onAdd={handleAddApp} />
      ) : null}
    </main>
  );
}
