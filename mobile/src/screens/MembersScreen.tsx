import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { RootStackParamList } from '../../App';

const GREEN = '#1a7f3c';

// ── Types ─────────────────────────────────────────────────────────────────────

type Club = { id: number; name: string; role: string };

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  handicap: number | null;
  role: string;
  rounds_played: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}

function personInitials(first: string | null, last: string | null, email: string) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || email[0].toUpperCase();
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MembersScreen() {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [activeClub,  setActiveClub]  = useState<Club | null>(null);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  // Load clubs once on first mount
  useEffect(() => {
    client.get<Club[]>('/api/clubs/mine')
      .then(({ data }) => {
        setClubs(data);
        if (data.length > 0) setActiveClub(data[0]);
      })
      .catch(() => {})
      .finally(() => setLoadingInit(false));
  }, []);

  // Load members whenever active club changes
  const fetchMembers = useCallback(async (club: Club | null) => {
    if (!club) return;
    setLoadingMembers(true);
    try {
      const { data } = await client.get<Member[]>(`/api/clubs/${club.id}/members`);
      setMembers(data);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchMembers(activeClub); }, [activeClub, fetchMembers]);

  useFocusEffect(useCallback(() => { fetchMembers(activeClub); }, [activeClub, fetchMembers]));

  function onRefresh() {
    setRefreshing(true);
    fetchMembers(activeClub);
  }

  // ── Loading ──

  if (loadingInit) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  // ── No clubs ──

  if (clubs.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="people-outline" size={48} color="#ddd" style={{ marginBottom: 14 }} />
        <Text style={styles.emptyTitle}>No Club Selected</Text>
        <Text style={styles.emptyBody}>Join or create a club to see its members.</Text>
      </View>
    );
  }

  const sorted = [...members].sort((a, b) => {
    if (a.handicap == null && b.handicap == null) return 0;
    if (a.handicap == null) return 1;
    if (b.handicap == null) return -1;
    return Number(a.handicap) - Number(b.handicap);
  });

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Header ── */}
      <Text style={styles.pageTitle}>Members</Text>

      {/* ── Club picker (only if user belongs to multiple clubs) ── */}
      {clubs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clubPicker}>
          {clubs.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.clubChip, activeClub?.id === c.id && styles.clubChipActive]}
              onPress={() => setActiveClub(c)}
              activeOpacity={0.75}
            >
              <Text style={[styles.clubChipText, activeClub?.id === c.id && styles.clubChipTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Single club label ── */}
      {clubs.length === 1 && activeClub && (
        <View style={styles.clubLabel}>
          <Ionicons name="golf-outline" size={14} color={GREEN} />
          <Text style={styles.clubLabelText}>{activeClub.name}</Text>
          <Text style={styles.clubLabelCount}>{members.length} members</Text>
        </View>
      )}

      {/* ── Member list ── */}
      {loadingMembers ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={32} color="#ddd" style={{ marginBottom: 8 }} />
          <Text style={styles.emptyCardText}>No members yet</Text>
        </View>
      ) : (
        <View style={styles.memberList}>
          {sorted.map((m, i) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberRow, i < sorted.length - 1 && styles.memberRowBorder]}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('MemberProfile', {
                userId: m.id,
                name: personName(m.first_name, m.last_name, m.email),
              })}
            >
              {/* Avatar */}
              <View style={[styles.avatar, m.role === 'owner' && styles.avatarOwner]}>
                <Text style={styles.avatarText}>
                  {personInitials(m.first_name, m.last_name, m.email)}
                </Text>
              </View>

              {/* Info */}
              <View style={styles.memberInfo}>
                <View style={styles.memberNameRow}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {personName(m.first_name, m.last_name, m.email)}
                  </Text>
                  {m.role === 'owner' && (
                    <View style={styles.ownerBadge}>
                      <Text style={styles.ownerBadgeText}>Owner</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.memberMeta}>
                  {m.rounds_played} round{m.rounds_played !== 1 ? 's' : ''} played
                </Text>
              </View>

              {/* HCP + chevron */}
              <View style={styles.memberRight}>
                <Text style={styles.hcpValue}>
                  {m.handicap != null ? Number(m.handicap).toFixed(1) : '—'}
                </Text>
                <Text style={styles.hcpLabel}>HCP</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#ccc" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f5f5f7' },
  content: { padding: 16 },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f7', padding: 32 },

  pageTitle: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 16 },

  // Club picker
  clubPicker:    { marginBottom: 14, flexDirection: 'row' },
  clubChip:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#f3f4f6', borderWidth: 1.5, borderColor: 'transparent' },
  clubChipActive:{ backgroundColor: '#f0fdf4', borderColor: GREEN },
  clubChipText:  { fontSize: 14, fontWeight: '600', color: '#555' },
  clubChipTextActive: { color: GREEN },

  // Single club label
  clubLabel:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  clubLabelText:  { fontSize: 15, fontWeight: '700', color: '#111', flex: 1 },
  clubLabelCount: { fontSize: 13, color: '#aaa' },

  loadingWrap: { paddingVertical: 48, alignItems: 'center' },

  // Empty
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 6, textAlign: 'center' },
  emptyBody:  { fontSize: 14, color: '#888', textAlign: 'center' },
  emptyCard:  { backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center' },
  emptyCardText: { fontSize: 14, color: '#aaa' },

  // Member list
  memberList: {
    backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  memberRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, gap: 12 },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },

  avatar:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarOwner: { backgroundColor: GREEN },
  avatarText:  { color: '#fff', fontSize: 16, fontWeight: '700' },

  memberInfo:    { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName:    { fontSize: 15, fontWeight: '600', color: '#111', flexShrink: 1 },

  ownerBadge:     { backgroundColor: '#f0fdf4', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ownerBadgeText: { fontSize: 10, fontWeight: '700', color: GREEN },

  memberMeta: { fontSize: 12, color: '#aaa' },

  memberRight: { alignItems: 'center' },
  hcpValue:    { fontSize: 17, fontWeight: '800', color: GREEN },
  hcpLabel:    { fontSize: 10, color: '#aaa', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
});
