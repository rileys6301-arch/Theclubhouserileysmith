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
import { colors, fontSize, spacing, radius, shadows } from '../theme';

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

type Props = { route?: { params?: { clubId?: number } } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}

function personInitials(first: string | null, last: string | null, email: string) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || email[0].toUpperCase();
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MembersScreen({ route }: Props) {
  const insets     = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const fixedClubId = route?.params?.clubId;

  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [activeClub,  setActiveClub]  = useState<Club | null>(null);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  useEffect(() => {
    if (fixedClubId) {
      setActiveClub({ id: fixedClubId, name: '', role: '' });
      setLoadingInit(false);
    } else {
      client.get<Club[]>('/api/clubs/mine')
        .then(({ data }) => {
          setClubs(data);
          if (data.length > 0) setActiveClub(data[0]);
        })
        .catch(() => {})
        .finally(() => setLoadingInit(false));
    }
  }, [fixedClubId]);

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

  if (loadingInit) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!fixedClubId && clubs.length === 0) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="people-outline" size={48} color={colors.border} style={{ marginBottom: 14 }} />
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.pageTitle}>Members</Text>

      {/* Club picker — only when not fixed to a specific club */}
      {!fixedClubId && clubs.length > 1 && (
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

      {!fixedClubId && clubs.length === 1 && activeClub && (
        <View style={styles.clubLabel}>
          <Ionicons name="golf-outline" size={14} color={colors.primary} />
          <Text style={styles.clubLabelText}>{activeClub.name}</Text>
          <Text style={styles.clubLabelCount}>{members.length} members</Text>
        </View>
      )}

      {loadingMembers ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={32} color={colors.border} style={{ marginBottom: spacing.sm }} />
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
              <View style={[styles.avatar, m.role === 'owner' && styles.avatarOwner]}>
                <Text style={styles.avatarText}>
                  {personInitials(m.first_name, m.last_name, m.email)}
                </Text>
              </View>

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

              <View style={styles.memberRight}>
                <Text style={styles.hcpValue}>
                  {m.handicap != null ? Number(m.handicap).toFixed(1) : '—'}
                </Text>
                <Text style={styles.hcpLabel}>HCP</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.border} style={{ marginLeft: spacing.xs }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: spacing.xl },

  pageTitle: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },

  clubPicker:    { marginBottom: 14, flexDirection: 'row' },
  clubChip:      { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, marginRight: spacing.sm, backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: 'transparent' },
  clubChipActive:{ backgroundColor: colors.surfaceMuted, borderColor: colors.primary },
  clubChipText:  { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  clubChipTextActive: { color: colors.primary },

  clubLabel:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  clubLabelText:  { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  clubLabelCount: { fontSize: fontSize.sm, color: colors.textSecondary },

  loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },

  emptyTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptyBody:  { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  emptyCard:  { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center' },
  emptyCardText: { fontSize: fontSize.sm, color: colors.textSecondary },

  memberList: {
    backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden',
    ...shadows.card,
  },
  memberRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: spacing.md, gap: spacing.sm },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },

  avatar:      { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarOwner: { backgroundColor: colors.primary },
  avatarText:  { color: colors.textInverse, fontSize: fontSize.md, fontWeight: '700' },

  memberInfo:    { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName:    { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },

  ownerBadge:     { backgroundColor: colors.surfaceMuted, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ownerBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },

  memberMeta: { fontSize: fontSize.xs, color: colors.textSecondary },

  memberRight: { alignItems: 'center' },
  hcpValue:    { fontSize: fontSize.md, fontWeight: '800', color: colors.primary },
  hcpLabel:    { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
});
