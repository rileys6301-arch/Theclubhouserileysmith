import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';
import ScorecardModal from '../components/ScorecardModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClubRound = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number; course_handicap: number | null; is_nine_hole: boolean;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type Props = {
  navigation: any;
  route: { params: { clubId: number; clubName: string; userId: string } };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  '#2D4A2D', '#3b6ea8', '#7b4a9e', '#2980b9',
  '#8B6914', '#16a085', '#c0392b', '#d35400',
];
function avatarBg(id: string): string {
  const sum = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}
function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function personInitials(first: string | null, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClubActivityScreen({ navigation, route }: Props) {
  const { clubId, clubName } = route.params;
  const insets = useSafeAreaInsets();

  const [rounds,    setRounds]    = useState<ClubRound[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scorecardId, setScorecardId] = useState<string | null>(null);

  const fetchRounds = useCallback(async () => {
    try {
      const { data } = await client.get<ClubRound[]>(`/api/rounds/club-recent?club_id=${clubId}`);
      setRounds(Array.isArray(data) ? data : []);
    } catch { /* keep stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  useEffect(() => { fetchRounds(); }, [fetchRounds]);

  function onRefresh() { setRefreshing(true); fetchRounds(); }

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Club Activity</Text>
            <Text style={s.headerSub}>{clubName}</Text>
          </View>
          <View style={{ width: 64 }} />
        </View>

        <Text style={s.sectionLabel}>Last 7 Days</Text>

        {rounds.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="golf-outline" size={40} color="#ddd" style={{ marginBottom: 10 }} />
            <Text style={s.emptyText}>No rounds played in the last 7 days</Text>
          </View>
        ) : (
          <View style={s.roundsList}>
            {rounds.map((r, i) => (
              <TouchableOpacity
                key={r.id}
                style={[s.roundRow, i === 0 && { borderTopWidth: 0 }]}
                onPress={() => setScorecardId(r.id)}
                activeOpacity={0.7}
              >
                <View style={[s.avatar, { backgroundColor: avatarBg(r.user_id) }]}>
                  <Text style={s.avatarText}>{personInitials(r.first_name, r.last_name)}</Text>
                </View>
                <View style={s.info}>
                  <Text style={s.playerName} numberOfLines={1}>{personName(r.first_name, r.last_name, r.email)}</Text>
                  <Text style={s.courseName} numberOfLines={1}>
                    {r.course_name}{r.is_nine_hole ? ' · 9 holes' : ''}
                  </Text>
                </View>
                <View style={[s.scoreWrap, { marginRight: 4 }]}>
                  <Text style={s.pts}>{r.stableford}</Text>
                  <Text style={s.when}>{timeAgo(r.played_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.border} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {scorecardId != null && (
        <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2, width: 64 },
  backText:    { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  headerCenter:{ flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  headerSub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  sectionLabel: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: spacing.sm, marginTop: spacing.xs,
  },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.xl, alignItems: 'center', marginTop: spacing.md,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  roundsList: {
    backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
    ...shadows.card,
  },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.07)',
  },
  avatar:     { width: 40, height: 40, borderRadius: radius.full, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText: { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },
  info:       { flex: 1, minWidth: 0 },
  playerName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  courseName: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  scoreWrap:  { alignItems: 'flex-end' },
  pts:        { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  when:       { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
});
