type NavigationBarProps = {
  onHomeClick: () => void;
};

export function NavigationBar({ onHomeClick }: NavigationBarProps) {
  return (
    <nav className="navigation-bar" aria-label="Home navigation">
      <button type="button" className="home-button" aria-label="Home button" onClick={onHomeClick}>
        <span className="home-button-ring" aria-hidden="true" />
        <span className="home-button-core" aria-hidden="true" />
      </button>
    </nav>
  );
}
