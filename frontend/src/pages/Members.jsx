import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useClub } from '../contexts/ClubContext';
import AppNav from '../components/AppNav';
import RoundsChart from '../components/RoundsChart';

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
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/profile')}>
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
                    <span className="handicap-badge" style={{ fontSize: 11 }}>
                      HCP {Number(m.handicap).toFixed(1)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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

// ─── Member profile ───────────────────────────────────────────────────────────

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

function MemberProfile({ id }) {
  const navigate = useNavigate();
  const [member, setMember]   = useState(null);
  const [rounds, setRounds]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    Promise.allSettled([
      api.get(`/users/${id}`),
      api.get(`/users/${id}/rounds`),
    ]).then(([m, r]) => {
      if (m.status === 'fulfilled') setMember(m.value);
      else setError(m.reason?.message || 'Failed to load profile');
      if (r.status === 'fulfilled') setRounds(r.value);
      setLoading(false);
    });
  }, [id]);

  const chartRounds = useMemo(() => [...rounds].reverse(), [rounds]);
  const trendInfo   = useMemo(() => trend(rounds), [rounds]);
  const recentAvg   = useMemo(() => {
    const last5 = rounds.slice(0, 5).map(r => r.stableford);
    return last5.length >= 3 ? avg(last5).toFixed(1) : null;
  }, [rounds]);

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
        <button className="back-link" onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Back
        </button>
        <div className="form-error" style={{ marginTop: 16 }}>{error || 'Player not found'}</div>
      </main>
    </div>
  );

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content">
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)',
          }}
        >
          ← Back
        </button>

        {/* Profile header */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="profile-header">
            <div className="avatar" style={{ width: 72, height: 72, fontSize: 26 }}>
              {playerInitials(member)}
            </div>
            <div className="profile-header-info">
              <div className="profile-name">{playerName(member)}</div>
              <div className="profile-email">{member.email}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                {member.handicap != null && (
                  <span className="handicap-badge">HCP {Number(member.handicap).toFixed(1)}</span>
                )}
                <span className="member-since">Member since {fmtMember(member.created_at)}</span>
              </div>
            </div>
          </div>

          {member.rounds_played > 0 && (
            <>
              <div className="divider" />
              <div className="stat-grid">
                <div className="stat-item">
                  <span className="stat-label">Rounds</span>
                  <span className="stat-value">{member.rounds_played}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Best Score</span>
                  <span className="stat-value">{member.best_score ?? '—'}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Best Stableford</span>
                  <span className="stat-value green">{member.best_stableford ?? '—'}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Avg Stableford</span>
                  <span className="stat-value">{member.avg_stableford ?? '—'}</span>
                </div>
                {recentAvg && (
                  <div className="stat-item">
                    <span className="stat-label">Recent Form (5)</span>
                    <span className="stat-value">{recentAvg}</span>
                  </div>
                )}
                {member.total_birdies > 0 && (
                  <div className="stat-item">
                    <span className="stat-label">Birdies</span>
                    <span className="stat-value">{member.total_birdies}</span>
                  </div>
                )}
                {member.total_eagles_plus > 0 && (
                  <div className="stat-item">
                    <span className="stat-label">Eagles+</span>
                    <span className="stat-value" style={{ color: 'var(--tan)' }}>{member.total_eagles_plus}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Trend chart */}
        {chartRounds.length >= 2 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span className="card-title" style={{ marginBottom: 0 }}>Stableford Trend</span>
              {trendInfo && (
                <span className="trend-badge" style={{ color: trendInfo.color }}>
                  <TrendArrow dir={trendInfo.dir} /> {trendInfo.label}
                </span>
              )}
            </div>
            <RoundsChart rounds={chartRounds} />
            <div className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-legend-dot" />
                Stableford pts
              </span>
              <span className="chart-legend-item muted">
                <span className="chart-legend-dash" />
                Par (36)
              </span>
            </div>
          </div>
        )}

        {/* Round history */}
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
                    <tr key={r.id} title={r.notes || undefined}>
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
