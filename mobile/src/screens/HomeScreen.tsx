import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { User, RootStackParamList } from '../../App';
import ScorecardModal from '../components/ScorecardModal';

type ClubRound = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number; is_nine_hole: boolean;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};
import { colors, fontSize, spacing, radius, shadows } from '../theme';

const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';
const PAGE_BG = '#edeae4';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = { route: RouteProp<RootStackParamList, 'Home'> };

type Profile = {
  first_name: string | null;
  last_name:  string | null;
  email:      string;
  handicap:   number | null;
};

type Club = {
  id:           number;
  name:         string;
  code:         string;
  role:         string;
  member_count: number;
};

type Round = {
  id:          string;
  played_at:   string;
  course_name: string;
  score:       number;
  stableford:  number;
  notes:       string | null;
};

type LiveHole = { number: number; par: number; si: number };

type LiveRoundData = {
  id:              number;
  course_name:     string;
  tee_name:        string | null;
  course_handicap: number | null;
  hole_data:       LiveHole[] | null;
  scored_holes:    { hole_number: number; score: number | null }[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(p: Profile) {
  return [p.first_name?.[0], p.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}

function displayName(p: Profile) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

function badgeColor(pts: number): string {
  if (pts >= 36) return G_MID;
  if (pts <= 30) return '#c0392b';
  return '#b07d2a';
}

function badgeBg(pts: number): string {
  if (pts >= 36) return 'rgba(62,107,31,0.10)';
  if (pts <= 30) return 'rgba(192,57,43,0.09)';
  return 'rgba(176,125,42,0.09)';
}

function memberInitials(first: string | null, last: string | null, email: string) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || email[0]?.toUpperCase() || '?';
}
function memberName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen({ route }: Props) {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [rounds,      setRounds]      = useState<Round[]>([]);
  const [clubRounds,  setClubRounds]  = useState<ClubRound[]>([]);
  const [liveRound,   setLiveRound]   = useState<LiveRoundData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [scorecardId, setScorecardId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [profileRes, clubsRes, roundsRes, liveRes, clubRoundsRes] = await Promise.all([
        client.get<Profile>('/api/users/profile'),
        client.get<Club[]>('/api/clubs/mine'),
        client.get<Round[]>('/api/rounds'),
        client.get<LiveRoundData | null>('/api/rounds/my-live').catch(() => ({ data: null })),
        client.get<ClubRound[]>('/api/rounds/my-clubs-recent').catch(() => ({ data: [] })),
      ]);
      setProfile(profileRes.data);
      setClubs(clubsRes.data);
      setRounds(roundsRes.data);
      setLiveRound(liveRes.data);
      setClubRounds(Array.isArray(clubRoundsRes.data) ? clubRoundsRes.data : []);
    } catch {
      // silently fail — stale data remains visible
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  function returnToRound() {
    if (!liveRound?.hole_data) return;
    const holeData  = liveRound.hole_data;
    const initScores = holeData.map((_: LiveHole, i: number) => {
      const sh = liveRound.scored_holes.find(h => h.hole_number === i + 1);
      return sh?.score ?? null;
    });
    navigation.navigate('LiveRound', {
      roundId:         liveRound.id,
      holeData,
      courseHcp:       liveRound.course_handicap ?? 0,
      courseName:      liveRound.course_name,
      teeName:         liveRound.tee_name ?? '',
      competitionName: null,
      initScores,
      user:            route.params.user,
    });
  }

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  function onRefresh() { setRefreshing(true); fetchAll(); }

  // Derived stats
  const avgPts    = rounds.length > 0
    ? (rounds.reduce((s, r) => s + r.stableford, 0) / rounds.length).toFixed(1)
    : null;
  const bestScore = rounds.length > 0 ? Math.min(...rounds.map(r => r.score)) : null;
  const bestPts   = rounds.length > 0 ? Math.max(...rounds.map(r => r.stableford)) : null;

  if (loading) {
    return (
      <View style={[s.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={G_MID} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={G_MID} />
        }
        showsVerticalScrollIndicator={false}
      >

        {/* ── Hero Card ─────────────────────────────────────────────────── */}
        {profile && (
          <View style={s.heroWrap}>
            <LinearGradient
              colors={[G_DARK, G_MID, G_LIGHT]}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={s.heroCard}
            >
              {/* Decorative glow */}
              <View style={s.heroGlow} pointerEvents="none" />

              {/* Edit button — absolute top-right */}
              <TouchableOpacity
                style={s.heroEditBtn}
                onPress={() => navigation.navigate('Profile', { userId: route.params.user.id })}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={s.heroEditTxt}>Edit</Text>
              </TouchableOpacity>

              {/* Avatar */}
              <View style={s.heroAvatar}>
                <Text style={s.heroAvatarText}>{initials(profile)}</Text>
              </View>

              {/* Name + email */}
              <Text style={s.heroName}>{displayName(profile)}</Text>
              <Text style={s.heroEmail}>{profile.email}</Text>

              {/* Separator */}
              <View style={s.heroSep}>
                <View style={s.heroSepLine} />
                <View style={s.heroSepDot} />
                <View style={s.heroSepLine} />
              </View>

              {/* Big HCP */}
              <Text style={s.heroHcp}>
                {profile.handicap != null ? Number(profile.handicap).toFixed(1) : '—'}
              </Text>
              <Text style={s.heroHcpLabel}>Handicap Index</Text>

              {/* Stat strip */}
              <View style={s.heroStrip}>
                <View style={s.heroStat}>
                  <Text style={s.heroStatVal}>{avgPts ?? '—'}</Text>
                  <Text style={s.heroStatLbl}>Avg Pts</Text>
                </View>
                <View style={s.heroStripDiv} />
                <View style={s.heroStat}>
                  <Text style={s.heroStatVal}>{bestScore ?? '—'}</Text>
                  <Text style={s.heroStatLbl}>Best Score</Text>
                </View>
                <View style={s.heroStripDiv} />
                <View style={s.heroStat}>
                  <Text style={s.heroStatVal}>{bestPts ?? '—'}</Text>
                  <Text style={s.heroStatLbl}>Best Pts</Text>
                </View>
                <View style={s.heroStripDiv} />
                <View style={s.heroStat}>
                  <Text style={s.heroStatVal}>{rounds.length}</Text>
                  <Text style={s.heroStatLbl}>Rounds</Text>
                </View>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* ── My Clubs ──────────────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardTitleRow}>
              <Text style={s.cardTitle}>My Clubs</Text>
              {clubs.length > 0 && (
                <View style={s.countBadge}>
                  <Text style={s.countBadgeTxt}>{clubs.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={s.addBtn}
              onPress={() => navigation.navigate('ClubSetup')}
              activeOpacity={0.75}
            >
              <Ionicons name="add" size={15} color={G_MID} />
              <Text style={s.addBtnTxt}>Add</Text>
            </TouchableOpacity>
          </View>

          {clubs.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="golf-outline" size={32} color="#ccc" style={{ marginBottom: spacing.sm }} />
              <Text style={s.emptyTitle}>No clubs yet</Text>
              <Text style={s.emptyText}>Join or create a club to start competing</Text>
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => navigation.navigate('ClubSetup')}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={s.emptyBtnTxt}>Create or Join a Club</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.clubGrid}>
              {clubs.map((club, idx) => (
                <TouchableOpacity
                  key={club.id}
                  style={s.clubCell}
                  activeOpacity={0.75}
                  onPress={() => navigation.navigate('ClubTabs', {
                    user: route.params.user,
                    clubId: club.id,
                    clubName: club.name,
                    role: club.role,
                    code: club.code,
                  })}
                >
                  {/* Active dot for first club */}
                  {idx === 0 && <View style={s.clubActiveDot} />}

                  <View style={s.clubIconWrap}>
                    <Ionicons name="golf-outline" size={20} color={G_MID} />
                  </View>
                  <Text style={s.clubName} numberOfLines={2}>{club.name}</Text>
                  <View style={s.clubRolePill}>
                    <Text style={s.clubRoleTxt}>
                      {club.role === 'owner' ? 'Owner' : 'Member'}
                    </Text>
                  </View>
                  <Text style={s.clubMemberCount}>{club.member_count} members</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Club Activity ─────────────────────────────────────────────── */}
        {clubRounds.length > 0 && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>Club Activity</Text>
                <View style={s.countBadge}>
                  <Text style={s.countBadgeTxt}>Last 7 days</Text>
                </View>
              </View>
            </View>
            {clubRounds.map((r, i) => (
              <TouchableOpacity
                key={r.id}
                style={[s.roundRow, i < clubRounds.length - 1 && s.roundRowBorder]}
                onPress={() => setScorecardId(r.id)}
                activeOpacity={0.7}
              >
                <View style={s.clubRoundAvatar}>
                  <Text style={s.clubRoundAvatarText}>
                    {memberInitials(r.first_name, r.last_name, r.email)}
                  </Text>
                </View>
                <View style={s.roundInfo}>
                  <Text style={s.roundCourse} numberOfLines={1}>
                    {memberName(r.first_name, r.last_name, r.email)}
                  </Text>
                  <Text style={s.roundDate}>
                    {r.course_name}{r.is_nine_hole ? ' · 9 holes' : ''} · {timeAgo(r.played_at)}
                  </Text>
                </View>
                <View style={s.roundStrokesWrap}>
                  <Text style={[s.roundStrokesVal, { color: G_MID }]}>{r.stableford}</Text>
                  <Text style={s.roundStrokesLbl}>pts</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#ccc" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Recent Rounds ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardTitleRow}>
              <Text style={s.cardTitle}>Recent Rounds</Text>
              {rounds.length > 0 && (
                <View style={s.countBadge}>
                  <Text style={s.countBadgeTxt}>{rounds.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={s.addBtn}
              onPress={() => navigation.navigate('LogRound')}
              activeOpacity={0.75}
            >
              <Ionicons name="add" size={15} color={G_MID} />
              <Text style={s.addBtnTxt}>Log</Text>
            </TouchableOpacity>
          </View>

          {rounds.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="document-text-outline" size={32} color="#ccc" style={{ marginBottom: spacing.sm }} />
              <Text style={s.emptyTitle}>No rounds logged yet</Text>
              <Text style={s.emptyText}>Tap below to record your first round</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => navigation.navigate('LogRound')}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={s.emptyBtnTxt}>Log your first round</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              {rounds.map((round, i) => (
                <TouchableOpacity
                  key={round.id}
                  style={[s.roundRow, i < rounds.length - 1 && s.roundRowBorder]}
                  onPress={() => setScorecardId(round.id)}
                  activeOpacity={0.7}
                >
                  {/* Coloured pts badge */}
                  <View style={[s.ptsBadge, { backgroundColor: badgeBg(round.stableford) }]}>
                    <Text style={[s.ptsBadgeVal, { color: badgeColor(round.stableford) }]}>
                      {round.stableford}
                    </Text>
                    <Text style={[s.ptsBadgeLbl, { color: badgeColor(round.stableford) }]}>pts</Text>
                  </View>

                  {/* Course + date */}
                  <View style={s.roundInfo}>
                    <Text style={s.roundCourse} numberOfLines={1}>{round.course_name}</Text>
                    <Text style={s.roundDate}>{formatDate(round.played_at)}</Text>
                  </View>

                  {/* Gross strokes — right side */}
                  <View style={s.roundStrokesWrap}>
                    <Text style={s.roundStrokesVal}>{round.score}</Text>
                    <Text style={s.roundStrokesLbl}>strokes</Text>
                  </View>

                  <Ionicons name="chevron-forward" size={16} color="#ccc" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      {/* ── FAB ──────────────────────────────────────────────────────── */}
      <View style={[s.fabWrap, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('LogRound')}
        >
          <LinearGradient
            colors={[G_MID, G_LIGHT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.fab}
          >
            <Ionicons name="add" size={30} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {scorecardId != null && (
        <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: PAGE_BG },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAGE_BG },

  // ── Hero ──────────────────────────────────────────────────────────────────

  heroWrap: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#1a3a0a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  heroCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 0,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -80, alignSelf: 'center',
  },

  heroEditBtn: {
    position: 'absolute',
    top: 16, right: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  heroEditTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },

  heroAvatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroAvatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },

  heroName:  { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 3 },
  heroEmail: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 16 },

  heroSep:     { flexDirection: 'row', alignItems: 'center', width: '70%', marginBottom: 16 },
  heroSepLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  heroSepDot:  {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginHorizontal: 8,
  },

  heroHcp: {
    color: '#fff',
    fontSize: 64,
    fontWeight: '900',
    lineHeight: 70,
    letterSpacing: -2,
  },
  heroHcpLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 4,
    marginBottom: 20,
  },

  heroStrip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.13)',
    paddingVertical: 14,
    width: '100%',
  },
  heroStat:     { flex: 1, alignItems: 'center' },
  heroStatVal:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroStatLbl:  {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 3,
  },
  heroStripDiv: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.16)', alignSelf: 'center' },

  // ── Section cards ─────────────────────────────────────────────────────────

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle:    { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  countBadge:   {
    backgroundColor: '#f0f0ef',
    borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  countBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#888' },

  addBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: G_MID, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addBtnTxt: { fontSize: 13, fontWeight: '600', color: G_MID },

  // ── Empty states ──────────────────────────────────────────────────────────

  emptyWrap:  { alignItems: 'center', paddingVertical: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  emptyText:  { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 },
  emptyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: G_MID, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16 },
  emptyBtnTxt:{ color: '#fff', fontWeight: '600', fontSize: 13 },

  // ── Clubs grid ────────────────────────────────────────────────────────────

  clubGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  clubCell: {
    width: '47.5%',
    backgroundColor: '#f8f8f6',
    borderRadius: 14,
    padding: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  clubActiveDot: {
    position: 'absolute',
    top: 10, right: 10,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: G_LIGHT,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  clubIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(62,107,31,0.12)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
  },
  clubName:        { fontSize: 13, fontWeight: '700', color: '#1a1a1a', marginBottom: 8, lineHeight: 18 },
  clubRolePill:    { alignSelf: 'flex-start', backgroundColor: 'rgba(62,107,31,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 5 },
  clubRoleTxt:     { fontSize: 11, fontWeight: '600', color: G_MID },
  clubMemberCount: { fontSize: 11, color: '#999' },

  // ── Rounds ────────────────────────────────────────────────────────────────

  roundRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10 },
  roundRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0efec' },

  ptsBadge: {
    width: 46, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  ptsBadgeVal: { fontSize: 18, fontWeight: '800', lineHeight: 21 },
  ptsBadgeLbl: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  clubRoundAvatar:     { width: 36, height: 36, borderRadius: 18, backgroundColor: G_MID + '18', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  clubRoundAvatarText: { fontSize: 13, fontWeight: '700', color: G_MID },

  roundInfo:   { flex: 1 },
  roundCourse: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 3 },
  roundDate:   { fontSize: 11, color: '#999' },

  roundStrokesWrap: { alignItems: 'flex-end', flexShrink: 0 },
  roundStrokesVal:  { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  roundStrokesLbl:  { fontSize: 10, color: '#aaa', fontWeight: '500' },

  // ── FAB — centered ────────────────────────────────────────────────────────

  fabWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: G_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  // ── Live round banner ─────────────────────────────────────────────────────
  liveRoundBanner: {
    position: 'absolute',
    left: 16, right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: G_DARK,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: G_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  liveDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#6fcf5a',
  },
  liveBannerText: { flex: 1 },
  liveBannerTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  liveBannerSub:   { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
});
