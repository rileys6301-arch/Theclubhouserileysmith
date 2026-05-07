import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';
import CourseSearch from '../components/CourseSearch';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultHoles() {
  const pars = [4,4,3,4,5,3,4,5,4, 4,4,3,4,5,3,4,5,4];
  const sis  = [1,3,5,7,9,11,13,15,17, 2,4,6,8,10,12,14,16,18];
  return pars.map((par, i) => ({ number: i + 1, par, si: sis[i] }));
}

function calcPoints(score, par, si, hcp) {
  if (score === null) return null;
  const shots = Math.floor(hcp / 18) + (si <= (hcp % 18) ? 1 : 0);
  return Math.max(0, 2 + par + shots - score);
}

function shotsOnHole(si, hcp) {
  return Math.floor(hcp / 18) + (si <= (hcp % 18) ? 1 : 0);
}

function playerName(u) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.email;
}

// ─── Phase: Check for existing round ─────────────────────────────────────────

function PhaseCheck({ onNewRound, onContinue }) {
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    api.get('/rounds/my-live')
      .then(round => {
        if (!round) { onNewRound(); return; }
        setExisting(round);
        setChecking(false);
      })
      .catch(() => { onNewRound(); });
  }, []);

  if (checking) {
    return (
      <div className="app-layout">
        <AppNav />
        <div className="loading-screen" style={{ minHeight: 'unset', flex: 1 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const holesPlayed = existing?.scored_holes?.length ?? 0;

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 480 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <h1 className="page-title">Live Round</h1>
        </div>
        <div className="card">
          <span className="card-title">Round In Progress</span>
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 600, fontSize: 17 }}>{existing.course_name}</p>
            {existing.tee_name && (
              <span className="tee-badge" style={{ marginTop: 6, display: 'inline-flex' }}>{existing.tee_name}</span>
            )}
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8 }}>
              {holesPlayed} of 18 holes played · {existing.stableford} pts
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
            <button className="btn btn-secondary" style={{ height: 48 }} onClick={() => onContinue(existing)}>
              Continue This Round
            </button>
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--error)', height: 44 }}
              onClick={onNewRound}
            >
              Discard &amp; Start New Round
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Phase: Setup (course → tee → competition → start) ───────────────────────

function PhaseSetup({ onStart }) {
  const { user } = useAuth();
  const [step,         setStep]         = useState('course');
  const [course,       setCourse]       = useState(null);
  const [tees,         setTees]         = useState([]);
  const [selTee,       setSelTee]       = useState(null);
  const [loadingTees,  setLoadingTees]  = useState(false);
  const [competitions, setCompetitions] = useState([]);
  const [selComp,      setSelComp]      = useState(null);
  const [starting,     setStarting]     = useState(false);
  const [startError,   setStartError]   = useState('');

  useEffect(() => {
    api.get('/competitions')
      .then(comps => setCompetitions(comps.filter(c => c.status === 'active' && c.entered)))
      .catch(() => {});
  }, []);

  const profileHcp = user?.handicap != null ? Number(user.handicap) : 0;
  const parTotal   = selTee?.holes?.reduce((s, h) => s + h.par, 0) ?? 72;
  const courseHcp  = selTee?.slopeRating != null
    ? Math.max(0, Math.round(profileHcp * (selTee.slopeRating / 113) + ((selTee.courseRating ?? parTotal) - parTotal)))
    : Math.max(0, Math.round(profileHcp));

  const handleCourseSelect = async (name, id) => {
    if (!id) return;
    setCourse({ id, name });
    setTees([]);
    setSelTee(null);
    setLoadingTees(true);
    setStep('tee');
    try {
      const data = await api.get(`/courses/detail/${id}`);
      const extracted = Array.isArray(data.tees)
        ? data.tees.filter(t => Array.isArray(t.holes) && t.holes.length >= 9)
        : [];
      setTees(extracted);
      if (extracted.length === 1) {
        setSelTee(extracted[0]);
        setStep('confirm');
      }
    } catch {
      setTees([]);
    } finally {
      setLoadingTees(false);
    }
  };

  const handleTeeSelect = (tee) => {
    setSelTee(tee);
    setStep('confirm');
  };

  const handleManual = () => {
    setSelTee({ name: 'Manual entry', holes: defaultHoles(), slopeRating: null, courseRating: null });
    setStep('confirm');
  };

  const handleStart = async () => {
    if (!selTee || !course) return;
    setStarting(true);
    setStartError('');
    try {
      const holeData = selTee.holes.map(h => ({ number: h.number, par: h.par, si: h.si }));
      const round = await api.post('/rounds/start', {
        playedAt:      today(),
        courseName:    course.name,
        teeName:       selTee.name,
        slopeRating:   selTee.slopeRating ?? null,
        courseRating:  selTee.courseRating ?? null,
        courseHandicap: courseHcp,
        handicapIndex:  profileHcp,
        holeData,
        competitionId:  selComp ?? null,
      });
      const compName = selComp ? competitions.find(c => c.id === selComp)?.name ?? null : null;
      onStart({
        roundId:         round.id,
        holeData,
        courseHcp,
        courseName:      course.name,
        teeName:         selTee.name,
        competitionName: compName,
        initScores:      Array(18).fill(null),
      });
    } catch (err) {
      setStartError(err.message);
      setStarting(false);
    }
  };

  const stepLabel =
    step === 'course'  ? 'Step 1 — Select a course' :
    step === 'tee'     ? 'Step 2 — Select a tee' :
                         'Step 3 — Confirm & start';

  return (
    <div className="app-layout">
      <AppNav />
      <main className="main-content" style={{ maxWidth: 680 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <h1 className="page-title">Start Live Round</h1>
          <p className="page-subtitle">{stepLabel}</p>
        </div>

        {/* ── Course ── */}
        {step === 'course' && (
          <div className="card">
            <span className="card-title" style={{ display: 'block', marginBottom: 16 }}>Search for a course</span>
            <CourseSearch onSelect={handleCourseSelect} />
          </div>
        )}

        {/* ── Tee ── */}
        {step === 'tee' && (
          <div className="card">
            <button type="button" className="back-link-btn" onClick={() => setStep('course')}>← Back</button>
            <span className="card-title" style={{ display: 'block', marginTop: 16, marginBottom: 4 }}>Select a tee</span>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{course?.name}</p>
            {loadingTees ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
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
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  No tee data found — par and stroke index will use defaults.
                </p>
                <button type="button" className="btn btn-secondary" onClick={handleManual} style={{ width: '100%', height: 44 }}>
                  Continue with defaults
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Confirm + competition ── */}
        {step === 'confirm' && selTee && (
          <div className="card">
            <button type="button" className="back-link-btn" onClick={() => setStep('tee')}>← Change tee</button>

            <div style={{ marginTop: 20, marginBottom: 24, padding: '14px 18px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{course?.name}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="tee-badge">{selTee.name}</span>
                {selTee.slopeRating != null && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                    Slope {selTee.slopeRating}
                  </span>
                )}
              </div>
              {profileHcp > 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
                  Course handicap: <strong style={{ color: 'var(--tan)' }}>{courseHcp}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                    (index {profileHcp}{selTee.slopeRating ? ` · slope ${selTee.slopeRating}` : ''})
                  </span>
                </p>
              )}
            </div>

            {competitions.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--tan)', marginBottom: 10 }}>
                  Link to competition (optional)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelComp(null)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1.5px solid ${selComp === null ? 'rgba(94,155,58,0.5)' : 'var(--border)'}`,
                      background: selComp === null ? 'rgba(94,155,58,0.08)' : 'var(--bg-elevated)',
                      color: 'var(--text-secondary)',
                      fontSize: 14,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    No competition — practice round
                  </button>
                  {competitions.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelComp(c.id)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        border: `1.5px solid ${selComp === c.id ? 'rgba(94,155,58,0.5)' : 'var(--border)'}`,
                        background: selComp === c.id ? 'rgba(94,155,58,0.08)' : 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      🏆 {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {startError && (
              <div className="form-error" style={{ marginBottom: 16 }}>{startError}</div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStart}
              disabled={starting}
              style={{ marginTop: 0, width: '100%', height: 52, fontSize: 16 }}
            >
              {starting ? 'Starting…' : '⛳ Start Round'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Phase: Playing (hole-by-hole scoring) ────────────────────────────────────

function PhasePlaying({ roundId, holeData, courseHcp, courseName, teeName, competitionName, initScores }) {
  const navigate = useNavigate();

  const [currentHole, setCurrentHole] = useState(() => {
    const idx = initScores.findIndex(s => s === null);
    return idx === -1 ? 0 : idx;
  });
  const [scores,      setScores]      = useState(initScores);
  const [savedScores, setSavedScores] = useState([...initScores]);
  const [savingSet,   setSavingSet]   = useState(new Set());
  const [errorSet,    setErrorSet]    = useState(new Set());
  const [finishing,   setFinishing]   = useState(false);
  const [finishError, setFinishError] = useState('');

  const saveTimers = useRef(Array(18).fill(null));

  const h        = holeData[currentHole];
  const hShots   = shotsOnHole(h.si, courseHcp);
  const curScore = scores[currentHole];
  const curPts   = calcPoints(curScore, h.par, h.si, courseHcp);

  const holesPlayed = scores.filter(s => s !== null).length;
  const totalScore  = scores.reduce((t, s) => t + (s ?? 0), 0);
  const totalPts    = scores.reduce((t, s, i) => {
    if (s === null) return t;
    return t + Math.max(0, calcPoints(s, holeData[i].par, holeData[i].si, courseHcp) ?? 0);
  }, 0);

  function scheduleSave(holeIdx, score) {
    if (saveTimers.current[holeIdx]) clearTimeout(saveTimers.current[holeIdx]);
    setSavingSet(prev => new Set([...prev, holeIdx]));
    setErrorSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
    saveTimers.current[holeIdx] = setTimeout(() => doSave(holeIdx, score), 1200);
  }

  async function doSave(holeIdx, score) {
    const hole = holeData[holeIdx];
    const pts  = Math.max(0, calcPoints(score, hole.par, hole.si, courseHcp) ?? 0);
    try {
      await api.patch(`/rounds/${roundId}/hole`, {
        holeNumber:       holeIdx + 1,
        par:              hole.par,
        strokeIndex:      hole.si,
        score,
        stablefordPoints: pts,
      });
      setSavedScores(prev => { const n = [...prev]; n[holeIdx] = score; return n; });
      setSavingSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
    } catch {
      setSavingSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
      setErrorSet(prev => new Set([...prev, holeIdx]));
    }
  }

  function changeScore(delta) {
    setScores(prev => {
      const n = [...prev];
      if (n[currentHole] === null) n[currentHole] = holeData[currentHole].par;
      n[currentHole] = Math.max(1, Math.min(15, n[currentHole] + delta));
      scheduleSave(currentHole, n[currentHole]);
      return n;
    });
  }

  async function handleFinish() {
    setFinishing(true);
    setFinishError('');
    // Flush any pending saves
    for (let i = 0; i < 18; i++) {
      if (saveTimers.current[i]) {
        clearTimeout(saveTimers.current[i]);
        const s = scores[i];
        if (s !== null && s !== savedScores[i]) await doSave(i, s);
      }
    }
    try {
      await api.post(`/rounds/${roundId}/finish`);
      navigate('/profile');
    } catch (err) {
      setFinishError(err.message ?? 'Could not finish round');
      setFinishing(false);
    }
  }

  async function handleAbandon() {
    if (!window.confirm('Abandon this round? Your scores will not be saved.')) return;
    try { await api.delete(`/rounds/${roundId}`); } catch {}
    navigate('/');
  }

  function ptsColor(pts) {
    if (pts === null) return 'var(--text-muted)';
    if (pts === 0)   return 'var(--error)';
    if (pts === 1)   return 'var(--text-muted)';
    if (pts === 2)   return 'var(--text-secondary)';
    if (pts === 3)   return 'var(--green-bright)';
    return 'var(--tan)';
  }

  return (
    <div className="app-layout">
      <AppNav />
      <div className="lr-container">

        {/* Info bar */}
        <div className="lr-info-bar">
          <span className="lr-course-name">{courseName}</span>
          <span className="tee-badge">{teeName}</span>
          {competitionName && (
            <span className="comp-badge comp-badge-active" style={{ fontSize: 11 }}>🏆 {competitionName}</span>
          )}
        </div>

        {/* Running totals */}
        <div className="sc-running-total lr-totals">
          <div className="sc-rt-item">
            <span className="sc-rt-label">Holes</span>
            <span className="sc-rt-value">{holesPlayed}<span className="sc-rt-denom">/18</span></span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Score</span>
            <span className="sc-rt-value">{holesPlayed > 0 ? totalScore : '—'}</span>
          </div>
          <div className="sc-rt-divider" />
          <div className="sc-rt-item">
            <span className="sc-rt-label">Stableford</span>
            <span className="sc-rt-value sc-rt-pts">
              {holesPlayed > 0 ? totalPts : '—'}<span className="sc-rt-denom"> pts</span>
            </span>
          </div>
        </div>

        {/* Main hole card */}
        <div className="lr-hole-card">
          <div className="lr-hole-label">HOLE</div>
          <div className="lr-hole-num">{currentHole + 1}</div>

          <div className="lr-hole-meta">
            <span>Par {h.par}</span>
            <span className="lr-meta-dot">·</span>
            <span>SI {h.si}</span>
            {hShots > 0 && (
              <span className="lr-shots-pill">+{hShots} shot{hShots > 1 ? 's' : ''}</span>
            )}
          </div>

          <div className="lr-score-row">
            <button
              className="lr-score-btn lr-minus"
              onClick={() => changeScore(-1)}
              disabled={curScore !== null && curScore <= 1}
            >−</button>

            <span className={`lr-score-display${curScore === null ? ' lr-score-empty' : ''}`}>
              {curScore ?? '—'}
            </span>

            <button
              className="lr-score-btn lr-plus"
              onClick={() => changeScore(+1)}
              disabled={curScore !== null && curScore >= 15}
            >+</button>
          </div>

          {curScore !== null && (
            <div className="lr-pts-display" style={{ color: ptsColor(curPts) }}>
              {curPts} pt{curPts !== 1 ? 's' : ''}
              {curPts >= 4 ? ' 🦅' : curPts === 3 ? ' 🐦' : ''}
            </div>
          )}
        </div>

        {/* Hole navigation */}
        <div className="lr-nav">
          <button
            className="btn btn-ghost lr-nav-btn"
            onClick={() => setCurrentHole(h => Math.max(0, h - 1))}
            disabled={currentHole === 0}
          >
            ← Hole {currentHole}
          </button>
          <button
            className="btn btn-ghost lr-nav-btn"
            onClick={() => setCurrentHole(h => Math.min(17, h + 1))}
            disabled={currentHole === 17}
          >
            Hole {currentHole + 2} →
          </button>
        </div>

        {/* Mini scorecard strip */}
        <div className="lr-strip">
          {holeData.map((hole, i) => {
            const s    = scores[i];
            const pts  = s !== null ? calcPoints(s, hole.par, hole.si, courseHcp) : null;
            const isCur = i === currentHole;
            const isSav = savingSet.has(i);
            const isErr = errorSet.has(i);
            return (
              <button
                key={i}
                className={`lr-strip-hole${isCur ? ' lr-strip-active' : ''}`}
                onClick={() => setCurrentHole(i)}
                style={{ color: pts !== null ? ptsColor(pts) : undefined }}
              >
                <span className="lr-strip-num">{i + 1}</span>
                <span className="lr-strip-score">
                  {isSav ? <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>…</span>
                   : isErr ? <span style={{ color: 'var(--error)', fontSize: 11 }}>!</span>
                   : s !== null ? s : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* Finish / abandon */}
        {finishError && (
          <div className="form-error" style={{ margin: '0 16px 4px' }}>{finishError}</div>
        )}
        <div className="lr-actions">
          <button className="btn btn-ghost" onClick={handleAbandon} style={{ color: 'var(--error)' }}>
            Abandon
          </button>
          <button
            className="btn btn-save"
            onClick={handleFinish}
            disabled={finishing}
            style={{ flex: 1, height: 48 }}
          >
            {finishing ? 'Saving…' : `Finish Round${holesPlayed < 18 ? ` (${holesPlayed}/18)` : ''}`}
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveRound() {
  const [phase,       setPhase]       = useState('check');
  const [playingData, setPlayingData] = useState(null);

  const handleNewRound = () => setPhase('setup');

  const handleContinue = (existingRound) => {
    const holeData    = existingRound.hole_data ?? defaultHoles();
    const scored      = existingRound.scored_holes ?? [];
    const initScores  = Array(18).fill(null);
    for (const sh of scored) initScores[sh.hole_number - 1] = sh.score;

    const firstUnplayed = initScores.findIndex(s => s === null);
    setPlayingData({
      roundId:         existingRound.id,
      holeData,
      courseHcp:       existingRound.course_handicap ?? 0,
      courseName:      existingRound.course_name,
      teeName:         existingRound.tee_name ?? '',
      competitionName: null,
      initScores,
      startHole:       firstUnplayed === -1 ? 0 : firstUnplayed,
    });
    setPhase('playing');
  };

  const handleStart = (data) => {
    setPlayingData(data);
    setPhase('playing');
  };

  if (phase === 'check')   return <PhaseCheck onNewRound={handleNewRound} onContinue={handleContinue} />;
  if (phase === 'setup')   return <PhaseSetup onStart={handleStart} />;
  if (phase === 'playing') return <PhasePlaying {...playingData} />;
  return null;
}
