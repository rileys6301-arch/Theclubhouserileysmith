import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';
import { useDrawer } from '../context/DrawerContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatPlayer = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
};

type GrossRow = StatPlayer & { score: number; course_name: string; played_at: string };
type NetRow   = StatPlayer & { score: number; net_score: number; handicap_index: number; course_name: string; played_at: string };
type StabRow  = StatPlayer & { stableford: number; course_name: string; played_at: string };
type ImprovedRow = StatPlayer & { current_handicap: number | null; month_start_hcp: number; month_end_hcp: number; handicap_drop: number };

type MonthlyStats = {
  lowest_gross: GrossRow[];
  lowest_net: NetRow[];
  highest_stableford: StabRow[];
  most_improved: ImprovedRow[];
};

type Props = {
  navigation: any;
  route: { params: { clubId: number; clubName: string } };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];

function SectionHeader({ icon, title, sub }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub?: string }) {
  return (
    <View style={s.sectionHeader}>
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text style={s.sectionTitle}>{title}</Text>
      {sub ? <Text style={s.sectionSub}>{sub}</Text> : null}
    </View>
  );
}

function EmptyCard() {
  return (
    <View style={s.emptyCard}>
      <Text style={s.emptyText}>No rounds recorded this month yet</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClubStatsScreen({ navigation, route }: Props) {
  const { clubId, clubName } = route.params;
  const insets = useSafeAreaInsets();
  const { openDrawer } = useDrawer();

  const [stats,      setStats]      = useState<MonthlyStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const monthLabel = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  }, []);

  const fetchStats = useCallback(async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      const { data } = await client.get<MonthlyStats>(
        `/api/clubs/${clubId}/monthly-stats?start=${fmt(start)}&end=${fmt(end)}`
      );
      setStats(data);
    } catch { /* stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  useFocusEffect(useCallback(() => { fetchStats(); }, [fetchStats]));
  function onRefresh() { setRefreshing(true); fetchStats(); }

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={openDrawer}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.hamburger}
        >
          <Ionicons name="menu" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Club Stats</Text>
          <Text style={s.headerSub}>{monthLabel}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >

          {/* ── Hall of Fame / Shame shortcut ── */}
          <TouchableOpacity
            style={s.hallCard}
            activeOpacity={0.75}
            onPress={() => navigation.navigate('Hall', { clubId, clubName })}
          >
            <View style={s.hallLeft}>
              <Text style={s.hallTitle}>Hall of Fame & Shame</Text>
              <Text style={s.hallSub}>All-time club records & legends</Text>
            </View>
            <View style={s.hallIconRow}>
              <View style={[s.hallIconBadge, { backgroundColor: '#F59E0B18' }]}>
                <Ionicons name="trophy" size={18} color="#F59E0B" />
              </View>
              <View style={[s.hallIconBadge, { backgroundColor: colors.danger + '18' }]}>
                <Ionicons name="skull-outline" size={18} color={colors.danger} />
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>

          {/* ── Lowest Gross Stroke ── */}
          <SectionHeader icon="golf-outline" title="Lowest Gross Stroke" sub={monthLabel} />
          {!stats?.lowest_gross.length ? <EmptyCard /> : (
            stats.lowest_gross.map((r, i) => (
              <TouchableOpacity
                key={`gross-${i}`}
                style={s.statCard}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('MemberProfile', {
                  userId: r.user_id,
                  name: personName(r.first_name, r.last_name, r.email),
                })}
              >
                <Text style={s.medal}>{MEDALS[i] ?? `${i + 1}.`}</Text>
                <View style={s.statInfo}>
                  <Text style={s.statName}>{personName(r.first_name, r.last_name, r.email)}</Text>
                  <Text style={s.statCourse} numberOfLines={1}>{r.course_name} · {formatDate(r.played_at)}</Text>
                </View>
                <Text style={s.statValue}>{r.score}</Text>
              </TouchableOpacity>
            ))
          )}

          {/* ── Lowest Net Stroke ── */}
          <SectionHeader icon="calculator-outline" title="Lowest Net Stroke" sub={monthLabel} />
          {!stats?.lowest_net.length ? <EmptyCard /> : (
            stats.lowest_net.map((r, i) => (
              <TouchableOpacity
                key={`net-${i}`}
                style={s.statCard}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('MemberProfile', {
                  userId: r.user_id,
                  name: personName(r.first_name, r.last_name, r.email),
                })}
              >
                <Text style={s.medal}>{MEDALS[i] ?? `${i + 1}.`}</Text>
                <View style={s.statInfo}>
                  <Text style={s.statName}>{personName(r.first_name, r.last_name, r.email)}</Text>
                  <Text style={s.statCourse} numberOfLines={1}>{r.course_name} · {formatDate(r.played_at)}</Text>
                </View>
                <View style={s.statValueCol}>
                  <Text style={s.statValue}>{r.net_score}</Text>
                  <Text style={s.statValueSub}>net ({r.score} gross)</Text>
                </View>
              </TouchableOpacity>
            ))
          )}

          {/* ── Highest Stableford ── */}
          <SectionHeader icon="star-outline" title="Highest Stableford" sub={monthLabel} />
          {!stats?.highest_stableford.length ? <EmptyCard /> : (
            stats.highest_stableford.map((r, i) => (
              <TouchableOpacity
                key={`stab-${i}`}
                style={s.statCard}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('MemberProfile', {
                  userId: r.user_id,
                  name: personName(r.first_name, r.last_name, r.email),
                })}
              >
                <Text style={s.medal}>{MEDALS[i] ?? `${i + 1}.`}</Text>
                <View style={s.statInfo}>
                  <Text style={s.statName}>{personName(r.first_name, r.last_name, r.email)}</Text>
                  <Text style={s.statCourse} numberOfLines={1}>{r.course_name} · {formatDate(r.played_at)}</Text>
                </View>
                <Text style={[s.statValue, { color: colors.primary }]}>{r.stableford} pts</Text>
              </TouchableOpacity>
            ))
          )}

          {/* ── Most Improved Handicap ── */}
          <SectionHeader icon="trending-down-outline" title="Most Improved Handicap" />
          {!stats?.most_improved.length ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyText}>No handicap movement recorded this month</Text>
            </View>
          ) : (
            stats.most_improved.map((r, i) => (
              <TouchableOpacity
                key={`hcp-${i}`}
                style={s.statCard}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('MemberProfile', {
                  userId: r.user_id,
                  name: personName(r.first_name, r.last_name, r.email),
                })}
              >
                <Text style={s.medal}>{MEDALS[i] ?? `${i + 1}.`}</Text>
                <View style={s.statInfo}>
                  <Text style={s.statName}>{personName(r.first_name, r.last_name, r.email)}</Text>
                  <Text style={s.statCourse}>
                    {Number(r.month_start_hcp).toFixed(1)} → {Number(r.month_end_hcp).toFixed(1)}
                  </Text>
                </View>
                <Text style={[s.statValue, { color: colors.primary }]}>
                  -{Number(r.handicap_drop).toFixed(1)}
                </Text>
              </TouchableOpacity>
            ))
          )}

        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hamburger: { width: 40, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#111' },
  headerSub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  content: { padding: spacing.md, gap: spacing.xs },

  // Hall card
  hallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
    gap: spacing.sm,
  },
  hallLeft:    { flex: 1 },
  hallTitle:   { fontSize: fontSize.base, fontWeight: '700', color: '#111' },
  hallSub:     { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  hallIconRow:  { flexDirection: 'row', gap: 6 },
  hallIconBadge: { width: 34, height: 34, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionSub:   { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600', marginLeft: 'auto' },

  // Stat cards
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.card,
  },
  medal:         { fontSize: 20, width: 28, textAlign: 'center' },
  statInfo:      { flex: 1 },
  statName:      { fontSize: fontSize.sm, fontWeight: '700', color: '#111' },
  statCourse:    { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  statValue:     { fontSize: fontSize.xl, fontWeight: '800', color: '#111' },
  statValueCol:  { alignItems: 'flex-end' },
  statValueSub:  { fontSize: 10, color: colors.textSecondary, marginTop: 1 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
