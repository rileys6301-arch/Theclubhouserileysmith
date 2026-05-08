import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Image, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';

const PHOTO_KEY = 'profile_photo_uri';

type UserProfile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  club_name: string | null;
  created_at: string;
};

type Props = {
  route: { params: { userId: string } };
};

export default function ProfileScreen({ route }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Edit form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [handicap, setHandicap] = useState('');

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await client.get<UserProfile>('/api/users/profile');
      setProfile(data);
      setFirstName(data.first_name ?? '');
      setLastName(data.last_name ?? '');
      setHandicap(data.handicap != null ? String(data.handicap) : '');
    } catch {
      setError('Could not load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    AsyncStorage.getItem(PHOTO_KEY).then(uri => { if (uri) setPhotoUri(uri); });
  }, [fetchProfile]);

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
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

  function cancelEditing() {
    setEditing(false);
    setError('');
  }

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
        lastName: lastName.trim() || null,
        handicap: h !== '' ? parseFloat(h) : null,
      });
      setProfile(prev => prev ? { ...prev, ...data } : data);
      setEditing(false);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || '';
  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Profile card ───────────────────────────────────────────── */}
        <View style={styles.card}>
          {/* Avatar */}
          <TouchableOpacity style={styles.avatarWrap} onPress={pickPhoto} activeOpacity={0.8}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.cameraIcon}>
              <Ionicons name="camera" size={14} color="#555" />
            </View>
          </TouchableOpacity>

          {/* Name & meta (view mode) */}
          {!editing && (
            <>
              <Text style={styles.displayName}>{displayName}</Text>
              <Text style={styles.email}>{profile?.email}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>
                    {profile?.handicap != null ? `+${profile.handicap}` : '—'}
                  </Text>
                  <Text style={styles.statLabel}>Handicap</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue} numberOfLines={1}>
                    {profile?.club_name ?? '—'}
                  </Text>
                  <Text style={styles.statLabel}>Home Club</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.editButton} onPress={startEditing}>
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Edit form */}
          {editing && (
            <>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Last Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Handicap Index</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={handicap}
                  onChangeText={setHandicap}
                  placeholder="e.g. 18.4"
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Home Club</Text>
                <View style={[styles.fieldInput, styles.fieldReadonly]}>
                  <Text style={styles.fieldReadonlyText}>{profile?.club_name ?? '—'}</Text>
                </View>
              </View>

              <View style={styles.editActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing} disabled={saving}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={saveProfile} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveButtonText}>Save Changes</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const GREEN = '#1a7f3c';

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f5f5f7' },
  content:      { padding: 20, paddingTop: 16 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },

  // Avatar
  avatarWrap:        { marginBottom: 16, position: 'relative' },
  avatar:            { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GREEN, justifyContent: 'center', alignItems: 'center',
  },
  avatarInitials:    { color: '#fff', fontSize: 32, fontWeight: '700' },
  cameraIcon: {
    position: 'absolute', bottom: 0, right: -2,
    backgroundColor: '#fff', borderRadius: 12, padding: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 3, elevation: 2,
  },
  cameraIconText: {},

  // View mode
  displayName: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 2 },
  email:        { fontSize: 13, color: '#888', marginBottom: 20 },

  statsRow:    { flexDirection: 'row', width: '100%', marginBottom: 20 },
  statBox:     { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statValue:   { fontSize: 18, fontWeight: '700', color: GREEN, marginBottom: 2 },
  statLabel:   { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, backgroundColor: '#eee', marginVertical: 4 },

  editButton: {
    borderWidth: 1.5, borderColor: GREEN, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 28,
  },
  editButtonText: { color: GREEN, fontWeight: '600', fontSize: 15 },

  // Edit form
  errorText:  { color: '#c0392b', marginBottom: 12, textAlign: 'center', fontSize: 13 },
  fieldGroup: { width: '100%', marginBottom: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  fieldInput: {
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, color: '#111',
    backgroundColor: '#fafafa',
  },
  fieldReadonly:     { justifyContent: 'center' },
  fieldReadonlyText: { fontSize: 16, color: '#aaa' },

  editActions:      { flexDirection: 'row', gap: 10, width: '100%', marginTop: 6 },
  cancelButton:     { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelButtonText: { fontSize: 15, color: '#555', fontWeight: '500' },
  saveButton:       { flex: 2, backgroundColor: GREEN, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveButtonText:   { fontSize: 15, color: '#fff', fontWeight: '600' },

});
