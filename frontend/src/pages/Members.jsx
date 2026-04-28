import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
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

// ─── Members list ─────────────────────────────────────────────────────────────

function MembersList() {
  const navigate  = useNavigate();
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');

  useEffect(() => {
    api.get('/users')
      .then(setMembers)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 900 }}>
        <div className="page-header" style={{ marginBottom: 28 }}>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">All club members</p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="spinner" />
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

function MemberProfile({ id }) {
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
      else setError(m.reason?.message || 'Failed to load member');

      if (r.status === 'fulfilled') setRounds(r.value);

      setLoading(false);
    });
  }, [id]);

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
        <Link to="/members" className="back-link">← Back to Members</Link>
        <div className="form-error" style={{ marginTop: 16 }}>{error || 'Member not found'}</div>
      </main>
    </div>
  );

  const chartRounds = [...rounds].reverse();

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content">
        <Link to="/members" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
          ← Back to Members
        </Link>

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

          {/* Stats grid */}
          {member.rounds_played > 0 && (
            <>
              <div className="divider" />
              <div className="stat-grid">
                <div className="stat-item">
                  <span className="stat-label">Rounds</span>
                  <span className="stat-value">{member.rounds_played}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Avg Stableford</span>
                  <span className="stat-value green">{member.avg_stableford ?? '—'}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Best Stableford</span>
                  <span className="stat-value">{member.best_stableford ?? '—'}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Best Score</span>
                  <span className="stat-value">{member.best_score ?? '—'}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chart */}
        {chartRounds.length >= 2 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <span className="card-title" style={{ marginBottom: 20, display: 'block' }}>Stableford Trend</span>
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
          <span className="card-title" style={{ marginBottom: 0, display: 'block', marginBottom: 16 }}>Round History</span>
          {rounds.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No rounds yet</p>
              <p className="empty-state-sub">This member hasn't logged any rounds.</p>
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
                      <td className="num" style={{ fontWeight: 600, color: r.stableford >= 37 ? 'var(--green)' : r.stableford >= 34 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {r.stableford}
                      </td>
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
