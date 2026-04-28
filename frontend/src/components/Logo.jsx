export default function Logo({ className }) {
  return (
    <div className={className ?? 'navbar-logo'}>
      <div className="auth-logo-icon">
        <GolfFlagIcon />
      </div>
      <span className="auth-logo-name">The Circuit</span>
    </div>
  );
}

function GolfFlagIcon() {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2v20M6 2l12 5-12 5" />
    </svg>
  );
}
