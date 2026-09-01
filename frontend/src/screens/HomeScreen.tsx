import { StatusBar } from '../components/StatusBar';
import { AppIcon } from '../components/AppIcon';
import { type CustomApp } from '../lib/api';

type HomeScreenProps = {
  time: string;
  onGoogleClick: () => void;
  onSettingsClick: () => void;
  onFilesClick: () => void;
  onRitePathClick: () => void;
  customApps: CustomApp[];
  onCustomAppClick: (url: string) => void;
  onAddAppClick: () => void;
};

export function HomeScreen({
  time,
  onGoogleClick,
  onSettingsClick,
  onFilesClick,
  onRitePathClick,
  customApps,
  onCustomAppClick,
  onAddAppClick,
}: HomeScreenProps) {
  return (
    <div className="kiosk-content">
      <StatusBar time={time} />

      <div className="hero-copy">
        <p className="launcher-label">RitePath Kiosk</p>
        <h1>Welcome home</h1>
        <p className="launcher-subtitle">Touch-friendly launcher for the tablet home screen.</p>
      </div>

      <div className="home-logo-panel" aria-hidden="true">
        <img className="home-logo" src="/Ritepath.png" alt="" />
      </div>

      <div className="home-header">
        <div></div>
        <button className="add-app-button-top-right" onClick={onAddAppClick} aria-label="Add your own app">
          <span className="add-app-icon">+</span>
          <span className="add-app-label">Add Your Own App</span>
        </button>
      </div>

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
        <AppIcon
          label="RitePath"
          accent="purple"
          ariaLabel="RitePath app"
          icon="/Ritepath.png"
          onClick={onRitePathClick}
        />
        {customApps.map((app) => (
          <AppIcon
            key={app.id}
            label={app.displayName}
            accent="blue"
            ariaLabel={`${app.displayName} app`}
            icon={app.logo}
            onClick={() => onCustomAppClick(app.url)}
            customColor={app.backgroundColor}
          />
        ))}
      </section>
    </div>
  );
}
