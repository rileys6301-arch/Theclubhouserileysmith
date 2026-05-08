import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';

const GREEN = '#1a7f3c';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Competition'>;
  route: { params: { competitionId: number; userId: string } };
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Entry = {
  player_id: string;
  player_first: string | null;
  player_last: string | null;
  player_email: string;
  handicap: number | null;
  scorer_id: string | null;
  total_stableford: number;
  total_strokes: number;
  holes_played: number;
};

type Comp = {
  id: number;
  name: string;
  format: string;
  team_size: number;
  date: string;
  course_name: string;
  tee_name: string | null;
  description: string | null;
  status: 'upcoming' | 'active' | 'completed';
  creator_first: string | null;
  creator_last: string | null;
  creator_email: string;
  created_by: string;
  entries: Entry[];
  myEntry: Entry | null;
  isCreator: boolean;
};

type LBRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  handicap: number | null;
  total_stableford: number;
  total_strokes: number;
  net_strokes: number;
  holes_played: number;
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
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford',
  stroke:     'Stroke Play',
  net_stroke: 'Net Stroke',
  match_play: 'Match Play',
  scramble:   'Scramble',
  best_ball:  'Best Ball',
  skins:      'Skins',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  upcoming:  { bg: '#eff6ff', text: '#1d4ed8', label: 'Upcoming' },
  active:    { bg: '#f0fdf4', text: GREEN,      label: '● Live'   },
  completed: { bg: '#f3f4f6', text: '#555',     label: 'Completed'},
};

function isStrokeBased(format: string) {
  return ['stroke', 'net_stroke', 'scramble', 'match_play', 'skins'].includes(format);
}

function scoreLabel(format: string) {
  if (format === 'net_stroke') return 'Net';
  if (isStrokeBased(format))   return 'Strokes';
  return 'Points';
}

function scoreValue(row: LBRow, format: string): string {
  if (row.holes_played === 0) return '—';
  if (format === 'net_stroke') return String(row.net_strokes);
  if (isStrokeBased(format))   return String(row.total_strokes);
  return String(row.total_stableford);
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CompetitionScreen({ navigation, route }: Props) {
  const { competitionId, userId } = route.params;
  const insets = useSafeAreaInsets();

  const [comp,      setComp]      = useState<Comp | null>(null);
  const [lbRows,    setLbRows]    = useState<LBRow[]>([]);
  const [lbFormat,  setLbFormat]  = useState('stableford');
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [acting,    setActing]    = useState(false);

  const fetchComp = useCallback(async () => {
    try {
      const { data } = await client.get<Comp>(`/api/competitions/${competitionId}`);
      setComp(data);
      navigation.setOptions({ title: data.name });
    } catch { /* keep stale */ }
  }, [competitionId]);

  const fetchLb = useCallback(async () => {
    try {
      const { data } = await client.get<{ format: string; rows: LBRow[] }>(
        `/api/competitions/${competitionId}/leaderboard`
      );
      setLbRows(data.rows ?? []);
      setLbFormat(data.format ?? 'stableford');
    } catch { /* keep stale */ }
  }, [competitionId]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchComp(), fetchLb()]);
    setLoading(false);
    setRefreshing(false);
  }, [fetchComp, fetchLb]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function onRefresh() { setRefreshing(true); fetchAll(); }

  async function handleEnter() {
    setActing(true);
    try {
      await client.post(`/api/competitions/${competitionId}/enter`);
      fetchAll();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not enter competition');
    } finally { setActing(false); }
  }

  async function handleWithdraw() {
    Alert.alert('Withdraw', 'Remove yourself from this competition?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: async () => {
        setActing(true);
        try {
          await client.delete(`/api/competitions/${competitionId}/enter`);
          fetchAll();
        } catch (e: any) {
          Alert.alert('Error', e.response?.data?.error ?? 'Could not withdraw');
        } finally { setActing(false); }
      }},
    ]);
  }

  async function handleSetStatus(status: 'active' | 'completed') {
    const msg = status === 'active'
      ? 'Start this competition? Players can begin scoring.'
      : 'Mark this competition as completed?';
    Alert.alert(status === 'active' ? 'Start Competition' : 'Complete Competition', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        setActing(true);
        try {
          await client.patch(`/api/competitions/${competitionId}/status`, { status });
          fetchAll();
        } catch (e: any) {
          Alert.alert('Error', e.response?.data?.error ?? 'Could not update status');
        } finally { setActing(false); }
      }},
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  if (!comp) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: '#888' }}>Competition not found</Text>
      </View>
    );
  }

  const statusStyle = STATUS_COLORS[comp.status] ?? STATUS_COLORS.upcoming;
  const myEntry     = comp.myEntry;
  const isCreator   = comp.isCreator;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Header card ── */}
      <View style={styles.headerCard}>
        <View style={styles.headerTopRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusText, { color: statusStyle.text }]}>{statusStyle.label}</Text>
          </View>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>{FORMAT_LABELS[comp.format] ?? comp.format}</Text>
            {comp.team_size > 1 && (
              <Text style={styles.teamTag}>{comp.team_size}-player teams</Text>
            )}
          </View>
        </View>

        <Text style={styles.compName}>{comp.name}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color="#888" />
          <Text style={styles.metaText}>{fmtDate(comp.date)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="golf-outline" size={13} color="#888" />
          <Text style={styles.metaText}>{comp.course_name}{comp.tee_name ? ` · ${comp.tee_name}` : ''}</Text>
        </View>
        {comp.description ? (
          <Text style={styles.description}>{comp.description}</Text>
        ) : null}
        <Text style={styles.createdBy}>
          {comp.entries.length} player{comp.entries.length !== 1 ? 's' : ''} entered ·{' '}
          Created by {personName(comp.creator_first, comp.creator_last, comp.creator_email)}
        </Text>
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionsRow}>
        {comp.status === 'upcoming' && !myEntry && (
          <TouchableOpacity style={styles.actionBtn} onPress={handleEnter} disabled={acting} activeOpacity={0.85}>
            {acting ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.actionBtnText}>Enter Competition</Text>}
          </TouchableOpacity>
        )}
        {comp.status === 'upcoming' && myEntry && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={handleWithdraw} disabled={acting} activeOpacity={0.85}>
            <Text style={[styles.actionBtnText, { color: '#555' }]}>Withdraw</Text>
          </TouchableOpacity>
        )}
        {isCreator && comp.status === 'upcoming' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => handleSetStatus('active')} disabled={acting} activeOpacity={0.85}>
            <Ionicons name="play" size={15} color={GREEN} />
            <Text style={[styles.actionBtnText, { color: GREEN }]}>Start</Text>
          </TouchableOpacity>
        )}
        {isCreator && comp.status === 'active' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => handleSetStatus('completed')} disabled={acting} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={15} color={GREEN} />
            <Text style={[styles.actionBtnText, { color: GREEN }]}>Mark Complete</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Entries ── */}
      {comp.entries.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Entered Players</Text>
          <View style={styles.entriesCard}>
            {comp.entries.map((e, i) => (
              <View key={e.player_id} style={[styles.entryRow, i < comp.entries.length - 1 && styles.entryRowBorder]}>
                <View style={[styles.entryAvatar, e.player_id === userId && styles.entryAvatarMe]}>
                  <Text style={styles.entryAvatarText}>
                    {personInitials(e.player_first, e.player_last)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryName}>
                    {personName(e.player_first, e.player_last, e.player_email)}
                    {e.player_id === userId ? ' (You)' : ''}
                  </Text>
                  {e.handicap != null && (
                    <Text style={styles.entryHcp}>HCP {Number(e.handicap).toFixed(1)}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── Leaderboard (active / completed) ── */}
      {(comp.status === 'active' || comp.status === 'completed') && (
        <>
          <Text style={styles.sectionTitle}>
            {comp.status === 'active' ? 'Live Leaderboard' : 'Final Results'}
          </Text>
          {lbRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No scores yet</Text>
            </View>
          ) : (
            <View style={styles.lbCard}>
              {/* Header row */}
              <View style={[styles.lbRow, styles.lbHeaderRow]}>
                <Text style={[styles.lbCell, styles.lbRankCell, styles.lbHeaderText]}>POS</Text>
                <Text style={[styles.lbCell, styles.lbNameCell, styles.lbHeaderText]}>PLAYER</Text>
                <Text style={[styles.lbCell, styles.lbNumCell, styles.lbHeaderText]}>HOLES</Text>
                <Text style={[styles.lbCell, styles.lbNumCell, styles.lbHeaderText]}>
                  {scoreLabel(lbFormat).toUpperCase()}
                </Text>
              </View>
              {lbRows.map((row, i) => {
                const isMe = row.id === userId;
                return (
                  <View key={row.id} style={[
                    styles.lbRow,
                    i < lbRows.length - 1 && styles.lbRowBorder,
                    isMe && styles.lbMyRow,
                  ]}>
                    <View style={[styles.lbCell, styles.lbRankCell]}>
                      <Text style={[
                        styles.lbRankText,
                        i === 0 && { color: '#F59E0B', fontSize: 16 },
                        i === 1 && { color: '#94A3B8', fontSize: 15 },
                        i === 2 && { color: '#CD7F32', fontSize: 15 },
                      ]}>{i + 1}</Text>
                    </View>
                    <View style={[styles.lbCell, styles.lbNameCell, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.lbAvatar, isMe && styles.lbAvatarMe]}>
                        <Text style={styles.lbAvatarText}>{personInitials(row.first_name, row.last_name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.lbName, isMe && { color: GREEN }]} numberOfLines={1}>
                          {personName(row.first_name, row.last_name, row.email)}{isMe ? ' (You)' : ''}
                        </Text>
                        {row.handicap != null && (
                          <Text style={styles.lbHcp}>HCP {Number(row.handicap).toFixed(1)}</Text>
                        )}
                      </View>
                    </View>
                    <Text style={[styles.lbCell, styles.lbNumCell, styles.lbNum, isMe && { color: GREEN }]}>
                      {row.holes_played}<Text style={{ fontSize: 10, color: '#aaa' }}>/18</Text>
                    </Text>
                    <Text style={[styles.lbCell, styles.lbNumCell, styles.lbScore, isMe && { color: GREEN }]}>
                      {scoreValue(row, lbFormat)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#f5f5f7' },
  content:  { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f7' },

  headerCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
  },
  headerTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  statusBadge:   { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  statusText:    { fontSize: 12, fontWeight: '700' },
  formatBadge:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0fdf4', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  formatBadgeText: { fontSize: 12, fontWeight: '700', color: GREEN },
  teamTag:       { fontSize: 11, color: '#888' },
  compName:      { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 10, letterSpacing: -0.3 },
  metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  metaText:      { fontSize: 13, color: '#666' },
  description:   { fontSize: 13, color: '#555', lineHeight: 19, marginTop: 8, marginBottom: 4 },
  createdBy:     { fontSize: 12, color: '#aaa', marginTop: 8 },

  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 12,
  },
  actionBtnGhost:     { backgroundColor: '#f3f4f6' },
  actionBtnSecondary: { backgroundColor: '#f0fdf4', borderWidth: 1.5, borderColor: GREEN },
  actionBtnText:      { fontSize: 14, fontWeight: '700', color: '#fff' },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 10 },

  entriesCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  entryRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  entryRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  entryAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center' },
  entryAvatarMe:  { backgroundColor: GREEN },
  entryAvatarText:{ color: '#fff', fontSize: 13, fontWeight: '700' },
  entryName:      { fontSize: 14, fontWeight: '600', color: '#111' },
  entryHcp:       { fontSize: 12, color: '#aaa' },

  emptyCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16 },
  emptyText: { fontSize: 14, color: '#aaa' },

  lbCard:      { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  lbHeaderRow: { backgroundColor: '#f8f8f8', borderBottomWidth: 1.5, borderBottomColor: '#ececec' },
  lbHeaderText:{ fontSize: 10, fontWeight: '700', color: '#aaa', letterSpacing: 0.8 },
  lbRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12 },
  lbRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  lbMyRow:     { backgroundColor: '#f0fdf4' },
  lbCell:      { justifyContent: 'center' },
  lbRankCell:  { width: 32, alignItems: 'center' },
  lbNameCell:  { flex: 1, marginHorizontal: 4 },
  lbNumCell:   { width: 52, alignItems: 'center' },
  lbRankText:  { fontSize: 14, fontWeight: '700', color: '#ccc' },
  lbAvatar:    { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  lbAvatarMe:  { backgroundColor: GREEN },
  lbAvatarText:{ color: '#fff', fontSize: 11, fontWeight: '700' },
  lbName:      { fontSize: 14, fontWeight: '600', color: '#111' },
  lbHcp:       { fontSize: 11, color: '#aaa' },
  lbNum:       { fontSize: 14, fontWeight: '600', color: '#111' },
  lbScore:     { fontSize: 16, fontWeight: '800', color: '#111' },
});
