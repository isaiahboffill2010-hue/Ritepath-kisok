import { StatusBar } from '../components/StatusBar';
import { GoogleSearch } from '../components/GoogleSearch';
import { AppIcon } from '../components/AppIcon';

type HomeScreenProps = {
  time: string;
  onSearch: (query: string) => void;
  onGoogleClick: () => void;
  onSettingsClick: () => void;
  onFilesClick: () => void;
};

export function HomeScreen({ time, onSearch, onGoogleClick, onSettingsClick, onFilesClick }: HomeScreenProps) {
  return (
    <div className="kiosk-content">
      <StatusBar time={time} />

      <div className="hero-copy">
        <p className="launcher-label">RitePath Kiosk</p>
        <h1>Welcome home</h1>
        <p className="launcher-subtitle">Touch-friendly launcher for the tablet home screen.</p>
      </div>

      <GoogleSearch onSearch={onSearch} />

      <section className="app-grid" aria-label="Applications">
        <AppIcon
          label="Google"
          accent="blue"
          ariaLabel="Google app"
          icon="google"
          onClick={onGoogleClick}
        />
        <AppIcon
          label="Settings"
          accent="slate"
          ariaLabel="Settings app"
          icon="settings"
          onClick={onSettingsClick}
        />
        <AppIcon
          label="Files"
          accent="green"
          ariaLabel="Files app"
          icon="files"
          onClick={onFilesClick}
        />
      </section>
    </div>
  );
}
