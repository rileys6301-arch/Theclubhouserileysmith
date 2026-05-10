import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import client from '../api/client';

const GREEN  = '#1a7f3c';
const GOLD   = '#C4A35A';
const BIRDIE = '#5E9B3A';
const ORANGE = '#E09050';
const RED    = '#C0392B';

// ── Types ─────────────────────────────────────────────────────────────────────

type Hole = {
  hole_number: number;
  par: number;
  stroke_index: number | null;
  score: number;
  stableford_points: number;
};

type Round = {
  id: number;
  course_name: string;
  played_at: string;
  score: number;
  stableford: number;
  handicap_used: number | null;
  holes: Hole[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

type ShapeConfig = {
  bg: string;
  color: string;
  circle: boolean;
  bordered: boolean;
  borderColor: string;
} | null;

function holeShape(score: number, par: number): ShapeConfig {
  const diff = score - par;
  if (diff <= -2) return { bg: GOLD,   color: '#fff', circle: true,  bordered: false, borderColor: '' };
  if (diff === -1) return { bg: BIRDIE, color: '#fff', circle: true,  bordered: false, borderColor: '' };
  if (diff === 0)  return null;
  if (diff === 1)  return { bg: 'transparent', color: ORANGE, circle: false, bordered: true, borderColor: ORANGE };
  return              { bg: 'transparent', color: RED,    circle: false, bordered: true, borderColor: RED };
}

function ptsColor(pts: number) {
  if (pts >= 4) return BIRDIE;
  if (pts <= 1) return RED;
  return '#444';
}

// ── Nine-hole table ───────────────────────────────────────────────────────────

function NineTable({ holes, label }: { holes: Hole[]; label: string }) {
  const tot = holes.reduce((s, h) => s + h.score, 0);
  const pts = holes.reduce((s, h) => s + h.stableford_points, 0);

  return (
    <View style={t.block}>
      <Text style={t.blockLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Hole numbers */}
          <View style={t.row}>
            <Text style={[t.cell, t.labelCell]}>Hole</Text>
            {holes.map(h => (
              <Text key={h.hole_number} style={[t.cell, t.holeNum]}>{h.hole_number}</Text>
            ))}
            <Text style={[t.cell, t.totCell]}>Tot</Text>
          </View>

          {/* Par */}
          <View style={t.row}>
            <Text style={[t.cell, t.labelCell]}>Par</Text>
            {holes.map(h => (
              <Text key={h.hole_number} style={[t.cell, t.par]}>{h.par}</Text>
            ))}
            <Text style={[t.cell, t.par, t.totCell]}>{holes.reduce((s, h) => s + h.par, 0)}</Text>
          </View>

          {/* SI */}
          <View style={t.row}>
            <Text style={[t.cell, t.labelCell]}>SI</Text>
            {holes.map(h => (
              <Text key={h.hole_number} style={[t.cell, t.si]}>{h.stroke_index ?? '—'}</Text>
            ))}
            <Text style={[t.cell, t.si, t.totCell]} />
          </View>

          {/* Score */}
          <View style={[t.row, t.scoreRow]}>
            <Text style={[t.cell, t.labelCell]}>Score</Text>
            {holes.map(h => {
              const shape = holeShape(h.score, h.par);
              return (
                <View key={h.hole_number} style={[t.cell, t.scoreCell]}>
                  {shape ? (
                    <View style={[
                      t.shape,
                      shape.circle ? t.shapeCircle : t.shapeSquare,
                      { backgroundColor: shape.bg, borderColor: shape.borderColor, borderWidth: shape.bordered ? 1.5 : 0 },
                    ]}>
                      <Text style={[t.shapeText, { color: shape.color }]}>{h.score}</Text>
                    </View>
                  ) : (
                    <Text style={t.scorePlain}>{h.score}</Text>
                  )}
                </View>
              );
            })}
            <Text style={[t.cell, t.scorePlain, t.totCell]}>{tot}</Text>
          </View>

          {/* Stableford pts */}
          <View style={t.row}>
            <Text style={[t.cell, t.labelCell]}>Pts</Text>
            {holes.map(h => (
              <Text key={h.hole_number} style={[t.cell, t.pts, { color: ptsColor(h.stableford_points) }]}>
                {h.stableford_points}
              </Text>
            ))}
            <Text style={[t.cell, t.pts, t.totCell, { color: pts >= 18 ? BIRDIE : pts <= 14 ? RED : '#444' }]}>{pts}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Props = {
  roundId: number;
  onClose: () => void;
};

export default function ScorecardModal({ roundId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    client.get(`/api/rounds/${roundId}`)
      .then(r => setRound(r.data))
      .catch(() => setError('Could not load scorecard'))
      .finally(() => setLoading(false));
  }, [roundId]);

  const front9 = round?.holes.filter(h => h.hole_number <= 9)  ?? [];
  const back9  = round?.holes.filter(h => h.hole_number >= 10) ?? [];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[s.overlay, { paddingTop: insets.top }]}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{round?.course_name ?? 'Scorecard'}</Text>
              {round && <Text style={s.subtitle}>{fmtDate(round.played_at)}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color="#555" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
            {loading && (
              <View style={s.centered}>
                <ActivityIndicator color={GREEN} size="large" />
              </View>
            )}

            {!loading && error !== '' && (
              <View style={s.centered}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {!loading && round && (
              <>
                {/* Summary strip */}
                <View style={s.strip}>
                  <View style={s.stripItem}>
                    <Text style={s.stripVal}>{round.score}</Text>
                    <Text style={s.stripLabel}>Gross</Text>
                  </View>
                  <View style={s.stripDivider} />
                  <View style={s.stripItem}>
                    <Text style={[s.stripVal, { color: round.stableford >= 36 ? BIRDIE : round.stableford <= 28 ? RED : '#111' }]}>
                      {round.stableford}
                    </Text>
                    <Text style={s.stripLabel}>Stableford</Text>
                  </View>
                  {round.handicap_used != null && (
                    <>
                      <View style={s.stripDivider} />
                      <View style={s.stripItem}>
                        <Text style={s.stripVal}>{round.handicap_used}</Text>
                        <Text style={s.stripLabel}>Handicap</Text>
                      </View>
                    </>
                  )}
                </View>

                {round.holes.length === 0 ? (
                  <View style={s.noHoles}>
                    <Ionicons name="information-circle-outline" size={20} color="#aaa" />
                    <Text style={s.noHolesText}>Logged as total score only — no hole-by-hole data available.</Text>
                  </View>
                ) : (
                  <>
                    {front9.length > 0 && <NineTable holes={front9} label="Front 9" />}
                    {back9.length  > 0 && <NineTable holes={back9}  label="Back 9"  />}

                    {/* Legend */}
                    <View style={s.legend}>
                      {[
                        { bg: GOLD,   circle: true,  bordered: false, label: 'Eagle+' },
                        { bg: BIRDIE, circle: true,  bordered: false, label: 'Birdie' },
                        { bg: 'transparent', circle: false, bordered: true, borderColor: ORANGE, textColor: ORANGE, label: 'Bogey' },
                        { bg: 'transparent', circle: false, bordered: true, borderColor: RED,    textColor: RED,    label: 'Double+' },
                      ].map(item => (
                        <View key={item.label} style={s.legendItem}>
                          <View style={[
                            s.legendShape,
                            item.circle ? s.legendCircle : s.legendSquare,
                            { backgroundColor: item.bg, borderColor: (item as any).borderColor ?? 'transparent', borderWidth: item.bordered ? 1.5 : 0 },
                          ]} />
                          <Text style={s.legendLabel}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CELL_W = 36;
const LABEL_W = 54;
const TOT_W = 40;

const t = StyleSheet.create({
  block:     { marginBottom: 20 },
  blockLabel:{ fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  row:       { flexDirection: 'row', alignItems: 'center' },
  scoreRow:  { marginVertical: 2 },

  cell:      { width: CELL_W, textAlign: 'center', fontSize: 13, color: '#333', paddingVertical: 5 },
  labelCell: { width: LABEL_W, textAlign: 'left', fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.4 },
  totCell:   { width: TOT_W, fontWeight: '700', color: '#111' },
  holeNum:   { fontWeight: '700', color: '#111', fontSize: 13 },
  par:       { color: '#555' },
  si:        { color: '#aaa', fontSize: 11 },
  pts:       { fontWeight: '700', fontSize: 13 },
  scorePlain:{ fontSize: 13, color: '#111', textAlign: 'center', width: CELL_W, paddingVertical: 5 },

  scoreCell: { width: CELL_W, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  shape:     { width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  shapeCircle: { borderRadius: 14 },
  shapeSquare: { borderRadius: 4 },
  shapeText: { fontSize: 12, fontWeight: '700' },
});

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  title:    { fontSize: 17, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 12, color: '#999', marginTop: 2 },

  body:    { padding: 20 },
  centered:{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  errorText:{ fontSize: 14, color: RED },

  strip: {
    flexDirection: 'row', backgroundColor: '#f0fdf4',
    borderRadius: 14, padding: 16, marginBottom: 24,
    borderWidth: 1, borderColor: 'rgba(26,127,60,0.12)',
  },
  stripItem:    { flex: 1, alignItems: 'center' },
  stripVal:     { fontSize: 22, fontWeight: '800', color: '#111' },
  stripLabel:   { fontSize: 11, color: '#888', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  stripDivider: { width: 1, backgroundColor: 'rgba(26,127,60,0.15)', marginHorizontal: 4 },

  noHoles: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f9f9f9', borderRadius: 10, padding: 14,
  },
  noHolesText: { flex: 1, fontSize: 13, color: '#aaa', lineHeight: 18 },

  legend: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendShape: { width: 18, height: 18 },
  legendCircle: { borderRadius: 9 },
  legendSquare: { borderRadius: 3 },
  legendLabel: { fontSize: 11, color: '#777' },
});
