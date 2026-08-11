import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import { font, space, radius } from '../tokens.js';
import { Avatar, EmptyState } from '../components/ui/index.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function playerName(u) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.email;
}

function playerInitials(u) {
  if (u.first_name || u.last_name) {
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  }
  return u.email[0].toUpperCase();
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function relativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

// ─── SVG Icons (Lucide-style, stroke-width 2.2) ───────────────────────────────

function IconTrophy({ size = 16, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4H4a1 1 0 0 0-1 1v3c0 2.2 1.8 4 4 4" />
      <path d="M17 4h3a1 1 0 0 1 1 1v3c0 2.2-1.8 4-4 4" />
      <path d="M6 4v7a6 6 0 0 0 12 0V4H6z" />
    </svg>
  );
}

function IconMedal({ size = 16, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="15" r="5" />
      <path d="M8.5 8.5 7 4l5 3 5-3-1.5 4.5" />
    </svg>
  );
}

function IconSend({ size = 16, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconKey({ size = 14, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function IconSettings({ size = 16, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconChevronRight({ size = 12, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconChevronDown({ size = 14, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconPlus({ size = 14, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconPencil({ size = 13, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash({ size = 13, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function IconBook({ size = 16, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function IconHelpCircle({ size = 22, stroke = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const S = {
  card: {
    background: '#fff',
    borderRadius: 20,
    border: '0.5px solid rgba(0,0,0,0.07)',
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '16px 18px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  viewAll: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 12,
    fontWeight: 600,
    color: '#3d6b1f',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  row: {
    borderTop: '0.5px solid rgba(0,0,0,0.05)',
  },
};

// ─── Rank badge (preserved) ───────────────────────────────────────────────────

function RankBadge({ rank }) {
  const styles = {
    1: { background: 'linear-gradient(135deg, var(--tan), var(--tan-light))', color: '#fff', fontWeight: 800 },
    2: { background: 'rgba(0,0,0,0.06)', color: 'var(--text-secondary)', borderColor: 'rgba(0,0,0,0.1)' },
    3: { background: 'linear-gradient(135deg, var(--tan-dim), var(--tan))', color: '#fff' },
  };
  const style = styles[rank] ?? {};
  return (
    <span className="lb-rank-badge" style={style}>
      {rank}
    </span>
  );
}

// ─── Leaderboard table (preserved) ────────────────────────────────────────────

function Leaderboard({ rows }) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '24px 0' }}>No rounds played yet.</p>;
  return (
    <div className="rounds-table-wrap" style={{ marginTop: space.md }}>
      <table className="lb-table">
        <thead>
          <tr>
            <th className="lb-rank-col">Rank</th>
            <th>Player</th>
            <th className="num lb-hide-mobile">HCP</th>
            <th className="num lb-hide-mobile">Rounds</th>
            <th className="num">Best 6 Avg</th>
            <th className="num lb-hide-mobile">Best Pts</th>
            <th className="num lb-hide-mobile">Best Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={u.id} className="lb-row" onClick={() => navigate(`/members/${u.id}`)} style={{ cursor: 'pointer' }}>
              <td className="lb-rank-col"><RankBadge rank={i + 1} /></td>
              <td>
                <div className="lb-player-cell">
                  <div className="lb-avatar">{playerInitials(u)}</div>
                  <span>{playerName(u)}</span>
                </div>
              </td>
              <td className="num lb-hide-mobile">{u.handicap != null ? Number(u.handicap).toFixed(1) : '—'}</td>
              <td className="num lb-hide-mobile">{u.rounds_played}</td>
              <td className="num" style={{ fontWeight: 700, color: 'var(--green-mid)' }}>{u.avg_stableford ?? '—'}</td>
              <td className="num lb-hide-mobile">{u.best_stableford ?? '—'}</td>
              <td className="num lb-hide-mobile">{u.best_score ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Birdie tracker (preserved) ───────────────────────────────────────────────

function BirdieTracker({ rows }) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '16px 0' }}>No birdie data yet.</p>;
  return (
    <ul className="birdie-list">
      {rows.map((u, i) => (
        <li key={u.id} className="birdie-row" onClick={() => navigate(`/members/${u.id}`)} style={{ cursor: 'pointer' }}>
          <span className="birdie-rank">{i + 1}</span>
          <div className="lb-player-cell" style={{ flex: 1 }}>
            <div className="lb-avatar" style={{ width: 28, height: 28, fontSize: font.xs, flexShrink: 0 }}>{playerInitials(u)}</div>
            <span style={{ fontSize: font.sm }}>{playerName(u)}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="birdie-pill">{u.birdies} birdie{u.birdies !== 1 ? 's' : ''}</span>
            {u.eagles_plus > 0 && (
              <span className="birdie-pill" style={{ background: 'rgba(196,163,90,0.12)', color: 'var(--tan)', borderColor: 'rgba(196,163,90,0.22)' }}>
                {u.eagles_plus} eagle{u.eagles_plus !== 1 ? 's' : ''}+
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Best rounds (preserved) ──────────────────────────────────────────────────

function BestRounds({ rows }) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '16px 0' }}>No rounds yet.</p>;
  return (
    <ol className="best-round-list">
      {rows.map((r, i) => (
        <li key={r.id} className="best-round-row" onClick={() => navigate(`/members/${r.user_id}`)} style={{ cursor: 'pointer' }}>
          <span className="best-round-rank">{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: font.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.first_name || r.last_name ? [r.first_name, r.last_name].filter(Boolean).join(' ') : r.email}
            </div>
            <div style={{ fontSize: font.xs, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.course_name} · {fmtDate(r.played_at)}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--green-bright)' }}>{r.stableford}</div>
            <div style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>{r.score} gross</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Delete icon (preserved) ──────────────────────────────────────────────────

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

// ─── Live Now (preserved) ─────────────────────────────────────────────────────

function LiveNow({ rounds }) {
  if (!rounds.length) return null;

  function name(r) {
    if (r.first_name || r.last_name) return [r.first_name, r.last_name].filter(Boolean).join(' ');
    return r.email;
  }
  function initials(r) {
    if (r.first_name || r.last_name) {
      return `${r.first_name?.[0] ?? ''}${r.last_name?.[0] ?? ''}`.toUpperCase();
    }
    return r.email?.[0]?.toUpperCase() ?? '?';
  }

  return (
    <section className="home-section" style={{ borderColor: 'rgba(94,155,58,0.25)' }}>
      <div className="home-section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="live-pulse-dot" />
          <h2 className="home-section-title">Live Now</h2>
        </div>
        <span className="home-section-sub" style={{ alignSelf: 'center' }}>
          {rounds.length} player{rounds.length !== 1 ? 's' : ''} on the course
        </span>
      </div>
      <div className="live-now-list">
        {rounds.map(r => (
          <div key={r.id} className="live-now-row">
            <Avatar name={name(r)} size={36} />
            <div className="live-now-info">
              <span className="live-now-name">{name(r)}</span>
              <span className="live-now-meta">
                {r.course_name}
                {r.tee_name ? ` · ${r.tee_name}` : ''}
                {' · '}Hole {r.holes_played + 1}
              </span>
            </div>
            <div className="live-now-score">
              <span className="live-now-pts">{r.current_stableford}</span>
              <span className="live-now-pts-label">pts</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── No-club empty state (preserved) ─────────────────────────────────────────

function NoClubState() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
          strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      }
      title="No club selected"
      sub="Select a club from your profile to see the leaderboard, live rounds, and more."
      action="Go to Profile"
      onAction={() => navigate('/profile')}
    />
  );
}

// ─── Club hero ────────────────────────────────────────────────────────────────

function ClubHero({ activeClub, leaderboard, rules, season }) {
  const totalRounds = leaderboard.reduce((s, u) => s + (u.rounds_played || 0), 0);
  const estYear = activeClub.created_at ? new Date(activeClub.created_at).getFullYear() : null;

  const stats = [
    { value: activeClub.member_count ?? leaderboard.length, label: 'Members' },
    { value: totalRounds,                                    label: 'Rounds'  },
    { value: rules.length,                                   label: 'Rules'   },
    { value: season?.name ?? new Date().getFullYear(),        label: 'Season'  },
  ];

  return (
    <div style={{
      background: 'linear-gradient(160deg, #2a4a18 0%, #3d6b1f 60%, #4e8a27 100%)',
      borderRadius: 24,
      padding: '28px 22px 24px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Decorative glow */}
      <div style={{
        position: 'absolute', top: -60, right: -40,
        width: 220, height: 220, borderRadius: 110,
        background: 'radial-gradient(circle, rgba(255,255,255,0.07), transparent)',
        pointerEvents: 'none',
      }} />
      {/* Decorative ring */}
      <div style={{
        position: 'absolute', bottom: -40, left: -20,
        width: 160, height: 160, borderRadius: 80,
        border: '28px solid rgba(255,255,255,0.04)',
        pointerEvents: 'none',
      }} />

      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: -0.5, lineHeight: 1.15 }}>
            {activeClub.name}
          </div>
          {estYear && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500, marginTop: 3 }}>
              Est. {estYear}
            </div>
          )}
        </div>
        {activeClub.code && (
          <div style={{
            background: 'rgba(255,255,255,0.13)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 20,
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexShrink: 0,
          }}>
            <IconKey size={13} stroke="rgba(255,255,255,0.7)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.08em' }}>
              {activeClub.code}
            </span>
          </div>
        )}
      </div>

      {/* Stat strip */}
      <div style={{
        display: 'flex',
        marginTop: 22,
        paddingTop: 18,
        borderTop: '1px solid rgba(255,255,255,0.12)',
        position: 'relative',
      }}>
        {stats.map((stat, i) => (
          <div key={stat.label} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
            {i > 0 && (
              <div style={{
                position: 'absolute', left: 0, top: '10%',
                height: '80%', width: 0.5,
                background: 'rgba(255,255,255,0.15)',
              }} />
            )}
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: 3 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Notice Board (redesigned JSX, all state & handlers preserved) ────────────

function NoticeBoard({ notices: initialNotices, clubId }) {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [notices,    setNotices]    = useState(initialNotices);
  const [posting,    setPosting]    = useState(false);
  const [title,      setTitle]      = useState('');
  const [body,       setBody]       = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const handlePost = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !body.trim()) { setError('Title and body are required'); return; }
    setSaving(true);
    try {
      const notice = await api.post('/notices', { title: title.trim(), body: body.trim(), clubId });
      setNotices(prev => [notice, ...prev]);
      setTitle('');
      setBody('');
      setPosting(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/notices/${id}`);
      setNotices(prev => prev.filter(n => n.id !== id));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconSend size={15} stroke="#3d6b1f" />
          <span style={S.cardTitle}>Notice Board</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => { setPosting(p => !p); setError(''); }}
            style={{ fontSize: 12, fontWeight: 600, color: '#3d6b1f', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {posting ? 'Cancel' : 'Post'}
          </button>
          <button onClick={() => navigate('/members')} style={S.viewAll}>
            View all <IconChevronRight size={11} />
          </button>
        </div>
      </div>

      {/* Post form */}
      {posting && (
        <div style={{ padding: '0 18px 16px' }}>
          <form onSubmit={handlePost}>
            {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                className="form-input"
                type="text"
                placeholder="Notice title…"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Message</label>
              <textarea
                className="form-input notice-textarea"
                placeholder="Write your notice here…"
                value={body}
                onChange={e => setBody(e.target.value)}
                required
                rows={4}
              />
            </div>
            <div className="log-form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPosting(false)}>Cancel</button>
              <button type="submit" className="btn btn-save" disabled={saving}>
                {saving ? 'Posting…' : 'Post Notice'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Empty state */}
      {notices.length === 0 && !posting && (
        <div
          onClick={() => setPosting(true)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0 32px', cursor: 'pointer' }}
        >
          <IconSend size={32} stroke="#ccc" />
          <p style={{ fontSize: 13, color: '#ccc', margin: 0 }}>No notices yet — tap to add one</p>
        </div>
      )}

      {/* Notice rows */}
      {notices.map(n => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px', ...S.row }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: '#3d6b1f', flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{n.title}</div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginTop: 2 }}>{n.body}</div>
            <div style={{ fontSize: 10, color: '#ccc', marginTop: 4 }}>
              {n.first_name || n.last_name ? [n.first_name, n.last_name].filter(Boolean).join(' ') : n.email}
              {' · '}{relativeTime(n.created_at)}
            </div>
          </div>
          {n.user_id === user?.id && (
            <button
              onClick={() => handleDelete(n.id)}
              disabled={deletingId === n.id}
              aria-label="Delete notice"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', padding: 0, flexShrink: 0, marginTop: 1 }}
            >
              {deletingId === n.id ? '…' : <DeleteIcon />}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Leaderboard card ─────────────────────────────────────────────────────────

function PodiumCard({ user, rank, isCurrentUser, onClick }) {
  const avatarGrads = {
    1: 'linear-gradient(135deg, #c9a227, #a67c00)',
    2: 'linear-gradient(135deg, #7a8fa0, #5a6f80)',
    3: 'linear-gradient(135deg, #8a6240, #6b4a2a)',
  };
  const scoreColors  = { 1: '#c9a227', 2: '#7a8fa0', 3: '#8a6240' };
  const footerGrads  = {
    1: 'linear-gradient(135deg, #c9a227, #a67c00)',
    2: 'linear-gradient(135deg, #8a9bb0, #6b7d91)',
    3: 'linear-gradient(135deg, #8a6240, #6b4a2a)',
  };
  const firstName = playerName(user).split(' ')[0];

  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        transform: rank === 1 ? 'translateY(-8px)' : 'none',
        cursor: 'pointer',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 44, height: 44, borderRadius: 22,
        background: avatarGrads[rank],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{playerInitials(user)}</span>
      </div>

      {/* Body */}
      <div style={{
        width: '100%',
        background: isCurrentUser ? 'rgba(61,107,31,0.05)' : '#fff',
        borderRadius: '16px 16px 0 0',
        border: `0.5px solid ${isCurrentUser ? 'rgba(61,107,31,0.2)' : 'rgba(0,0,0,0.07)'}`,
        padding: '14px 10px 12px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {firstName}
        </div>
        {isCurrentUser && (
          <div style={{ fontSize: 9, color: '#3d6b1f', fontWeight: 600 }}>(You)</div>
        )}
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: scoreColors[rank], marginTop: 4 }}>
          {user.avg_stableford ?? '—'}
        </div>
        <div style={{ fontSize: 9, color: '#bbb' }}>best 3</div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 3 }}>
          HCP {user.handicap != null ? Number(user.handicap).toFixed(1) : '—'}
        </div>
      </div>

      {/* Footer strip */}
      <div style={{
        width: '100%',
        background: footerGrads[rank],
        padding: '8px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {rank === 1
          ? <IconTrophy size={12} stroke="rgba(255,255,255,0.85)" />
          : <IconMedal  size={12} stroke="rgba(255,255,255,0.85)" />
        }
        <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
          {rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}
        </span>
      </div>
    </div>
  );
}

function LeaderboardCard({ rows, currentUser, season, lbTab, setLbTab, lbExpanded, setLbExpanded, onSettings, navigate }) {
  const top3 = rows.slice(0, Math.min(3, rows.length));
  const rest = rows.slice(3);

  // Podium order: 2nd left · 1st centre · 3rd right
  const podiumOrder = top3.length === 0 ? [] :
    top3.length === 1 ? [[top3[0], 1]] :
    top3.length === 2 ? [[top3[1], 2], [top3[0], 1]] :
    [[top3[1], 2], [top3[0], 1], [top3[2], 3]];

  const listVisible = lbExpanded ? rest : rest.slice(0, 7);

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={{ ...S.cardHeader, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#aaa', marginBottom: 3 }}>
            {season?.name ?? 'Season'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconTrophy size={15} stroke="#3d6b1f" />
            <span style={{ ...S.cardTitle, fontSize: 17 }}>Leaderboard</span>
            <button
              onClick={onSettings}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', marginLeft: 2 }}
            >
              <IconSettings size={15} stroke="#bbb" />
            </button>
          </div>
        </div>
        <button onClick={() => navigate('/members')} style={S.viewAll}>
          View all <IconChevronRight size={11} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '0 18px 14px' }}>
        {[['current', 'Current'], ['season', 'Season']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setLbTab(key)}
            style={{
              padding: '6px 16px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              background: lbTab === key ? 'linear-gradient(135deg, #2a4a18, #3d6b1f)' : '#f5f2ed',
              color: lbTab === key ? '#fff' : '#888',
              transition: '150ms ease',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p style={{ padding: '16px 18px 24px', fontSize: 13, color: '#bbb', textAlign: 'center', margin: 0 }}>No rounds played yet.</p>
      ) : (
        <>
          {/* Podium */}
          <div style={{ display: 'flex', alignItems: 'flex-end', padding: '0 14px 16px', gap: 4 }}>
            {podiumOrder.map(([u, rank]) => (
              <PodiumCard
                key={u.id}
                user={u}
                rank={rank}
                isCurrentUser={u.id === currentUser?.id}
                onClick={() => navigate(`/members/${u.id}`)}
              />
            ))}
          </div>

          {/* List (4th+) */}
          {listVisible.map((u, i) => (
            <div
              key={u.id}
              onClick={() => navigate(`/members/${u.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', cursor: 'pointer', ...S.row }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ccc', width: 18, flexShrink: 0, textAlign: 'center' }}>
                {i + 4}
              </span>
              <div style={{
                width: 34, height: 34, borderRadius: 17, flexShrink: 0,
                background: 'linear-gradient(135deg, #4a6741, #6b8f60)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{playerInitials(u)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {playerName(u)}{u.id === currentUser?.id ? ' (You)' : ''}
                </div>
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>
                  HCP {u.handicap != null ? Number(u.handicap).toFixed(1) : '—'}
                </div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a', letterSpacing: -0.3, flexShrink: 0 }}>
                {u.avg_stableford ?? '—'}
              </div>
            </div>
          ))}

          {/* Expand / collapse */}
          {rest.length > 7 && (
            <div
              onClick={() => setLbExpanded(e => !e)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px 18px', cursor: 'pointer', ...S.row }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#3d6b1f' }}>
                {lbExpanded ? 'Show less' : `View all ${rows.length} players`}
              </span>
              <IconChevronDown
                size={14} stroke="#3d6b1f"
                style={{ transform: lbExpanded ? 'rotate(180deg)' : 'none', transition: '150ms ease' }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Hall of Fame card ────────────────────────────────────────────────────────

function HallOfFameCard({ navigate }) {
  return (
    <div style={{ ...S.card, cursor: 'pointer' }} onClick={() => navigate('/members')}>
      <div style={{ ...S.cardHeader, gap: 14, padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(201,162,39,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconTrophy size={22} stroke="#c9a227" />
          </div>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(192,57,43,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconHelpCircle size={22} stroke="#c0392b" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>Hall of Fame</div>
          <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>Top performers and club legends</div>
        </div>
        <IconChevronRight size={16} stroke="#ddd" />
      </div>
    </div>
  );
}

// ─── Tournaments card ─────────────────────────────────────────────────────────

function TournamentsCard({ tournaments, navigate, onCreate }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconMedal size={15} stroke="#3d6b1f" />
          <span style={S.cardTitle}>Tournaments</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onCreate}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'linear-gradient(135deg, #2a4a18, #3d6b1f)',
              color: '#fff', borderRadius: 20, padding: '6px 14px',
              fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            <IconPlus size={12} stroke="#fff" />
            Create
          </button>
          <button onClick={() => navigate('/competitions')} style={{ ...S.viewAll, border: '0.5px solid rgba(61,107,31,0.3)', borderRadius: 20, padding: '6px 14px' }}>
            View all <IconChevronRight size={11} />
          </button>
        </div>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0 28px' }}>
          <IconTrophy size={30} stroke="#ddd" />
          <p style={{ fontSize: 13, color: '#ccc', margin: 0 }}>No tournaments yet</p>
        </div>
      ) : (
        tournaments.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: '11px 18px', ...S.row }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{t.name}</div>
              {t.date && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{fmtDate(t.date)}</div>}
            </div>
            <IconChevronRight size={13} stroke="#ddd" />
          </div>
        ))
      )}
    </div>
  );
}

// ─── Club Rules card ──────────────────────────────────────────────────────────

function ClubRulesCard({ rules, onAdd, onEdit, onDelete }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconBook size={15} stroke="#3d6b1f" />
          <span style={S.cardTitle}>Club Rules</span>
          {rules.length > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: '#bbb', marginLeft: 5 }}>
              {rules.length}
            </span>
          )}
        </div>
        <button
          onClick={onAdd}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'transparent', color: '#3d6b1f',
            borderRadius: 20, padding: '7px 14px',
            fontSize: 12, fontWeight: 700,
            border: '1.5px solid #3d6b1f', cursor: 'pointer',
          }}
        >
          <IconPlus size={12} stroke="#3d6b1f" />
          Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0 28px' }}>
          <IconBook size={30} stroke="#ddd" />
          <p style={{ fontSize: 13, color: '#ccc', margin: 0 }}>No club rules yet</p>
        </div>
      ) : (
        rules.map((rule, i) => (
          <div key={rule.id} style={{ display: 'flex', gap: 14, padding: '14px 18px', ...S.row }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14, flexShrink: 0,
              background: 'linear-gradient(135deg, #2a4a18, #3d6b1f)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{i + 1}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>{rule.title}</div>
              <div style={{ fontSize: 12, color: '#666', lineHeight: 1.65 }}>{rule.body}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                <button
                  onClick={() => onEdit(rule)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <IconPencil size={13} stroke="#888" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Edit</span>
                </button>
                <button
                  onClick={() => window.confirm('Delete this rule?') && onDelete(rule.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <IconTrash size={13} stroke="#c0392b" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#c0392b' }}>Delete</span>
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { activeClub, loadingClubs } = useClub();
  const { user }                     = useAuth();
  const navigate                     = useNavigate();

  const [leaderboard, setLeaderboard] = useState([]);
  const [birdies,     setBirdies]     = useState([]);
  const [bestRounds,  setBestRounds]  = useState([]);
  const [notices,     setNotices]     = useState([]);
  const [liveRounds,  setLiveRounds]  = useState([]);
  const [season,      setSeason]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [errors,      setErrors]      = useState({});

  // New UI state
  const [lbTab,       setLbTab]       = useState('current');
  const [lbExpanded,  setLbExpanded]  = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [rules,       setRules]       = useState([]);

  useEffect(() => {
    if (!activeClub) {
      setLoading(false);
      setLeaderboard([]);
      setBirdies([]);
      setBestRounds([]);
      setNotices([]);
      return;
    }

    setLoading(true);
    const cq = `?club_id=${activeClub.id}`;

    Promise.allSettled([
      api.get(`/social/leaderboard${cq}`),
      api.get(`/social/birdies${cq}`),
      api.get(`/social/best-rounds${cq}`),
      api.get(`/notices${cq}`),
      api.get('/social/season'),
    ]).then(([lb, bi, br, no, se]) => {
      if (lb.status === 'fulfilled') setLeaderboard(lb.value);
      else setErrors(e => ({ ...e, leaderboard: lb.reason?.message }));

      if (bi.status === 'fulfilled') setBirdies(bi.value);
      else setErrors(e => ({ ...e, birdies: bi.reason?.message }));

      if (br.status === 'fulfilled') setBestRounds(br.value);
      else setErrors(e => ({ ...e, bestRounds: br.reason?.message }));

      if (no.status === 'fulfilled') setNotices(no.value);
      else setErrors(e => ({ ...e, notices: no.reason?.message }));

      if (se.status === 'fulfilled') setSeason(se.value);

      setLoading(false);
    });
  }, [activeClub?.id]);

  // Live rounds — poll every 30s when in a club
  useEffect(() => {
    if (!activeClub) { setLiveRounds([]); return; }
    const fetch = () => api.get(`/rounds/live?club_id=${activeClub.id}`).then(setLiveRounds).catch(() => {});
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, [activeClub?.id]);

  if (loadingClubs) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <AppNav />
      <main className="home-main" style={{ background: '#edeae4' }}>
        {!activeClub ? (
          <NoClubState />
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="spinner" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px 48px', maxWidth: 640, margin: '0 auto' }}>

            <LiveNow rounds={liveRounds} />

            <ClubHero
              activeClub={activeClub}
              leaderboard={leaderboard}
              rules={rules}
              season={season}
            />

            {errors.notices
              ? <div className="form-error">{errors.notices}</div>
              : <NoticeBoard notices={notices} clubId={activeClub?.id} />
            }

            {errors.leaderboard
              ? <div className="form-error">{errors.leaderboard}</div>
              : (
                <LeaderboardCard
                  rows={leaderboard}
                  currentUser={user}
                  season={season}
                  lbTab={lbTab}
                  setLbTab={setLbTab}
                  lbExpanded={lbExpanded}
                  setLbExpanded={setLbExpanded}
                  onSettings={() => navigate('/club/settings')}
                  navigate={navigate}
                />
              )
            }

            <HallOfFameCard navigate={navigate} />

            <TournamentsCard
              tournaments={tournaments}
              navigate={navigate}
              onCreate={() => navigate('/competitions')}
            />

            <ClubRulesCard
              rules={rules}
              onAdd={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
            />

          </div>
        )}
      </main>
    </div>
  );
}
