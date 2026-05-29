import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, AppState, AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Socket } from 'socket.io-client';
import client from '../api/client';
import { getSocket } from '../api/socketClient';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

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

// ── Gradient palette (matches app-wide green gradient) ───────────────────────
const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';

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
  upcoming:  { bg: colors.surfaceMuted, text: colors.secondary,     label: 'Upcoming'  },
  active:    { bg: colors.primary + '18', text: colors.primary,     label: '● Live'    },
  completed: { bg: colors.surfaceMuted,  text: colors.textSecondary, label: 'Completed' },
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

// ── Podium (shown when competition is completed) ──────────────────────────────

const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#b87333'] as const;
const MEDAL_LABELS = ['1st', '2nd', '3rd']              as const;

function Podium({
  rows, format, userId, navigation,
}: {
  rows: LBRow[]; format: string; userId: string; navigation: any;
}) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) return null;

  const [first, second, third] = top3;

  function PodiumCard({
    row, rank, featured,
  }: {
    row: LBRow; rank: 0 | 1 | 2; featured?: boolean;
  }) {
    const isMe      = row.id === userId;
    const medalClr  = MEDAL_COLORS[rank];
    const label     = MEDAL_LABELS[rank];
    const score     = scoreValue(row, format);
    const scoreLbl  = scoreLabel(format);
    const initials  = personInitials(row.first_name, row.last_name);
    const name      = personName(row.first_name, row.last_name, row.email);

    if (featured) {
      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('MemberProfile', { userId: row.id, name })}
          style={{ marginBottom: 10 }}
        >
          <LinearGradient
            colors={[G_DARK, G_MID, G_LIGHT]}
            locations={[0, 0.6, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={podStyles.firstCard}
          >
            {/* Decorative glow */}
            <View style={podStyles.firstGlow} pointerEvents="none" />

            {/* Medal label */}
            <View style={[podStyles.medalPill, { borderColor: medalClr + '60', backgroundColor: medalClr + '22' }]}>
              <Text style={[podStyles.medalPillText, { color: medalClr }]}>{label}</Text>
            </View>

            {/* Trophy icon */}
            <Ionicons name="trophy" size={28} color={medalClr} style={{ marginBottom: 14, marginTop: 4 }} />

            {/* Avatar */}
            <View style={[podStyles.firstAvatar, isMe && podStyles.firstAvatarMe]}>
              <Text style={podStyles.firstAvatarText}>{initials}</Text>
            </View>

            {/* Name */}
            <Text style={podStyles.firstName} numberOfLines={1}>{name}{isMe ? ' (You)' : ''}</Text>
            {row.handicap != null && (
              <Text style={podStyles.firstHcp}>HCP {Number(row.handicap).toFixed(1)}</Text>
            )}

            {/* Separator */}
            <View style={podStyles.firstSep} />

            {/* Score */}
            <Text style={podStyles.firstScore}>{score}</Text>
            <Text style={podStyles.firstScoreLbl}>{scoreLbl.toUpperCase()}</Text>
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('MemberProfile', { userId: row.id, name })}
        style={podStyles.otherCard}
      >
        <View style={[podStyles.otherMedalPill, { borderColor: medalClr + '60', backgroundColor: medalClr + '18' }]}>
          <Text style={[podStyles.otherMedalText, { color: medalClr }]}>{label}</Text>
        </View>
        <View style={[podStyles.otherAvatar, isMe && podStyles.otherAvatarMe]}>
          <Text style={podStyles.otherAvatarText}>{initials}</Text>
        </View>
        <Text style={podStyles.otherName} numberOfLines={2}>{name}{isMe ? '\n(You)' : ''}</Text>
        {row.handicap != null && (
          <Text style={podStyles.otherHcp}>HCP {Number(row.handicap).toFixed(1)}</Text>
        )}
        <Text style={podStyles.otherScore}>{score}</Text>
        <Text style={podStyles.otherScoreLbl}>{scoreLbl}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={podStyles.wrap}>
      {/* 1st place — full-width featured card */}
      {first && <PodiumCard row={first} rank={0} featured />}

      {/* 2nd + 3rd side by side */}
      <View style={podStyles.row}>
        {second && <PodiumCard row={second} rank={1} />}
        {third  && <PodiumCard row={third}  rank={2} />}
      </View>
    </View>
  );
}

// ── Podium styles ─────────────────────────────────────────────────────────────

const podStyles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  row:  { flexDirection: 'row', gap: 10 },

  // First place
  firstCard: {
    borderRadius: 22, paddingVertical: 28, paddingHorizontal: 24,
    alignItems: 'center', overflow: 'hidden', position: 'relative',
    ...shadows.card,
  },
  firstGlow: {
    position: 'absolute', width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.06)', top: -80, alignSelf: 'center',
  },
  medalPill: {
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 4, marginBottom: 4,
  },
  medalPillText:   { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  firstAvatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  firstAvatarMe: { borderColor: '#f59e0b', borderWidth: 3 },
  firstAvatarText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  firstName:       { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: -0.3, textAlign: 'center', marginBottom: 2 },
  firstHcp:        { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 },
  firstSep:        { width: 40, height: 0.5, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 },
  firstScore:      { fontSize: 52, fontWeight: '800', color: '#fff', letterSpacing: -1.5, lineHeight: 58 },
  firstScoreLbl:   { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, marginTop: 4 },

  // 2nd and 3rd
  otherCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 20,
    paddingVertical: 18, paddingHorizontal: 14, alignItems: 'center',
    ...shadows.card,
  },
  otherMedalPill: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 10,
  },
  otherMedalText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  otherAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  otherAvatarMe:  { backgroundColor: colors.primary + '18', borderColor: colors.primary },
  otherAvatarText:{ fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  otherName:      { fontSize: 13, fontWeight: '600', color: colors.textPrimary, textAlign: 'center', marginBottom: 2 },
  otherHcp:       { fontSize: 11, color: colors.textSecondary, marginBottom: 6 },
  otherScore:     { fontSize: 30, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.8, lineHeight: 34 },
  otherScoreLbl:  { fontSize: 10, color: colors.textSecondary, marginTop: 3, fontWeight: '500' },
});

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const socketRef                 = useRef<Socket | null>(null);
  const compStatusRef             = useRef<string>('');

  const fetchComp = useCallback(async () => {
    try {
      const { data } = await client.get<Comp>(`/api/competitions/${competitionId}`);
      setComp(data);
      compStatusRef.current = data.status;
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
      setLastUpdated(new Date());
    } catch { /* keep stale */ }
  }, [competitionId]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchComp(), fetchLb()]);
    setLoading(false);
    setRefreshing(false);
  }, [fetchComp, fetchLb]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refetch comp + leaderboard when screen comes back into focus.
  // fetchAll (not just fetchLb) so the status ref is updated too —
  // competitions that auto-activated on first score would otherwise
  // have a stale 'upcoming' ref and the old guard would skip the fetch.
  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  // Refetch when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && compStatusRef.current === 'active') fetchLb();
    });
    return () => sub.remove();
  }, [fetchLb]);

  // Real-time leaderboard via Socket.IO
  useEffect(() => {
    let sock: Socket | undefined;

    function handleLiveScore(payload: { format: string; rows: LBRow[] }) {
      console.log('competition_score received', payload);
      setLbRows(payload.rows ?? []);
      setLbFormat(payload.format ?? 'stableford');
    }

    function joinRoom() {
      console.log('emitted join_competition');
      sock?.emit('join_competition', { competitionId });
    }

    getSocket().then(s => {
      console.log('socket ready, joining competition room:', competitionId);
      sock = s;
      socketRef.current = s;
      // Join immediately (and re-join on every reconnect so room membership survives drops)
      joinRoom();
      s.on('connect', () => {
        console.log('socket reconnected, rejoining room');
        joinRoom();
      });
      s.on('competition_score', handleLiveScore);
    });

    // Polling fallback — keeps leaderboard fresh if socket is unavailable
    const poll = setInterval(() => fetchLb(), 5000);

    return () => {
      clearInterval(poll);
      if (sock) {
        sock.off('connect', joinRoom);
        sock.off('competition_score', handleLiveScore);
        sock.emit('leave_competition', { competitionId });
      }
    };
  }, [competitionId]);

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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!comp) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.textSecondary }}>Competition not found</Text>
      </View>
    );
  }

  const statusStyle = STATUS_COLORS[comp.status] ?? STATUS_COLORS.upcoming;
  const myEntry     = comp.myEntry;
  const isCreator   = comp.isCreator;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
          <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.metaText}>{fmtDate(comp.date)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="golf-outline" size={13} color={colors.textSecondary} />
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
            {acting ? <ActivityIndicator color={colors.textInverse} size="small" />
                    : <Text style={styles.actionBtnText}>Enter Competition</Text>}
          </TouchableOpacity>
        )}
        {comp.status === 'upcoming' && myEntry && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={handleWithdraw} disabled={acting} activeOpacity={0.85}>
            <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>Withdraw</Text>
          </TouchableOpacity>
        )}
        {isCreator && comp.status === 'upcoming' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => handleSetStatus('active')} disabled={acting} activeOpacity={0.85}>
            <Ionicons name="play" size={15} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Start</Text>
          </TouchableOpacity>
        )}
        {(comp.status === 'active' || comp.status === 'upcoming') && myEntry && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnScore]}
            onPress={() => navigation.navigate('TournamentScoring', { competitionId: comp.id, userId })}
            activeOpacity={0.85}
          >
            <Ionicons name="golf" size={15} color={colors.textInverse} />
            <Text style={styles.actionBtnText}>Score Round</Text>
          </TouchableOpacity>
        )}
        {isCreator && comp.status === 'active' && (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => handleSetStatus('completed')} disabled={acting} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={15} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Mark Complete</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Entries ── */}
      {comp.entries.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Entered Players</Text>
          <View style={styles.entriesCard}>
            {comp.entries.map((e, i) => (
              <TouchableOpacity
                key={e.player_id}
                style={[styles.entryRow, i < comp.entries.length - 1 && styles.entryRowBorder]}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('MemberProfile', {
                  userId: e.player_id,
                  name: personName(e.player_first, e.player_last, e.player_email),
                })}
              >
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
                <Ionicons name="chevron-forward" size={14} color={colors.border} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* ── Leaderboard (active) ── */}
      {comp.status === 'active' && (
        <>
          <View style={styles.lbTitleRow}>
            <Text style={styles.sectionTitle}>Live Leaderboard</Text>
            {lastUpdated && (
              <Text style={styles.lbUpdated}>
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
            )}
          </View>
          {lbRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No scores yet</Text>
            </View>
          ) : (
            <View style={styles.lbCard}>
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
                  <TouchableOpacity
                    key={row.id}
                    style={[
                      styles.lbRow,
                      i < lbRows.length - 1 && styles.lbRowBorder,
                      isMe && styles.lbMyRow,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('MemberProfile', {
                      userId: row.id,
                      name: personName(row.first_name, row.last_name, row.email),
                    })}
                  >
                    <View style={[styles.lbCell, styles.lbRankCell]}>
                      <Text style={[
                        styles.lbRankText,
                        i === 0 && { color: colors.gold,   fontSize: fontSize.md },
                        i === 1 && { color: colors.silver, fontSize: fontSize.base },
                        i === 2 && { color: colors.bronze, fontSize: fontSize.base },
                      ]}>{i + 1}</Text>
                    </View>
                    <View style={[styles.lbCell, styles.lbNameCell, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
                      <View style={[styles.lbAvatar, isMe && styles.lbAvatarMe]}>
                        <Text style={styles.lbAvatarText}>{personInitials(row.first_name, row.last_name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.lbName, isMe && { color: colors.primary }]} numberOfLines={1}>
                          {personName(row.first_name, row.last_name, row.email)}{isMe ? ' (You)' : ''}
                        </Text>
                        {row.handicap != null && (
                          <Text style={styles.lbHcp}>HCP {Number(row.handicap).toFixed(1)}</Text>
                        )}
                      </View>
                    </View>
                    <Text style={[styles.lbCell, styles.lbNumCell, styles.lbNum, isMe && { color: colors.primary }]}>
                      {row.holes_played}<Text style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>/18</Text>
                    </Text>
                    <Text style={[styles.lbCell, styles.lbNumCell, styles.lbScore, isMe && { color: colors.primary }]}>
                      {scoreValue(row, lbFormat)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* ── Podium (completed) ── */}
      {comp.status === 'completed' && (
        <>
          <View style={[styles.lbTitleRow, { marginBottom: 12 }]}>
            <Text style={styles.sectionTitle}>Final Results</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f59e0b18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Ionicons name="trophy" size={12} color="#f59e0b" />
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#f59e0b' }}>Official</Text>
            </View>
          </View>
          {lbRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No scores recorded</Text>
            </View>
          ) : (
            <Podium rows={lbRows} format={lbFormat} userId={userId} navigation={navigation} />
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.background },
  content:  { padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  headerCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18, marginBottom: spacing.sm,
    ...shadows.card,
  },
  headerTopRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  statusBadge:   { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  statusText:    { fontSize: fontSize.xs, fontWeight: '700' },
  formatBadge:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceMuted, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  formatBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  teamTag:       { fontSize: fontSize.xs, color: colors.textSecondary },
  compName:      { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary, marginBottom: 10, letterSpacing: -0.3 },
  metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  metaText:      { fontSize: fontSize.sm, color: colors.textSecondary },
  description:   { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19, marginTop: spacing.sm, marginBottom: spacing.xs },
  createdBy:     { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.sm },

  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg, flexWrap: 'wrap' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12,
  },
  actionBtnGhost:     { backgroundColor: colors.surfaceMuted },
  actionBtnSecondary: { backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: colors.primary },
  actionBtnScore:     { backgroundColor: colors.primaryLight },
  actionBtnText:      { fontSize: fontSize.sm, fontWeight: '700', color: colors.textInverse },

  lbTitleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  lbUpdated:   { fontSize: fontSize.xs, color: colors.textSecondary },

  entriesCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
    marginBottom: spacing.lg, ...shadows.card,
  },
  entryRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md },
  entryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  entryAvatar:    { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' },
  entryAvatarMe:  { backgroundColor: colors.primary },
  entryAvatarText:{ color: colors.textInverse, fontSize: fontSize.sm, fontWeight: '700' },
  entryName:      { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  entryHcp:       { fontSize: fontSize.xs, color: colors.textSecondary },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary },

  lbCard:      { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md, ...shadows.card },
  lbHeaderRow: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: colors.border },
  lbHeaderText:{ fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8 },
  lbRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: spacing.sm },
  lbRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lbMyRow:     { backgroundColor: colors.surfaceMuted },
  lbCell:      { justifyContent: 'center' },
  lbRankCell:  { width: 32, alignItems: 'center' },
  lbNameCell:  { flex: 1, marginHorizontal: spacing.xs },
  lbNumCell:   { width: 52, alignItems: 'center' },
  lbRankText:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.border },
  lbAvatar:    { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  lbAvatarMe:  { backgroundColor: colors.primary },
  lbAvatarText:{ color: colors.textInverse, fontSize: fontSize.xs, fontWeight: '700' },
  lbName:      { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  lbHcp:       { fontSize: fontSize.xs, color: colors.textSecondary },
  lbNum:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  lbScore:     { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
});
