import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function playerName(u) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.email;
}

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Edit Round Modal ─────────────────────────────────────────────────────────

function EditRoundModal({ round, onClose, onSave }) {
  const [form, setForm] = useState({
    playedAt:   round.played_at?.slice(0, 10) ?? '',
    courseName: round.course_name ?? '',
    score:      String(round.score ?? ''),
    stableford: String(round.stableford ?? ''),
    notes:      round.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const updated = await api.patch(`/admin/rounds/${round.id}`, {
        playedAt:   form.playedAt,
        courseName: form.courseName,
        score:      parseInt(form.score),
        stableford: parseInt(form.stableford),
        notes:      form.notes,
      });
      onSave(updated);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Edit Round</h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>{playerName(round)}</p>

        {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.playedAt} onChange={e => set('playedAt', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Course</label>
          <input className="form-input" type="text" value={form.courseName} onChange={e => set('courseName', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Gross Score</label>
            <input className="form-input" type="number" value={form.score} onChange={e => set('score', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Stableford Pts</label>
            <input className="form-input" type="number" value={form.stableford} onChange={e => set('stableford', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" type="text" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-save" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 16,
};
const modal = {
  background: 'var(--bg-card)', border: '1px solid var(--border-accent)',
  borderRadius: 16, padding: 24, width: '100%', maxWidth: 440,
  boxShadow: 'var(--shadow-elevated)',
};
const closeBtn = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  cursor: 'pointer', fontSize: 16, padding: 4,
};

// ─── Season Tab ───────────────────────────────────────────────────────────────

function SeasonTab() {
  const [form,    setForm]    = useState({ name: '', start: '', end: '' });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/admin/season').then(s => {
      setForm({ name: s.name ?? '', start: s.start ?? '', end: s.end ?? '' });
    }).finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async (e) => {
    e.preventDefault();
    setError(''); setSaved(false); setSaving(true);
    try {
      await api.patch('/admin/season', {
        name:  form.name,
        start: form.start || null,
        end:   form.end   || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        The leaderboard ranks players by the average of their best 6 rounds within the season window.
        Leave start/end blank for all-time.
      </p>
      {error  && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saved  && <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--green-bright)', fontWeight: 600 }}>Saved!</div>}
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label className="form-label">Season Name</label>
          <input className="form-input" type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. 2025 Season" required />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input className="form-input" type="date" value={form.start} onChange={e => set('start', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date</label>
            <input className="form-input" type="date" value={form.end} onChange={e => set('end', e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn btn-save" disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Saving…' : 'Save Season'}
        </button>
      </form>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me } = useAuth();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState({}); // id → { handicap, isAdmin }
  const [saving,  setSaving]  = useState({});
  const [error,   setError]   = useState({});

  useEffect(() => {
    api.get('/admin/users').then(setUsers).finally(() => setLoading(false));
  }, []);

  const startEdit = (u) => {
    setEditing(prev => ({
      ...prev,
      [u.id]: { handicap: u.handicap != null ? String(u.handicap) : '', isAdmin: u.is_admin },
    }));
  };

  const setField = (id, k, v) => {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  };

  const save = async (u) => {
    const ed = editing[u.id];
    setSaving(prev => ({ ...prev, [u.id]: true }));
    setError(prev => ({ ...prev, [u.id]: '' }));
    try {
      const updated = await api.patch(`/admin/users/${u.id}`, {
        handicap: ed.handicap !== '' ? parseFloat(ed.handicap) : null,
        isAdmin:  ed.isAdmin,
      });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...updated } : x));
      setEditing(prev => { const n = { ...prev }; delete n[u.id]; return n; });
    } catch (err) {
      setError(prev => ({ ...prev, [u.id]: err.message }));
    } finally {
      setSaving(prev => ({ ...prev, [u.id]: false }));
    }
  };

  if (loading) return <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="rounds-table-wrap" style={{ marginTop: 0 }}>
      <table className="rounds-table">
        <thead>
          <tr>
            <th>Member</th>
            <th className="num">Rounds</th>
            <th className="num">Handicap</th>
            <th className="num">Admin</th>
            <th style={{ width: 100 }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const ed = editing[u.id];
            return (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{playerName(u)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                </td>
                <td className="num">{u.rounds_played}</td>
                <td className="num">
                  {ed ? (
                    <input
                      type="number" step="0.1" min="-10" max="54"
                      value={ed.handicap}
                      onChange={e => setField(u.id, 'handicap', e.target.value)}
                      style={{ width: 64, textAlign: 'center', background: 'var(--bg-elevated)', border: '1.5px solid var(--border-focus)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '4px 6px' }}
                    />
                  ) : (
                    u.handicap != null ? Number(u.handicap).toFixed(1) : <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="num">
                  {ed ? (
                    <input type="checkbox" checked={ed.isAdmin}
                      onChange={e => setField(u.id, 'isAdmin', e.target.checked)}
                      disabled={u.id === me?.id}
                    />
                  ) : (
                    u.is_admin ? <span style={{ color: 'var(--tan)', fontSize: 12, fontWeight: 700 }}>Yes</span> : '—'
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {error[u.id] && <span style={{ fontSize: 11, color: 'var(--error)', display: 'block', marginBottom: 4 }}>{error[u.id]}</span>}
                  {ed ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(prev => { const n = { ...prev }; delete n[u.id]; return n; })}>Cancel</button>
                      <button className="btn btn-save" style={{ height: 32, fontSize: 12, padding: '0 12px' }} disabled={saving[u.id]} onClick={() => save(u)}>
                        {saving[u.id] ? '…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(u)}>Edit</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Rounds Tab ───────────────────────────────────────────────────────────────

function RoundsTab() {
  const [rounds,  setRounds]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.get('/admin/rounds').then(setRounds).finally(() => setLoading(false));
  }, []);

  const handleSave = (updated) => {
    setRounds(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this round? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.delete(`/admin/rounds/${id}`);
      setRounds(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  return (
    <>
      {editing && (
        <EditRoundModal
          round={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      <div className="rounds-table-wrap" style={{ marginTop: 0 }}>
        <table className="rounds-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Course</th>
              <th className="num">Date</th>
              <th className="num">Score</th>
              <th className="num">Pts</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {rounds.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{playerName(r)}</div>
                </td>
                <td className="course-cell" style={{ maxWidth: 180 }}>{r.course_name}</td>
                <td className="num date-cell">{fmtDate(r.played_at)}</td>
                <td className="num">{r.score}</td>
                <td className="num" style={{ color: 'var(--green-bright)', fontWeight: 600 }}>{r.stableford}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '0 10px' }} onClick={() => setEditing(r)}>Edit</button>
                    <button className="btn-delete" disabled={deleting === r.id} onClick={() => handleDelete(r.id)}>
                      {deleting === r.id ? '…' : <DeleteIcon />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4h6v2" />
    </svg>
  );
}

// ─── Password gate ────────────────────────────────────────────────────────────

function AdminPasswordGate({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setChecking(true);
    try {
      await api.post('/admin/verify', { password });
      onUnlock();
    } catch {
      setError('Incorrect password');
      setChecking(false);
    }
  };

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 420 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">Enter the admin password to continue</p>
        </div>
        <div className="card">
          <form onSubmit={handleSubmit}>
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Admin Password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={checking}>
              {checking ? 'Verifying…' : 'Unlock Admin'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('users');

  if (!user?.is_admin) {
    navigate('/', { replace: true });
    return null;
  }

  if (!unlocked) {
    return <AdminPasswordGate onUnlock={() => setUnlocked(true)} />;
  }

  const tabStyle = (active) => ({
    padding: '8px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    background: active ? 'rgba(94,155,58,0.12)' : 'transparent',
    color: active ? 'var(--green-bright)' : 'var(--text-secondary)',
    transition: '180ms ease',
  });

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 900 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">Manage members and rounds</p>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
          <button style={tabStyle(tab === 'users')}  onClick={() => setTab('users')}>Members</button>
          <button style={tabStyle(tab === 'rounds')} onClick={() => setTab('rounds')}>Rounds</button>
          <button style={tabStyle(tab === 'season')} onClick={() => setTab('season')}>Season</button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tab === 'users'  && <UsersTab />}
          {tab === 'rounds' && <RoundsTab />}
          {tab === 'season' && <SeasonTab />}
        </div>
      </main>
    </div>
  );
}
