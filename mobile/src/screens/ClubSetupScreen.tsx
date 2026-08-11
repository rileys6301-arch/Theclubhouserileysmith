import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ClubSetup'>;
};

export default function ClubSetupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'create' | 'join'>('create');

  const [clubName,      setClubName]      = useState('');
  const [createSaving,  setCreateSaving]  = useState(false);
  const [createError,   setCreateError]   = useState('');

  const [code,       setCode]       = useState('');
  const [joinSaving, setJoinSaving] = useState(false);
  const [joinError,  setJoinError]  = useState('');

  async function handleCreate() {
    setCreateError('');
    if (!clubName.trim()) { setCreateError('Club name is required'); return; }
    setCreateSaving(true);
    try {
      await client.post('/api/clubs', { name: clubName.trim() });
      navigation.goBack();
    } catch (e: any) {
      setCreateError(e.response?.data?.error ?? 'Could not create club');
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleJoin() {
    setJoinError('');
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setJoinError('Club code is required'); return; }
    setJoinSaving(true);
    try {
      await client.post('/api/clubs/join', { code: trimmed });
      navigation.goBack();
    } catch (e: any) {
      setJoinError(e.response?.data?.error ?? 'Could not join club');
    } finally {
      setJoinSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Club Setup</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, tab === 'create' && styles.tabActive]}
            onPress={() => { setTab('create'); setCreateError(''); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={16} color={tab === 'create' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.tabText, tab === 'create' && styles.tabTextActive]}>Create a Club</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'join' && styles.tabActive]}
            onPress={() => { setTab('join'); setJoinError(''); }}
            activeOpacity={0.8}
          >
            <Ionicons name="enter-outline" size={16} color={tab === 'join' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.tabText, tab === 'join' && styles.tabTextActive]}>Join a Club</Text>
          </TouchableOpacity>
        </View>

        {tab === 'create' && (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="golf-outline" size={32} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>Start a new club</Text>
            <Text style={styles.cardSub}>
              Create a club and share the invite code with your friends.
            </Text>

            {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

            <Text style={styles.fieldLabel}>Club Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={clubName}
              onChangeText={setClubName}
              placeholder="e.g. The Sunday Hackers"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />

            <TouchableOpacity
              style={[styles.btn, !clubName.trim() && styles.btnDisabled]}
              onPress={handleCreate}
              disabled={createSaving || !clubName.trim()}
              activeOpacity={0.85}
            >
              {createSaving
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <Text style={styles.btnText}>Create Club</Text>}
            </TouchableOpacity>
          </View>
        )}

        {tab === 'join' && (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="people-outline" size={32} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>Join an existing club</Text>
            <Text style={styles.cardSub}>
              Enter the 6-character invite code shared by your club owner.
            </Text>

            {joinError ? <Text style={styles.errorText}>{joinError}</Text> : null}

            <Text style={styles.fieldLabel}>Invite Code</Text>
            <TextInput
              style={[styles.fieldInput, styles.codeInput]}
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              placeholder="e.g. A1B2C3"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={handleJoin}
            />

            <TouchableOpacity
              style={[styles.btn, !code.trim() && styles.btnDisabled]}
              onPress={handleJoin}
              disabled={joinSaving || !code.trim()}
              activeOpacity={0.85}
            >
              {joinSaving
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <Text style={styles.btnText}>Join Club</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg, paddingTop: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },

  tabRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabActive:     { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  tabText:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.primary },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg,
    alignItems: 'center', ...shadows.card,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
  },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  cardSub:   { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: spacing.lg },

  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },

  fieldLabel: {
    alignSelf: 'flex-start',
    fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
  },
  fieldInput: {
    width: '100%',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: fontSize.md,
    color: colors.textPrimary, backgroundColor: colors.surfaceMuted, marginBottom: spacing.lg,
  },
  codeInput: {
    letterSpacing: 4, fontSize: fontSize.xl, fontWeight: '700', textAlign: 'center',
  },

  btn: {
    width: '100%', backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.md },
});
