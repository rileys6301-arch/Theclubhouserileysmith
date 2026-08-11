import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Image, Alert,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import HandicapTrendChart from '../components/HandicapTrendChart';
import { colors, fontSize, spacing, shadows } from '../theme';

const PHOTO_KEY = 'profile_photo_uri';

const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';
const TILE_BG = '#f7f5f1';
const GREEN_V = '#3d6b1f';
const PAGE_BG = '#edeae4';
const CARD_R  = 20;
const CARD_GAP = 12;

// ── Types ─────────────────────────────────────────────────────────────────────

type MemberStats = {
  id: string; email: string;
  first_name: string | null; last_name: string | null;
  handicap: number | null; created_at: string;
  rounds_played: number;
  avg_stableford: number | null; best_stableford: number | null;
  best_score: number | null; avg_score: number | null; avg_vs_par: number | null;
  unique_courses: number | null;
  last_played_at: string | null; last_score: number | null; last_stableford: number | null;
  rounds_this_year: number | null; rounds_last_year: number | null;
  total_eagles_plus: number; total_birdies: number; total_pars: number;
  total_bogeys: number; total_double_plus: number; total_holes: number;
  points_per_hole: number | null;
};

type UserProfile = {
  id: string; email: string;
  first_name: string | null; last_name: string | null;
  handicap: number | null; club_name: string | null; created_at: string;
};

type Round = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number;
  slope_rating: number | null; course_rating: number | null;
  course_handicap: number | null; handicap_index: number | null;
};

type Props = {
  route: { params: { userId: string } };
  navigation: any;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtMember(s: string) {
  return new Date(s).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

// ── ActTile ───────────────────────────────────────────────────────────────────

function ActTile({ label, value, accent, muted }: {
  label: string; value: number | string; accent?: boolean; muted?: boolean;
}) {
  return (
    <View style={[styles.actTile, accent ? styles.actTileAccent : styles.actTileNeutral]}>
      <Text style={[styles.actTileValue, muted ? { color: '#ccc' } : accent ? { color: GREEN_V } : null]}>
        {value != null ? String(value) : '—'}
      </Text>
      <Text style={styles.actTileLabel}>{label}</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const chartWidth = screenW - 32 - 36;

  const [stats,    setStats]    = useState<MemberStats | null>(null);
  const [profile,  setProfile]  = useState<UserProfile | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [rounds,   setRounds]   = useState<Round[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [handicap,  setHandicap]  = useState('');

  useEffect(() => {
    Promise.allSettled([
      client.get<UserProfile>('/api/users/profile'),
      client.get<MemberStats>(`/api/users/${userId}`),
      client.get<Round[]>('/api/rounds'),
    ]).then(([pr, s, r]) => {
      if (pr.status === 'fulfilled') {
        const d = pr.value.data;
        setProfile(d);
        setFirstName(d.first_name ?? '');
        setLastName(d.last_name ?? '');
        setHandicap(d.handicap != null ? String(d.handicap) : '');
      }
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (r.status === 'fulfilled') setRounds(r.value.data);
      setLoading(false);
    });
    AsyncStorage.getItem(PHOTO_KEY).then(uri => { if (uri) setPhotoUri(uri); });
  }, [userId]);

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await AsyncStorage.setItem(PHOTO_KEY, uri);
    }
  }

  function startEditing() {
    setFirstName(profile?.first_name ?? '');
    setLastName(profile?.last_name ?? '');
    setHandicap(profile?.handicap != null ? String(profile.handicap) : '');
    setEditing(true);
    setError('');
  }

  function cancelEditing() { setEditing(false); setError(''); }

  async function saveProfile() {
    setError('');
    const h = handicap.trim();
    if (h !== '') {
      const num = parseFloat(h);
      if (isNaN(num) || num < -10 || num > 54) {
        setError('Handicap must be between -10 and 54');
        return;
      }
    }
    setSaving(true);
    try {
      const { data } = await client.patch<UserProfile>('/api/users/profile', {
        firstName: firstName.trim() || null,
        lastName:  lastName.trim()  || null,
        handicap:  h !== '' ? parseFloat(h) : null,
      });
      setProfile(prev => prev ? { ...prev, ...data } : data);
      setStats(prev => prev ? { ...prev, first_name: data.first_name, last_name: data.last_name, handicap: data.handicap } : prev);
      setEditing(false);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={GREEN_V} /></View>;
  }

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || '';
  const initials    = [profile?.first_name?.[0], profile?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const hcp         = stats?.handicap != null ? Number(stats.handicap) : null;
  const last10Avg   = (() => {
    const last10 = rounds.slice(0, 10);
    return last10.length > 0
      ? (last10.reduce((s, r) => s + r.stableford, 0) / last10.length).toFixed(1)
      : null;
  })();
  const yr = new Date().getFullYear();

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.root}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Hero / Edit ─────────────────────────────────────────────── */}
          {editing ? (
            <View style={[styles.card, { marginTop: insets.top + 8 }]}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput style={styles.fieldInput} value={firstName} onChangeText={setFirstName}
                  placeholder="First name" placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Last Name</Text>
                <TextInput style={styles.fieldInput} value={lastName} onChangeText={setLastName}
                  placeholder="Last name" placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Handicap Index</Text>
                <TextInput style={styles.fieldInput} value={handicap} onChangeText={setHandicap}
                  placeholder="e.g. 18.4" placeholderTextColor={colors.textSecondary} keyboardType="decimal-pad" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Home Club</Text>
                <View style={[styles.fieldInput, { justifyContent: 'center' }]}>
                  <Text style={{ fontSize: fontSize.base, color: colors.textSecondary }}>{profile?.club_name ?? '—'}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing} disabled={saving}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={saveProfile} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color={colors.textInverse} size="small" />
                    : <Text style={styles.saveButtonText}>Save Changes</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <LinearGradient
              colors={[G_DARK, G_MID, G_LIGHT]}
              locations={[0, 0.6, 1]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[styles.heroGradient, { paddingTop: insets.top + 32 }]}
            >
              <View style={styles.heroGlow} pointerEvents="none" />
              <View style={styles.heroRing} pointerEvents="none" />

              <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85} style={{ alignItems: 'center', marginBottom: 14 }}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.heroAvatar} />
                ) : (
                  <View style={styles.heroAvatar}>
                    <Text style={styles.heroAvatarText}>{initials}</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.heroName}>{displayName}</Text>
              <Text style={styles.heroEmail}>{profile?.email}</Text>
              {profile?.created_at && (
                <Text style={styles.heroMemberSince}>Member since {fmtMember(profile.created_at)}</Text>
              )}

              <View style={styles.heroSep}>
                <View style={styles.heroSepLine} />
                <View style={styles.heroSepDot} />
                <View style={styles.heroSepLine} />
              </View>

              <Text style={styles.heroHcp}>{hcp != null ? hcp.toFixed(1) : '—'}</Text>
              <Text style={styles.heroHcpLabel}>Handicap Index</Text>

              <TouchableOpacity style={styles.heroEditBtn} onPress={startEditing} activeOpacity={0.8}>
                <Ionicons name="pencil-outline" size={13} color={colors.primary} />
                <Text style={styles.heroEditBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            </LinearGradient>
          )}

          {/* ── Stat strip ──────────────────────────────────────────────── */}
          {stats && stats.rounds_played > 0 && (
            <View style={styles.statStrip}>
              <View style={styles.statCol}>
                <Text style={[styles.statVal, { color: GREEN_V }]}>{last10Avg ?? '—'}</Text>
                <Text style={styles.statLabel}>Avg Last 10</Text>
              </View>
              <View style={styles.statDiv} />
              <View style={styles.statCol}>
                <Text style={styles.statVal}>{stats.best_score ?? '—'}</Text>
                <Text style={styles.statLabel}>Best Gross</Text>
              </View>
              <View style={styles.statDiv} />
              <View style={styles.statCol}>
                <Text style={[styles.statVal, { color: GREEN_V }]}>{stats.best_stableford ?? '—'}</Text>
                <Text style={styles.statLabel}>Best Pts</Text>
              </View>
            </View>
          )}

          {/* ── Stats ─────────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={styles.statsRow}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('MemberProfile', { userId, name: 'Stats' })}
          >
            <View style={styles.statsRowIconWrap}>
              <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.statsRowText}>Stats</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* ── Handicap Trend ───────────────────────────────────────────── */}
          <HandicapTrendChart rounds={rounds} width={chartWidth} />

          {/* ── Activity ──────────────────────────────────────────────────── */}
          {stats && stats.rounds_played > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Activity</Text>

              {stats.last_played_at && (
                <LinearGradient
                  colors={[G_DARK, G_MID]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.actFeatured}
                >
                  <Text style={styles.actFeaturedLbl}>Last Round</Text>
                  <Text style={styles.actFeaturedDate}>{fmtDate(stats.last_played_at)}</Text>
                  {stats.last_score != null && (
                    <Text style={styles.actFeaturedSub}>
                      {stats.last_score} strokes · {stats.last_stableford} pts
                    </Text>
                  )}
                </LinearGradient>
              )}

              <View style={[styles.tileGrid, { marginTop: 8 }]}>
                <ActTile label="Total Rounds"   value={stats.rounds_played} />
                <ActTile label="Courses Played" value={stats.unique_courses ?? 0} accent />
              </View>

              <Text style={styles.sectionLabel}>By Year</Text>
              <View style={styles.tileGrid}>
                <ActTile label={String(yr)}   value={stats.rounds_this_year ?? 0} />
                <ActTile label={String(yr-1)} value={stats.rounds_last_year ?? 0} />
              </View>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: PAGE_BG },
  content:  { gap: CARD_GAP },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAGE_BG },

  heroGradient: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -60, alignSelf: 'center',
  },
  heroRing: {
    position: 'absolute',
    bottom: -30, right: -30,
    width: 160, height: 160, borderRadius: 80,
    borderWidth: 30, borderColor: 'rgba(255,255,255,0.04)',
  },
  heroEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 20,
    paddingVertical: 9, paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: '#fff',
  },
  heroEditBtnText:  { fontSize: 13, fontWeight: '700', color: colors.primary },
  heroAvatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroAvatarText:  { fontSize: 26, fontWeight: '700', color: '#fff' },
  heroName:        { fontSize: 21, fontWeight: '700', color: '#fff', letterSpacing: -0.3, marginBottom: 3 },
  heroEmail:       { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 2 },
  heroMemberSince: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  heroSep: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginVertical: 20,
  },
  heroSepLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  heroSepDot:  { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 8 },
  heroHcp: {
    fontSize: 64, fontWeight: '800', color: '#fff',
    letterSpacing: -2, lineHeight: 70,
  },
  heroHcpLabel: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2,
    textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 6,
  },

  errorText:        { color: colors.danger, marginBottom: spacing.sm, textAlign: 'center', fontSize: fontSize.sm },
  fieldGroup:       { width: '100%', marginBottom: 14 },
  fieldLabel:       { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  fieldInput:       { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: fontSize.base, color: colors.textPrimary, backgroundColor: colors.surfaceMuted },
  cancelButton:     { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelButtonText: { fontSize: fontSize.base, color: colors.textSecondary, fontWeight: '500' },
  saveButton:       { flex: 2, backgroundColor: GREEN_V, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveButtonText:   { fontSize: fontSize.base, color: '#fff', fontWeight: '600' },

  statStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: CARD_R,
    paddingVertical: 16,
    ...shadows.card,
  },
  statCol:   { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  statDiv:   { width: 0.5, backgroundColor: '#e0ddd8', marginVertical: 4 },
  statVal:   { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontWeight: '500', color: '#aaa', marginTop: 5 },

  card:      { backgroundColor: colors.surface, borderRadius: CARD_R, padding: 18, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 14 },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: CARD_R,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...shadows.card,
  },
  statsRowIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(61,107,31,0.1)',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  statsRowText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: '#bbb', paddingVertical: 14 },
  tileGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  actFeatured:     { borderRadius: 14, padding: 16, marginBottom: 2 },
  actFeaturedLbl:  { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  actFeaturedDate: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  actFeaturedSub:  { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  actTile:         { flex: 1, minWidth: '45%', borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)' },
  actTileNeutral:  { backgroundColor: TILE_BG },
  actTileAccent:   { backgroundColor: 'rgba(61,107,31,0.06)', borderColor: 'rgba(61,107,31,0.15)' },
  actTileValue:    { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  actTileLabel:    { fontSize: 10, fontWeight: '500', color: '#aaa', marginTop: 5 },
});
