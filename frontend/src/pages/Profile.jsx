import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import RoundsChart from '../components/RoundsChart';
import ScorecardModal from '../components/ScorecardModal';

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
  if (delta > 1)  return { label: 'Improving', dir: 'up'   };
  if (delta < -1) return { label: 'Declining', dir: 'down' };
  return               { label: 'Steady',    dir: 'flat' };
}

// ─── Club invite button ──────────────────────────────────────────────────────

function ClubInviteButton({ club, compact = false }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/club/join?code=${club.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${club.name} on The Circuit`, text: `Use code ${club.code} to join my club.`, url });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (compact) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={handleShare} title="Share invite link" style={{ padding: '0 8px' }}>
        {copied ? <CheckIcon /> : <ShareIcon />}
      </button>
    );
  }
  return (
    <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleShare}>
      {copied ? <><CheckIcon /> Link copied!</> : <><ShareIcon /> Share invite link</>}
    </button>
  );
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

// ─── Stat tile ───────────────────────────────────────────────────────────────

function Tile({ label, value, sub, accent, wide }) {
  return (
    <div style={{
      gridColumn: wide ? '1 / -1' : undefined,
      background: accent ? 'rgba(61,107,31,0.06)' : '#f7f5f1',
      border: accent ? '0.5px solid rgba(61,107,31,0.15)' : '0.5px solid rgba(0,0,0,0.05)',
      borderRadius: 14,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>
        {label}
        {sub && <span style={{ color: '#ccc', fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, color: accent ? '#3d6b1f' : 'var(--text-primary)', lineHeight: 1 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Profile() {
  const { user, updateUser, logout } = useAuth();
  const { myClubs, activeClub, loadingClubs, enterClub, exitClub, leaveClub, deleteClub } = useClub();
  const navigate = useNavigate();

  const [rounds,          setRounds]         = useState([]);
  const [rLoading,        setRLoading]       = useState(true);
  const [rError,          setRError]         = useState('');
  const [editing,         setEditing]        = useState(false);
  const [deleteId,        setDeleteId]       = useState(null);
  const [leavingId,       setLeavingId]      = useState(null);
  const [scorecardId,     setScorecardId]    = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingClubId,  setDeletingClubId] = useState(null);

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
    } catch {
      // ignore
    } finally {
      setDeleteId(null);
    }
  };

  const handleLeaveClub = async (clubId) => {
    setLeavingId(clubId);
    try { await leaveClub(clubId); } catch { /* ignore */ } finally { setLeavingId(null); }
  };

  const handleDeleteClub = async (clubId) => {
    setDeletingClubId(clubId);
    try { await deleteClub(clubId); } catch { /* ignore */ } finally {
      setDeletingClubId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleProfileSaved = (updated) => {
    updateUser(updated);
    setEditing(false);
  };

  // 9-hole rounds are excluded from handicap stats and trend
  const fullRounds  = useMemo(() => rounds.filter(r => !r.is_nine_hole), [rounds]);
  const chartRounds = useMemo(() => [...fullRounds].reverse(), [fullRounds]);
  const trendInfo   = useMemo(() => trend(fullRounds), [fullRounds]);

  const profileStats = useMemo(() => {
    if (!fullRounds.length) return null;
    const sfords    = fullRounds.map(r => r.stableford);
    const scores    = fullRounds.map(r => r.score);
    const last10    = sfords.slice(0, 10);
    const hcp       = user?.handicap != null ? Number(user.handicap) : null;
    const bestScore = Math.min(...scores);
    const bestStblf = Math.max(...sfords);
    const avgSblf10 = avg(last10);
    const avgGross  = avg(scores);
    const avgNet    = hcp != null ? avgGross - hcp : null;
    const bestNet   = hcp != null ? bestScore - hcp : null;
    const avgVsPar  = avgGross - 72;
    const now       = new Date();
    const thisYear  = now.getFullYear();
    const countYear = (y) => rounds.filter(r => localDate(r.played_at).getFullYear() === y).length;
    const recent5   = fullRounds.slice(0, 5).map(r => r.stableford);
    return {
      total:            rounds.length,
      bestScore,        bestStblf,
      avgSblf10:        avgSblf10.toFixed(1),
      last10Count:      last10.length,
      avgGross:         avgGross.toFixed(1),
      avgNet:           avgNet  != null ? avgNet.toFixed(1)  : null,
      bestNet:          bestNet != null ? bestNet.toFixed(1) : null,
      avgVsPar:         avgVsPar >= 0   ? `+${avgVsPar.toFixed(1)}` : avgVsPar.toFixed(1),
      ptsPerHole:       (avgSblf10 / 18).toFixed(2),
      coursesPlayed:    new Set(rounds.map(r => r.course_name)).size,
      thisYear,
      roundsThisYear:   countYear(thisYear),
      roundsLastYear:   countYear(thisYear - 1),
      roundsYearBefore: countYear(thisYear - 2),
      recentForm:       recent5.length >= 3 ? avg(recent5).toFixed(1) : null,
    };
  }, [rounds, fullRounds, user]);

  const bestRoundId = useMemo(() =>
    fullRounds.length ? fullRounds.reduce((b, r) => !b || r.stableford > b.stableford ? r : b, null)?.id : null,
  [fullRounds]);

  return (
    <div className="app-layout">
      <AppNav />

      {scorecardId && (
        <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
      )}

      <main className="main-content fade-in" style={{ background: '#edeae4' }}>

        {/* ── Hero card ────────────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(160deg, #2a4a18 0%, #3d6b1f 60%, #4e8a27 100%)',
          borderRadius: 24,
          padding: '32px 24px 28px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: 12,
        }}>
          {/* Decorative radial glow */}
          <div style={{
            position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)',
            width: 280, height: 280, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.08), transparent)',
            pointerEvents: 'none',
          }} />
          {/* Decorative ring */}
          <div style={{
            position: 'absolute', bottom: -30, right: -30,
            width: 160, height: 160, borderRadius: '50%',
            border: '30px solid rgba(255,255,255,0.04)',
            pointerEvents: 'none',
          }} />

          {/* Edit button */}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                position: 'absolute', top: 16, right: 16, zIndex: 2,
                padding: '5px 13px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(255,255,255,0.12)',
                cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              Edit
            </button>
          )}

          {/* Avatar */}
          <div style={{
            width: 76, height: 76, borderRadius: 38,
            background: 'rgba(255,255,255,0.15)',
            border: '2.5px solid rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 700, color: '#fff',
            marginBottom: 14, flexShrink: 0, zIndex: 1, userSelect: 'none',
          }}>
            {initials(user)}
          </div>

          {/* Name */}
          <div style={{ fontSize: 21, fontWeight: 700, color: '#fff', letterSpacing: -0.3, zIndex: 1, textAlign: 'center' }}>
            {displayName(user)}
          </div>

          {/* Email */}
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3, zIndex: 1 }}>
            {user.email}
          </div>

          {/* Member since */}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, zIndex: 1 }}>
            Member since {fmtMember(user.created_at)}
          </div>

          {/* Separator */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, marginBottom: 20, width: '100%', zIndex: 1 }}>
            <div style={{ flex: 1, height: 0.5, background: 'rgba(255,255,255,0.15)' }} />
            <div style={{ width: 4, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.3)', margin: '0 8px' }} />
            <div style={{ flex: 1, height: 0.5, background: 'rgba(255,255,255,0.15)' }} />
          </div>

          {/* Handicap */}
          <div style={{
            fontSize: 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1, zIndex: 1,
            color: user.handicap != null ? '#fff' : 'rgba(255,255,255,0.4)',
          }}>
            {user.handicap != null ? Number(user.handicap).toFixed(1) : '—'}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 1.2,
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
            marginTop: 6, zIndex: 1,
          }}>
            HCP
          </div>
        </div>

        {/* ── Edit form ─────────────────────────────────────────────── */}
        {editing && (
          <div className="card" style={{ borderRadius: 20, marginBottom: 12 }}>
            <span className="card-title" style={{ display: 'block', marginBottom: 16 }}>Edit Profile</span>
            <EditProfileForm user={user} onSave={handleProfileSaved} onCancel={() => setEditing(false)} />
          </div>
        )}

        {/* ── Stat strip ────────────────────────────────────────────── */}
        {profileStats && (
          <div style={{ background: '#fff', borderRadius: 18, display: 'flex', marginBottom: 12, overflow: 'hidden' }}>
            {[
              { label: `Avg Stableford · last ${profileStats.last10Count}`, value: profileStats.avgSblf10, color: '#3d6b1f' },
              { label: 'Best Gross Score', value: profileStats.bestScore, color: 'var(--text-primary)' },
              { label: 'Best Stableford', value: profileStats.bestStblf, color: '#3d6b1f' },
            ].map((s, i) => (
              <div key={i} style={{
                flex: 1, padding: '16px 8px', textAlign: 'center',
                borderLeft: i > 0 ? '0.5px solid rgba(0,0,0,0.08)' : 'none',
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, fontWeight: 500, color: '#aaa', marginTop: 5, lineHeight: 1.3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── My Clubs ──────────────────────────────────────────────── */}
        <div className="card" style={{ borderRadius: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: myClubs.length > 0 ? 16 : 8 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>My Clubs</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/club/join')}>Join</button>
              <button className="btn btn-add" onClick={() => navigate('/club/create')}>+ Create</button>
            </div>
          </div>

          {loadingClubs ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
              <div className="spinner" />
            </div>
          ) : myClubs.length === 0 ? (
            <div style={{ padding: '12px 0 4px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>You're not in any clubs yet.</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Create a club or join one with a code.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {myClubs.map(c => (
                <div key={c.id} style={{
                  padding: '12px 14px',
                  background: activeClub?.id === c.id ? 'rgba(94,155,58,0.06)' : 'var(--bg-subtle)',
                  borderRadius: 'calc(var(--radius) - 2px)',
                  border: confirmDeleteId === c.id
                    ? '1.5px solid rgba(220,38,38,0.3)'
                    : activeClub?.id === c.id
                      ? '1.5px solid rgba(94,155,58,0.2)'
                      : '1.5px solid var(--border)',
                  transition: 'border-color 180ms ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{c.name}</span>
                        {activeClub?.id === c.id && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: 'var(--green-bright)', background: 'rgba(94,155,58,0.12)',
                            borderRadius: 20, padding: '2px 7px',
                          }}>Active</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {c.role === 'owner' ? 'Owner' : 'Member'} · {c.member_count} member{c.member_count !== 1 ? 's' : ''}
                        {c.role === 'owner' && (
                          <> · <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>{c.code}</span></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {c.role === 'owner' && <ClubInviteButton club={c} compact />}
                      {activeClub?.id === c.id ? (
                        <button className="btn btn-ghost btn-sm" onClick={exitClub}>Exit</button>
                      ) : (
                        <button className="btn btn-secondary btn-sm" onClick={() => { enterClub(c.id); navigate('/'); }}>
                          Enter
                        </button>
                      )}
                      {c.role === 'owner' ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => setConfirmDeleteId(confirmDeleteId === c.id ? null : c.id)}
                          disabled={deletingClubId === c.id}
                        >
                          {deletingClubId === c.id ? '…' : 'Delete'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleLeaveClub(c.id)}
                          disabled={leavingId === c.id}
                        >
                          {leavingId === c.id ? '…' : 'Leave'}
                        </button>
                      )}
                    </div>
                  </div>

                  {confirmDeleteId === c.id && (
                    <div style={{
                      marginTop: 12, padding: '12px 14px',
                      background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)',
                      borderRadius: 'calc(var(--radius) - 4px)',
                    }}>
                      <p style={{ fontSize: 13, color: 'var(--error)', fontWeight: 600, marginBottom: 3 }}>
                        Delete "{c.name}"?
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                        This permanently removes the club, all members, competitions, and data. This cannot be undone.
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)} disabled={deletingClubId === c.id}>
                          Cancel
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteClub(c.id)} disabled={deletingClubId === c.id}>
                          {deletingClubId === c.id ? 'Deleting…' : 'Yes, delete club'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Round history ─────────────────────────────────────────── */}
        <div style={{ background: '#fff', borderRadius: 20, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Round History</div>
              {profileStats && (
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                  {profileStats.total} round{profileStats.total !== 1 ? 's' : ''} total
                </div>
              )}
            </div>
            <Link to="/log" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 600, color: '#3d6b1f',
              background: 'rgba(61,107,31,0.08)', borderRadius: 20,
              padding: '5px 12px', textDecoration: 'none',
            }}>
              + Log round
            </Link>
          </div>

          {rLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <div className="spinner" />
            </div>
          ) : rError ? (
            <div className="form-error" style={{ margin: 16 }}><ErrIcon />{rError}</div>
          ) : rounds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px 24px' }}>
              <FlagIcon />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12, marginBottom: 4 }}>No rounds yet</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Log your first round to start tracking your game.</p>
            </div>
          ) : (
            rounds.map((r, i) => {
              const stblf = r.stableford;
              let badgeBg, ptsColor;
              if (stblf >= 36)      { badgeBg = 'rgba(61,107,31,0.10)';  ptsColor = '#3d6b1f';  }
              else if (stblf <= 28) { badgeBg = 'rgba(192,57,43,0.08)'; ptsColor = '#c0392b'; }
              else                  { badgeBg = '#f7f5f1';               ptsColor = '#888';    }
              const isBest = r.id === bestRoundId;

              return (
                <div
                  key={r.id}
                  onClick={() => setScorecardId(r.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', cursor: 'pointer',
                    borderTop: i === 0 ? 'none' : '0.5px solid rgba(0,0,0,0.05)',
                  }}
                >
                  {/* Stableford badge */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: badgeBg,
                    ...(isBest ? { outline: '0.5px solid rgba(61,107,31,0.2)' } : {}),
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: ptsColor, lineHeight: 1 }}>{stblf}</div>
                    <div style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', opacity: 0.7, color: ptsColor }}>pts</div>
                  </div>

                  {/* Course + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        {r.course_name}
                      </div>
                      {r.is_nine_hole && (
                        <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(100,100,100,0.12)', color: 'var(--text-muted)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          9-HOLE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                      {fmtDate(r.played_at)}
                    </div>
                  </div>

                  {/* Gross */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>{r.score}</div>
                    <div style={{ fontSize: 10, color: '#bbb' }}>gross</div>
                  </div>

                  {/* Chevron */}
                  <div style={{ color: '#ddd', fontSize: 16, flexShrink: 0, lineHeight: 1 }}>›</div>

                  {/* Delete */}
                  <button
                    className="btn-delete"
                    onClick={e => { e.stopPropagation(); handleDelete(r.id); }}
                    disabled={deleteId === r.id}
                    aria-label="Delete round"
                  >
                    {deleteId === r.id ? '…' : <TrashIcon />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* ── Handicap trend ────────────────────────────────────────── */}
        {chartRounds.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '16px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Stableford Trend</div>
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>Last {chartRounds.length} rounds</div>
              </div>
              {trendInfo && (
                <span style={{
                  background: trendInfo.dir === 'up' ? 'rgba(61,107,31,0.10)' : trendInfo.dir === 'down' ? 'rgba(192,57,43,0.08)' : 'rgba(0,0,0,0.06)',
                  color: trendInfo.dir === 'up' ? '#3d6b1f' : trendInfo.dir === 'down' ? '#c0392b' : 'var(--text-secondary)',
                  fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '3px 10px',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
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

        {/* ── Scoring stats ─────────────────────────────────────────── */}
        {profileStats && (
          <div style={{ background: '#fff', borderRadius: 20, marginBottom: 12, padding: '0 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: '#bbb', padding: '14px 0 10px' }}>
              Scoring
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 4 }}>
              <Tile label="Avg Gross"  value={profileStats.avgGross} />
              <Tile label="Avg Net"    value={profileStats.avgNet}   sub="est." />
              <Tile label="Best Gross" value={profileStats.bestScore} accent />
              <Tile label="Best Net"   value={profileStats.bestNet}  sub="est." accent />
              <Tile label="Avg vs Par" value={profileStats.avgVsPar} />
              <Tile label="Pts / Hole" value={profileStats.ptsPerHole} accent />
            </div>

            <div style={{ height: 0.5, background: 'rgba(0,0,0,0.06)', margin: '8px 0' }} />

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: '#bbb', padding: '10px 0 10px' }}>
              Stableford
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 16 }}>
              <Tile label="Avg / Round" value={profileStats.avgSblf10} accent />
              <Tile label="Best Round"  value={profileStats.bestStblf} accent />
              {profileStats.recentForm && (
                <Tile label="Recent Form" value={profileStats.recentForm} sub="avg last 5" accent wide />
              )}
            </div>
          </div>
        )}

        {/* ── Activity ──────────────────────────────────────────────── */}
        {profileStats && rounds.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 20, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Activity</div>

            {/* Featured: last round */}
            <div style={{
              background: 'linear-gradient(135deg, #2a4a18, #3d6b1f)',
              borderRadius: 14, padding: '14px 16px', marginBottom: 8,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>
                Last Round
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: -0.5, lineHeight: 1 }}>
                {fmtDate(rounds[0].played_at)}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                {rounds[0].course_name} · {rounds[0].score} gross · {rounds[0].stableford} pts
              </div>
            </div>

            {/* Total + courses */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <Tile label="Total Rounds"   value={profileStats.total} />
              <Tile label="Courses Played" value={profileStats.coursesPlayed} accent />
            </div>

            {/* By year */}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: '#bbb', margin: '12px 0 8px' }}>
              By Year
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { year: profileStats.thisYear,     count: profileStats.roundsThisYear   },
                { year: profileStats.thisYear - 1, count: profileStats.roundsLastYear   },
                { year: profileStats.thisYear - 2, count: profileStats.roundsYearBefore },
              ].map(({ year, count }) => (
                <div key={year} style={{
                  background: '#f7f5f1', border: '0.5px solid rgba(0,0,0,0.05)',
                  borderRadius: 14, padding: '12px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: count === 0 ? '#ccc' : 'var(--text-primary)', lineHeight: 1 }}>
                    {count}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: '#bbb', marginTop: 5 }}>
                    {year}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Account ───────────────────────────────────────────────── */}
        <div className="card mobile-account-card" style={{ borderRadius: 20, marginTop: 0 }}>
          <span className="card-title">Account</span>
          <button
            className="btn btn-ghost"
            style={{ color: 'var(--error)', padding: 0, height: 'auto', fontSize: 14, fontWeight: 600 }}
            onClick={logout}
          >
            Sign out
          </button>
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

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
