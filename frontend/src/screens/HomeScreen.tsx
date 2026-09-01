import { StatusBar } from '../components/StatusBar';
import { AppIcon } from '../components/AppIcon';
import { webApps } from '../config/webApps';

type HomeScreenProps = {
  time: string;
  onGoogleClick: () => void;
  onSettingsClick: () => void;
  onFilesClick: () => void;
  onWebAppClick: (appId: string) => void;
};

export function HomeScreen({ time, onGoogleClick, onSettingsClick, onFilesClick, onWebAppClick }: HomeScreenProps) {
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
        {webApps.map(app => (
          <AppIcon
            key={app.id}
            label={app.name}
            accent="purple"
            ariaLabel={`${app.name} app`}
            icon={app.icon}
            onClick={() => onWebAppClick(app.id)}
          />
        ))}
      </section>
    </div>
  );
}
