import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import { font, space, radius } from '../tokens.js';

function playerName(u) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.email;
}

function fmtDate(str) {
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
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

// ─── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab({ clubId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [editing, setEditing] = useState({});
  const [saving,  setSaving]  = useState({});
  const [saveErr, setSaveErr] = useState({});

  useEffect(() => {
    api.get(`/clubs/${clubId}/members`)
      .then(setMembers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [clubId]);

  const startEdit = (m) => {
    setEditing(prev => ({ ...prev, [m.id]: m.handicap != null ? String(Number(m.handicap).toFixed(1)) : '' }));
  };

  const cancelEdit = (id) => {
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
    setSaveErr(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const saveHandicap = async (m) => {
    const val = editing[m.id];
    const h = parseFloat(val);
    if (isNaN(h) || h < -10 || h > 54) {
      setSaveErr(prev => ({ ...prev, [m.id]: 'Must be between -10 and 54' }));
      return;
    }
    setSaving(prev => ({ ...prev, [m.id]: true }));
    setSaveErr(prev => { const n = { ...prev }; delete n[m.id]; return n; });
    try {
      const updated = await api.patch(`/users/${m.id}/handicap`, { handicap: h });
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, handicap: updated.handicap } : x));
      cancelEdit(m.id);
    } catch (err) {
      setSaveErr(prev => ({ ...prev, [m.id]: err.message }));
    } finally {
      setSaving(prev => ({ ...prev, [m.id]: false }));
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><div className="spinner" /></div>;
  if (error)   return <div className="form-error" style={{ margin: 24 }}>{error}</div>;

  return (
    <div className="rounds-table-wrap" style={{ marginTop: 0 }}>
      <table className="rounds-table">
        <thead>
          <tr>
            <th>Member</th>
            <th className="num">Rounds</th>
            <th className="num">Handicap</th>
            <th style={{ width: 140 }}></th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => {
            const ed = editing[m.id];
            return (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{playerName(m)}</div>
                  <div style={{ fontSize: font.xs, color: 'var(--text-muted)' }}>{m.email}</div>
                </td>
                <td className="num">{m.rounds_played}</td>
                <td className="num">
                  {ed !== undefined ? (
                    <input
                      type="number" step="0.1" min="-10" max="54"
                      value={ed}
                      onChange={e => setEditing(prev => ({ ...prev, [m.id]: e.target.value }))}
                      style={{ width: 64, textAlign: 'center', background: 'var(--bg-elevated)', border: '1.5px solid var(--border-focus)', borderRadius: radius.sm, color: 'var(--text-primary)', fontSize: font.sm, padding: '4px 6px' }}
                    />
                  ) : (
                    m.handicap != null
                      ? Number(m.handicap).toFixed(1)
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {saveErr[m.id] && (
                    <span style={{ fontSize: font.xs, color: 'var(--error)', display: 'block', marginBottom: space.xs }}>
                      {saveErr[m.id]}
                    </span>
                  )}
                  {ed !== undefined ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => cancelEdit(m.id)}>Cancel</button>
                      <button
                        className="btn btn-save"
                        style={{ height: 32, fontSize: font.xs, padding: '0 12px' }}
                        disabled={saving[m.id]}
                        onClick={() => saveHandicap(m)}
                      >
                        {saving[m.id] ? '…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(m)}>
                      Edit HCP
                    </button>
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

function RoundsTab({ clubId }) {
  const [rounds,   setRounds]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.get(`/clubs/${clubId}/admin/rounds`)
      .then(setRounds)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [clubId]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this round? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.delete(`/clubs/${clubId}/admin/rounds/${id}`);
      setRounds(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><div className="spinner" /></div>;
  if (error)   return <div className="form-error" style={{ margin: 24 }}>{error}</div>;
  if (!rounds.length) return <p style={{ padding: space.lg, fontSize: font.sm, color: 'var(--text-muted)' }}>No rounds logged yet.</p>;

  return (
    <div className="rounds-table-wrap" style={{ marginTop: 0 }}>
      <table className="rounds-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Course</th>
            <th className="num">Date</th>
            <th className="num">Score</th>
            <th className="num">Pts</th>
            <th style={{ width: 50 }}></th>
          </tr>
        </thead>
        <tbody>
          {rounds.map(r => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <div style={{ fontWeight: 500, fontSize: font.sm }}>{playerName(r)}</div>
              </td>
              <td className="course-cell" style={{ maxWidth: 180 }}>{r.course_name}</td>
              <td className="num date-cell">{fmtDate(r.played_at)}</td>
              <td className="num">{r.score}</td>
              <td className="num" style={{ color: 'var(--green-bright)', fontWeight: 600 }}>{r.stableford}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn-delete"
                  disabled={deleting === r.id}
                  onClick={() => handleDelete(r.id)}
                >
                  {deleting === r.id ? '…' : <DeleteIcon />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClubAdmin() {
  const { activeClub } = useClub();
  const navigate = useNavigate();
  const [tab, setTab] = useState('members');

  const isAuthorised = activeClub?.role === 'owner' || activeClub?.role === 'admin';

  if (!activeClub) {
    return (
      <div className="app-layout">
        <AppNav />
        <main className="main-content" style={{ maxWidth: 680 }}>
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <p className="empty-state-title">No club selected</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/profile')}>
              Go to Profile
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthorised) {
    navigate('/club/settings', { replace: true });
    return null;
  }

  const tabStyle = (active) => ({
    padding: `${space.sm}px 18px`,
    borderRadius: radius.sm,
    fontSize: font.sm,
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
        <div className="page-header" style={{ marginBottom: space.lg }}>
          <button
            onClick={() => navigate('/club/settings')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: font.sm, marginBottom: space.sm, display: 'block' }}
          >
            ← Club Settings
          </button>
          <h1 className="page-title">Club Admin</h1>
          <p className="page-subtitle">{activeClub.name}</p>
        </div>

        <div style={{ display: 'flex', gap: space.xs, marginBottom: space.xl, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: radius.md, padding: space.xs, width: 'fit-content' }}>
          <button style={tabStyle(tab === 'members')} onClick={() => setTab('members')}>Members</button>
          <button style={tabStyle(tab === 'rounds')}  onClick={() => setTab('rounds')}>Rounds</button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tab === 'members' && <MembersTab clubId={activeClub.id} />}
          {tab === 'rounds'  && <RoundsTab  clubId={activeClub.id} />}
        </div>
      </main>
    </div>
  );
}
