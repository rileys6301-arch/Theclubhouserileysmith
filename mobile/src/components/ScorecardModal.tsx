import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import client from '../api/client';
import { colors } from '../theme';

const GREEN  = colors.primary;
const GOLD   = colors.gold;
const BIRDIE = colors.primaryLight;
const ORANGE = '#E09050';
const RED    = colors.danger;

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
  course_handicap: number | null;
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
  return colors.textPrimary;
}

// ── Nine-hole table ───────────────────────────────────────────────────────────

function NineTable({ holes, label, cw, lw, tw }: {
  holes: Hole[]; label: string;
  cw: number; lw: number; tw: number;
}) {
  const tot    = holes.reduce((s, h) => s + h.score, 0);
  const pts    = holes.reduce((s, h) => s + h.stableford_points, 0);
  const parTot = holes.reduce((s, h) => s + h.par, 0);
  const shapeSize = Math.max(cw - 4, 18);
  const scoreFs = Math.max(Math.round(cw * 0.45), 12);

  const cell  = { width: cw,  textAlign: 'center' as const, paddingVertical: 5 };
  const label_ = { width: lw, textAlign: 'left' as const };
  const tot_   = { width: tw, textAlign: 'center' as const, fontWeight: '700' as const };

  return (
    <View style={t.block}>
      <Text style={t.blockLabel}>{label}</Text>
      <View>
        {/* Hole numbers */}
        <View style={t.row}>
          <Text style={[t.labelCell, label_]}>Hole</Text>
          {holes.map(h => <Text key={h.hole_number} style={[t.holeNum, cell]}>{h.hole_number}</Text>)}
          <Text style={[t.holeNum, tot_]}>Tot</Text>
        </View>

        {/* Par */}
        <View style={t.row}>
          <Text style={[t.labelCell, label_]}>Par</Text>
          {holes.map(h => <Text key={h.hole_number} style={[t.par, cell]}>{h.par}</Text>)}
          <Text style={[t.par, tot_]}>{parTot}</Text>
        </View>

        {/* SI */}
        <View style={t.row}>
          <Text style={[t.labelCell, label_]}>SI</Text>
          {holes.map(h => <Text key={h.hole_number} style={[t.si, cell]}>{h.stroke_index ?? '—'}</Text>)}
          <Text style={[t.si, tot_]} />
        </View>

        {/* Score */}
        <View style={[t.row, t.scoreRow]}>
          <Text style={[t.labelCell, label_]}>Score</Text>
          {holes.map(h => {
            const shape = holeShape(h.score, h.par);
            return (
              <View key={h.hole_number} style={[t.scoreCell, { width: cw }]}>
                {shape ? (
                  <View style={[
                    { width: shapeSize, height: shapeSize, justifyContent: 'center', alignItems: 'center' },
                    shape.circle ? { borderRadius: shapeSize / 2 } : { borderRadius: 4 },
                    { backgroundColor: shape.bg, borderColor: shape.borderColor, borderWidth: shape.bordered ? 1.5 : 0 },
                  ]}>
                    <Text style={[t.shapeText, { color: shape.color, fontSize: scoreFs }]}>{h.score}</Text>
                  </View>
                ) : (
                  <Text style={[t.scorePlain, { fontSize: scoreFs, width: cw }]}>{h.score}</Text>
                )}
              </View>
            );
          })}
          <Text style={[t.scorePlain, tot_, { fontSize: scoreFs }]}>{tot}</Text>
        </View>

        {/* Stableford pts */}
        <View style={t.row}>
          <Text style={[t.labelCell, label_]}>Pts</Text>
          {holes.map(h => (
            <Text key={h.hole_number} style={[t.pts, cell, { color: ptsColor(h.stableford_points) }]}>
              {h.stableford_points}
            </Text>
          ))}
          <Text style={[t.pts, tot_, { color: pts >= 18 ? BIRDIE : pts <= 14 ? RED : colors.textPrimary }]}>{pts}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Props = {
  roundId: string;
  onClose: () => void;
};

export default function ScorecardModal({ roundId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dynamic cell widths so all 9 columns fit without horizontal scrolling
  const BODY_PAD = 40;
  const LW = 40;
  const TW = 30;
  const CW = Math.floor((screenW - BODY_PAD - LW - TW) / 9);

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

  // Derive totals from hole data when available — DB totals can be stale
  const holeScore     = round?.holes.reduce((s, h) => s + h.score, 0) ?? 0;
  const holeStableford = round?.holes.reduce((s, h) => s + h.stableford_points, 0) ?? 0;
  const displayScore     = round && round.holes.length > 0 ? holeScore     : (round?.score     ?? 0);
  const displayStableford = round && round.holes.length > 0 ? holeStableford : (round?.stableford ?? 0);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[s.overlay, { paddingTop: insets.top }]}>
        <View style={s.sheet}>
          {/* Drag handle */}
          <View style={s.dragHandle} />
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{round?.course_name ?? 'Scorecard'}</Text>
              {round && <Text style={s.subtitle}>{fmtDate(round.played_at)}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
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
                    <Text style={s.stripVal}>{displayScore}</Text>
                    <Text style={s.stripLabel}>Gross</Text>
                  </View>
                  <View style={s.stripDivider} />
                  <View style={s.stripItem}>
                    <Text style={[s.stripVal, { color: displayStableford >= 36 ? BIRDIE : displayStableford <= 28 ? RED : colors.textPrimary }]}>
                      {displayStableford}
                    </Text>
                    <Text style={s.stripLabel}>Stableford</Text>
                  </View>
                  {round.course_handicap != null && (
                    <>
                      <View style={s.stripDivider} />
                      <View style={s.stripItem}>
                        <Text style={s.stripVal}>{round.course_handicap}</Text>
                        <Text style={s.stripLabel}>Handicap</Text>
                      </View>
                    </>
                  )}
                </View>

                {round.holes.length === 0 ? (
                  <View style={s.noHoles}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                    <Text style={s.noHolesText}>Logged as total score only — no hole-by-hole data available.</Text>
                  </View>
                ) : (
                  <>
                    {front9.length > 0 && <NineTable holes={front9} label="Front 9" cw={CW} lw={LW} tw={TW} />}
                    {back9.length  > 0 && <NineTable holes={back9}  label="Back 9"  cw={CW} lw={LW} tw={TW} />}

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

const t = StyleSheet.create({
  block:      { marginBottom: 20 },
  blockLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  row:        { flexDirection: 'row', alignItems: 'center' },
  scoreRow:   { marginVertical: 2 },

  labelCell:  { fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, paddingVertical: 5 },
  holeNum:    { fontWeight: '700', color: colors.textPrimary, fontSize: 13 },
  par:        { fontSize: 13, color: colors.textSecondary, paddingVertical: 5 },
  si:         { fontSize: 11, color: colors.border, paddingVertical: 5 },
  pts:        { fontWeight: '700', fontSize: 13, paddingVertical: 5 },
  scorePlain: { color: colors.textPrimary, textAlign: 'center', paddingVertical: 5, fontWeight: '700' },

  scoreCell:  { alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  shapeText:  { fontWeight: '800' },
});

const s = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', paddingTop: 8 },
  dragHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 4 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title:    { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  body:     { padding: 20 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  errorText:{ fontSize: 14, color: RED },

  strip: {
    flexDirection: 'row',
    backgroundColor: colors.primary + '0D',
    borderRadius: 14, padding: 16, marginBottom: 24,
    borderWidth: 1, borderColor: colors.primary + '22',
  },
  stripItem:    { flex: 1, alignItems: 'center' },
  stripVal:     { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  stripLabel:   { fontSize: 11, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  stripDivider: { width: 1, backgroundColor: colors.primary + '22', marginHorizontal: 4 },

  noHoles: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surfaceMuted, borderRadius: 10, padding: 14,
  },
  noHolesText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  legend:       { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 4 },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendShape:  { width: 18, height: 18 },
  legendCircle: { borderRadius: 9 },
  legendSquare: { borderRadius: 3 },
  legendLabel:  { fontSize: 11, color: colors.textSecondary },
});
