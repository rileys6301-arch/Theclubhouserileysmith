import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';

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
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      color: s.color, background: s.bg, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
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
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
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
        <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '4px 0' }}>No tournaments yet.</p>
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
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtDate(c.date)} · {c.course_name} · {c.entry_count} player{c.entry_count !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/competitions/${c.id}`)}
                  style={{ fontSize: 12 }}
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
        <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '4px 0 0' }}>No seasons yet.</p>
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
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
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

  if (!activeClub) {
    return (
      <div className="app-layout">
        <AppNav />
        <main className="main-content" style={{ maxWidth: 680 }}>
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <p className="empty-state-title">No club selected</p>
            <p className="empty-state-sub">Select a club from your profile first.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/profile')}>
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

        <div className="card" style={{ marginBottom: 20 }}>
          <span className="card-title" style={{ display: 'block', marginBottom: 12 }}>Club Info</span>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Name</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{activeClub.name}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Join Code</div>
              <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 2, color: 'var(--green-bright)', fontVariantNumeric: 'tabular-nums' }}>
                {activeClub.code}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Your Role</div>
              <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{activeClub.role}</div>
            </div>
          </div>
        </div>

        <TournamentsSettings clubId={activeClub.id} />
        <SeasonsSettings clubId={activeClub.id} />
      </main>
    </div>
  );
}
