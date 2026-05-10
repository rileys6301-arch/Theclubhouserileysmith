import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import CourseSearch from '../components/CourseSearch';

// ─── Helpers ────────────────────────────────────────────────────────────────

function pName(u, { first = 'player_first', last = 'player_last', email = 'player_email' } = {}) {
  if (u[first] || u[last]) return [u[first], u[last]].filter(Boolean).join(' ');
  return u[email] ?? '—';
}

function fmtDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function defaultHoles() {
  const pars = [4,4,3,4,5,3,4,5,4, 4,4,3,4,5,3,4,5,4];
  const sis  = [1,3,5,7,9,11,13,15,17, 2,4,6,8,10,12,14,16,18];
  return pars.map((par, i) => ({ number: i + 1, par, si: sis[i] }));
}

function parseHoles(raw) {
  return raw.slice(0, 18).map((h, i) => ({
    number: h.hole_number ?? i + 1,
    par:    Math.max(3, Math.min(6, parseInt(h.par) || 4)),
    si:     Math.max(1, Math.min(18,
      parseInt(h.handicap_stroke_index ?? h.stroke_index ?? h.handicap ?? h.handicap_index) || (i + 1)
    )),
  }));
}

function extractTees(data) {
  const course = data.course ?? data;
  if (Array.isArray(course.holes) && course.holes.length >= 9) {
    return [{ name: 'Standard', holes: parseHoles(course.holes) }];
  }
  const tees = [];
  if (course.tees) {
    if (Array.isArray(course.tees)) {
      for (const t of course.tees) {
        if (Array.isArray(t.holes) && t.holes.length >= 9)
          tees.push({ name: t.tee_name ?? t.name ?? t.colour ?? 'Standard', holes: parseHoles(t.holes) });
      }
    } else {
      for (const [key, prefix] of [['male', ''], ['female', 'Ladies – ']]) {
        const group = course.tees[key];
        if (Array.isArray(group)) {
          for (const t of group) {
            if (Array.isArray(t.holes) && t.holes.length >= 9)
              tees.push({ name: prefix + (t.tee_name ?? t.name ?? t.colour ?? 'Tee'), holes: parseHoles(t.holes) });
          }
        }
      }
    }
  }
  return tees;
}

function calcPoints(score, par, si, hcp) {
  if (score === null || score === undefined) return null;
  const shots = Math.floor(hcp / 18) + (si <= (hcp % 18) ? 1 : 0);
  return Math.max(0, 1 + par + shots - score);
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    upcoming:  { label: 'Upcoming',   cls: 'comp-badge-upcoming'  },
    active:    { label: '● Live',     cls: 'comp-badge-active'    },
    completed: { label: 'Completed',  cls: 'comp-badge-completed' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: '' };
  return <span className={`comp-badge ${cls}`}>{label}</span>;
}

// ─── Seasons manager (owner only) ────────────────────────────────────────────

function SeasonsManager({ clubId }) {
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
        name:      form.name.trim(),
        startDate: form.startDate,
        endDate:   form.endDate,
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

  const fmtS = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="card" style={{ marginTop: 24 }}>
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
        <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '4px 0 0' }}>No seasons yet. Create one to filter your leaderboard by date range.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {seasons.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-subtle)',
              borderRadius: 'calc(var(--radius) - 2px)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtS(s.start_date)} – {fmtS(s.end_date)}
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

// ─── Competition list ─────────────────────────────────────────────────────────

function CompetitionList() {
  const navigate = useNavigate();
  const { activeClub, loadingClubs } = useClub();
  const [comps,          setComps]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [deletingCompId, setDeletingCompId] = useState(null);

  const isOwner = activeClub?.role === 'owner';

  const load = () => {
    if (!activeClub) { setLoading(false); setComps([]); return; }
    setLoading(true);
    api.get(`/competitions?club_id=${activeClub.id}`)
      .then(setComps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [activeClub?.id]);

  const handleDeleteComp = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this competition? All entries and scores will be removed.')) return;
    setDeletingCompId(id);
    try {
      await api.delete(`/competitions/${id}`);
      setComps(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingCompId(null);
    }
  };

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 860 }}>
        <div className="page-header" style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 className="page-title">Competitions</h1>
              <p className="page-subtitle">{activeClub ? `${activeClub.name} tournaments` : 'Select a club to view competitions'}</p>
            </div>
            {activeClub && (
              <button className="btn btn-save" style={{ height: 38 }} onClick={() => navigate('/competitions/new')}>
                + Create
              </button>
            )}
          </div>
        </div>

        {loadingClubs || loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="spinner" />
          </div>
        ) : !activeClub ? (
          <div className="empty-state" style={{ paddingTop: 60 }}>
            <p className="empty-state-title">No club selected</p>
            <p className="empty-state-sub">Go to your profile and enter a club to see its competitions.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/profile')}>
              Go to Profile
            </button>
          </div>
        ) : error ? (
          <div className="form-error">{error}</div>
        ) : comps.length === 0 ? (
          <>
            <div className="empty-state">
              <p className="empty-state-title">No competitions yet</p>
              <p className="empty-state-sub">Create the first one to get started.</p>
              <button className="btn btn-add" style={{ marginTop: 16 }} onClick={() => navigate('/competitions/new')}>
                + Create competition
              </button>
            </div>
            {isOwner && <SeasonsManager clubId={activeClub.id} />}
          </>
        ) : (
          <>
            <div className="comp-list">
              {comps.map(c => {
                const canDelete = true;
                return (
                  <div key={c.id} className="comp-card" onClick={() => navigate(`/competitions/${c.id}`)}>
                    <div className="comp-card-top">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="comp-card-name">{c.name}</div>
                        <div className="comp-card-meta">
                          {fmtDate(c.date)} · {c.course_name}{c.tee_name ? ` (${c.tee_name})` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <StatusBadge status={c.status} />
                        {canDelete && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => handleDeleteComp(e, c.id)}
                            disabled={deletingCompId === c.id}
                          >
                            {deletingCompId === c.id ? '…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="comp-card-footer">
                      <span>{c.entry_count} player{c.entry_count !== 1 ? 's' : ''} entered</span>
                      {c.entered && <span className="comp-entered-tag">Entered</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {isOwner && <SeasonsManager clubId={activeClub.id} />}
          </>
        )}
      </main>
    </div>
  );
}

// ─── Create competition wizard ────────────────────────────────────────────────

function CreateCompetition() {
  const navigate = useNavigate();
  const { activeClub } = useClub();

  const [step,    setStep]    = useState('details'); // 'details' | 'course' | 'tee'
  const [details, setDetails] = useState({ name: '', description: '', date: '' });
  const [course,  setCourse]  = useState(null);   // { id, name }
  const [tees,    setTees]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [selTee,  setSelTee]  = useState(null);   // { name, holes[] }
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleCourseSelect = async (name, id) => {
    if (!id) return;
    setCourse({ id, name });
    setTees([]); setSelTee(null);
    setLoading(true); setStep('tee');
    try {
      const data = await api.get(`/courses/detail/${id}`);
      const extracted = extractTees(data);
      setTees(extracted);
      if (extracted.length === 1) { setSelTee(extracted[0]); }
    } catch { setTees([]); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    setSaving(true); setError('');
    try {
      const comp = await api.post('/competitions', {
        name:       details.name.trim(),
        description:details.description.trim() || null,
        date:       details.date,
        courseName: course?.name ?? '',
        teeName:    selTee?.name ?? null,
        holeData:   selTee?.holes ?? null,
        clubId:     activeClub?.id ?? null,
      });
      navigate(`/competitions/${comp.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const stepLabel =
    step === 'details' ? 'Step 1 — Competition details' :
    step === 'course'  ? 'Step 2 — Select a course' :
                         'Step 3 — Select a tee';

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 640 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <Link to="/competitions" className="back-link">← Competitions</Link>
          <h1 className="page-title">Create Competition</h1>
          <p className="page-subtitle">{stepLabel}</p>
        </div>

        {/* ── Step 1: Details ── */}
        {step === 'details' && (
          <div className="card">
            <span className="card-title" style={{ display: 'block', marginBottom: 16 }}>Competition details</span>
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" type="text" placeholder="e.g. Spring Cup 2026"
                value={details.name} onChange={e => setDetails(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="date"
                value={details.date} onChange={e => setDetails(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <textarea className="form-input notice-textarea" rows={3} placeholder="Format, rules, prizes…"
                value={details.description} onChange={e => setDetails(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-save"
                disabled={!details.name.trim() || !details.date}
                onClick={() => setStep('course')}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Course ── */}
        {step === 'course' && (
          <div className="card">
            <button type="button" className="back-link-btn" onClick={() => setStep('details')}>← Back</button>
            <span className="card-title" style={{ display: 'block', marginTop: 16, marginBottom: 16 }}>Select a course</span>
            <CourseSearch onSelect={handleCourseSelect} autoFocus />
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Can't find your course?</span>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }}
                onClick={() => { setCourse({ id: null, name: '' }); setSelTee({ name: 'Manual', holes: defaultHoles() }); setStep('tee'); }}>
                Skip →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Tee ── */}
        {step === 'tee' && (
          <div className="card">
            <button type="button" className="back-link-btn" onClick={() => setStep('course')}>← Back to course</button>
            <span className="card-title" style={{ display: 'block', marginTop: 16, marginBottom: 4 }}>Select a tee</span>
            {course?.name && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{course.name}</p>}

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><div className="spinner" /></div>
            ) : tees.length > 0 ? (
              <div className="tee-grid" style={{ marginBottom: 20 }}>
                {tees.map(t => (
                  <button key={t.name} type="button"
                    className={`tee-btn ${selTee?.name === t.name ? 'tee-btn-selected' : ''}`}
                    onClick={() => setSelTee(t)}>
                    <span className="tee-btn-name">{t.name}</span>
                    <span className="tee-btn-par">Par {t.holes.reduce((s, h) => s + h.par, 0)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="sc-api-notice" style={{ marginBottom: 20 }}>
                <InfoIcon />
                No tee data available — hole data will use defaults and can be adjusted during scoring.
              </div>
            )}

            {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {tees.length > 0 && !selTee && (
                <button type="button" className="btn btn-ghost"
                  onClick={() => { setSelTee(null); handleCreate(); }}>
                  Skip tee
                </button>
              )}
              <button className="btn btn-save" disabled={saving || (tees.length > 0 && !selTee)} onClick={handleCreate}>
                {saving ? 'Creating…' : 'Create competition'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Scoring panel ────────────────────────────────────────────────────────────
// mySubmissions   — scores submitted by the current user for this player (editable)
// theirSubmissions — scores submitted by the other party (read-only, for comparison)

function ScoringPanel({ comp, playerId, hcp: hcpProp, mySubmissions, theirSubmissions, title, subtitle, myLabel = 'Your entry', theirLabel = 'Partner', onScoresSaved }) {
  const holes = comp.hole_data ?? defaultHoles();
  const hcp   = Math.max(0, hcpProp ?? 0);

  const [scores, setScores] = useState(() => {
    const s = {};
    for (const sc of mySubmissions) s[sc.hole_number] = String(sc.score);
    return s;
  });
  const [saved,  setSaved]  = useState(() => new Set(mySubmissions.map(s => s.hole_number)));
  const [saving, setSaving] = useState(new Set());
  const [errs,   setErrs]   = useState({});

  const theirMap = {};
  for (const sc of theirSubmissions) theirMap[sc.hole_number] = sc.score;

  const handleChange = (hNum, val) => {
    setScores(p => ({ ...p, [hNum]: val }));
    setSaved(p => { const n = new Set(p); n.delete(hNum); return n; });
    setErrs(p => { const n = { ...p }; delete n[hNum]; return n; });
  };

  const saveHole = async (hNum) => {
    const val = scores[hNum];
    if (!val || isNaN(parseInt(val))) return;
    const score = parseInt(val);
    const hole  = holes[hNum - 1];
    if (!hole) return;
    const pts = calcPoints(score, hole.par, hole.si, hcp) ?? 0;

    setSaving(p => new Set([...p, hNum]));
    try {
      await api.post(`/competitions/${comp.id}/scores`, {
        playerId,
        holeNumber:       hNum,
        score,
        stablefordPoints: pts,
      });
      setSaved(p => new Set([...p, hNum]));
      if (onScoresSaved) onScoresSaved();
    } catch (err) {
      setErrs(p => ({ ...p, [hNum]: err.message }));
    } finally {
      setSaving(p => { const n = new Set(p); n.delete(hNum); return n; });
    }
  };

  const filledHoles = holes.map((h, i) => {
    const hNum  = i + 1;
    const score = scores[hNum] ? parseInt(scores[hNum]) : null;
    return { ...h, score, pts: calcPoints(score, h.par, h.si, hcp) };
  });
  const filled   = filledHoles.filter(h => h.score !== null);
  const runScore = filled.reduce((t, h) => t + h.score, 0);
  const runPts   = filled.reduce((t, h) => t + (h.pts ?? 0), 0);

  const renderRow = (h, i) => {
    const hNum      = i + 1;
    const isSav     = saving.has(hNum);
    const isDone    = saved.has(hNum);
    const hasErr    = errs[hNum];
    const theirScore = theirMap[hNum];
    const myScore    = h.score;
    const bothEntered = myScore !== null && theirScore !== undefined;
    const matched     = bothEntered && myScore === theirScore;
    const disputed    = bothEntered && myScore !== theirScore;

    return (
      <tr key={hNum} className="sc-row">
        <td className="sc-hole-num">{hNum}</td>
        <td><span style={{ fontSize: 13 }}>{h.par}</span></td>
        <td className="lb-hide-mobile"><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.si}</span></td>
        <td>
          <input className="sc-score-input" type="number" min={1} max={15}
            value={scores[hNum] ?? ''}
            onChange={e => handleChange(hNum, e.target.value)}
            onBlur={() => saveHole(hNum)}
            placeholder="—" />
        </td>
        <td className="lb-hide-mobile" style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {theirScore !== undefined ? theirScore : '—'}
        </td>
        <td style={{ textAlign: 'center', width: 28 }}>
          {matched  ? <span title="Scores agree"    style={{ color: 'var(--green-bright)', fontWeight: 700, fontSize: 13 }}>✓</span> : null}
          {disputed ? <span title="Scores disagree" style={{ color: '#e09a2f',             fontWeight: 700, fontSize: 13 }}>⚠</span> : null}
        </td>
        <td className="sc-save-status">
          {isSav ? <span className="sc-saving">…</span> : isDone ? <span className="sc-saved"><CheckIcon /></span> : hasErr ? <span className="sc-err" title={hasErr}>!</span> : null}
        </td>
      </tr>
    );
  };

  return (
    <div className="comp-section">
      <div className="comp-section-header">
        <div>
          <h3 className="comp-section-title">{title}</h3>
          <p className="comp-section-sub">{subtitle ?? `HCP ${hcp.toFixed(1)} · scores auto-save on blur`}</p>
        </div>
      </div>

      {filled.length > 0 && (
        <div className="sc-running-total" style={{ marginBottom: 12 }}>
          <div className="sc-rt-item">
            <span className="sc-rt-label">Holes</span>
            <span className="sc-rt-value">{filled.length}<span className="sc-rt-denom">/18</span></span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Strokes</span>
            <span className="sc-rt-value">{runScore}</span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Stableford</span>
            <span className="sc-rt-value sc-rt-pts">{runPts}<span className="sc-rt-denom"> pts</span></span>
          </div>
        </div>
      )}

      <div className="scorecard-wrap">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th className="sc-hole">Hole</th>
              <th className="sc-par">Par</th>
              <th className="sc-si lb-hide-mobile">SI</th>
              <th className="sc-score">{myLabel}</th>
              <th className="sc-pts-head lb-hide-mobile">{theirLabel}</th>
              <th style={{ width: 28 }} />
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {filledHoles.map((h, i) => {
              if (i === 9) return [
                <tr key="out" className="sc-subtotal">
                  <td className="sc-subtotal-label">OUT</td>
                  <td>{filledHoles.slice(0,9).reduce((t,x)=>t+x.par,0)}</td>
                  <td className="lb-hide-mobile" /><td /><td className="lb-hide-mobile" /><td /><td />
                </tr>,
                renderRow(h, i),
              ];
              return renderRow(h, i);
            })}
            <tr className="sc-subtotal">
              <td className="sc-subtotal-label">IN</td>
              <td>{filledHoles.slice(9).reduce((t,x)=>t+x.par,0)}</td>
              <td className="lb-hide-mobile" /><td /><td className="lb-hide-mobile" /><td /><td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Live leaderboard ─────────────────────────────────────────────────────────

function LiveLeaderboard({ compId, status }) {
  const navigate = useNavigate();
  const [rows,    setRows]    = useState([]);
  const [format,  setFormat]  = useState('stableford');
  const [loading, setLoading] = useState(true);

  const fetchLb = () =>
    api.get(`/competitions/${compId}/leaderboard`)
      .then(data => { setRows(data.rows ?? data); if (data.format) setFormat(data.format); })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchLb();
    if (status !== 'active') return;
    const iv = setInterval(fetchLb, 15000);
    return () => clearInterval(iv);
  }, [compId, status]);

  const strokeBased = ['stroke', 'net_stroke', 'scramble', 'match_play', 'skins'].includes(format);
  const scoreHeader = format === 'net_stroke' ? 'Net' : strokeBased ? 'Strokes' : 'Stableford';
  const scoreVal    = (r) => format === 'net_stroke' ? r.net_strokes : strokeBased ? (r.holes_played > 0 ? r.total_strokes : '—') : r.total_stableford;

  if (loading) return <div style={{ padding: '20px 0' }}><div className="spinner" /></div>;
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '16px 0' }}>No players entered.</p>;

  return (
    <div className="rounds-table-wrap" style={{ marginTop: 0 }}>
      <table className="lb-table">
        <thead>
          <tr>
            <th className="lb-rank-col">Pos</th>
            <th>Player</th>
            <th className="num">HCP</th>
            <th className="num">Holes</th>
            <th className="num">{scoreHeader}</th>
            <th className="num lb-hide-mobile">Strokes</th>
            <th>Scored by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="lb-row" onClick={() => navigate(`/members/${r.id}`)} style={{ cursor: 'pointer' }}>
              <td className="lb-rank-col">
                <span className="lb-rank-badge" style={
                  i === 0 ? { background: '#B8960C', color: '#fff', border: 'none' } :
                  i === 1 ? { background: '#888',    color: '#fff', border: 'none' } :
                  i === 2 ? { background: '#8B6914', color: '#fff', border: 'none' } : {}
                }>{i + 1}</span>
              </td>
              <td>
                <div className="lb-player-cell">
                  <div className="lb-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                    {(r.first_name?.[0] ?? r.email?.[0] ?? '?').toUpperCase()}
                  </div>
                  <span>{r.first_name || r.last_name ? [r.first_name, r.last_name].filter(Boolean).join(' ') : r.email}</span>
                </div>
              </td>
              <td className="num">{r.handicap != null ? Number(r.handicap).toFixed(1) : '—'}</td>
              <td className="num">{r.holes_played} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/18</span></td>
              <td className="num" style={{ fontWeight: 700, color: 'var(--green-mid)' }}>{scoreVal(r)}</td>
              <td className="num lb-hide-mobile">{r.holes_played > 0 ? r.total_strokes : '—'}</td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {r.scorer_first || r.scorer_last
                  ? [r.scorer_first, r.scorer_last].filter(Boolean).join(' ')
                  : r.scorer_email ?? <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Partner picker ───────────────────────────────────────────────────────────

function PartnerPicker({ comp, myEntry, onPaired }) {
  const [selected, setSel]  = useState('');
  const [saving,  setSaving] = useState(false);
  const [error,   setError]  = useState('');

  // A player is available if they have no scorer assigned and are not scoring anyone else
  const hasScorer  = new Set(comp.entries.filter(e => e.scorer_id).map(e => e.player_id));
  const isAMarker  = new Set(comp.entries.filter(e => e.scorer_id).map(e => e.scorer_id));
  const available  = comp.entries.filter(e =>
    e.player_id !== myEntry.player_id &&
    !hasScorer.has(e.player_id) &&
    !isAMarker.has(e.player_id)
  );

  const handlePair = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`/competitions/${comp.id}/partner`, { partnerId: selected });
      onPaired();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="comp-section">
      <div className="comp-section-header">
        <div>
          <h3 className="comp-section-title">Select your scoring partner</h3>
          <p className="comp-section-sub">Pick a player — you'll enter each other's scorecards</p>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      {available.length === 0 ? (
        <div className="sc-api-notice">
          <InfoIcon />
          All players are already paired. Ask the organiser to reassign if needed.
        </div>
      ) : (
        <>
          <div className="partner-pick-grid">
            {available.map(e => (
              <button
                key={e.player_id}
                type="button"
                className={`partner-pick-btn${selected === e.player_id ? ' partner-pick-selected' : ''}`}
                onClick={() => setSel(e.player_id)}
              >
                <div className="lb-avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
                  {(e.player_first?.[0] ?? e.player_email?.[0] ?? '?').toUpperCase()}
                </div>
                <span className="partner-pick-name">{pName(e)}</span>
                {e.handicap != null && (
                  <span className="handicap-badge" style={{ fontSize: 11 }}>
                    HCP {Number(e.handicap).toFixed(1)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-save" disabled={!selected || saving} onClick={handlePair}>
              {saving ? 'Confirming…' : 'Confirm partner →'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Pairing manager ──────────────────────────────────────────────────────────

function PairingManager({ entries, compId, onUpdate }) {
  const [pairings, setPairings] = useState(() => {
    const p = {};
    for (const e of entries) {
      if (e.scorer_id) {
        const lo = [e.player_id, e.scorer_id].sort()[0];
        const hi = [e.player_id, e.scorer_id].sort()[1];
        p[lo] = hi;
      }
    }
    return p;
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const getPartner = (pid) => {
    if (pairings[pid]) return pairings[pid];
    return Object.keys(pairings).find(k => pairings[k] === pid) ?? null;
  };

  const isPaired = (pid) => getPartner(pid) != null;

  const setPair = (pid, partnerId) => {
    setPairings(prev => {
      const n = { ...prev };
      // clear existing pairing for pid
      delete n[pid];
      for (const k of Object.keys(n)) { if (n[k] === pid) delete n[k]; }
      if (partnerId) {
        const lo = [pid, partnerId].sort()[0];
        const hi = [pid, partnerId].sort()[1];
        n[lo] = hi;
      }
      return n;
    });
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const pairs = [];
      for (const [a, b] of Object.entries(pairings)) {
        pairs.push({ playerId: a, scorerId: b });
        pairs.push({ playerId: b, scorerId: a });
      }
      await api.patch(`/competitions/${compId}/pairs`, { pairs });
      onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const unpaired = (excludeId) =>
    entries.filter(e => e.player_id !== excludeId && !isPaired(e.player_id));

  return (
    <div className="comp-section">
      <div className="comp-section-header">
        <div>
          <h3 className="comp-section-title">Scoring Pairs</h3>
          <p className="comp-section-sub">Assign each player a scoring partner — they will enter scores for each other</p>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="pairing-list">
        {entries.map(e => {
          const partnerId  = getPartner(e.player_id);
          const partnerEntry = partnerId ? entries.find(x => x.player_id === partnerId) : null;
          const avail      = unpaired(e.player_id);

          return (
            <div key={e.player_id} className="pairing-row">
              <div className="pairing-player">
                <div className="lb-avatar" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>
                  {(e.player_first?.[0] ?? e.player_email?.[0] ?? '?').toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{pName(e)}</div>
                  {e.handicap != null && <span className="handicap-badge" style={{ fontSize: 10 }}>HCP {Number(e.handicap).toFixed(1)}</span>}
                </div>
              </div>

              <span className="pairing-arrow">↔ scores for</span>

              <div className="pairing-partner">
                {partnerEntry ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{pName(partnerEntry)}</span>
                    <button className="btn-delete" onClick={() => setPair(e.player_id, null)} title="Remove">×</button>
                  </div>
                ) : (
                  <select className="form-input" style={{ height: 36, fontSize: 13, width: 200 }}
                    value="" onChange={ev => setPair(e.player_id, ev.target.value)}>
                    <option value="">Assign partner…</option>
                    {avail.map(u => (
                      <option key={u.player_id} value={u.player_id}>{pName(u)}</option>
                    ))}
                    {avail.length === 0 && <option disabled>No unassigned players</option>}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save pairs'}
        </button>
      </div>
    </div>
  );
}

// ─── Competition detail ───────────────────────────────────────────────────────

function CompetitionDetail({ id }) {
  const { user } = useAuth();
  const { activeClub } = useClub();
  const navigate = useNavigate();
  const [comp,    setComp]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [acting,  setActing]  = useState(false);

  const load = () =>
    api.get(`/competitions/${id}`)
      .then(setComp)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, [id]);

  const handleEnter = async () => {
    setActing(true);
    try { await api.post(`/competitions/${id}/enter`); load(); }
    catch (e) { alert(e.message); }
    finally { setActing(false); }
  };

  const handleWithdraw = async () => {
    if (!confirm('Withdraw from this competition?')) return;
    setActing(true);
    try { await api.delete(`/competitions/${id}/enter`); load(); }
    catch (e) { alert(e.message); }
    finally { setActing(false); }
  };

  const handleStatus = async (status) => {
    const msg = status === 'active' ? 'Start this competition? Players will be able to submit live scores.' : 'Mark this competition as completed?';
    if (!confirm(msg)) return;
    setActing(true);
    try { await api.patch(`/competitions/${id}/status`, { status }); load(); }
    catch (e) { alert(e.message); }
    finally { setActing(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this competition? All entries and scores will be permanently removed.')) return;
    setActing(true);
    try {
      await api.delete(`/competitions/${id}`);
      navigate('/competitions');
    } catch (e) {
      alert(e.message);
      setActing(false);
    }
  };

  if (loading) return (
    <div className="app-layout"><AppNav />
      <main className="main-content"><div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><div className="spinner" /></div></main>
    </div>
  );

  if (error || !comp) return (
    <div className="app-layout"><AppNav />
      <main className="main-content">
        <Link to="/competitions" className="back-link">← Competitions</Link>
        <div className="form-error" style={{ marginTop: 16 }}>{error || 'Not found'}</div>
      </main>
    </div>
  );

  const creatorName = comp.creator_first || comp.creator_last
    ? [comp.creator_first, comp.creator_last].filter(Boolean).join(' ')
    : comp.creator_email;

  const myEntry    = comp.myEntry;
  const scoringFor = comp.scoringFor;

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 860 }}>
        <Link to="/competitions" className="back-link" style={{ marginBottom: 24, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-secondary)' }}>
          ← Competitions
        </Link>

        {/* ── Header card ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>{comp.name}</h2>
                <StatusBadge status={comp.status} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {fmtDate(comp.date)} · {comp.course_name}
                {comp.tee_name && <span className="tee-badge" style={{ marginLeft: 8 }}>{comp.tee_name}</span>}
              </p>
              {comp.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>{comp.description}</p>}
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Created by {creatorName} · {comp.entries.length} player{comp.entries.length !== 1 ? 's' : ''} entered
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {comp.status === 'upcoming' && !myEntry && (
                <button className="btn btn-save" style={{ height: 36 }} disabled={acting} onClick={handleEnter}>
                  {acting ? 'Entering…' : 'Enter competition'}
                </button>
              )}
              {comp.status === 'upcoming' && myEntry && (
                <button className="btn btn-ghost" style={{ height: 36 }} disabled={acting} onClick={handleWithdraw}>
                  Withdraw
                </button>
              )}
              {comp.isCreator && comp.status === 'upcoming' && (
                <button className="btn btn-secondary" style={{ height: 36 }} disabled={acting} onClick={() => handleStatus('active')}>
                  ▶ Start competition
                </button>
              )}
              {comp.isCreator && comp.status === 'active' && (
                <button className="btn btn-secondary" style={{ height: 36 }} disabled={acting} onClick={() => handleStatus('completed')}>
                  ✓ Mark complete
                </button>
              )}
              {(
                <button className="btn btn-danger" style={{ height: 36 }} disabled={acting} onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Entries list */}
          {comp.entries.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {comp.entries.map(e => (
                  <div
                    key={e.player_id}
                    className="comp-entry-chip"
                    onClick={() => navigate(`/members/${e.player_id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span>{pName(e)}</span>
                    {e.scorer_id && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        · scored by {pName(e, { first: 'scorer_first', last: 'scorer_last', email: 'scorer_email' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Own scorecard (active + entered) ── */}
        {comp.status === 'active' && myEntry && comp.myScorecard && (
          <div className="card" style={{ marginBottom: 16 }}>
            <ScoringPanel
              comp={comp}
              playerId={myEntry.player_id}
              hcp={parseFloat(myEntry.handicap) || 0}
              mySubmissions={comp.myScorecard.selfScores}
              theirSubmissions={comp.myScorecard.markerScores}
              title="Your scorecard"
              subtitle={`HCP ${(parseFloat(myEntry.handicap) || 0).toFixed(1)} · scores auto-save on blur`}
              myLabel="My score"
              theirLabel="Marker"
              onScoresSaved={load}
            />
          </div>
        )}

        {/* ── Partner picker (active + entered + no partner yet) ── */}
        {comp.status === 'active' && myEntry && !scoringFor && (
          <div className="card" style={{ marginBottom: 16 }}>
            <PartnerPicker comp={comp} myEntry={myEntry} onPaired={load} />
          </div>
        )}

        {/* ── Partner scorecard (active + assigned as a marker) ── */}
        {comp.status === 'active' && scoringFor && comp.partnerScorecard && (
          <div className="card" style={{ marginBottom: 16 }}>
            <ScoringPanel
              comp={comp}
              playerId={scoringFor.player_id}
              hcp={parseFloat(scoringFor.handicap) || 0}
              mySubmissions={comp.partnerScorecard.markerScores}
              theirSubmissions={comp.partnerScorecard.selfScores}
              title={`Marking ${pName(scoringFor)}`}
              subtitle={`HCP ${(parseFloat(scoringFor.handicap) || 0).toFixed(1)} · your entries are the official scores — ${pName(scoringFor)}'s self-entries shown for reference`}
              myLabel="Your entry"
              theirLabel={pName(scoringFor)}
              onScoresSaved={load}
            />
          </div>
        )}

        {/* ── Pairing manager (upcoming + creator) ── */}
        {comp.status === 'upcoming' && comp.isCreator && comp.entries.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <PairingManager entries={comp.entries} compId={id} onUpdate={load} />
          </div>
        )}

        {/* ── Live leaderboard (active or completed) ── */}
        {(comp.status === 'active' || comp.status === 'completed') && (
          <div className="card">
            <div className="comp-section-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 className="comp-section-title">
                  {comp.status === 'active' ? 'Live Leaderboard' : 'Final Results'}
                </h3>
                {comp.status === 'active' && (
                  <p className="comp-section-sub">Updates automatically every 15 seconds</p>
                )}
              </div>
            </div>
            <LiveLeaderboard compId={id} status={comp.status} />
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default function Competitions() {
  const { id } = useParams();
  if (!id)          return <CompetitionList />;
  if (id === 'new') return <CreateCompetition />;
  return <CompetitionDetail id={id} />;
}
