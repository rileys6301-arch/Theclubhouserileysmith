import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import AppNav from '../components/AppNav';
import RoundsChart from '../components/RoundsChart';
import ScorecardModal from '../components/ScorecardModal';
import { font, space, radius } from '../tokens.js';
import { Avatar } from '../components/ui/index.jsx';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtMember(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function trend(rounds) {
  if (rounds.length < 4) return null;
  const sorted  = [...rounds].sort((a, b) => a.played_at.localeCompare(b.played_at));
  const vals    = sorted.map(r => r.stableford);
  const recent  = avg(vals.slice(-3));
  const earlier = avg(vals.slice(0, -3));
  const delta   = recent - earlier;
  if (delta > 1)  return { label: 'Improving', dir: 'up',   color: 'var(--green-bright)' };
  if (delta < -1) return { label: 'Declining', dir: 'down', color: 'var(--error)' };
  return               { label: 'Steady',    dir: 'flat', color: 'var(--text-secondary)' };
}

// ─── Members list ─────────────────────────────────────────────────────────────

function MembersList() {
  const navigate  = useNavigate();
  const { activeClub, loadingClubs } = useClub();
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');

  useEffect(() => {
    if (!activeClub) { setLoading(false); setMembers([]); return; }
    setLoading(true);
    api.get(`/clubs/${activeClub.id}/members`)
      .then(setMembers)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeClub?.id]);

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 900 }}>
        <div className="page-header" style={{ marginBottom: 28 }}>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">{activeClub ? activeClub.name : 'Select a club to view members'}</p>
        </div>

        {loadingClubs || loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="spinner" />
          </div>
        ) : !activeClub ? (
          <div className="empty-state" style={{ paddingTop: 60 }}>
            <p className="empty-state-title">No club selected</p>
            <p className="empty-state-sub">Go to your profile and enter a club to see its members.</p>
            <button className="btn btn-primary" style={{ marginTop: space.md }} onClick={() => navigate('/profile')}>
              Go to Profile
            </button>
          </div>
        ) : error ? (
          <div className="form-error">{error}</div>
        ) : (
          <div className="member-grid">
            {members.map(m => (
              <div
                key={m.id}
                className="member-card"
                onClick={() => navigate(`/members/${m.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/members/${m.id}`)}
              >
                <div className="member-card-avatar">{playerInitials(m)}</div>
                <div className="member-card-name">{playerName(m)}</div>
                <div className="member-card-meta">
                  {m.handicap != null && (
                    <span className="handicap-badge" style={{ fontSize: font.xs }}>
                      HCP {Number(m.handicap).toFixed(1)}
                    </span>
                  )}
                  <span style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>
                    {m.rounds_played} round{m.rounds_played !== 1 ? 's' : ''}
                  </span>
                </div>
                <span className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>View Profile</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Member profile sub-components ───────────────────────────────────────────

function TrendArrow({ dir }) {
  if (dir === 'up')   return <span>↑</span>;
  if (dir === 'down') return <span>↓</span>;
  return <span>→</span>;
}

function StablefordBadge({ value }) {
  let color = 'var(--text-muted)';
  if (value >= 37) color = 'var(--green-bright)';
  else if (value >= 34) color = 'var(--text-primary)';
  return <span style={{ color, fontWeight: 600 }}>{value}</span>;
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: font.xs, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: 'var(--text-muted)', marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function StatCell({ label, value, accent, sub }) {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={accent ? { color: accent } : undefined}>
        {value ?? '—'}
      </span>
      {sub && <span style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</span>}
    </div>
  );
}

// Stacked bar showing eagle+/birdie/par/bogey/double+ distribution
function HoleDistribution({ member }) {
  const { total_eagles_plus, total_birdies, total_pars, total_bogeys, total_double_plus, total_holes } = member;
  if (!total_holes) return null;

  const types = [
    { label: 'Eagle+',  count: total_eagles_plus, color: '#C4A35A' },
    { label: 'Birdie',  count: total_birdies,      color: '#5E9B3A' },
    { label: 'Par',     count: total_pars,         color: '#888888' },
    { label: 'Bogey',   count: total_bogeys,       color: '#E09050' },
    { label: 'Double+', count: total_double_plus,  color: '#C0392B' },
  ];

  const pct = (n) => ((n / total_holes) * 100).toFixed(1);

  return (
    <div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 10, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 14, gap: 1 }}>
        {types.filter(t => t.count > 0).map(t => (
          <div key={t.label} style={{ flex: t.count, background: t.color, minWidth: 2 }}
            title={`${t.label}: ${t.count} (${pct(t.count)}%)`} />
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
        {types.map(t => (
          <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <span style={{ fontSize: font.xs, color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 700 }}>{t.label}</span>
              {' '}{t.count} <span style={{ color: 'var(--text-muted)' }}>({pct(t.count)}%)</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 10 }}>
        From {total_holes.toLocaleString()} holes with hole-by-hole data
      </div>
    </div>
  );
}

// Handicap trend sparkline — uses scoring differential (score-72)*0.96 per round
function HcpSparkline({ rounds, currentHcp }) {
  if (rounds.length < 3) return null;

  // rounds newest-first; reverse for chronological order, take last 20
  const chronological = [...rounds].reverse().slice(-20);
  const diffs = chronological.map(r => parseFloat(((r.score - 72) * 0.96).toFixed(1)));

  const allVals = currentHcp != null ? [...diffs, Number(currentHcp)] : diffs;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const W = 300, H = 56, PAD = 6;
  const xStep = diffs.length > 1 ? (W - PAD * 2) / (diffs.length - 1) : 0;
  const pts = diffs.map((d, i) => ({
    x: PAD + i * xStep,
    y: PAD + ((maxV - d) / range) * (H - PAD * 2),
  }));
  const ptStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const refY = currentHcp != null
    ? PAD + ((maxV - Number(currentHcp)) / range) * (H - PAD * 2)
    : null;

  // Direction: compare first half avg vs second half avg differential
  const half = Math.max(1, Math.floor(diffs.length / 2));
  const earlyAvg = diffs.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const recentAvg = diffs.slice(diffs.length - half).reduce((a, b) => a + b, 0) / half;
  const delta = recentAvg - earlyAvg;
  const dir = delta < -0.5 ? 'improving' : delta > 0.5 ? 'declining' : 'stable';
  const cfg = {
    improving: { label: 'Improving', color: 'var(--green-bright)', symbol: '↓' },
    declining:  { label: 'Declining',  color: 'var(--error)',        symbol: '↑' },
    stable:     { label: 'Stable',     color: 'var(--text-secondary)', symbol: '→' },
  }[dir];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: font.sm, fontWeight: 700, color: cfg.color }}>
          {cfg.symbol} {cfg.label}
        </span>
        {currentHcp != null && (
          <span style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>
            Current HCP: {Number(currentHcp).toFixed(1)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        {refY != null && (
          <line x1={PAD} y1={refY.toFixed(1)} x2={W - PAD} y2={refY.toFixed(1)}
            stroke="rgba(196,163,90,0.45)" strokeWidth="1.5" strokeDasharray="5,3" />
        )}
        <polyline points={ptStr} fill="none"
          stroke="var(--tan)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="2.5" fill="var(--tan)" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>Older</span>
        <span style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>
          {chronological.length} rounds · simplified differential
        </span>
        <span style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>Recent</span>
      </div>
    </div>
  );
}

// ─── Member profile ───────────────────────────────────────────────────────────

function MemberProfile({ id }) {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const { activeClub } = useClub();

  const [member,      setMember]      = useState(null);
  const [rounds,      setRounds]      = useState([]);
  const [holeStats,   setHoleStats]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [chartMode,   setChartMode]   = useState('stableford');
  const [scorecardId, setScorecardId] = useState(null);

  // Handicap editing
  const [editingHcp, setEditingHcp] = useState(false);
  const [hcpInput,   setHcpInput]   = useState('');
  const [hcpSaving,  setHcpSaving]  = useState(false);
  const [hcpError,   setHcpError]   = useState('');

  const canEditHcp = activeClub && ['owner', 'admin'].includes(activeClub.role) && user?.id !== id;

  useEffect(() => {
    Promise.allSettled([
      api.get(`/users/${id}`),
      api.get(`/users/${id}/rounds`),
      api.get(`/users/${id}/hole-stats`),
    ]).then(([m, r, h]) => {
      if (m.status === 'fulfilled') setMember(m.value);
      else setError(m.reason?.message || 'Failed to load profile');
      if (r.status === 'fulfilled') setRounds(r.value);
      if (h.status === 'fulfilled') setHoleStats(h.value);
      setLoading(false);
    });
  }, [id]);

  const chartRounds = useMemo(() => [...rounds].reverse(), [rounds]);
  const trendInfo   = useMemo(() => trend(rounds), [rounds]);
  const recentAvg   = useMemo(() => {
    const last5 = rounds.slice(0, 5).map(r => r.stableford);
    return last5.length >= 3 ? avg(last5).toFixed(1) : null;
  }, [rounds]);

  const bestHole  = useMemo(() => holeStats.length ? holeStats.reduce((b, h) => !b || h.avg_points > b.avg_points ? h : b, null) : null, [holeStats]);
  const worstHole = useMemo(() => holeStats.length ? holeStats.reduce((w, h) => !w || h.avg_points < w.avg_points ? h : w, null) : null, [holeStats]);

  const handleSaveHcp = async () => {
    const h = parseFloat(hcpInput);
    if (isNaN(h) || h < -10 || h > 54) { setHcpError('Enter a value between -10 and 54'); return; }
    setHcpSaving(true); setHcpError('');
    try {
      const { handicap } = await api.patch(`/users/${id}/handicap`, { handicap: h });
      setMember(prev => ({ ...prev, handicap }));
      setEditingHcp(false);
    } catch (err) {
      setHcpError(err.message);
    } finally {
      setHcpSaving(false);
    }
  };

  if (loading) return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <div className="spinner" />
        </div>
      </main>
    </div>
  );

  if (error || !member) return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content">
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Back
        </button>
        <div className="form-error" style={{ marginTop: space.md }}>{error || 'Player not found'}</div>
      </main>
    </div>
  );

  const hcp = member.handicap != null ? Number(member.handicap) : null;
  const avgNetScore = member.avg_score != null && hcp != null
    ? (Number(member.avg_score) - hcp).toFixed(1) : null;
  const bestNetScore = member.best_score != null && hcp != null
    ? member.best_score - hcp : null;

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content">
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginBottom: space.lg, fontSize: font.sm, color: 'var(--text-secondary)',
          }}
        >
          ← Back
        </button>

        {/* ── Identity ── */}
        <div className="card" style={{ marginBottom: space.md }}>
          <div className="profile-header">
            <Avatar name={playerName(member)} size={72} />
            <div className="profile-header-info">
              <div className="profile-name">{playerName(member)}</div>
              <div className="profile-email">{member.email}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {editingHcp ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" step="0.1" min="-10" max="54" className="form-input"
                      style={{ width: 90, height: 32, fontSize: font.sm, padding: '4px 10px' }}
                      value={hcpInput}
                      onChange={e => { setHcpInput(e.target.value); setHcpError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveHcp(); if (e.key === 'Escape') setEditingHcp(false); }}
                      autoFocus
                    />
                    <button className="btn btn-save btn-sm" style={{ height: 32, fontSize: font.xs }} disabled={hcpSaving} onClick={handleSaveHcp}>
                      {hcpSaving ? '…' : 'Save'}
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ height: 32, fontSize: font.xs }} onClick={() => setEditingHcp(false)}>
                      Cancel
                    </button>
                    {hcpError && <span style={{ fontSize: font.xs, color: 'var(--error)' }}>{hcpError}</span>}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="handicap-badge">
                      HCP {hcp != null ? hcp.toFixed(1) : '—'}
                    </span>
                    {canEditHcp && (
                      <button className="btn btn-ghost btn-sm"
                        style={{ height: 24, fontSize: font.xs, padding: `0 ${space.sm}px` }}
                        onClick={() => { setHcpInput(hcp != null ? String(hcp) : ''); setEditingHcp(true); }}
                      >
                        Edit HCP
                      </button>
                    )}
                  </div>
                )}
                <span className="member-since">Member since {fmtMember(member.created_at)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Stats ── */}
        {member.rounds_played > 0 && (
          <div className="card" style={{ marginBottom: space.md }}>

            {/* Scoring */}
            <SectionTitle>Scoring</SectionTitle>
            <div className="stat-grid" style={{ marginBottom: space.xl }}>
              <StatCell label="Avg Score (Gross)" value={member.avg_score != null ? Number(member.avg_score).toFixed(1) : null} />
              <StatCell label="Avg Score (Net)" value={avgNetScore} sub="est. using current HCP" />
              <StatCell label="Best Score (Gross)" value={member.best_score} />
              <StatCell label="Best Score (Net)" value={bestNetScore != null ? bestNetScore.toFixed(1) : null} sub="est. using current HCP" />
              <StatCell label="Avg vs Par"
                value={member.avg_vs_par != null ? (member.avg_vs_par > 0 ? `+${Number(member.avg_vs_par).toFixed(1)}` : Number(member.avg_vs_par).toFixed(1)) : null}
                accent={member.avg_vs_par != null && member.avg_vs_par < 0 ? 'var(--green-bright)' : undefined}
              />
            </div>

            <div className="divider" style={{ marginBottom: space.xl }} />

            {/* Stableford */}
            <SectionTitle>Stableford</SectionTitle>
            <div className="stat-grid" style={{ marginBottom: space.xl }}>
              <StatCell label="Avg Points / Round" value={member.avg_stableford != null ? Number(member.avg_stableford).toFixed(1) : null} />
              <StatCell label="Best Score" value={member.best_stableford} accent="var(--green-bright)" />
              <StatCell label="Points / Hole"
                value={member.points_per_hole != null ? Number(member.points_per_hole).toFixed(2) : null}
              />
              {recentAvg && <StatCell label="Recent Form (5 rounds)" value={recentAvg} />}
            </div>

            <div className="divider" style={{ marginBottom: space.xl }} />

            {/* Activity */}
            <SectionTitle>Activity</SectionTitle>
            <div className="stat-grid">
              <StatCell label="Total Rounds" value={member.rounds_played} />
              <StatCell label={`Rounds ${new Date().getFullYear()}`} value={member.rounds_this_year ?? 0} />
              <StatCell label={`Rounds ${new Date().getFullYear() - 1}`} value={member.rounds_last_year ?? 0} />
              <StatCell label="Courses Played" value={member.unique_courses ?? 0} />
              {member.last_played_at && (
                <StatCell
                  label="Last Round"
                  value={fmtDate(member.last_played_at)}
                  sub={member.last_score != null ? `${member.last_score} gross · ${member.last_stableford} pts` : undefined}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Hole performance ── */}
        {member.total_holes > 0 && (
          <div className="card" style={{ marginBottom: space.md }}>
            <SectionTitle>Hole Performance</SectionTitle>
            <HoleDistribution member={member} />

            {(bestHole || worstHole) && (
              <div style={{ display: 'flex', gap: space.md, marginTop: space.xl, flexWrap: 'wrap' }}>
                {bestHole && (
                  <div style={{
                    flex: 1, minWidth: 140, padding: '12px 16px',
                    background: 'rgba(94,155,58,0.06)', border: '1px solid rgba(94,155,58,0.18)',
                    borderRadius: 'calc(var(--radius) - 2px)',
                  }}>
                    <div style={{ fontSize: font.xs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--green-bright)', marginBottom: space.xs }}>
                      Best Hole
                    </div>
                    <div style={{ fontSize: font.lg, fontWeight: 800, color: 'var(--green-bright)' }}>
                      Hole {bestHole.hole_number}
                    </div>
                    <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                      {Number(bestHole.avg_points).toFixed(2)} avg pts ·{' '}
                      {bestHole.avg_vs_par >= 0 ? '+' : ''}{Number(bestHole.avg_vs_par).toFixed(2)} vs par
                    </div>
                  </div>
                )}
                {worstHole && worstHole.hole_number !== bestHole?.hole_number && (
                  <div style={{
                    flex: 1, minWidth: 140, padding: '12px 16px',
                    background: 'rgba(192,57,43,0.04)', border: '1px solid rgba(192,57,43,0.14)',
                    borderRadius: 'calc(var(--radius) - 2px)',
                  }}>
                    <div style={{ fontSize: font.xs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--error)', marginBottom: space.xs }}>
                      Toughest Hole
                    </div>
                    <div style={{ fontSize: font.lg, fontWeight: 800, color: 'var(--error)' }}>
                      Hole {worstHole.hole_number}
                    </div>
                    <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                      {Number(worstHole.avg_points).toFixed(2)} avg pts ·{' '}
                      {worstHole.avg_vs_par >= 0 ? '+' : ''}{Number(worstHole.avg_vs_par).toFixed(2)} vs par
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Handicap trend ── */}
        {rounds.length >= 3 && (
          <div className="card" style={{ marginBottom: space.md }}>
            <SectionTitle>Handicap Trend</SectionTitle>
            <HcpSparkline rounds={rounds} currentHcp={hcp} />
          </div>
        )}

        {/* ── Score chart ── */}
        {chartRounds.length >= 2 && (
          <div className="card" style={{ marginBottom: space.md }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="card-title" style={{ marginBottom: 0 }}>
                  {chartMode === 'stableford' ? 'Stableford Trend' : 'Score Over Time'}
                </span>
                {trendInfo && chartMode === 'stableford' && (
                  <span className="trend-badge" style={{ color: trendInfo.color }}>
                    <TrendArrow dir={trendInfo.dir} /> {trendInfo.label}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: radius.sm, padding: 3, gap: 2 }}>
                {['stableford', 'score'].map(m => (
                  <button key={m} onClick={() => setChartMode(m)} style={{
                    fontSize: font.xs, fontWeight: 600, padding: '4px 10px', borderRadius: radius.sm,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: chartMode === m ? 'var(--bg-surface)' : 'transparent',
                    color: chartMode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: chartMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}>
                    {m === 'stableford' ? 'Stableford' : 'Gross Score'}
                  </button>
                ))}
              </div>
            </div>
            <RoundsChart rounds={chartRounds} mode={chartMode} />
            <div className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: chartMode === 'score' ? 'var(--tan)' : 'var(--green-bright)' }} />
                {chartMode === 'stableford' ? 'Stableford pts' : 'Gross strokes'}
              </span>
              <span className="chart-legend-item muted">
                <span className="chart-legend-dash" />
                Par ({chartMode === 'stableford' ? 36 : 72})
              </span>
              {chartMode === 'score' && (
                <span style={{ fontSize: font.xs, color: 'var(--text-muted)', marginLeft: 'auto' }}>lower is better</span>
              )}
            </div>
          </div>
        )}

        {/* ── Round history ── */}
        <div className="card">
          <span className="card-title" style={{ marginBottom: 16, display: 'block' }}>Round History</span>
          {rounds.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No rounds yet</p>
              <p className="empty-state-sub">This player hasn't logged any rounds.</p>
            </div>
          ) : (
            <div className="rounds-table-wrap">
              <table className="rounds-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Course</th>
                    <th className="num">Score</th>
                    <th className="num">Stableford</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map(r => (
                    <tr
                      key={r.id}
                      title={r.notes || 'Tap to view scorecard'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setScorecardId(r.id)}
                    >
                      <td className="date-cell">{fmtDate(r.played_at)}</td>
                      <td className="course-cell">{r.course_name}</td>
                      <td className="num">{r.score}</td>
                      <td className="num"><StablefordBadge value={r.stableford} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {scorecardId && (
          <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
        )}
      </main>
    </div>
  );
}

// ─── Route switcher ───────────────────────────────────────────────────────────

export default function Members() {
  const { id } = useParams();
  if (id) return <MemberProfile id={id} />;
  return <MembersList />;
}
