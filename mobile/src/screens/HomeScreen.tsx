import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { User, RootStackParamList } from '../../App';
import ScorecardModal from '../components/ScorecardModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabParamList = { Home: { user: User }; Profile: { userId: string } };
type Props = { route: RouteProp<TabParamList, 'Home'> };

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const GREEN = '#1a7f3c';

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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen({ route }: Props) {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [rounds,      setRounds]      = useState<Round[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [scorecardId, setScorecardId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [profileRes, clubsRes, roundsRes] = await Promise.all([
        client.get<Profile>('/api/users/profile'),
        client.get<Club[]>('/api/clubs/mine'),
        client.get<Round[]>('/api/rounds'),
      ]);
      setProfile(profileRes.data);
      setClubs(clubsRes.data);
      setRounds(roundsRes.data);
    } catch {
      // silently fail — stale data remains visible
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh when returning from ClubSetup (after create/join)
  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  function onRefresh() {
    setRefreshing(true);
    fetchAll();
  }

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Profile header ─────────────────────────────────────────────── */}
      {profile && (
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials(profile)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName(profile)}</Text>
            <Text style={styles.profileEmail}>{profile.email}</Text>
          </View>
          <View style={styles.hcpBadge}>
            <Text style={styles.hcpValue}>
              {profile.handicap != null ? Number(profile.handicap).toFixed(1) : '—'}
            </Text>
            <Text style={styles.hcpLabel}>HCP</Text>
          </View>
        </View>
      )}

      {/* ── Clubs ──────────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.sectionTitle}>My Clubs</Text>
          {clubs.length > 0 && <Text style={styles.sectionCount}>{clubs.length}</Text>}
        </View>
        <TouchableOpacity
          style={styles.addClubBtn}
          onPress={() => navigation.navigate('ClubSetup')}
          activeOpacity={0.75}
        >
          <Ionicons name="add" size={16} color={GREEN} />
          <Text style={styles.addClubBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {clubs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="golf-outline" size={36} color="#ccc" style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>You haven't joined any clubs yet</Text>
          <View style={styles.emptyActions}>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => navigation.navigate('ClubSetup')}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Create or Join a Club</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clubsScroll}>
          {clubs.map(club => (
            <TouchableOpacity
              key={club.id}
              style={styles.clubCard}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Club', {
                clubId: club.id,
                clubName: club.name,
                role: club.role,
                code: club.code,
                userId: route.params.user.id,
              })}
            >
              <View style={styles.clubIconWrap}>
                <Ionicons name="golf-outline" size={20} color={GREEN} />
              </View>
              <Text style={styles.clubName} numberOfLines={2}>{club.name}</Text>
              <View style={styles.clubMeta}>
                <View style={[styles.roleBadge, club.role === 'owner' && styles.roleBadgeOwner]}>
                  <Text style={[styles.roleText, club.role === 'owner' && styles.roleTextOwner]}>
                    {club.role === 'owner' ? 'Owner' : 'Member'}
                  </Text>
                </View>
                <Text style={styles.memberCount}>{club.member_count} members</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Recent rounds ──────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.sectionTitle}>Recent Rounds</Text>
          {rounds.length > 0 && <Text style={styles.sectionCount}>{rounds.length}</Text>}
        </View>
        <TouchableOpacity
          style={styles.addClubBtn}
          onPress={() => navigation.navigate('LogRound')}
          activeOpacity={0.75}
        >
          <Ionicons name="add" size={16} color={GREEN} />
          <Text style={styles.addClubBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {rounds.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="document-text-outline" size={36} color="#ccc" style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>No rounds logged yet</Text>
          <TouchableOpacity style={styles.logRoundBtn} onPress={() => navigation.navigate('LogRound')}>
            <Text style={styles.logRoundBtnText}>Log your first round</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.roundsList}>
          {rounds.map(round => (
            <TouchableOpacity
              key={round.id}
              style={styles.roundCard}
              onPress={() => setScorecardId(round.id)}
              activeOpacity={0.7}
            >
              <View style={styles.roundMain}>
                <Text style={styles.roundCourse} numberOfLines={1}>{round.course_name}</Text>
                <Text style={styles.roundDate}>{formatDate(round.played_at)}</Text>
              </View>
              <View style={styles.roundScores}>
                <View style={styles.roundScore}>
                  <Text style={styles.roundScoreValue}>{round.score}</Text>
                  <Text style={styles.roundScoreLabel}>Strokes</Text>
                </View>
                <View style={styles.roundDivider} />
                <View style={styles.roundScore}>
                  <Text style={[styles.roundScoreValue, { color: GREEN }]}>{round.stableford}</Text>
                  <Text style={styles.roundScoreLabel}>Pts</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={{ height: 96 }} />
    </ScrollView>

    <View style={styles.fabContainer} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('LogRound')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>
    </View>
    {scorecardId != null && (
      <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
    )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f5f5f7' },
  content: { padding: 16 },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f7' },

  // Profile card
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 10, elevation: 3,
  },
  avatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: GREEN, justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  avatarText:   { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileInfo:  { flex: 1 },
  profileName:  { fontSize: 17, fontWeight: '700', color: '#111' },
  profileEmail: { fontSize: 12, color: '#888', marginTop: 1 },
  hcpBadge:     { alignItems: 'center', backgroundColor: '#f0fdf4', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  hcpValue:     { fontSize: 22, fontWeight: '800', color: GREEN },
  hcpLabel:     { fontSize: 10, color: GREEN, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle:  { fontSize: 17, fontWeight: '700', color: '#111' },
  sectionCount:  { fontSize: 13, fontWeight: '600', color: '#aaa' },

  addClubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: GREEN, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  addClubBtnText: { fontSize: 13, fontWeight: '600', color: GREEN },

  // Empty state
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 28,
    alignItems: 'center', marginBottom: 24,
  },
  emptyIcon: { marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center' },
  emptyActions: { marginTop: 16, width: '100%' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GREEN, borderRadius: 10, paddingVertical: 11,
  },
  emptyBtnText:    { color: '#fff', fontWeight: '600', fontSize: 14 },
  logRoundBtn:     { marginTop: 14, backgroundColor: GREEN, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24 },
  logRoundBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  // Clubs
  clubsScroll: { marginBottom: 24, overflow: 'visible' },
  clubCard: {
    width: 148, backgroundColor: '#fff', borderRadius: 16, padding: 14,
    marginRight: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  clubIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#f0fdf4', justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  clubIcon:   {},
  clubName:   { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 10, lineHeight: 18 },
  clubMeta:   { gap: 4 },
  roleBadge:  { alignSelf: 'flex-start', backgroundColor: '#f3f4f6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleBadgeOwner: { backgroundColor: '#f0fdf4' },
  roleText:       { fontSize: 11, fontWeight: '600', color: '#666' },
  roleTextOwner:  { color: GREEN },
  memberCount:    { fontSize: 11, color: '#aaa' },

  // Rounds
  roundsList: { gap: 10, marginBottom: 8 },
  roundCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  roundMain:       { flex: 1, marginRight: 12 },
  roundCourse:     { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 3 },
  roundDate:       { fontSize: 12, color: '#888' },
  roundScores:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  roundScore:      { alignItems: 'center' },
  roundScoreValue: { fontSize: 20, fontWeight: '800', color: '#111' },
  roundScoreLabel: { fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.4 },
  roundDivider:    { width: 1, height: 28, backgroundColor: '#f0f0f0' },

  // FAB
  fabContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
});
