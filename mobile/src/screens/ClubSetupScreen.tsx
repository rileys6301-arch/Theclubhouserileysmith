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

const GREEN = '#1a7f3c';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ClubSetup'>;
};

export default function ClubSetupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'create' | 'join'>('create');

  // Create state
  const [clubName,      setClubName]      = useState('');
  const [createSaving,  setCreateSaving]  = useState(false);
  const [createError,   setCreateError]   = useState('');

  // Join state
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#111" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Club Setup</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, tab === 'create' && styles.tabActive]}
            onPress={() => { setTab('create'); setCreateError(''); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={16} color={tab === 'create' ? GREEN : '#888'} />
            <Text style={[styles.tabText, tab === 'create' && styles.tabTextActive]}>Create a Club</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'join' && styles.tabActive]}
            onPress={() => { setTab('join'); setJoinError(''); }}
            activeOpacity={0.8}
          >
            <Ionicons name="enter-outline" size={16} color={tab === 'join' ? GREEN : '#888'} />
            <Text style={[styles.tabText, tab === 'join' && styles.tabTextActive]}>Join a Club</Text>
          </TouchableOpacity>
        </View>

        {/* Create form */}
        {tab === 'create' && (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="golf-outline" size={32} color={GREEN} />
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
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>Create Club</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Join form */}
        {tab === 'join' && (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="people-outline" size={32} color={GREEN} />
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
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>Join Club</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f5f5f7' },
  content: { padding: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 24, paddingTop: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },

  tabRow: {
    flexDirection: 'row', gap: 10, marginBottom: 20,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e5e5e5', backgroundColor: '#fff',
  },
  tabActive:     { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  tabText:       { fontSize: 14, fontWeight: '600', color: '#888' },
  tabTextActive: { color: GREEN },

  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: '#f0fdf4',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 8, textAlign: 'center' },
  cardSub:   { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, marginBottom: 24 },

  errorText: { color: '#c0392b', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  fieldLabel: {
    alignSelf: 'flex-start',
    fontSize: 11, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
  },
  fieldInput: {
    width: '100%',
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 16,
    color: '#111', backgroundColor: '#fafafa', marginBottom: 20,
  },
  codeInput: {
    letterSpacing: 4, fontSize: 22, fontWeight: '700', textAlign: 'center',
  },

  btn: {
    width: '100%', backgroundColor: GREEN, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText:     { color: '#fff', fontWeight: '700', fontSize: 16 },
});
