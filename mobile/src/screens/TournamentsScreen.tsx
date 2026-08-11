import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type CompItem = {
  id: number;
  name: string;
  club_id: number | null;
  format: string;
  team_size: number;
  date: string;
  course_name: string;
  tee_name: string | null;
  status: 'upcoming' | 'active' | 'completed';
  entry_count: number;
  entered: boolean;
  is_creator: boolean;
  creator_first: string | null;
  creator_last: string | null;
  creator_email: string;
};

type Group = {
  id: number;
  name: string;
  description: string | null;
  scoring: string;
  scoring_n: number;
  status: 'active' | 'completed';
  comp_count: number;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford', stroke: 'Stroke Play', net_stroke: 'Net Stroke',
  match_play: 'Match Play', scramble: 'Scramble', best_ball: 'Best Ball', skins: 'Skins',
};

const STATUS_CONFIG = {
  active:    { label: '● Live',    fg: colors.primary,       bg: colors.primary + '18' },
  upcoming:  { label: 'Upcoming',  fg: colors.secondary,     bg: colors.secondary + '18' },
  completed: { label: 'Completed', fg: colors.textSecondary, bg: colors.textSecondary + '18' },
} as const;

const SCORING_OPTIONS = [
  { value: 'total_stableford', label: 'Total Points', desc: 'Sum of all round points' },
  { value: 'best_n',           label: 'Best N Rounds', desc: 'Sum of top N round scores' },
];

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TournamentsScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { clubId, userId } = (route.params ?? {}) as { clubId?: number; userId?: string };
  const insets = useSafeAreaInsets();

  const [items,      setItems]      = useState<CompItem[]>([]);
  const [groups,     setGroups]     = useState<Group[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── New Group modal ──────────────────────────────────────────────────────────
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName,    setGroupName]    = useState('');
  const [groupScoring, setGroupScoring] = useState('total_stableford');
  const [groupN,       setGroupN]       = useState('3');
  const [groupSaving,  setGroupSaving]  = useState(false);
  const [groupError,   setGroupError]   = useState('');

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const params = clubId ? { club_id: clubId } : {};
      const [compsRes, groupsRes] = await Promise.allSettled([
        client.get<CompItem[]>('/api/competitions', { params }),
        clubId ? client.get<Group[]>('/api/groups', { params: { club_id: clubId } }) : Promise.resolve({ data: [] as Group[] }),
      ]);
      if (compsRes.status === 'fulfilled') setItems(Array.isArray(compsRes.value.data) ? compsRes.value.data : []);
      if (groupsRes.status === 'fulfilled') setGroups(Array.isArray(groupsRes.value.data) ? groupsRes.value.data : []);
    } catch { /* keep stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));
  function onRefresh() { setRefreshing(true); fetchAll(); }

  // ── Actions ───────────────────────────────────────────────────────────────

  function openCreate() {
    if (!clubId) return;
    navigation.navigate('CreateCompetition', { clubId, clubName: '' });
  }

  function handleNew() {
    Alert.alert('Create New', undefined, [
      { text: 'Tournament', onPress: openCreate },
      { text: 'Tournament Group', onPress: () => { resetGroupForm(); setShowGroupModal(true); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function resetGroupForm() {
    setGroupName(''); setGroupScoring('total_stableford'); setGroupN('3');
    setGroupError(''); setGroupSaving(false);
  }

  async function createGroup() {
    setGroupError('');
    if (!groupName.trim()) { setGroupError('Group name is required'); return; }
    setGroupSaving(true);
    try {
      const { data } = await client.post<Group>('/api/groups', {
        clubId,
        name:      groupName.trim(),
        scoring:   groupScoring,
        scoringN:  groupScoring === 'best_n' ? parseInt(groupN) || 3 : 3,
      });
      setGroups(prev => [data, ...prev]);
      setShowGroupModal(false);
    } catch (e: any) {
      setGroupError(e.response?.data?.error ?? 'Could not create group');
    } finally {
      setGroupSaving(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderGroup(g: Group) {
    const isCompleted = g.status === 'completed';
    return (
      <TouchableOpacity
        key={g.id}
        style={styles.groupCard}
        onPress={() => navigation.navigate('TournamentGroup', {
          groupId: g.id, userId: userId ?? '', clubId: clubId ?? 0, clubName: '', role: 'member',
        })}
        activeOpacity={0.75}
      >
        <View style={styles.groupLeft}>
          <Ionicons name="layers-outline" size={20} color={isCompleted ? colors.textSecondary : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
          <Text style={styles.groupMeta}>
            {g.comp_count} round{g.comp_count !== 1 ? 's' : ''} · {g.scoring === 'best_n' ? `Best ${g.scoring_n}` : 'Total Points'}
          </Text>
        </View>
        <View style={[styles.groupStatus, {
          backgroundColor: isCompleted ? colors.textSecondary + '18' : colors.primary + '18',
        }]}>
          <Text style={[styles.groupStatusText, { color: isCompleted ? colors.textSecondary : colors.primary }]}>
            {isCompleted ? 'Done' : '● Active'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={colors.border} />
      </TouchableOpacity>
    );
  }

  function renderCard(item: CompItem) {
    const sc = STATUS_CONFIG[item.status];
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        onPress={() => navigation.navigate('Competition', { competitionId: item.id, userId: userId ?? '' })}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.fg }]}>{sc.label}</Text>
          </View>
        </View>
        <View style={styles.cardMeta}>
          <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
          <Text style={styles.cardMetaText}>{fmtDate(item.date)}</Text>
          <Text style={styles.cardMetaDot}>·</Text>
          <Ionicons name="golf-outline" size={12} color={colors.textSecondary} />
          <Text style={styles.cardMetaText} numberOfLines={1}>{item.course_name}</Text>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.formatPill}>
            <Text style={styles.formatText}>{FORMAT_LABELS[item.format] ?? item.format}</Text>
          </View>
          <View style={styles.cardBottomRight}>
            <Text style={styles.entries}>
              {item.entry_count} player{item.entry_count !== 1 ? 's' : ''}
            </Text>
            {item.entered && item.status !== 'active' && (
              <View style={styles.enteredPill}>
                <Text style={styles.enteredText}>Entered</Text>
              </View>
            )}
            {item.status === 'active' && item.entered && userId && (
              <TouchableOpacity
                style={styles.scoreLiveBtn}
                onPress={() => navigation.navigate('TournamentScoring', { competitionId: item.id, userId: userId ?? '' })}
                activeOpacity={0.8}
              >
                <Ionicons name="golf" size={11} color={colors.textInverse} />
                <Text style={styles.scoreLiveText}>Score</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderSection(title: string, data: CompItem[]) {
    if (data.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{title}</Text>
        {data.map(renderCard)}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const active    = items.filter(c => c.status === 'active');
  const upcoming  = items.filter(c => c.status === 'upcoming');
  const completed = items.filter(c => c.status === 'completed');

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header — paddingLeft clears the floating hamburger button */}
        <View style={styles.header}>
          <View style={{ paddingLeft: 44 }}>
            <Text style={styles.screenTitle}>Tournaments</Text>
            <Text style={styles.screenSub}>
              {items.length > 0 ? `${items.length} competition${items.length !== 1 ? 's' : ''}` : 'No competitions yet'}
            </Text>
          </View>
          {clubId ? (
            <TouchableOpacity style={styles.createBtn} onPress={handleNew} activeOpacity={0.8}>
              <Ionicons name="add" size={18} color={colors.textInverse} />
              <Text style={styles.createBtnText}>New</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Groups section ── */}
        {groups.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>GROUPS</Text>
              {clubId && (
                <TouchableOpacity onPress={() => { resetGroupForm(); setShowGroupModal(true); }}>
                  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {groups.map(renderGroup)}
          </View>
        )}

        {/* ── Competitions ── */}
        {items.length === 0 && groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trophy-outline" size={44} color={colors.border} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.emptyTitle}>No competitions yet</Text>
            {clubId ? (
              <TouchableOpacity style={styles.emptyCreateBtn} onPress={handleNew} activeOpacity={0.8}>
                <Text style={styles.emptyCreateBtnText}>Create the first one</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.emptyText}>Join a club to enter competitions</Text>
            )}
          </View>
        ) : (
          <>
            {renderSection('LIVE NOW', active)}
            {renderSection('UPCOMING', upcoming)}
            {renderSection('COMPLETED', completed)}
          </>
        )}
      </ScrollView>

      {/* ── New Group Modal ── */}
      <Modal
        visible={showGroupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowGroupModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={styles.modalRoot}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowGroupModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>New Tournament Group</Text>
              <View style={{ width: 24 }} />
            </View>

            <Text style={styles.modalDesc}>
              A group links multiple tournaments into a running series, tracks combined scores, and crowns an overall winner.
            </Text>

            {groupError ? <Text style={styles.errorText}>{groupError}</Text> : null}

            <Text style={styles.fieldLabel}>Group Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. Monthly Medal — 2026"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
            />

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Scoring Method</Text>
            {SCORING_OPTIONS.map(opt => {
              const active = groupScoring === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.scoringOption, active && styles.scoringOptionActive]}
                  onPress={() => setGroupScoring(opt.value)}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.scoringLabel, active && styles.scoringLabelActive]}>{opt.label}</Text>
                    <Text style={styles.scoringDesc}>{opt.desc}</Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}

            {groupScoring === 'best_n' && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Count best N rounds</Text>
                <View style={styles.nRow}>
                  {['2', '3', '4', '5', '6'].map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.nBtn, groupN === n && styles.nBtnActive]}
                      onPress={() => setGroupN(n)}
                    >
                      <Text style={[styles.nBtnText, groupN === n && styles.nBtnTextActive]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.createGroupBtn, groupSaving && { opacity: 0.6 }]}
              onPress={createGroup}
              disabled={groupSaving}
              activeOpacity={0.85}
            >
              {groupSaving
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.createGroupBtnText}>Create Group</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: spacing.lg,
  },
  screenTitle: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary, marginBottom: 2 },
  screenSub:   { fontSize: fontSize.sm, color: colors.textSecondary },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, marginTop: 4,
  },
  createBtnText: { color: colors.textInverse, fontSize: fontSize.sm, fontWeight: '700' },

  section:          { marginBottom: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionLabel: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },

  // Group cards
  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  groupLeft: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.primary + '12',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  groupName:       { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  groupMeta:       { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  groupStatus:     { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  groupStatusText: { fontSize: 11, fontWeight: '700' },

  // Competition cards (unchanged from before)
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.card,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.sm,
  },
  cardName:     { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  cardMeta:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm, flexWrap: 'wrap' },
  cardMetaText: { fontSize: fontSize.xs, color: colors.textSecondary, flexShrink: 1 },
  cardMetaDot:  { fontSize: fontSize.xs, color: colors.border },
  cardBottom:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  statusBadge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, flexShrink: 0 },
  statusText:  { fontSize: fontSize.xs, fontWeight: '700' },

  formatPill: {
    backgroundColor: colors.surfaceMuted, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  formatText:  { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  entries:     { fontSize: fontSize.xs, color: colors.textSecondary },
  enteredPill: { backgroundColor: colors.primary + '18', borderRadius: radius.full, paddingHorizontal: spacing.xs + 2, paddingVertical: 2 },
  enteredText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  scoreLiveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.xs + 2, paddingVertical: 3,
  },
  scoreLiveText: { fontSize: 10, fontWeight: '700', color: colors.textInverse },

  empty: { alignItems: 'center', paddingTop: spacing.xl * 2 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.md },
  emptyCreateBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  emptyCreateBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.base },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary },

  // New group modal
  modalRoot:    { flex: 1, backgroundColor: colors.background },
  modalContent: { padding: spacing.lg, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  modalDesc:  { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  fieldLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs },
  fieldInput: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.base, color: colors.textPrimary,
  },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm },

  scoringOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  scoringOptionActive: { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  scoringLabel:       { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  scoringLabelActive: { color: colors.primary },
  scoringDesc:        { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  nRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  nBtn: {
    width: 48, height: 40, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
  },
  nBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  nBtnText:       { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
  nBtnTextActive: { color: colors.primary },

  createGroupBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  createGroupBtnText: { color: colors.textInverse, fontSize: fontSize.base, fontWeight: '700' },
});
