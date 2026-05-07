import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="4"  y1="9"  x2="20" y2="9"  />
      <line x1="4"  y1="15" x2="20" y2="15" />
      <line x1="10" y1="3"  x2="8"  y2="21" />
      <line x1="16" y1="3"  x2="14" y2="21" />
    </svg>
  );
}

export default function ClubGate() {
  const navigate = useNavigate();

  return (
    <div className="auth-page gate-page">
      <div className="auth-card">
        <Logo className="auth-logo" />

        <h1 className="auth-heading">Welcome to The Circuit</h1>
        <p className="auth-subheading">Set up your club to get started</p>

        <div className="gate-options">
          <button className="gate-option-btn" onClick={() => navigate('/club/create')}>
            <span className="gate-option-icon gate-option-icon-create">
              <PlusIcon />
            </span>
            <div className="gate-option-text">
              <span className="gate-option-title">Create a Club</span>
              <span className="gate-option-sub">Start a new club and invite your members</span>
            </div>
          </button>

          <button className="gate-option-btn" onClick={() => navigate('/club/join')}>
            <span className="gate-option-icon gate-option-icon-join">
              <HashIcon />
            </span>
            <div className="gate-option-text">
              <span className="gate-option-title">Join a Club</span>
              <span className="gate-option-sub">Enter a code to join an existing club</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
