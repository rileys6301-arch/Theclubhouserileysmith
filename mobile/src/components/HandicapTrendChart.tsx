import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const GREEN   = '#1a7f3c';
const CHART_H = 110;
const PAD_TOP = 14;
const PAD_BOT = 14;
const PAD_L   = 28;   // left margin for Y-axis labels
const PAD_R   = 8;
const STROKE  = 2.5;
const DOT_R   = 4.5;
const HIT_R   = 14;   // tap target radius around each dot

export type TrendRound = {
  id: string;
  played_at: string;
  course_name: string;
  course_handicap: number | null;
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

type Props = { rounds: TrendRound[]; width: number };

export default function HandicapTrendChart({ rounds, width }: Props) {
  const eligible = [...rounds]
    .filter(r => r.course_handicap != null)
    .sort((a, b) => a.played_at.localeCompare(b.played_at))
    .slice(-20);

  const [selIdx, setSelIdx] = useState(eligible.length - 1);

  if (eligible.length < 2) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>
          {eligible.length === 0
            ? 'Start a live round with course data to track your playing handicap over time.'
            : 'Need at least 2 rounds with course data to plot your trend.'}
        </Text>
      </View>
    );
  }

  const data   = eligible.map(r => r.course_handicap as number);
  const innerW = width - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_TOP - PAD_BOT;
  const minV   = Math.min(...data);
  const maxV   = Math.max(...data);
  const range  = maxV - minV || 1;

  const pts = data.map((v, i) => ({
    x: PAD_L + (i / (data.length - 1)) * innerW,
    y: PAD_TOP + ((maxV - v) / range) * innerH,
  }));

  const midV   = Math.round((minV + maxV) / 2);
  const yTicks = [
    { label: String(maxV), frac: 0 },
    { label: String(midV), frac: 0.5 },
    { label: String(minV), frac: 1 },
  ];

  const safeIdx = Math.min(selIdx, eligible.length - 1);
  const sel     = eligible[safeIdx];

  return (
    <View>
      {/* Y-axis context note */}
      <Text style={s.axisNote}>lower = better · playing handicap</Text>

      {/* Chart */}
      <View style={{ height: CHART_H, width, position: 'relative' }}>
        {/* Y-axis grid lines + labels */}
        {yTicks.map(t => {
          const y = PAD_TOP + t.frac * innerH;
          return (
            <React.Fragment key={t.label}>
              <Text style={[s.yLabel, { position: 'absolute', top: y - 7, left: 0, width: PAD_L - 6 }]}>
                {t.label}
              </Text>
              <View style={{
                position: 'absolute', left: PAD_L, top: y,
                width: innerW, height: 1, backgroundColor: 'rgba(0,0,0,0.07)',
              }} />
            </React.Fragment>
          );
        })}

        {/* Line segments */}
        {pts.slice(0, -1).map((p1, i) => {
          const p2  = pts[i + 1];
          const dx  = p2.x - p1.x;
          const dy  = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={i} style={{
              position: 'absolute',
              left:   (p1.x + p2.x) / 2 - len / 2,
              top:    (p1.y + p2.y) / 2 - STROKE / 2,
              width:  len,
              height: STROKE,
              backgroundColor: GREEN,
              borderRadius: STROKE / 2,
              transform: [{ rotate: `${ang}deg` }],
            }} />
          );
        })}

        {/* Tappable dots */}
        {pts.map((p, i) => {
          const isSel = i === safeIdx;
          const r     = isSel ? DOT_R + 2 : DOT_R;
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
                backgroundColor: isSel ? GREEN : 'rgba(26,127,60,0.4)',
                borderWidth: isSel ? 2 : 0,
                borderColor: '#fff',
              }} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* X-axis labels */}
      <View style={[s.xAxis, { paddingLeft: PAD_L }]}>
        <Text style={s.xLabel}>Older</Text>
        <Text style={s.xLabel}>{eligible.length} rounds</Text>
        <Text style={s.xLabel}>Recent</Text>
      </View>

      {/* Selected-point info card */}
      <View style={s.infoCard}>
        <Text style={s.infoHcp}>{sel.course_handicap}</Text>
        <View style={s.infoText}>
          <Text style={s.infoCourse} numberOfLines={1}>{sel.course_name}</Text>
          <Text style={s.infoDate}>{fmtDate(sel.played_at)}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  empty:     { paddingVertical: 16 },
  emptyText: { fontSize: 13, color: '#aaa', textAlign: 'center', lineHeight: 19 },

  axisNote: { fontSize: 10, color: '#bbb', textAlign: 'right', marginBottom: 6, fontWeight: '500', letterSpacing: 0.2 },
  yLabel:   { fontSize: 10, color: '#bbb', textAlign: 'right', fontWeight: '600' },
  xAxis:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  xLabel:   { fontSize: 10, color: '#bbb' },

  infoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f0fdf4', borderRadius: 12, padding: 14, marginTop: 14,
    borderWidth: 1, borderColor: 'rgba(26,127,60,0.12)',
  },
  infoHcp:    { fontSize: 30, fontWeight: '800', color: GREEN, marginRight: 14 },
  infoText:   { flex: 1 },
  infoCourse: { fontSize: 13, fontWeight: '600', color: '#111' },
  infoDate:   { fontSize: 11, color: '#888', marginTop: 2 },
});
