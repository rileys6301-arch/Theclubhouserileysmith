import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Constants ──────────────────────────────────────────────────────────────────

const CHART_H  = 180;
const PAD_TOP  = 16;
const PAD_BOT  = 24;
const PAD_L    = 8;
const PAD_R    = 8;
const STROKE   = 2.5;
const DOT_R    = 4;
const HIT_R    = 18;

const CHART_BG  = colors.surfaceMuted;
const LINE_CLR  = colors.primary;
const FILL_START = colors.primary + '28';
const FILL_MID   = colors.primary + '14';
const FILL_END   = colors.primary + '06';
const DOT_CLR   = colors.primary;
const DOT_RING  = colors.surface;
const GRID_CLR  = colors.border + '70';
const BEST_CLR  = colors.gold;
const WORSE_CLR = colors.danger;

// ── Types ──────────────────────────────────────────────────────────────────────

export type TrendRound = {
  id: string;
  played_at: string;
  course_name: string;
  score: number;
  stableford: number;
  slope_rating?: number | null;
  course_rating?: number | null;
  handicap_index?: number | null;
  course_handicap?: number | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fmtMonth(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { month: 'short' });
}

function catmullRom(pts: { x: number; y: number }[], steps = 12): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < steps; t++) {
      const s = t / steps, s2 = s * s, s3 = s2 * s;
      out.push({
        x: 0.5*(2*p1.x+(-p0.x+p2.x)*s+(2*p0.x-5*p1.x+4*p2.x-p3.x)*s2+(-p0.x+3*p1.x-3*p2.x+p3.x)*s3),
        y: 0.5*(2*p1.y+(-p0.y+p2.y)*s+(2*p0.y-5*p1.y+4*p2.y-p3.y)*s2+(-p0.y+3*p1.y-3*p2.y+p3.y)*s3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function diffOf(r: TrendRound): number {
  // WHS formula: Handicap Differential = (Gross Score − Course Rating) × (113 ÷ Slope Rating)

  // Course Rating rounding (WHS Rules of Handicapping 5.1):
  // Round to nearest whole number; exactly 0.5 rounds UP → use Math.round()
  // e.g. 71.5 → 72,  71.4 → 71
  const roundedRating = Math.round(r.course_rating as number);

  return (r.score - roundedRating) * (113 / (r.slope_rating as number));
  // Note: differentials are NOT rounded — they are stored/averaged as decimals
}

// Pick up to `count` evenly spaced indices across [0, n-1] for axis tick labels.
function evenIndices(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.round((i / (count - 1)) * (n - 1)));
  }
  return Array.from(new Set(out));
}

// ── Component ──────────────────────────────────────────────────────────────────

type Props = { rounds: TrendRound[]; width: number };

export default function HandicapTrendChart({ rounds, width }: Props) {
  // TODO: rounds without both course_rating and slope_rating cannot produce a valid
  // WHS Handicap Differential; they are excluded rather than using a wrong value.
  const eligible = [...rounds]
    .filter(r => r.course_rating != null && r.slope_rating != null)
    .sort((a, b) => a.played_at.localeCompare(b.played_at))
    .slice(-20);

  const [selIdx, setSelIdx] = useState<number | null>(null);

  if (eligible.length < 2) {
    return (
      <View style={[s.card, { justifyContent: 'center', alignItems: 'center', minHeight: 120 }]}>
        <Text style={s.emptyText}>
          {eligible.length === 0
            ? 'Play a round with course rating and slope data to track your handicap differential.'
            : 'Need at least 2 rounds with course rating and slope data to plot your trend.'}
        </Text>
      </View>
    );
  }

  const n        = eligible.length;
  const latest   = eligible[n - 1];
  const prev     = n >= 2 ? eligible[n - 2] : null;
  const latestDiff = diffOf(latest);
  const prevDiff   = prev != null ? diffOf(prev) : null;
  const delta      = prevDiff != null ? latestDiff - prevDiff : null;
  // Lower differential = better play (closer to scratch)
  const improved   = delta != null ? delta < 0 : null;

  const diffVals = eligible.map(diffOf);
  const bestDiff = Math.min(...diffVals);
  const bestIdx  = diffVals.indexOf(bestDiff);
  const oldestDiff = diffVals[0];

  const innerW  = width - PAD_L - PAD_R;
  const innerH  = CHART_H - PAD_TOP - PAD_BOT;
  const chartB  = PAD_TOP + innerH; // y of chart bottom

  const minPH   = Math.min(...diffVals);
  const maxPH   = Math.max(...diffVals);
  const range   = maxPH - minPH || 2;
  const padY    = range * 0.2;
  const yLo     = minPH - padY;
  const yHi     = maxPH + padY;

  function xAt(i: number) {
    return PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  }
  function yAt(v: number) {
    return PAD_TOP + ((yHi - v) / (yHi - yLo)) * innerH;
  }

  const keyPts   = eligible.map((r, i) => ({ x: xAt(i), y: yAt(diffOf(r)) }));
  const curvePts = catmullRom(keyPts, 12);

  // Y-axis grid ticks — 3 evenly spaced
  const yTicks = [
    Math.round(yHi - padY * 0.5),
    Math.round((yLo + yHi) / 2),
    Math.round(yLo + padY * 0.5),
  ].filter((v, i, a) => a.indexOf(v) === i);

  // X-axis month ticks — up to 6 evenly spaced across the plotted range
  const xTickIdx = evenIndices(n, 6);

  const activeSel = selIdx !== null ? selIdx : n - 1;
  const sel       = eligible[activeSel];
  const selDiff   = diffOf(sel);

  return (
    <View style={s.card}>

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Handicap Trend</Text>
          <Text style={s.headerSub}>{n} round{n !== 1 ? 's' : ''} · tap a point for details</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.headerBig}>{latestDiff.toFixed(1)}</Text>
          {delta != null && (
            <View style={s.deltaBadge}>
              <Ionicons
                name={improved ? 'arrow-down' : 'arrow-up'}
                size={12}
                color={improved ? colors.primaryLight : WORSE_CLR}
              />
              <Text style={[s.deltaText, { color: improved ? colors.primaryLight : WORSE_CLR }]}>
                {Math.abs(delta).toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Chart ── */}
      <View style={{ height: CHART_H, width, position: 'relative', overflow: 'hidden' }}>
        {/* Background */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CHART_BG }]} />

        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <View key={i} style={{
            position: 'absolute',
            left: PAD_L, top: yAt(v),
            width: innerW, height: 1,
            backgroundColor: GRID_CLR,
          }} />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <Text key={i} style={[s.yLabel, { position: 'absolute', top: yAt(v) - 8, right: width - PAD_L + 4 }]}>
            {v}
          </Text>
        ))}

        {/* Gradient fill — 3 opacity passes below the curve */}
        {[FILL_START, FILL_MID, FILL_END].map((fillColor, pass) => (
          curvePts.slice(0, -1).map((p1, i) => {
            const p2  = curvePts[i + 1];
            const mx  = (p1.x + p2.x) / 2;
            const my  = (p1.y + p2.y) / 2;
            const cw  = Math.abs(p2.x - p1.x) + 1.5;
            const ch  = chartB - my;
            if (ch <= 0 || cw <= 0) return null;
            const fadeH = ch * (1 - pass * 0.28);
            return (
              <View key={`${pass}-${i}`} style={{
                position: 'absolute',
                left: mx - cw / 2,
                top: my,
                width: cw,
                height: fadeH,
                backgroundColor: fillColor,
              }} />
            );
          })
        ))}

        {/* Curve line segments */}
        {curvePts.slice(0, -1).map((p1, i) => {
          const p2  = curvePts[i + 1];
          const dx  = p2.x - p1.x;
          const dy  = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx) * (180 / Math.PI);
          if (len < 0.5) return null;
          return (
            <View key={i} style={{
              position: 'absolute',
              left:   (p1.x + p2.x) / 2 - len / 2,
              top:    (p1.y + p2.y) / 2 - STROKE / 2,
              width:  len,
              height: STROKE,
              backgroundColor: LINE_CLR,
              borderRadius:    STROKE / 2,
              transform:       [{ rotate: `${ang}deg` }],
            }} />
          );
        })}

        {/* Dots — current round is a solid highlight, best round gets a gold ring */}
        {keyPts.map((p, i) => {
          const isCurrent = i === n - 1;
          const isBest    = i === bestIdx;
          const isSel     = i === activeSel;
          const r = isSel ? DOT_R + 2 : (isCurrent || isBest) ? DOT_R + 1 : DOT_R;
          const fill = isBest ? colors.surface : (isCurrent || isSel) ? DOT_CLR : DOT_CLR + '60';
          const ring = isBest ? BEST_CLR : DOT_RING;
          const ringW = isBest ? 2.5 : (isSel ? 2 : 1.5);
          return (
            <TouchableOpacity
              key={i}
              style={{
                position: 'absolute',
                left: p.x - HIT_R, top: p.y - HIT_R,
                width: HIT_R * 2, height: HIT_R * 2,
                justifyContent: 'center', alignItems: 'center',
              }}
              onPress={() => setSelIdx(i)}
              activeOpacity={0.7}
            >
              <View style={{
                width: r * 2, height: r * 2, borderRadius: r,
                backgroundColor: fill,
                borderWidth: ringW,
                borderColor: ring,
              }} />
            </TouchableOpacity>
          );
        })}

        {/* X-axis month labels — evenly spaced across the plotted range */}
        {xTickIdx.map(i => (
          <Text key={i} style={[s.xLabel, {
            position: 'absolute', bottom: 4,
            left: Math.min(Math.max(keyPts[i].x - 14, PAD_L), width - PAD_R - 28),
          }]}>
            {fmtMonth(eligible[i].played_at)}
          </Text>
        ))}
      </View>

      {/* ── Tap tooltip ── */}
      <View style={s.tooltip}>
        <View style={s.tooltipMain}>
          <Text style={s.tooltipPH}>{selDiff.toFixed(1)}</Text>
          <Text style={s.tooltipPHLabel}>hcp diff</Text>
        </View>
        <View style={s.tooltipDivider} />
        <View style={s.tooltipInfo}>
          <Text style={s.tooltipCourse} numberOfLines={1}>{sel.course_name}</Text>
          <Text style={s.tooltipDate}>{fmtDate(sel.played_at)}</Text>
          <View style={s.tooltipMeta}>
            <Text style={s.tooltipMetaText}>Played to HCP {selDiff.toFixed(1)}</Text>
            {sel.slope_rating != null && (
              <Text style={s.tooltipMetaText}>Slope {sel.slope_rating}</Text>
            )}
          </View>
        </View>
      </View>

      {/* ── Footer stats ── */}
      <View style={s.footerDivider} />
      <View style={s.footer}>
        <View style={s.footerCol}>
          <Text style={s.footerLabel}>{n} round{n !== 1 ? 's' : ''} ago</Text>
          <Text style={s.footerVal}>{oldestDiff.toFixed(1)}</Text>
        </View>
        <View style={s.footerCol}>
          <Text style={s.footerLabel}>Best round</Text>
          <Text style={[s.footerVal, { color: BEST_CLR }]}>{bestDiff.toFixed(1)}</Text>
        </View>
        <View style={[s.footerCol, { alignItems: 'flex-end' }]}>
          <Text style={s.footerLabel}>Current</Text>
          <Text style={[s.footerVal, { color: LINE_CLR }]}>{latestDiff.toFixed(1)}</Text>
        </View>
      </View>

    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    ...shadows.card,
  },

  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  // Header
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md, paddingHorizontal: spacing.md },
  headerTitle:{ fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  headerSub:  { fontSize: fontSize.xs, color: colors.textSecondary },
  headerBig:  { fontSize: 30, fontWeight: '800', color: colors.textPrimary, lineHeight: 34 },

  deltaBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.surfaceMuted, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4 },
  deltaText:  { fontSize: 12, fontWeight: '700' },

  // Chart labels
  yLabel: { fontSize: 9, color: colors.textSecondary, fontWeight: '600' },
  xLabel: { fontSize: 9, color: colors.textSecondary },

  // Tooltip
  tooltip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, marginHorizontal: spacing.md },
  tooltipMain:   { alignItems: 'center', minWidth: 52 },
  tooltipPH:     { fontSize: 28, fontWeight: '800', color: LINE_CLR },
  tooltipPHLabel:{ fontSize: 9, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  tooltipDivider:{ width: 1, height: 44, backgroundColor: colors.border, marginHorizontal: 14 },
  tooltipInfo:   { flex: 1 },
  tooltipCourse: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  tooltipDate:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  tooltipMeta:   { flexDirection: 'row', gap: 10, marginTop: 5 },
  tooltipMetaText:{ fontSize: 10, color: colors.textSecondary, fontWeight: '500' },

  // Footer
  footerDivider: { height: 1, backgroundColor: colors.border + '70', marginTop: spacing.md, marginHorizontal: spacing.md },
  footer:        { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  footerCol:     { flex: 1 },
  footerLabel:   { fontSize: 10.5, color: colors.textSecondary, marginBottom: 4 },
  footerVal:     { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});
