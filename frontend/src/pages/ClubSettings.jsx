import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import { font, space, radius } from '../tokens.js';

function fmtDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    upcoming:  { label: 'Upcoming',  color: 'var(--text-muted)',  bg: 'rgba(0,0,0,0.05)' },
    active:    { label: '● Live',    color: '#5E9B3A',            bg: 'rgba(94,155,58,0.1)' },
    completed: { label: 'Completed', color: 'var(--tan)',          bg: 'rgba(124,79,42,0.08)' },
  };
  const s = map[status] ?? { label: status, color: 'var(--text-muted)', bg: 'rgba(0,0,0,0.05)' };
  return (
    <span style={{
      fontSize: font.xs, fontWeight: 600, padding: '2px 8px', borderRadius: radius.lg,
      color: s.color, background: s.bg, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

// ─── Members section ─────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const map = {
    owner: { label: 'Owner', color: 'var(--tan)',         bg: 'rgba(124,79,42,0.1)' },
    admin: { label: 'Admin', color: 'var(--green-bright)', bg: 'rgba(94,155,58,0.1)' },
  };
  const s = map[role];
  if (!s) return null;
  return (
    <span style={{
      fontSize: font.xs, fontWeight: 700, padding: '2px 8px', borderRadius: radius.lg,
      color: s.color, background: s.bg,
    }}>{s.label}</span>
  );
}

function MembersSettings({ clubId }) {
  const navigate = useNavigate();
  const [members,    setMembers]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [togglingId, setTogglingId] = useState(null);

  useEffect(() => {
    api.get(`/clubs/${clubId}/members`)
      .then(setMembers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [clubId]);

  const toggleAdmin = async (member) => {
    const newRole = member.role === 'admin' ? 'member' : 'admin';
    setTogglingId(member.id);
    try {
      await api.patch(`/clubs/${clubId}/members/${member.id}/role`, { role: newRole });
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    } catch (err) {
      alert(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: space.xl }}>
      <div style={{ marginBottom: space.md }}>
        <span className="card-title" style={{ display: 'block', marginBottom: 4 }}>Admin Staff</span>
        <p style={{ fontSize: font.sm, color: 'var(--text-muted)', margin: 0 }}>
          Admin members can edit handicaps and delete rounds in the Admin Area.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-subtle, var(--bg-elevated))',
              borderRadius: 'calc(var(--radius) - 2px)',
              border: '1px solid var(--border)',
            }}>
              <div
                style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--green-glow)', border: '1.5px solid var(--border-accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: font.sm, fontWeight: 700, color: 'var(--green-bright)',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/members/${m.id}`)}
              >
                {((m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '') || m.email[0]).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{ fontWeight: 600, fontSize: font.sm, cursor: 'pointer' }}
                    onClick={() => navigate(`/members/${m.id}`)}
                  >
                    {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}
                  </span>
                  <RoleBadge role={m.role} />
                </div>
                <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                  {m.handicap != null ? `HCP ${Number(m.handicap).toFixed(1)} · ` : ''}{m.rounds_played} round{m.rounds_played !== 1 ? 's' : ''}
                </div>
              </div>

              {m.role !== 'owner' && (
                <button
                  className={m.role === 'admin' ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'}
                  style={{ fontSize: font.xs, flexShrink: 0 }}
                  disabled={togglingId === m.id}
                  onClick={() => toggleAdmin(m)}
                >
                  {togglingId === m.id ? '…' : m.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tournaments section ──────────────────────────────────────────────────────

function TournamentsSettings({ clubId }) {
  const navigate = useNavigate();
  const [comps,      setComps]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    api.get(`/competitions?club_id=${clubId}`)
      .then(setComps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [clubId]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this tournament? All entries and scores will be permanently removed.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/competitions/${id}`);
      setComps(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: space.xl }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
        <span className="card-title" style={{ marginBottom: 0 }}>Tournaments</span>
        <button className="btn btn-add" onClick={() => navigate('/competitions/new')}>
          + New
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : comps.length === 0 ? (
        <p style={{ fontSize: font.sm, color: 'var(--text-muted)', padding: '4px 0' }}>No tournaments yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comps.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-subtle, var(--bg-elevated))',
              borderRadius: 'calc(var(--radius) - 2px)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: font.sm }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtDate(c.date)} · {c.course_name} · {c.entry_count} player{c.entry_count !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/competitions/${c.id}`)}
                  style={{ fontSize: font.xs }}
                >
                  View
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                >
                  {deletingId === c.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Seasons section ──────────────────────────────────────────────────────────

function SeasonsSettings({ clubId }) {
  const [seasons,    setSeasons]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [creating,   setCreating]   = useState(false);
  const [form,       setForm]       = useState({ name: '', startDate: '', endDate: '' });
  const [saving,     setSaving]     = useState(false);
  const [formErr,    setFormErr]    = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const load = () =>
    api.get(`/clubs/${clubId}/seasons`)
      .then(setSeasons)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, [clubId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true); setFormErr('');
    try {
      await api.post(`/clubs/${clubId}/seasons`, {
        name: form.name.trim(), startDate: form.startDate, endDate: form.endDate,
      });
      setForm({ name: '', startDate: '', endDate: '' });
      setCreating(false);
      load();
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this season? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/clubs/${clubId}/seasons/${id}`);
      setSeasons(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: seasons.length > 0 || creating ? 16 : 4 }}>
        <span className="card-title" style={{ marginBottom: 0 }}>Seasons</span>
        <button className="btn btn-add" onClick={() => { setCreating(p => !p); setFormErr(''); }}>
          {creating ? 'Cancel' : '+ New Season'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} style={{ marginBottom: seasons.length > 0 ? 20 : 0, paddingBottom: seasons.length > 0 ? 20 : 0, borderBottom: seasons.length > 0 ? '1px solid var(--border)' : 'none' }}>
          {formErr && <div className="form-error" style={{ marginBottom: 12 }}>{formErr}</div>}
          <div className="form-group">
            <label className="form-label">Season name</label>
            <input className="form-input" type="text" placeholder="e.g. 2026 Season"
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Start date</label>
              <input className="form-input" type="date"
                value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">End date</label>
              <input className="form-input" type="date"
                value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} required />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-save" disabled={saving}>
              {saving ? 'Creating…' : 'Create season'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}><div className="spinner" /></div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : seasons.length === 0 && !creating ? (
        <p style={{ fontSize: font.sm, color: 'var(--text-muted)', padding: '4px 0 0' }}>No seasons yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {seasons.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-subtle, var(--bg-elevated))',
              borderRadius: 'calc(var(--radius) - 2px)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: font.sm }}>{s.name}</div>
                <div style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtDate(s.start_date)} – {fmtDate(s.end_date)}
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)} disabled={deletingId === s.id}>
                {deletingId === s.id ? '…' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClubSettings() {
  const { activeClub } = useClub();
  const navigate = useNavigate();
  const isOwner = activeClub?.role === 'owner';

  if (!activeClub) {
    return (
      <div className="app-layout">
        <AppNav />
        <main className="main-content" style={{ maxWidth: 680 }}>
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <p className="empty-state-title">No club selected</p>
            <p className="empty-state-sub">Select a club from your profile first.</p>
            <button className="btn btn-primary" style={{ marginTop: space.md }} onClick={() => navigate('/profile')}>
              Go to Profile
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 680 }}>
        <div className="page-header" style={{ marginBottom: 28 }}>
          <h1 className="page-title">Club Settings</h1>
          <p className="page-subtitle">{activeClub.name}</p>
        </div>

        <div className="card" style={{ marginBottom: space.xl }}>
          <span className="card-title" style={{ display: 'block', marginBottom: 12 }}>Club Info</span>
          <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: font.xs, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs }}>Name</div>
              <div style={{ fontWeight: 600, fontSize: font.md }}>{activeClub.name}</div>
            </div>
            <div>
              <div style={{ fontSize: font.xs, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs }}>Join Code</div>
              <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 2, color: 'var(--green-bright)', fontVariantNumeric: 'tabular-nums' }}>
                {activeClub.code}
              </div>
            </div>
            <div>
              <div style={{ fontSize: font.xs, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs }}>Your Role</div>
              <div style={{ fontWeight: 600, fontSize: font.sm, textTransform: 'capitalize' }}>{activeClub.role}</div>
            </div>
          </div>
        </div>

        {(isOwner || activeClub.role === 'admin') && (
          <div className="card" style={{ marginBottom: space.xl }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span className="card-title" style={{ display: 'block', marginBottom: 4 }}>Admin Area</span>
                <p style={{ fontSize: font.sm, color: 'var(--text-muted)', margin: 0 }}>
                  Edit member handicaps and delete rounds
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => navigate('/club/admin')}>
                Open
              </button>
            </div>
          </div>
        )}

        {isOwner && <MembersSettings clubId={activeClub.id} />}
        <TournamentsSettings clubId={activeClub.id} />
        <SeasonsSettings clubId={activeClub.id} />
      </main>
    </div>
  );
}
