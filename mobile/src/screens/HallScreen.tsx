import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Hall'>;
  route: RouteProp<RootStackParamList, 'Hall'>;
};

type RoundRecord = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  score: number;
  stableford: number | null;
  score_to_par: number;
  course_par: number;
  played_at: string;
  course_name: string;
};

type CountRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  count: number;
};

type RateRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  value: number;
};

type WorstHole = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  hole_number: number;
  score: number;
  par: number;
  course_name: string;
  over_par: number;
};

type HallData = {
  fame: {
    lowRounds: RoundRecord[];
    bestStableford: RoundRecord | null;
    mostBirdies: CountRecord[];
    mostEagles: CountRecord[];
    holesInOne: CountRecord[];
    bestFIR: RateRecord[];
    bestGIR: RateRecord[];
    fewestPutts: RateRecord[];
  };
  shame: {
    highRounds: RoundRecord[];
    worstHole: WorstHole | null;
    bigNumbers: CountRecord[];
    worstFIR: RateRecord[];
    worstGIR: RateRecord[];
    mostPutts: RateRecord[];
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function name(r: { first_name: string | null; last_name: string | null; email: string }) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
}

function initials(r: { first_name: string | null; last_name: string | null; email: string }) {
  return [r.first_name?.[0], r.last_name?.[0]].filter(Boolean).join('').toUpperCase() || r.email[0].toUpperCase();
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toParStr(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

const PODIUM_ORDER = [1, 0, 2] as const; // centre=1st, left=2nd, right=3rd

const FAME_PODIUM = [
  { rank: 1, color: colors.gold,   height: 88, icon: 'trophy'        as const },
  { rank: 2, color: colors.silver, height: 66, icon: 'medal-outline'  as const },
  { rank: 3, color: colors.bronze, height: 50, icon: 'ribbon-outline' as const },
];

const SHAME_PODIUM = [
  { rank: 1, color: colors.danger,   height: 88, icon: 'skull-outline'      as const },
  { rank: 2, color: '#E05C1A',       height: 66, icon: 'flame-outline'      as const },
  { rank: 3, color: colors.secondary,height: 50, icon: 'warning-outline'    as const },
];

// ── Sub-components ─────────────────────────────────────────────────────────

// Floor heights per array index: 0=1st(44), 1=2nd(36), 2=3rd(28)
const FLOOR_H = [44, 36, 28] as const;

function Podium({ records, meta, label, valueKey, formatter }: {
  records: RoundRecord[];
  meta: typeof FAME_PODIUM;
  label: string;
  valueKey: keyof RoundRecord;
  formatter?: (v: number) => string;
}) {
  if (!records.length) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="golf-outline" size={32} color={colors.border} />
        <Text style={styles.emptyText}>No rounds with hole data yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.podiumWrap}>
      {PODIUM_ORDER.map(i => {
        const rec = records[i];
        const m   = meta[i];
        if (!rec) return <View key={i} style={{ flex: 1 }} />;
        const raw = rec[valueKey] as number | null;
        const val = formatter && raw != null ? formatter(raw) : (raw ?? '—');
        return (
          <View key={i} style={styles.podiumCol}>
            {/* Player avatar */}
            <View style={[styles.podiumAvatar, { borderColor: m.color }]}>
              <Text style={[styles.podiumAvatarText, { color: m.color }]}>{initials(rec)}</Text>
            </View>
            <Text style={styles.podiumName} numberOfLines={1}>{name(rec)}</Text>
            <Text style={styles.podiumCourse} numberOfLines={1}>{rec.course_name}</Text>

            {/* Score in podium colour */}
            <Text style={[styles.podiumScore, { color: m.color }]}>{val}</Text>
            <Text style={[styles.podiumScoreLabel, { color: m.color + '99' }]}>{label}</Text>

            {/* Solid floor */}
            <View style={[styles.podiumFloor, { backgroundColor: m.color, height: FLOOR_H[i] }]}>
              <Ionicons name={m.icon} size={13} color="#fff" />
              <Text style={styles.podiumFloorRank}>#{m.rank}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CountList({ records, icon, color, unit, emptyMsg }: {
  records: CountRecord[];
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  unit: string;
  emptyMsg: string;
}) {
  if (!records.length) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name={icon} size={28} color={colors.border} />
        <Text style={styles.emptyText}>{emptyMsg}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.countCard, { borderLeftColor: color }]}>
      {records.map((r, i) => (
        <View key={r.id} style={[styles.countRow, i > 0 && styles.countRowBorder]}>
          <View style={[styles.countRankBadge, { backgroundColor: color + (i === 0 ? 'ff' : '55') }]}>
            <Text style={styles.countRankText}>#{i + 1}</Text>
          </View>
          <View style={[styles.countAvatar, { backgroundColor: color + '22' }]}>
            <Text style={[styles.countAvatarText, { color }]}>{initials(r)}</Text>
          </View>
          <Text style={styles.countName} numberOfLines={1}>{name(r)}</Text>
          <View style={styles.countBadge}>
            <Ionicons name={icon} size={13} color={color} />
            <Text style={[styles.countValue, { color }]}>{r.count}</Text>
            <Text style={styles.countUnit}>{unit}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function RateList({ records, icon, color, formatVal, unit, emptyMsg }: {
  records: RateRecord[];
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  formatVal: (v: number) => string;
  unit: string;
  emptyMsg: string;
}) {
  if (!records.length) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name={icon} size={28} color={colors.border} />
        <Text style={styles.emptyText}>{emptyMsg}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.countCard, { borderLeftColor: color }]}>
      {records.map((r, i) => (
        <View key={r.id} style={[styles.countRow, i > 0 && styles.countRowBorder]}>
          <View style={[styles.countRankBadge, { backgroundColor: color + (i === 0 ? 'ff' : '55') }]}>
            <Text style={styles.countRankText}>#{i + 1}</Text>
          </View>
          <View style={[styles.countAvatar, { backgroundColor: color + '22' }]}>
            <Text style={[styles.countAvatarText, { color }]}>{initials(r)}</Text>
          </View>
          <Text style={styles.countName} numberOfLines={1}>{name(r)}</Text>
          <View style={styles.countBadge}>
            <Ionicons name={icon} size={13} color={color} />
            <Text style={[styles.countValue, { color }]}>{formatVal(r.value)}</Text>
            <Text style={styles.countUnit}>{unit}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function HallScreen({ navigation, route }: Props) {
  const { clubId, clubName } = route.params;
  const insets = useSafeAreaInsets();

  const [tab,     setTab]     = useState<'fame' | 'shame'>('fame');
  const [data,    setData]    = useState<HallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    client.get<HallData>(`/api/clubs/${clubId}/hall`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not load records'))
      .finally(() => setLoading(false));
  }, [clubId]);

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      {/* ── Toggle ── */}
      <View style={styles.toggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'fame' && styles.toggleBtnActiveFame]}
          onPress={() => setTab('fame')}
          activeOpacity={0.8}
        >
          <Ionicons name="trophy" size={15} color={tab === 'fame' ? colors.gold : colors.textSecondary} />
          <Text style={[styles.toggleText, tab === 'fame' && styles.toggleTextActiveFame]}>Hall of Fame</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'shame' && styles.toggleBtnActiveShame]}
          onPress={() => setTab('shame')}
          activeOpacity={0.8}
        >
          <Ionicons name="skull-outline" size={15} color={tab === 'shame' ? colors.danger : colors.textSecondary} />
          <Text style={[styles.toggleText, tab === 'shame' && styles.toggleTextActiveShame]}>Hall of Shame</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !data ? null : (

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ═══════════════════ HALL OF FAME ═══════════════════ */}
          {tab === 'fame' && (
            <>
              {/* Club totals summary bar */}
              {(() => {
                const totalBirdies = data.fame.mostBirdies.reduce((s, r) => s + r.count, 0);
                const totalEagles  = data.fame.mostEagles.reduce((s, r) => s + r.count, 0);
                const totalHiO     = data.fame.holesInOne.reduce((s, r) => s + r.count, 0);
                return (
                  <View style={styles.summaryRow}>
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: '#3b82f6' }]}>{totalBirdies}</Text>
                      <Text style={styles.summaryLabel}>Birdies</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: colors.gold }]}>{totalEagles}</Text>
                      <Text style={styles.summaryLabel}>Eagles</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: colors.primaryLight }]}>{totalHiO}</Text>
                      <Text style={styles.summaryLabel}>Holes in One</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: colors.primary }]}>
                        {toParStr(data.fame.lowRounds[0]?.score_to_par)}
                      </Text>
                      <Text style={styles.summaryLabel}>Club Low</Text>
                    </View>
                  </View>
                );
              })()}

              {/* Lowest round podium */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="trophy" size={16} color={colors.gold} />
                  <Text style={styles.sectionTitle}>Lowest Round</Text>
                </View>
                <Text style={styles.sectionSub}>Best scores to par — accounts for different course pars</Text>
                <Podium
                  records={data.fame.lowRounds}
                  meta={FAME_PODIUM}
                  label="to par"
                  valueKey="score_to_par"
                  formatter={toParStr}
                />
              </View>

              {/* Best stableford record */}
              {data.fame.bestStableford && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="star" size={16} color={colors.primary} />
                    <Text style={styles.sectionTitle}>Best Stableford Round</Text>
                  </View>
                  <View style={[styles.recordCard, { borderLeftColor: colors.primary }]}>
                    <View style={[styles.recordIconWrap, { backgroundColor: colors.primary + '18' }]}>
                      <Ionicons name="star" size={22} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recordName}>{name(data.fame.bestStableford)}</Text>
                      <Text style={styles.recordSub}>
                        {data.fame.bestStableford.course_name} · {shortDate(data.fame.bestStableford.played_at)}
                      </Text>
                    </View>
                    <View style={styles.recordValueWrap}>
                      <Text style={[styles.recordValue, { color: colors.primary }]}>
                        {data.fame.bestStableford.stableford}
                      </Text>
                      <Text style={styles.recordValueLabel}>pts</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Most birdies */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="leaf" size={16} color="#3b82f6" />
                  <Text style={styles.sectionTitle}>Birdie King</Text>
                </View>
                <Text style={styles.sectionSub}>Most birdies scored across all rounds</Text>
                <CountList
                  records={data.fame.mostBirdies}
                  icon="leaf-outline"
                  color="#3b82f6"
                  unit="birdies"
                  emptyMsg="No birdies recorded yet"
                />
              </View>

              {/* Most eagles */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="partly-sunny" size={16} color={colors.gold} />
                  <Text style={styles.sectionTitle}>Eagle Eye</Text>
                </View>
                <Text style={styles.sectionSub}>Most eagles (& albatrosses) ever scored</Text>
                <CountList
                  records={data.fame.mostEagles}
                  icon="partly-sunny-outline"
                  color={colors.gold}
                  unit="eagles"
                  emptyMsg="No eagles recorded yet — keep trying!"
                />
              </View>

              {/* Holes in one */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="radio-button-on" size={16} color={colors.primaryLight} />
                  <Text style={styles.sectionTitle}>Hole in One Club</Text>
                </View>
                <Text style={styles.sectionSub}>The rarest achievement in golf</Text>
                <CountList
                  records={data.fame.holesInOne}
                  icon="radio-button-on-outline"
                  color={colors.primaryLight}
                  unit="HiO"
                  emptyMsg="No holes-in-one yet — legends in the making"
                />
              </View>

              {/* Best fairway hit rate */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="git-branch" size={16} color="#16a34a" />
                  <Text style={styles.sectionTitle}>Fairway King</Text>
                </View>
                <Text style={styles.sectionSub}>Highest fairway hit rate (par 4s & 5s) — min. 9 holes tracked</Text>
                <RateList
                  records={data.fame.bestFIR}
                  icon="git-branch-outline"
                  color="#16a34a"
                  formatVal={v => `${v.toFixed(0)}%`}
                  unit="FIR"
                  emptyMsg="Not enough fairway tracking data yet"
                />
              </View>

              {/* Best GIR rate */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="flag" size={16} color="#0891b2" />
                  <Text style={styles.sectionTitle}>GIR Machine</Text>
                </View>
                <Text style={styles.sectionSub}>Highest greens in regulation % — min. 9 holes tracked</Text>
                <RateList
                  records={data.fame.bestGIR}
                  icon="flag-outline"
                  color="#0891b2"
                  formatVal={v => `${v.toFixed(0)}%`}
                  unit="GIR"
                  emptyMsg="Not enough GIR tracking data yet"
                />
              </View>

              {/* Fewest putts */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="ellipse" size={16} color="#7c3aed" />
                  <Text style={styles.sectionTitle}>Putting Wizard</Text>
                </View>
                <Text style={styles.sectionSub}>Fewest putts per round on average — min. 1 full round tracked</Text>
                <RateList
                  records={data.fame.fewestPutts}
                  icon="ellipse-outline"
                  color="#7c3aed"
                  formatVal={v => v.toFixed(1)}
                  unit="putts/rnd"
                  emptyMsg="Not enough putting data yet"
                />
              </View>
            </>
          )}

          {/* ═══════════════════ HALL OF SHAME ═══════════════════ */}
          {tab === 'shame' && (
            <>
              {/* Shame totals summary bar */}
              {(() => {
                const totalBigNums = data.shame.bigNumbers.reduce((s, r) => s + r.count, 0);
                return (
                  <View style={[styles.summaryRow, styles.summaryRowShame]}>
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: colors.danger }]}>
                        {toParStr(data.shame.highRounds[0]?.score_to_par)}
                      </Text>
                      <Text style={styles.summaryLabel}>Club High</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: '#E05C1A' }]}>{totalBigNums}</Text>
                      <Text style={styles.summaryLabel}>Big Numbers</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryTile}>
                      <Text style={[styles.summaryValue, { color: colors.danger }]}>
                        {data.shame.worstHole ? `+${data.shame.worstHole.over_par}` : '—'}
                      </Text>
                      <Text style={styles.summaryLabel}>Worst Hole</Text>
                    </View>
                  </View>
                );
              })()}

              {/* Highest round podium */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="skull-outline" size={16} color={colors.danger} />
                  <Text style={[styles.sectionTitle, { color: colors.danger }]}>Worst Round</Text>
                </View>
                <Text style={styles.sectionSub}>Worst scores to par — accounts for different course pars</Text>
                <Podium
                  records={data.shame.highRounds}
                  meta={SHAME_PODIUM}
                  label="to par"
                  valueKey="score_to_par"
                  formatter={toParStr}
                />
              </View>

              {/* Worst hole ever */}
              {data.shame.worstHole ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={[styles.sectionTitle, { color: colors.danger }]}>Worst Hole Ever</Text>
                  </View>
                  <Text style={styles.sectionSub}>The single most painful hole in club history</Text>
                  <View style={[styles.recordCard, { borderLeftColor: colors.danger }]}>
                    <View style={[styles.recordIconWrap, { backgroundColor: colors.danger + '18' }]}>
                      <Ionicons name="alert-circle" size={22} color={colors.danger} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recordName}>{name(data.shame.worstHole)}</Text>
                      <Text style={styles.recordSub}>
                        Hole {data.shame.worstHole.hole_number} (Par {data.shame.worstHole.par}) · {data.shame.worstHole.course_name}
                      </Text>
                    </View>
                    <View style={styles.recordValueWrap}>
                      <Text style={[styles.recordValue, { color: colors.danger }]}>
                        {data.shame.worstHole.score}
                      </Text>
                      <Text style={[styles.recordValueLabel, { color: colors.danger + 'cc' }]}>
                        +{data.shame.worstHole.over_par}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Triple bogey club */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="flame" size={16} color="#E05C1A" />
                  <Text style={[styles.sectionTitle, { color: '#E05C1A' }]}>Triple Bogey Club</Text>
                </View>
                <Text style={styles.sectionSub}>Most triple bogeys (or worse) ever recorded</Text>
                <CountList
                  records={data.shame.bigNumbers}
                  icon="flame-outline"
                  color="#E05C1A"
                  unit="big #s"
                  emptyMsg="No big numbers recorded — impressive!"
                />
              </View>

              {/* Worst fairway hit rate */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="git-branch" size={16} color={colors.danger} />
                  <Text style={[styles.sectionTitle, { color: colors.danger }]}>Fairway Dodger</Text>
                </View>
                <Text style={styles.sectionSub}>Lowest fairway hit rate (par 4s & 5s) — min. 9 holes tracked</Text>
                <RateList
                  records={data.shame.worstFIR}
                  icon="git-branch-outline"
                  color={colors.danger}
                  formatVal={v => `${v.toFixed(0)}%`}
                  unit="FIR"
                  emptyMsg="Not enough fairway tracking data yet"
                />
              </View>

              {/* Worst GIR rate */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="flag" size={16} color="#E05C1A" />
                  <Text style={[styles.sectionTitle, { color: '#E05C1A' }]}>Green Avoider</Text>
                </View>
                <Text style={styles.sectionSub}>Lowest greens in regulation % — min. 9 holes tracked</Text>
                <RateList
                  records={data.shame.worstGIR}
                  icon="flag-outline"
                  color="#E05C1A"
                  formatVal={v => `${v.toFixed(0)}%`}
                  unit="GIR"
                  emptyMsg="Not enough GIR tracking data yet"
                />
              </View>

              {/* Most putts */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="ellipse" size={16} color={colors.danger} />
                  <Text style={[styles.sectionTitle, { color: colors.danger }]}>Three-Putt Terror</Text>
                </View>
                <Text style={styles.sectionSub}>Most putts per round on average — min. 1 full round tracked</Text>
                <RateList
                  records={data.shame.mostPutts}
                  icon="ellipse-outline"
                  color={colors.danger}
                  formatVal={v => v.toFixed(1)}
                  unit="putts/rnd"
                  emptyMsg="Not enough putting data yet"
                />
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: colors.background },
  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText:   { color: colors.danger, fontSize: fontSize.base, textAlign: 'center' },
  scrollContent:{ padding: spacing.md, paddingBottom: spacing.xl },

  // Toggle
  toggle: {
    flexDirection: 'row',
    margin: spacing.md,
    marginBottom: 0,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.md,
  },
  toggleBtnActiveFame:  { backgroundColor: colors.surface, ...shadows.card },
  toggleBtnActiveShame: { backgroundColor: colors.surface, ...shadows.card },
  toggleText:           { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  toggleTextActiveFame: { color: colors.gold },
  toggleTextActiveShame:{ color: colors.danger },

  // Sections
  section: { marginTop: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sectionTitle:  { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  sectionSub:    { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 17 },

  // Podium
  podiumWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  podiumCol:  { flex: 1, alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadows.card },
  podiumAvatar: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center', alignItems: 'center',
    marginTop: spacing.sm,
  },
  podiumAvatarText: { fontSize: fontSize.base, fontWeight: '700' },
  podiumName:       { fontSize: 11, fontWeight: '600', color: colors.textPrimary, textAlign: 'center', paddingHorizontal: 4 },
  podiumCourse:     { fontSize: 10, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
  podiumScore:      { fontSize: fontSize.xl, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  podiumScoreLabel: { fontSize: 10, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  podiumFloor: {
    width: '100%', alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  podiumFloorRank: { fontSize: 11, fontWeight: '800', color: '#fff' },

  // Record card (single record highlight)
  recordCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderLeftWidth: 4, ...shadows.card,
  },
  recordIconWrap:   { width: 48, height: 48, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  recordName:       { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  recordSub:        { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  recordValueWrap:  { alignItems: 'center', flexShrink: 0 },
  recordValue:      { fontSize: fontSize.xl, fontWeight: '800' },
  recordValueLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },

  // Count leaderboard card
  countCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderLeftWidth: 4,
    overflow: 'hidden', ...shadows.card,
  },
  countRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 12 },
  countRowBorder: { borderTopWidth: 1, borderTopColor: colors.surfaceMuted },
  countRankBadge: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  countRankText:  { fontSize: 11, fontWeight: '800', color: '#fff' },
  countAvatar:    { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  countAvatarText:{ fontSize: fontSize.sm, fontWeight: '700' },
  countName:      { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  countBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  countValue:     { fontSize: fontSize.md, fontWeight: '800' },
  countUnit:      { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '500' },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: 28,
    alignItems: 'center', gap: spacing.sm, ...shadows.card,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  // Summary bar (club totals at top of each tab)
  summaryRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: 14, paddingHorizontal: spacing.sm,
    marginTop: spacing.sm, ...shadows.card,
    borderWidth: 1, borderColor: colors.border,
  },
  summaryRowShame: {
    borderColor: colors.danger + '40',
  },
  summaryTile:    { flex: 1, alignItems: 'center' },
  summaryValue:   { fontSize: fontSize.xl, fontWeight: '800', lineHeight: 26 },
  summaryLabel:   { fontSize: 10, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: colors.border },
});
