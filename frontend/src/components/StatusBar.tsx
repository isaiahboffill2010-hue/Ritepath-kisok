type StatusBarProps = {
  time: string;
};

export function StatusBar({ time }: StatusBarProps) {
  return (
    <header className="status-bar" aria-label="Status bar">
      <div className="status-time">{time}</div>
      <div className="status-indicators" aria-hidden="true">
        <span className="status-chip">Wi-Fi</span>
        <span className="status-chip">87%</span>
        <span className="battery-icon">
          <span className="battery-fill" />
        </span>
      </div>
    </header>
  );
}
