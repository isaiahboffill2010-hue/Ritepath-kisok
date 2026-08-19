type StatusBarProps = {
  time: string;
};

export function StatusBar({ time }: StatusBarProps) {
  return (
    <header className="status-bar" aria-label="Status bar">
      <div className="status-time">{time}</div>
    </header>
  );
}
