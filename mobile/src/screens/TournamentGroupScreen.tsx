import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Competition = {
  id: number;
  name: string;
  date: string;
  format: string;
  status: 'upcoming' | 'active' | 'completed';
  course_name: string;
};

type Entry = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  handicap: number | null;
  scores: (number | null)[];
  total: number;
  comps_played: number;
};

type Group = {
  id: number;
  name: string;
  description: string | null;
  scoring: string;
  scoring_n: number;
  status: 'active' | 'completed';
  club_id: number;
  created_by: string | null;
};

type GroupData = {
  group: Group;
  competitions: Competition[];
  entries: Entry[];
};

type Props = {
  navigation: any;
  route: { params: { groupId: number; userId: string; clubId: number; clubName: string; role: string } };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function personInitials(first: string | null, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford', stroke: 'Stroke', net_stroke: 'Net', match_play: 'Match',
  scramble: 'Scramble', best_ball: 'Best Ball', skins: 'Skins',
};

const SCORING_LABELS: Record<string, string> = {
  total_stableford: 'Total Points',
  best_n:           'Best N Rounds',
};

const STATUS_COLOR: Record<string, string> = {
  active:    colors.primary,
  upcoming:  '#F59E0B',
  completed: colors.textSecondary,
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TournamentGroupScreen({ navigation, route }: Props) {
  const { groupId, userId, clubId, clubName, role } = route.params;
  const insets = useSafeAreaInsets();
  const isAdminOrOwner = role === 'owner' || role === 'admin';

  const [data,       setData]       = useState<GroupData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await client.get<GroupData>(`/api/groups/${groupId}/leaderboard`);
      setData(d);
    } catch { /* stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  function onRefresh() { setRefreshing(true); fetchData(); }

  function confirmDelete() {
    Alert.alert('Delete Group', `Remove "${data?.group.name}"? Tournaments stay, only the group is removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/groups/${groupId}`);
          navigation.goBack();
        } catch { Alert.alert('Error', 'Could not delete group'); }
      }},
    ]);
  }

  function toggleStatus() {
    if (!data) return;
    const next = data.group.status === 'active' ? 'completed' : 'active';
    Alert.alert(
      next === 'completed' ? 'Crown Winner?' : 'Reopen Group?',
      next === 'completed'
        ? 'Mark this group as completed and crown the overall winner?'
        : 'Reopen this group to allow more tournaments?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: next === 'completed' ? 'Complete' : 'Reopen', onPress: async () => {
          try {
            await client.patch(`/api/groups/${groupId}`, { status: next });
            fetchData();
          } catch { Alert.alert('Error', 'Could not update group'); }
        }},
      ]
    );
  }

  if (loading) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  const group  = data?.group;
  const comps  = data?.competitions ?? [];
  const entries = data?.entries ?? [];
  const winner = entries[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{group?.name ?? 'Group'}</Text>
          <Text style={s.headerSub}>{clubName}</Text>
        </View>
        {isAdminOrOwner ? (
          <TouchableOpacity
            onPress={() => Alert.alert(group?.name ?? 'Group', undefined, [
              { text: group?.status === 'active' ? 'Mark Completed' : 'Reopen', onPress: toggleStatus },
              { text: 'Delete Group', style: 'destructive', onPress: confirmDelete },
              { text: 'Cancel', style: 'cancel' },
            ])}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.moreBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >

        {/* ── Group meta ── */}
        <View style={s.metaRow}>
          <View style={[s.statusPill, { backgroundColor: group?.status === 'active' ? colors.primary + '18' : colors.textSecondary + '18' }]}>
            <Text style={[s.statusText, { color: group?.status === 'active' ? colors.primary : colors.textSecondary }]}>
              {group?.status === 'active' ? '● Active' : 'Completed'}
            </Text>
          </View>
          <Text style={s.scoringLabel}>{SCORING_LABELS[group?.scoring ?? ''] ?? group?.scoring}</Text>
          {group?.scoring === 'best_n' && (
            <Text style={s.scoringLabel}>(Best {group.scoring_n})</Text>
          )}
          <Text style={s.scoringLabel}>· {comps.length} round{comps.length !== 1 ? 's' : ''}</Text>
        </View>

        {/* ── Winner banner (if completed) ── */}
        {group?.status === 'completed' && winner && (
          <View style={s.winnerBanner}>
            <Text style={s.winnerCrown}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.winnerLabel}>Overall Winner</Text>
              <Text style={s.winnerName}>{personName(winner.first_name, winner.last_name, winner.email)}</Text>
            </View>
            <Text style={s.winnerTotal}>{winner.total} pts</Text>
          </View>
        )}

        {/* ── Leaderboard ── */}
        <Text style={s.sectionLabel}>LEADERBOARD</Text>
        {entries.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="trophy-outline" size={36} color="#ddd" style={{ marginBottom: 8 }} />
            <Text style={s.emptyText}>No scores recorded yet</Text>
            <Text style={s.emptySubText}>Scores from linked tournaments will appear here</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            <View>
              {/* Table header */}
              <View style={s.tableHeader}>
                <Text style={[s.thRank]}>#</Text>
                <Text style={s.thName}>Player</Text>
                {comps.map((c, i) => (
                  <TouchableOpacity
                    key={c.id}
                    style={s.thComp}
                    onPress={() => navigation.navigate('Competition', { competitionId: c.id, userId })}
                  >
                    <Text style={s.thCompText} numberOfLines={1}>R{i + 1}</Text>
                    <Text style={s.thCompSub} numberOfLines={1}>{fmtDate(c.date)}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={s.thTotal}>Total</Text>
              </View>

              {/* Player rows */}
              {entries.map((e, i) => {
                const isMe = e.user_id === userId;
                const podium = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                return (
                  <TouchableOpacity
                    key={e.user_id}
                    style={[s.tableRow, isMe && s.tableRowMe]}
                    onPress={() => navigation.navigate('MemberProfile', {
                      userId: e.user_id,
                      name: personName(e.first_name, e.last_name, e.email),
                    })}
                    activeOpacity={0.75}
                  >
                    <Text style={s.tdRank}>{podium ?? `${i + 1}`}</Text>
                    <View style={s.tdNameWrap}>
                      <View style={[s.avatar, isMe && s.avatarMe]}>
                        <Text style={s.avatarText}>{personInitials(e.first_name, e.last_name)}</Text>
                      </View>
                      <Text style={s.tdName} numberOfLines={1}>
                        {personName(e.first_name, e.last_name, e.email)}
                      </Text>
                    </View>
                    {e.scores.map((sc, j) => (
                      <Text
                        key={j}
                        style={[s.tdScore, sc === null && s.tdScoreNull]}
                      >
                        {sc !== null ? sc : '—'}
                      </Text>
                    ))}
                    <Text style={[s.tdTotal, group?.status === 'completed' && i === 0 && s.tdTotalWinner]}>
                      {e.total}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* ── Tournaments in this group ── */}
        <Text style={s.sectionLabel}>ROUNDS IN THIS GROUP</Text>
        {comps.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>No tournaments linked yet</Text>
            <Text style={s.emptySubText}>Assign tournaments to this group when creating them</Text>
          </View>
        ) : (
          comps.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              style={s.compCard}
              onPress={() => navigation.navigate('Competition', { competitionId: c.id, userId })}
              activeOpacity={0.75}
            >
              <View style={s.compCardLeft}>
                <Text style={s.compRound}>R{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.compName} numberOfLines={1}>{c.name}</Text>
                <Text style={s.compMeta}>{fmtDate(c.date)} · {FORMAT_LABELS[c.format] ?? c.format}</Text>
              </View>
              <View style={[s.compStatus, { backgroundColor: STATUS_COLOR[c.status] + '18' }]}>
                <Text style={[s.compStatusText, { color: STATUS_COLOR[c.status] }]}>
                  {c.status === 'active' ? '● Live' : c.status === 'upcoming' ? 'Upcoming' : 'Done'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.border} />
            </TouchableOpacity>
          ))
        )}

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:      { width: 36, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: fontSize.lg, fontWeight: '700', color: '#111' },
  headerSub:    { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  moreBtn:      { width: 36, alignItems: 'flex-end' },

  content: { padding: spacing.md },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md, flexWrap: 'wrap' },
  statusPill:  { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: fontSize.xs, fontWeight: '700' },
  scoringLabel:{ fontSize: fontSize.xs, color: colors.textSecondary },

  winnerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primary + '12',
    borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.primary + '30',
  },
  winnerCrown: { fontSize: 32 },
  winnerLabel: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  winnerName:  { fontSize: fontSize.lg, fontWeight: '800', color: '#111', marginTop: 2 },
  winnerTotal: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary },

  sectionLabel: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },

  // Table
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingBottom: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  thRank:    { width: 28, fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  thName:    { width: 140, fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', paddingLeft: 4 },
  thComp:    { width: 48, alignItems: 'center' },
  thCompText:{ fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  thCompSub: { fontSize: 9, color: colors.textSecondary },
  thTotal:   { width: 52, fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '700', textAlign: 'right' },

  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border + '80',
    backgroundColor: colors.surface,
  },
  tableRowMe: { backgroundColor: colors.primary + '08' },

  tdRank: { width: 28, fontSize: fontSize.sm, textAlign: 'center' },
  tdNameWrap: { width: 140, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2 },
  tdName: { fontSize: fontSize.sm, fontWeight: '600', color: '#111', flex: 1 },
  tdScore: { width: 48, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center', color: '#374151' },
  tdScoreNull: { color: colors.textSecondary },
  tdTotal: { width: 52, fontSize: fontSize.base, fontWeight: '800', textAlign: 'right', color: '#111' },
  tdTotalWinner: { color: colors.primary },

  avatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.primary + '18',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarMe:   { backgroundColor: colors.primary },
  avatarText: { fontSize: 10, fontWeight: '700', color: colors.primary },

  // Comp cards
  compCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm + 2, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  compCardLeft: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: colors.primary + '18',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  compRound:      { fontSize: 11, fontWeight: '800', color: colors.primary },
  compName:       { fontSize: fontSize.sm, fontWeight: '700', color: '#111' },
  compMeta:       { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  compStatus:     { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  compStatusText: { fontSize: 11, fontWeight: '700' },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  emptyText:    { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  emptySubText: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
});
