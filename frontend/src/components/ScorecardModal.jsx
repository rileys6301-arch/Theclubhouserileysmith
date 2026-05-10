import { useState, useEffect } from 'react';
import { api } from '../api/client';

function fmtDate(str) {
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Returns style config for a hole's score relative to par
function holeResult(score, par) {
  if (!score || score === 0) return null;
  const d = score - par;
  if (d <= -2) return { bg: '#C4A35A', color: '#fff',         radius: '50%', border: 'none' };
  if (d === -1) return { bg: '#5E9B3A', color: '#fff',         radius: '50%', border: 'none' };
  if (d === 0)  return null;
  if (d === 1)  return { bg: 'transparent', color: '#E09050', radius: 3, border: '2px solid #E09050' };
  return              { bg: 'transparent', color: '#C0392B', radius: 3, border: '2px solid #C0392B' };
}

function ptColor(pts) {
  if (pts >= 4) return '#C4A35A';
  if (pts === 3) return '#5E9B3A';
  if (pts === 2) return 'var(--text-primary)';
  if (pts === 1) return 'var(--text-muted)';
  return 'var(--error)';
}

// ─── 9-hole table ─────────────────────────────────────────────────────────────

function NineTable({ holeMap, from, label, showTot, totals }) {
  const holes = Array.from({ length: 9 }, (_, i) => holeMap[from + i] ?? null);

  const parSum   = holes.reduce((s, h) => s + (h?.par ?? 0), 0);
  const scoreSum = holes.reduce((s, h) => s + (h?.score ?? 0), 0);
  const ptsSum   = holes.reduce((s, h) => s + (h?.stableford_points ?? 0), 0);

  const th = {
    padding: '6px 4px', textAlign: 'center', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', color: 'var(--text-muted)',
    background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
    letterSpacing: '0.04em',
  };
  const td = {
    padding: '5px 4px', textAlign: 'center', fontSize: 12,
    borderBottom: '1px solid var(--border)', color: 'var(--text-primary)',
  };
  const subtot = {
    ...td, fontWeight: 700, background: 'var(--bg-elevated)',
    borderLeft: '1px solid var(--border)',
  };
  const lbl = {
    padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', width: 46,
  };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 300 }}>
        <tbody>
          {/* Hole numbers */}
          <tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 8, width: 46 }}>{label}</th>
            {holes.map((_, i) => <th key={i} style={th}>{from + i}</th>)}
            <th style={{ ...th, borderLeft: '1px solid var(--border)' }}>{label === 'Front' ? 'Out' : 'In'}</th>
            {showTot && <th style={{ ...th, borderLeft: '1px solid var(--border)' }}>Tot</th>}
          </tr>

          {/* Par */}
          <tr>
            <td style={lbl}>Par</td>
            {holes.map((h, i) => <td key={i} style={td}>{h?.par ?? '—'}</td>)}
            <td style={subtot}>{parSum || '—'}</td>
            {showTot && <td style={subtot}>{totals.par || '—'}</td>}
          </tr>

          {/* SI */}
          <tr>
            <td style={lbl}>SI</td>
            {holes.map((h, i) => (
              <td key={i} style={{ ...td, color: 'var(--text-muted)', fontSize: 11 }}>
                {h?.stroke_index ?? '—'}
              </td>
            ))}
            <td style={{ ...subtot, color: 'var(--text-muted)' }} />
            {showTot && <td style={{ ...subtot, color: 'var(--text-muted)' }} />}
          </tr>

          {/* Score (colored shapes) */}
          <tr>
            <td style={lbl}>Score</td>
            {holes.map((h, i) => {
              const rs = h ? holeResult(h.score, h.par) : null;
              return (
                <td key={i} style={td}>
                  {h ? (
                    <div style={{
                      width: 26, height: 26, margin: '0 auto',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, boxSizing: 'border-box',
                      background: rs?.bg ?? 'transparent',
                      color:      rs?.color ?? 'var(--text-primary)',
                      borderRadius: rs?.radius ?? 3,
                      border:     rs?.border ?? 'none',
                    }}>
                      {h.score}
                    </div>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
              );
            })}
            <td style={subtot}>{scoreSum || '—'}</td>
            {showTot && <td style={subtot}>{totals.score || '—'}</td>}
          </tr>

          {/* Stableford pts */}
          <tr>
            <td style={{ ...lbl, borderBottom: 'none' }}>Pts</td>
            {holes.map((h, i) => (
              <td key={i} style={{
                ...td, borderBottom: 'none',
                color: h ? ptColor(h.stableford_points) : 'var(--text-muted)',
                fontWeight: h?.stableford_points >= 3 ? 700 : 400,
              }}>
                {h?.stableford_points ?? '—'}
              </td>
            ))}
            <td style={{ ...subtot, borderBottom: 'none', color: 'var(--green-bright)' }}>{ptsSum || '—'}</td>
            {showTot && <td style={{ ...subtot, borderBottom: 'none', color: 'var(--green-bright)' }}>{totals.pts || '—'}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

const LEGEND = [
  { label: 'Eagle+', bg: '#C4A35A', color: '#fff',               radius: '50%', border: 'none' },
  { label: 'Birdie',  bg: '#5E9B3A', color: '#fff',               radius: '50%', border: 'none' },
  { label: 'Par',     bg: 'var(--bg-elevated)', color: 'var(--text-primary)', radius: 3,     border: '1px solid var(--border)' },
  { label: 'Bogey',   bg: 'transparent', color: '#E09050',        radius: 3,     border: '2px solid #E09050' },
  { label: 'Double+', bg: 'transparent', color: '#C0392B',        radius: 3,     border: '2px solid #C0392B' },
];

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function ScorecardModal({ roundId, onClose }) {
  const [round,   setRound]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/rounds/${roundId}`)
      .then(setRound)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [roundId]);

  const holeMap = {};
  if (round?.holes) for (const h of round.holes) holeMap[h.hole_number] = h;
  const hasHoles = (round?.holes?.length ?? 0) > 0;

  const totals = {
    par:   Object.values(holeMap).reduce((s, h) => s + (h?.par ?? 0), 0),
    score: Object.values(holeMap).reduce((s, h) => s + (h?.score ?? 0), 0),
    pts:   Object.values(holeMap).reduce((s, h) => s + (h?.stableford_points ?? 0), 0),
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-accent)', borderRadius: 16, width: '100%', maxWidth: 720, boxShadow: 'var(--shadow-elevated)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ minWidth: 0, marginRight: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {round?.course_name ?? (loading ? '…' : '—')}
            </div>
            {round && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {fmtDate(round.played_at)}
                {round.tee_name && <> · {round.tee_name} tees</>}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flexGrow: 1 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="spinner" />
            </div>
          ) : error ? (
            <div className="form-error">{error}</div>
          ) : (
            <>
              {/* Summary strip */}
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Gross Score</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{round.score}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Stableford</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green-bright)' }}>{round.stableford} pts</div>
                </div>
                {round.course_handicap != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Course HCP</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{round.course_handicap}</div>
                  </div>
                )}
              </div>

              {hasHoles ? (
                <>
                  {/* Front 9 */}
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>Front 9</div>
                  <div style={{ borderRadius: 'calc(var(--radius) - 2px)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 }}>
                    <NineTable holeMap={holeMap} from={1} label="Front" showTot={false} totals={totals} />
                  </div>

                  {/* Back 9 */}
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>Back 9</div>
                  <div style={{ borderRadius: 'calc(var(--radius) - 2px)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 24 }}>
                    <NineTable holeMap={holeMap} from={10} label="Back" showTot={true} totals={totals} />
                  </div>

                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '8px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {LEGEND.map(l => (
                      <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: l.bg, color: l.color, borderRadius: l.radius, border: l.border, boxSizing: 'border-box', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No hole-by-hole data — this round was logged as a total score only.
                </p>
              )}

              {round.notes && (
                <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  {round.notes}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
