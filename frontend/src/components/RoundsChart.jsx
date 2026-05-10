import { useMemo } from 'react';

const W      = 640;
const H      = 230;
const PAD    = { top: 20, right: 36, bottom: 44, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top  - PAD.bottom;

function sx(i, total) {
  if (total === 1) return PLOT_W / 2;
  return (i / (total - 1)) * PLOT_W;
}

function sy(val, min, max) {
  return PLOT_H - ((val - min) / (max - min || 1)) * PLOT_H;
}

function localDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtShort(dateStr) {
  return localDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtFull(dateStr) {
  return localDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function labelIndices(total, max = 7) {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const indices = new Set([0, total - 1]);
  const step = (total - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) indices.add(Math.round(i * step));
  return [...indices].sort((a, b) => a - b);
}

export default function RoundsChart({ rounds, mode = 'stableford' }) {
  // rounds is oldest-first
  const isScore = mode === 'score';
  const color   = isScore ? '#7C4F2A' : '#5E9B3A';
  const refVal  = isScore ? 72 : 36;

  const { min, max, ticks, refY } = useMemo(() => {
    const vals = rounds.map(r => isScore ? r.score : r.stableford);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const pad = Math.max(isScore ? 3 : 4, Math.ceil((rawMax - rawMin) * 0.25));
    const min = Math.max(0, rawMin - pad);
    const max = rawMax + pad;

    const step = (max - min) > 20 ? (isScore ? 4 : 6) : (isScore ? 2 : 3);
    const ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);

    const refY = min < refVal && max > refVal ? sy(refVal, min, max) : null;
    return { min, max, ticks, refY };
  }, [rounds, mode]);

  const pts = rounds.map((r, i) => ({
    x: sx(i, rounds.length),
    y: sy(isScore ? r.score : r.stableford, min, max),
    value: isScore ? r.score : r.stableford,
    played_at: r.played_at,
    course_name: r.course_name,
  }));

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = pts.length > 1
    ? `${line} L${pts.at(-1).x.toFixed(1)},${PLOT_H} L${pts[0].x.toFixed(1)},${PLOT_H} Z`
    : null;

  const xLabels = labelIndices(pts.length);
  const gradId  = `cg-${mode}`;
  const clipId  = `cc-${mode}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', display: 'block' }}
      aria-label={isScore ? 'Gross score trend chart' : 'Stableford trend chart'}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={PLOT_W} height={PLOT_H} />
        </clipPath>
      </defs>

      <g transform={`translate(${PAD.left},${PAD.top})`}>

        {/* Horizontal grid + Y labels */}
        {ticks.map(t => {
          const y = sy(t, min, max);
          if (y < -1 || y > PLOT_H + 1) return null;
          return (
            <g key={t}>
              <line x1={0} y1={y} x2={PLOT_W} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <text x={-8} y={y} dy="0.35em" textAnchor="end"
                fill="#445040" fontSize="11" fontFamily="Inter,sans-serif">{t}</text>
            </g>
          );
        })}

        {/* Par reference line */}
        {refY !== null && (
          <>
            <line x1={0} y1={refY} x2={PLOT_W} y2={refY}
              stroke={color} strokeWidth="1.5" strokeDasharray="5,4" strokeOpacity="0.5" />
            <text x={PLOT_W + 6} y={refY} dy="0.35em"
              fill={color} fontSize="10" fontFamily="Inter,sans-serif">par</text>
          </>
        )}

        {/* Area fill */}
        {area && <path d={area} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}

        {/* Line */}
        {pts.length > 1 && (
          <path d={line} fill="none" stroke={color} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId})`} />
        )}

        {/* Dots */}
        {pts.map((p, i) => (
          <g key={i}>
            <title>{`${fmtFull(p.played_at)} · ${p.course_name}: ${p.value}${isScore ? ' strokes' : ' pts'}`}</title>
            <circle cx={p.x} cy={p.y} r={pts.length > 30 ? 2.5 : 4}
              fill={color} stroke="#0C1409" strokeWidth="2" />
          </g>
        ))}

        {/* Baseline */}
        <line x1={0} y1={PLOT_H} x2={PLOT_W} y2={PLOT_H} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

        {/* X labels */}
        {xLabels.map(i => (
          <text key={i} x={pts[i].x} y={PLOT_H + 18} textAnchor="middle"
            fill="#445040" fontSize="11" fontFamily="Inter,sans-serif">
            {fmtShort(rounds[i].played_at)}
          </text>
        ))}

      </g>
    </svg>
  );
}
