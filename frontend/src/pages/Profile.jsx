import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import RoundsChart from '../components/RoundsChart';

// ─── Helpers ────────────────────────────────────────────────────────────────

function initials(user) {
  if (user.first_name || user.last_name) {
    return `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase();
  }
  return user.email[0].toUpperCase();
}

function displayName(user) {
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(' ');
  }
  return user.email;
}

function localDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(dateStr) {
  return localDate(dateStr).toLocaleDateString('en-US', {
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

// ─── Sub-components ─────────────────────────────────────────────────────────

function StablefordBadge({ value }) {
  let color = 'var(--text-muted)';
  if (value >= 37) color = 'var(--green-bright)';
  else if (value >= 34) color = 'var(--text-primary)';
  return <span style={{ color, fontWeight: 600 }}>{value}</span>;
}

function TrendArrow({ dir }) {
  if (dir === 'up')   return <span>↑</span>;
  if (dir === 'down') return <span>↓</span>;
  return <span>→</span>;
}

function StatBar({ rounds }) {
  const stats = useMemo(() => {
    if (!rounds.length) return null;
    const sfords = rounds.map(r => r.stableford);
    const scores  = rounds.map(r => r.score);
    const last10  = sfords.slice(0, 10);
    return {
      total:       rounds.length,
      bestScore:   Math.min(...scores),
      bestStblf:   Math.max(...sfords),
      avgStblf:    (avg(last10)).toFixed(1),
      last10Count: last10.length,
    };
  }, [rounds]);

  if (!stats) return null;

  return (
    <div className="stat-bar">
      <div className="stat-bar-item">
        <span className="stat-bar-value">{stats.total}</span>
        <span className="stat-bar-label">Rounds</span>
      </div>
      <div className="stat-bar-divider" />
      <div className="stat-bar-item">
        <span className="stat-bar-value">{stats.bestScore}</span>
        <span className="stat-bar-label">Best Score</span>
      </div>
      <div className="stat-bar-divider" />
      <div className="stat-bar-item">
        <span className="stat-bar-value green">{stats.bestStblf}</span>
        <span className="stat-bar-label">Best Stableford</span>
      </div>
      <div className="stat-bar-divider" />
      <div className="stat-bar-item">
        <span className="stat-bar-value">{stats.avgStblf}</span>
        <span className="stat-bar-label">Avg Stableford (last {stats.last10Count})</span>
      </div>
    </div>
  );
}

function EditProfileForm({ user, onSave, onCancel }) {
  const [form,   setForm]   = useState({ firstName: user.first_name ?? '', lastName: user.last_name ?? '', handicap: user.handicap != null ? String(user.handicap) : '' });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updated = await api.patch('/users/profile', {
        firstName: form.firstName.trim() || null,
        lastName:  form.lastName.trim()  || null,
        handicap:  form.handicap !== '' ? parseFloat(form.handicap) : null,
      });
      onSave(updated);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="form-error" style={{ marginBottom: 16 }}><ErrIcon />{error}</div>}
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">First name</label>
          <input className="form-input" type="text" value={form.firstName} onChange={set('firstName')} placeholder="First name" />
        </div>
        <div className="form-group">
          <label className="form-label">Last name</label>
          <input className="form-input" type="text" value={form.lastName} onChange={set('lastName')} placeholder="Last name" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Handicap Index</label>
        <input className="form-input" type="number" step="0.1" min="-10" max="54"
          value={form.handicap} onChange={set('handicap')} placeholder="e.g. 12.4" />
      </div>
      <div className="edit-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-secondary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Profile() {
  const { user, updateUser } = useAuth();

  const [rounds,   setRounds]   = useState([]);
  const [rLoading, setRLoading] = useState(true);
  const [rError,   setRError]   = useState('');
  const [editing,  setEditing]  = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    api.get('/rounds')
      .then(setRounds)
      .catch((err) => setRError(err.message))
      .finally(() => setRLoading(false));
  }, []);

  const handleDelete = async (id) => {
    setDeleteId(id);
    try {
      await api.delete(`/rounds/${id}`);
      setRounds(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteId(null);
    }
  };

  const handleProfileSaved = (updated) => {
    updateUser(updated);
    setEditing(false);
  };

  const chartRounds = useMemo(() => [...rounds].reverse(), [rounds]);
  const trendInfo   = useMemo(() => trend(rounds), [rounds]);

  return (
    <div className="app-layout">
      <AppNav />

      <main className="main-content">

        {/* ── Profile header ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="profile-header">
            <div className="avatar">{initials(user)}</div>
            <div className="profile-header-info">
              <div className="profile-name">{displayName(user)}</div>
              <div className="profile-email">{user.email}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                {user.handicap != null && (
                  <span className="handicap-badge">HCP {Number(user.handicap).toFixed(1)}</span>
                )}
                <span className="member-since">Member since {fmtMember(user.created_at)}</span>
              </div>
            </div>
            {!editing && (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
            )}
          </div>

          {editing && (
            <>
              <div className="divider" />
              <EditProfileForm user={user} onSave={handleProfileSaved} onCancel={() => setEditing(false)} />
            </>
          )}
        </div>

        {/* ── Stats bar ── */}
        {rounds.length > 0 && <StatBar rounds={rounds} />}

        {/* ── Trends chart ── */}
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

        {/* ── Round history ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Round History</span>
            <Link to="/log" className="btn btn-add">+ Log round</Link>
          </div>

          {rLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <div className="spinner" />
            </div>
          ) : rError ? (
            <div className="form-error" style={{ marginTop: 16 }}><ErrIcon />{rError}</div>
          ) : rounds.length === 0 ? (
            <div className="empty-state">
              <FlagIcon />
              <p className="empty-state-title">No rounds yet</p>
              <p className="empty-state-sub">Log your first round to start tracking your game.</p>
              <Link to="/log" className="btn btn-add" style={{ marginTop: 16 }}>+ Log round</Link>
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
                    <th className="del" />
                  </tr>
                </thead>
                <tbody>
                  {rounds.map(r => (
                    <tr key={r.id} title={r.notes || undefined}>
                      <td className="date-cell">{fmtDate(r.played_at)}</td>
                      <td className="course-cell">{r.course_name}</td>
                      <td className="num">{r.score}</td>
                      <td className="num"><StablefordBadge value={r.stableford} /></td>
                      <td className="del">
                        <button
                          className="btn-delete"
                          onClick={() => handleDelete(r.id)}
                          disabled={deleteId === r.id}
                          aria-label="Delete round"
                        >
                          {deleteId === r.id ? '…' : <TrashIcon />}
                        </button>
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

// ─── Icons ───────────────────────────────────────────────────────────────────

function ErrIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22V4" /><path d="M4 4l14 5-14 5" />
    </svg>
  );
}
