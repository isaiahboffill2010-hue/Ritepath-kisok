import { useEffect, useState } from 'react';
import {
  connectWifi,
  fetchSystemStatus,
  fetchVolume,
  fetchWifi,
  isBackendOfflineError,
  setVolume as updateVolume,
  type SystemStatus,
  type VolumeResponse,
  type WifiResponse,
} from '../lib/api';
import { StatusBar } from '../components/StatusBar';
import { NavigationBar } from '../components/NavigationBar';

type SettingsScreenProps = {
  time: string;
  onHomeClick: () => void;
};

export function SettingsScreen({ time, onHomeClick }: SettingsScreenProps) {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [volume, setVolumeState] = useState(50);
  const [muted, setMuted] = useState(false);
  const [wifi, setWifi] = useState<WifiResponse | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');

  useEffect(() => {
    let mounted = true;

    Promise.allSettled([fetchSystemStatus(), fetchVolume(), fetchWifi()]).then(([systemResult, volumeResult, wifiResult]) => {
      if (!mounted) {
        return;
      }

      if (systemResult.status === 'fulfilled') {
        setSystem(systemResult.value);
      }

      if (volumeResult.status === 'fulfilled') {
        const result = volumeResult.value as VolumeResponse;
        setVolumeState(result.volume);
        setMuted(result.muted);
      } else if (!isBackendOfflineError(volumeResult.reason)) {
        setVolumeError('Unable to read volume.');
      } else {
        setVolumeError('RitePath Backend Offline');
      }

      if (wifiResult.status === 'fulfilled') {
        setWifi(wifiResult.value);
      } else if (!isBackendOfflineError(wifiResult.reason)) {
        setWifiError('Unable to read Wi-Fi status.');
      } else {
        setWifiError('RitePath Backend Offline');
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void updateVolume(volume).catch(() => {
        setVolumeError('Unable to update volume.');
      });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [volume]);

  async function handleWifiConnect() {
    if (!wifiSsid.trim()) {
      return;
    }

    try {
      const updated = await connectWifi(wifiSsid.trim(), wifiPassword);
      setWifi(updated);
      setWifiError(null);
    } catch (error) {
      setWifiError(isBackendOfflineError(error) ? 'RitePath Backend Offline' : 'Unable to connect to Wi-Fi.');
    }
  }

  return (
    <div className="kiosk-content kiosk-content--app">
      <StatusBar time={time} />

      <div className="app-topline">
        <button type="button" className="app-back-button" onClick={onHomeClick}>
          Home
        </button>
        <div className="app-title-block">
          <p className="launcher-label">Settings</p>
          <h1>System controls</h1>
          <p className="launcher-subtitle">Volume, Wi-Fi, and system info only.</p>
        </div>
      </div>

      {loading ? <div className="app-banner">Loading settings...</div> : null}

      <section className="settings-stack" aria-label="Settings panels">
        <article className="settings-card">
          <h2>Volume</h2>
          <div className="slider-row">
            <span aria-hidden="true">🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(event) => setVolumeState(Number(event.target.value))}
              aria-label="Volume"
            />
            <span className="settings-value">{muted ? 'Muted' : `${volume}%`}</span>
          </div>
          {volumeError ? <p className="settings-error">{volumeError}</p> : null}
        </article>

        <article className="settings-card">
          <h2>Wi-Fi</h2>
          {wifi ? (
            <>
              <div className="settings-status">
                <span className={`status-dot ${wifi.connected ? 'status-dot--online' : 'status-dot--offline'}`} />
                <div>
                  <strong>{wifi.connected ? 'Connected' : 'Not connected'}</strong>
                  <p>{wifi.ssid || 'No network selected'}</p>
                </div>
              </div>
              <p className="settings-meta">Signal: {wifi.signal ?? 'Unknown'}%</p>
            </>
          ) : null}

          {wifiError ? <p className="settings-error">{wifiError}</p> : null}

          <div className="wifi-connect">
            <input
              className="settings-input"
              type="text"
              placeholder="Network name"
              value={wifiSsid}
              onChange={(event) => setWifiSsid(event.target.value)}
            />
            <input
              className="settings-input"
              type="password"
              placeholder="Password"
              value={wifiPassword}
              onChange={(event) => setWifiPassword(event.target.value)}
            />
            <button type="button" className="settings-action" onClick={() => void handleWifiConnect()}>
              Connect
            </button>
          </div>

          <div className="wifi-list">
            {(wifi?.networks ?? []).map((network) => (
              <button
                type="button"
                key={network.ssid}
                className="wifi-network"
                onClick={() => setWifiSsid(network.ssid)}
              >
                <span>{network.connected ? '●' : '○'}</span>
                <div>
                  <strong>{network.ssid || 'Hidden network'}</strong>
                  <p>
                    Signal {network.signal ?? 'Unknown'}% {network.security ? `• ${network.security}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <h2>About / System Information</h2>
          {system ? (
            <div className="system-grid">
              <div>
                <span>Host</span>
                <strong>{system.hostname}</strong>
              </div>
              <div>
                <span>Platform</span>
                <strong>{system.platform}</strong>
              </div>
              <div>
                <span>Kernel</span>
                <strong>{system.kernel}</strong>
              </div>
              <div>
                <span>Uptime</span>
                <strong>{Math.floor(system.uptime_seconds / 60)} min</strong>
              </div>
            </div>
          ) : (
            <p className="settings-meta">System information unavailable.</p>
          )}
        </article>
      </section>

      <NavigationBar onHomeClick={onHomeClick} />
    </div>
  );
}
