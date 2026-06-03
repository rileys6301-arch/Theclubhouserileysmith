import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import CourseSearch from '../components/CourseSearch';
import { font, space } from '../tokens.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultHoles() {
  const pars = [4,4,3,4,5,3,4,5,4, 4,4,3,4,5,3,4,5,4];
  const sis  = [1,3,5,7,9,11,13,15,17, 2,4,6,8,10,12,14,16,18];
  return pars.map((par, i) => ({ number: i + 1, par, si: sis[i] }));
}

function extractTees(data) {
  if (!Array.isArray(data.tees)) return [];
  return data.tees.filter(t => Array.isArray(t.holes) && t.holes.length >= 9);
}

function calcPoints(score, par, si, hcp) {
  if (score === null) return null;
  const shots = Math.floor(hcp / 18) + (si <= (hcp % 18) ? 1 : 0);
  return Math.max(0, 2 + par + shots - score);
}

function ptsCls(pts) {
  if (pts === null) return 'sc-pts sc-pts-empty';
  if (pts === 0)    return 'sc-pts sc-pts-zero';
  if (pts === 1)    return 'sc-pts sc-pts-bogey';
  if (pts === 2)    return 'sc-pts sc-pts-par';
  if (pts === 3)    return 'sc-pts sc-pts-birdie';
  return                   'sc-pts sc-pts-eagle';
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

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ─── Step 3 — Scorecard ──────────────────────────────────────────────────────

function StepScorecard({ courseName, teeName, initialHoles, slopeRating, courseRating, onSave, onBack }) {
  const { user } = useAuth();
  const profileHcp = user?.handicap != null ? Number(user.handicap) : null;
  const [date,        setDate]       = useState(today());
  const [holes,       setHoles]      = useState(initialHoles);
  const [scores,      setScores]     = useState(() => Array(18).fill(''));
  const [handicap,    setHandicap]   = useState(profileHcp != null ? String(profileHcp) : '');
  const [notes,       setNotes]      = useState('');
  const [saving,      setSaving]     = useState(false);
  const [error,       setError]      = useState('');
  const [nineHole,    setNineHole]   = useState(false);
  const [nineHoleSide, setNineHoleSide] = useState('front'); // 'front' | 'back'

  // Indices into holes/scores array that are active
  const activeStart = nineHole && nineHoleSide === 'back' ? 9 : 0;
  const activeEnd   = nineHole ? activeStart + 9 : 18;

  const hcpIndex = Math.max(0, parseFloat(handicap) || 0);
  const parTotal  = holes.reduce((s, h) => s + h.par, 0);
  // WHS formula: Course Handicap = Index × (Slope / 113) + (Course Rating − Par)
  const courseHcp = slopeRating != null
    ? Math.round(hcpIndex * (slopeRating / 113) + ((courseRating ?? parTotal) - parTotal))
    : hcpIndex;
  const hcp = Math.max(0, courseHcp);
  const fromProfile = profileHcp != null && parseFloat(handicap) === profileHcp;

  const setScore = (i, v) => setScores(prev => { const n = [...prev]; n[i] = v; return n; });
  const setPar   = (i, v) => setHoles(prev  => { const n = [...prev]; n[i] = { ...n[i], par: parseInt(v) || n[i].par }; return n; });
  const setSi    = (i, v) => setHoles(prev  => { const n = [...prev]; n[i] = { ...n[i], si:  parseInt(v) || n[i].si  }; return n; });

  const rowData = holes.map((h, i) => {
    const s = scores[i] !== '' ? parseInt(scores[i]) : null;
    return { ...h, score: s, pts: calcPoints(s, h.par, h.si, hcp) };
  });

  // Active rows depend on 9/18 hole mode
  const activeRows = rowData.slice(activeStart, activeEnd);
  const front = nineHole ? [] : rowData.slice(0, 9);
  const back  = nineHole ? [] : rowData.slice(9);

  const sumPar   = (arr) => arr.reduce((t, h) => t + h.par, 0);
  const sumScore = (arr) => arr.every(h => h.score !== null) ? arr.reduce((t, h) => t + h.score, 0) : null;
  const sumPts   = (arr) => arr.every(h => h.pts   !== null) ? arr.reduce((t, h) => t + h.pts,   0) : null;

  const totalScore = sumScore(activeRows);
  const totalPts   = sumPts(activeRows);

  const filledRows    = activeRows.filter(h => h.score !== null);
  const runningScore  = filledRows.reduce((t, h) => t + h.score, 0);
  const runningPts    = filledRows.reduce((t, h) => t + (h.pts ?? 0), 0);
  const holesComplete = filledRows.length;
  const totalHoles    = nineHole ? 9 : 18;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const activeScores = scores.slice(activeStart, activeEnd);
    if (!activeScores.every(s => s !== '' && !isNaN(parseInt(s)))) {
      setError(`Please enter a score for every hole`);
      return;
    }
    setSaving(true);
    try {
      await api.post('/rounds', {
        playedAt:   date,
        courseName,
        score:      activeRows.reduce((t, h) => t + h.score, 0),
        stableford: activeRows.reduce((t, h) => t + (h.pts ?? 0), 0),
        notes:      notes.trim() || null,
        isNineHole: nineHole,
        holes: activeRows.map(h => ({
          holeNumber:       h.number,
          par:              h.par,
          strokeIndex:      h.si,
          score:            h.score,
          stablefordPoints: h.pts ?? 0,
        })),
      });
      onSave();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="log-form" onSubmit={handleSubmit}>
      {/* Course + tee header */}
      <div className="sc-course-header">
        <button type="button" className="back-link-btn" onClick={onBack}>← Change tee</button>
        <div className="sc-course-info">
          <span className="sc-course-name">{courseName}</span>
          <span className="tee-badge">{teeName}</span>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: space.md }}><ErrIcon /> {error}</div>}

      {/* Date + handicap */}
      <div className="log-form-setup">
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={date}
            onChange={e => setDate(e.target.value)} max={today()} required />
        </div>
        <div className="form-group">
          <label className="form-label">Handicap Index</label>
          <input className="form-input" type="number" step="0.1" min="0" max="54"
            value={handicap} onChange={e => setHandicap(e.target.value)} placeholder="e.g. 18.0" />
          {fromProfile && (
            <span style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: space.xs, display: 'block' }}>
              From your profile
            </span>
          )}
          {profileHcp == null && (
            <span style={{ fontSize: font.xs, color: 'var(--text-muted)', marginTop: space.xs, display: 'block' }}>
              <Link to="/profile" style={{ color: 'var(--tan)' }}>Set your handicap in your profile</Link> to auto-fill this
            </span>
          )}
          {slopeRating != null && hcpIndex > 0 && (
            <span style={{ fontSize: font.xs, color: 'var(--text-secondary)', marginTop: 6, display: 'block', fontWeight: 500 }}>
              Course handicap: <strong style={{ color: 'var(--tan)', fontSize: font.sm }}>{hcp}</strong>
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                ({hcpIndex} × {slopeRating}/113{courseRating != null ? ` + ${courseRating - parTotal}` : ''})
              </span>
            </span>
          )}
          {slopeRating == null && hcpIndex > 0 && (
            <span style={{ fontSize: font.xs, color: 'var(--text-secondary)', marginTop: 6, display: 'block', fontWeight: 500 }}>
              Course handicap: <strong style={{ color: 'var(--tan)', fontSize: font.sm }}>{hcp}</strong>
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>(no slope data)</span>
            </span>
          )}
        </div>
      </div>

      {/* 9-hole toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={nineHole}
            onChange={e => { setNineHole(e.target.checked); setScores(Array(18).fill('')); }}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          9-hole round
        </label>
        {nineHole && (
          <div style={{ display: 'flex', gap: 6 }}>
            {['front', 'back'].map(side => (
              <button
                key={side}
                type="button"
                onClick={() => { setNineHoleSide(side); setScores(Array(18).fill('')); }}
                style={{
                  padding: '3px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  border: '1.5px solid var(--tan)',
                  background: nineHoleSide === side ? 'var(--tan)' : 'transparent',
                  color: nineHoleSide === side ? '#fff' : 'var(--tan)',
                  cursor: 'pointer',
                }}
              >
                {side === 'front' ? 'Front 9' : 'Back 9'}
              </button>
            ))}
          </div>
        )}
      </div>
      {nineHole && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
            9-hole rounds do not count towards your handicap
          </span>
        </div>
      )}

      {/* Running total */}
      {holesComplete > 0 && (
        <div className="sc-running-total">
          <div className="sc-rt-item">
            <span className="sc-rt-label">Holes</span>
            <span className="sc-rt-value">{holesComplete}<span className="sc-rt-denom">/{totalHoles}</span></span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Strokes</span>
            <span className="sc-rt-value">{runningScore}</span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Stableford</span>
            <span className="sc-rt-value sc-rt-pts">{runningPts}<span className="sc-rt-denom"> pts</span></span>
          </div>
        </div>
      )}

      {/* Scorecard */}
      <div className="scorecard-wrap">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th className="sc-hole">Hole</th>
              <th className="sc-par">Par</th>
              <th className="sc-si">SI</th>
              <th className="sc-score">Score</th>
              <th className="sc-pts-head">Pts</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((h, idx) => {
              const i = activeStart + idx;
              return (
                <>
                  {!nineHole && i === 9 && (
                    <tr key="out" className="sc-subtotal">
                      <td className="sc-subtotal-label">OUT</td>
                      <td>{sumPar(front)}</td>
                      <td />
                      <td>{sumScore(front) ?? '—'}</td>
                      <td className="sc-pts">{sumPts(front) ?? '—'}</td>
                    </tr>
                  )}
                  <tr key={h.number} className="sc-row">
                    <td className="sc-hole-num">{h.number}</td>
                    <td>
                      <input className="sc-editable" type="number" min={3} max={6}
                        value={h.par} onChange={e => setPar(i, e.target.value)} />
                    </td>
                    <td>
                      <input className="sc-editable" type="number" min={1} max={18}
                        value={h.si} onChange={e => setSi(i, e.target.value)} />
                    </td>
                    <td>
                      <input className="sc-score-input" type="number" min={1} max={15}
                        value={scores[i]} onChange={e => setScore(i, e.target.value)}
                        placeholder="—" />
                    </td>
                    <td className={ptsCls(h.pts)}>{h.pts !== null ? h.pts : '—'}</td>
                  </tr>
                </>
              );
            })}
            {!nineHole && (
              <tr key="in" className="sc-subtotal">
                <td className="sc-subtotal-label">IN</td>
                <td>{sumPar(back)}</td>
                <td />
                <td>{sumScore(back) ?? '—'}</td>
                <td className="sc-pts">{sumPts(back) ?? '—'}</td>
              </tr>
            )}
            <tr className="sc-total">
              <td className="sc-subtotal-label">TOTAL</td>
              <td><strong>{sumPar(activeRows)}</strong></td>
              <td />
              <td><strong>{totalScore ?? '—'}</strong></td>
              <td className={`sc-pts ${totalPts !== null ? 'sc-pts-birdie' : 'sc-pts-empty'}`}>
                <strong>{totalPts !== null ? `${totalPts} pts` : '—'}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes + actions */}
      <div className="form-group" style={{ marginTop: space.md }}>
        <label className="form-label">
          Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input className="form-input" type="text" placeholder="Conditions, highlights…"
          value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      <div className="log-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Cancel</button>
        <button type="submit" className="btn btn-save" disabled={saving}>
          {saving ? 'Saving…' : 'Save round'}
        </button>
      </div>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LogRound() {
  const navigate = useNavigate();

  const [step,    setStep]    = useState('course'); // 'course' | 'tee' | 'scorecard'
  const [course,  setCourse]  = useState(null);     // { id, name }
  const [tees,    setTees]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [selTee,  setSelTee]  = useState(null);     // { name, holes[] }

  const handleCourseSelect = async (name, id) => {
    if (!id) return;
    setCourse({ id, name });
    setTees([]);
    setSelTee(null);
    setLoading(true);
    setStep('tee');
    try {
      const data = await api.get(`/courses/detail/${id}`);
      const extracted = extractTees(data);
      setTees(extracted);
      if (extracted.length === 1) {
        setSelTee(extracted[0]);
        setStep('scorecard');
      }
    } catch {
      setTees([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTeeSelect = (tee) => {
    setSelTee(tee);
    setStep('scorecard');
  };

  const handleManual = () => {
    setSelTee({ name: 'Manual entry', holes: defaultHoles() });
    setStep('scorecard');
  };

  const stepLabel =
    step === 'course'    ? 'Step 1 — Select a course' :
    step === 'tee'       ? 'Step 2 — Select a tee' :
                           'Step 3 — Enter your scores';

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 760 }}>
        <div className="page-header" style={{ marginBottom: space.lg }}>
          <h1 className="page-title">Log a Round</h1>
          <p className="page-subtitle">{stepLabel}</p>
        </div>

        {/* ── Step 1: Course ── */}
        {step === 'course' && (
          <div className="card">
            <span className="card-title" style={{ display: 'block', marginBottom: 16 }}>Search for a course</span>
            <CourseSearch onSelect={handleCourseSelect} />
          </div>
        )}

        {/* ── Step 2: Tee ── */}
        {step === 'tee' && (
          <div className="card">
            <button type="button" className="back-link-btn" onClick={() => setStep('course')}>
              ← Back to course search
            </button>
            <span className="card-title" style={{ display: 'block', marginTop: 16, marginBottom: 4 }}>Select a tee</span>
            <p style={{ fontSize: font.sm, color: 'var(--text-secondary)', marginBottom: space.xl }}>{course?.name}</p>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <div className="spinner" />
              </div>
            ) : tees.length > 0 ? (
              <div className="tee-grid">
                {tees.map(t => (
                  <button key={t.name} type="button" className="tee-btn" onClick={() => handleTeeSelect(t)}>
                    <span className="tee-btn-name">{t.name}</span>
                    <span className="tee-btn-par">Par {t.holes.reduce((s, h) => s + h.par, 0)}</span>
                    {t.slopeRating != null && (
                      <span className="tee-btn-par">Slope {t.slopeRating}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="sc-api-notice">
                  <InfoIcon />
                  No tee data found for this course. Par and stroke index will use defaults — you can edit them in the scorecard.
                </div>
                <button type="button" className="btn btn-secondary" onClick={handleManual}
                  style={{ width: '100%', marginTop: 12, height: 44 }}>
                  Continue with defaults
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Step 3: Scorecard ── */}
        {step === 'scorecard' && selTee && (
          <div className="card">
            <StepScorecard
              courseName={course?.name ?? ''}
              teeName={selTee.name}
              initialHoles={selTee.holes}
              slopeRating={selTee.slopeRating ?? null}
              courseRating={selTee.courseRating ?? null}
              onSave={() => navigate('/profile')}
              onBack={() => setStep('tee')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
