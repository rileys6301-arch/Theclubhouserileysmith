import { useNavigate } from 'react-router-dom';
import AppNav from '../components/AppNav';
import { font, space, radius } from '../tokens.js';

function LiveIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4" />
      <path d="M17.7 6.3a8 8 0 0 1 0 11.4" />
      <path d="M9.2 9.2a4 4 0 0 0 0 5.6" />
      <path d="M14.8 9.2a4 4 0 0 1 0 5.6" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M8 14h4M8 18h6" />
    </svg>
  );
}

export default function Play() {
  const navigate = useNavigate();

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 480 }}>
        <div className="page-header" style={{ marginBottom: space.lg }}>
          <h1 className="page-title">Play</h1>
          <p className="page-subtitle">How do you want to record your round?</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            className="play-card"
            onClick={() => navigate('/live')}
            style={{
              display: 'flex', alignItems: 'center', gap: 20,
              padding: '28px 24px', cursor: 'pointer',
              border: '1.5px solid var(--border-accent)',
              background: 'var(--bg-card)', borderRadius: 'var(--radius)',
              textAlign: 'left', width: '100%',
              boxShadow: 'var(--shadow-card)',
              transition: 'border-color 180ms ease, box-shadow 180ms ease',
            }}
          >
            <div style={{
              width: 60, height: 60, borderRadius: radius.lg,
              background: 'linear-gradient(135deg, var(--green-mid), var(--green-bright))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', flexShrink: 0,
              boxShadow: '0 4px 14px rgba(94,155,58,0.3)',
            }}>
              <LiveIcon />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: font.md, fontWeight: 700, color: 'var(--text-primary)' }}>Live Round</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: font.xs, fontWeight: 700, color: 'var(--green-bright)',
                  background: 'rgba(94,155,58,0.12)', borderRadius: radius.lg, padding: '2px 8px',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--green-bright)', display: 'inline-block',
                    animation: 'pulse-green 1.8s ease-in-out infinite',
                  }} />
                  LIVE
                </span>
              </div>
              <p style={{ fontSize: font.sm, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                Track your round hole by hole in real time
              </p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <button
            className="play-card"
            onClick={() => navigate('/log')}
            style={{
              display: 'flex', alignItems: 'center', gap: 20,
              padding: '28px 24px', cursor: 'pointer',
              border: '1.5px solid var(--border)',
              background: 'var(--bg-card)', borderRadius: 'var(--radius)',
              textAlign: 'left', width: '100%',
              boxShadow: 'var(--shadow-card)',
              transition: 'border-color 180ms ease, box-shadow 180ms ease',
            }}
          >
            <div style={{
              width: 60, height: 60, borderRadius: radius.lg,
              background: 'linear-gradient(135deg, var(--tan-dim), var(--tan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', flexShrink: 0,
              boxShadow: '0 4px 14px rgba(124,79,42,0.25)',
            }}>
              <PreviousIcon />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 5 }}>
                <span style={{ fontSize: font.md, fontWeight: 700, color: 'var(--text-primary)' }}>Log Round</span>
              </div>
              <p style={{ fontSize: font.sm, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                Enter scores from a round you already played
              </p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
}
