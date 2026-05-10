import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import Logo from './Logo';

// ─── Icons ───────────────────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M22 20c0-2.5-2.2-4.5-5-4.5" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M8 21h8M12 17v4" />
      <path d="M5 3H3v5a4 4 0 0 0 4 4h.5" />
      <path d="M19 3h2v5a4 4 0 0 1-4 4h-.5" />
      <path d="M6 3h12v8a6 6 0 0 1-12 0V3z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3L4 7v5c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7L12 3z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppNav() {
  const { user, logout } = useAuth();
  const { myClubs, activeClub, enterClub, exitClub } = useClub();
  const navigate = useNavigate();
  const [clubOpen, setClubOpen] = useState(false);
  const switcherRef = useRef(null);

  useEffect(() => {
    if (!clubOpen) return;
    const close = (e) => {
      if (!switcherRef.current?.contains(e.target)) setClubOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [clubOpen]);

  const handleSwitch = (clubId) => {
    enterClub(clubId);
    setClubOpen(false);
    navigate('/');
  };

  const handleExitClub = () => {
    exitClub();
    navigate('/profile');
  };

  const displayName = user
    ? (user.first_name || user.last_name
        ? [user.first_name, user.last_name].filter(Boolean).join(' ')
        : user.email)
    : '';

  const location = useLocation();
  const isPlayActive = ['/play', '/live', '/log'].includes(location.pathname);
  const tabClass    = ({ isActive }) => 'nav-tab' + (isActive ? ' active' : '');
  const bottomClass = ({ isActive }) => 'bottom-nav-item' + (isActive ? ' active' : '');
  const playTabClass    = () => 'nav-tab'          + (isPlayActive ? ' active' : '');
  const playBottomClass = () => 'bottom-nav-item'  + (isPlayActive ? ' active' : '');

  return (
    <>
      {/* ── Desktop / top nav ── */}
      <nav className="app-nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand">
            <Logo className="navbar-logo" />
          </Link>

          <div className="nav-club-switcher" ref={switcherRef}>
            <button
              className="nav-club-pill"
              onClick={() => setClubOpen(o => !o)}
              aria-expanded={clubOpen}
            >
              {activeClub ? activeClub.name : 'Select club'}
              <ChevronDownIcon />
            </button>

            {clubOpen && (
              <div className="nav-club-dropdown">
                {myClubs.length > 0 && (
                  <>
                    <div className="nav-club-dropdown-label">My Clubs</div>
                    {myClubs.map(c => (
                      <button
                        key={c.id}
                        className={'nav-club-dropdown-item' + (activeClub?.id === c.id ? ' active' : '')}
                        onClick={() => handleSwitch(c.id)}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        {activeClub?.id === c.id && <TickIcon />}
                      </button>
                    ))}
                    <div className="nav-club-dropdown-divider" />
                  </>
                )}
                <button className="nav-club-dropdown-item" onClick={() => { setClubOpen(false); navigate('/club/join'); }}>
                  Join a club
                </button>
                <button className="nav-club-dropdown-item" onClick={() => { setClubOpen(false); navigate('/club/create'); }}>
                  + Create a club
                </button>
              </div>
            )}
          </div>

          <div className="nav-tabs">
            <NavLink to="/" end className={tabClass}>Home</NavLink>
            <NavLink to="/play"         className={playTabClass}>Play</NavLink>
            <NavLink to="/profile"      className={tabClass}>My Profile</NavLink>
            <NavLink to="/members"      className={tabClass}>Members</NavLink>
            <NavLink to="/competitions" className={tabClass}>Competitions</NavLink>
            {activeClub && (
              <NavLink to="/club/settings" className={tabClass}>Club Settings</NavLink>
            )}
            {user?.is_admin && (
              <NavLink to="/admin" className={tabClass}>Admin</NavLink>
            )}
          </div>

          <div className="nav-user">
            <span className="nav-user-name">{displayName}</span>
            {activeClub && (
              <button className="btn btn-ghost btn-sm" onClick={handleExitClub}>
                Exit club
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      {/* ── Mobile bottom nav ── */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          <NavLink to="/" end className={bottomClass}>
            <HomeIcon />
            Home
          </NavLink>
          <NavLink to="/play" className={playBottomClass}>
            <PlayIcon />
            Play
          </NavLink>
          <NavLink to="/profile" className={bottomClass}>
            <ProfileIcon />
            Profile
          </NavLink>
          <NavLink to="/members" className={bottomClass}>
            <MembersIcon />
            Members
          </NavLink>
          <NavLink to="/competitions" className={bottomClass}>
            <TrophyIcon />
            Events
          </NavLink>
          {activeClub && (
            <NavLink to="/club/settings" className={bottomClass}>
              <GearIcon />
              Settings
            </NavLink>
          )}
          {user?.is_admin && (
            <NavLink to="/admin" className={bottomClass}>
              <ShieldIcon />
              Admin
            </NavLink>
          )}
        </div>
      </nav>
    </>
  );
}
