import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client, { TOKEN_KEY } from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Register'> };

export default function RegisterScreen({ navigation }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [showPw,    setShowPw]    = useState(false);

  const lastRef     = useRef<TextInput>(null);
  const emailRef    = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef  = useRef<TextInput>(null);

  async function handleRegister() {
    setError('');
    if (!email.trim())       return setError('Email is required');
    if (!password)           return setError('Password is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');

    setLoading(true);
    try {
      const { data } = await client.post('/api/auth/register', {
        email:     email.trim().toLowerCase(),
        password,
        firstName: firstName.trim() || undefined,
        lastName:  lastName.trim()  || undefined,
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      navigation.replace('Home', { user: data.user });
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not create account');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand */}
        <View style={styles.brand}>
          <View style={styles.logoWrap}>
            <Ionicons name="golf" size={32} color={colors.textInverse} />
          </View>
          <Text style={styles.appName}>FairwayIQ</Text>
          <Text style={styles.appTagline}>Start tracking your game today</Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create account</Text>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Name row */}
          <View style={styles.nameRow}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>First name</Text>
              <TextInput
                style={styles.input}
                placeholder="Riley"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                returnKeyType="next"
                value={firstName}
                onChangeText={setFirstName}
                onSubmitEditing={() => lastRef.current?.focus()}
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>Last name</Text>
              <TextInput
                ref={lastRef}
                style={styles.input}
                placeholder="Smith"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                returnKeyType="next"
                value={lastName}
                onChangeText={setLastName}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              ref={emailRef}
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                ref={passwordRef}
                style={[styles.input, { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }]}
                placeholder="Min 8 characters"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showPw}
                returnKeyType="next"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
              <TouchableOpacity
                style={styles.pwToggle}
                onPress={() => setShowPw(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              ref={confirmRef}
              style={styles.input}
              placeholder="Re-enter password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showPw}
              returnKeyType="done"
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={handleRegister}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.textInverse} />
              : <Text style={styles.btnText}>Create Account</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Sign in link */}
        <TouchableOpacity
          style={styles.signInLink}
          onPress={() => navigation.goBack()}
          activeOpacity={0.75}
        >
          <Text style={styles.signInLinkText}>
            Already have an account?{'  '}
            <Text style={styles.signInLinkBold}>Sign in →</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingVertical: spacing.xl },

  // Brand header
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: spacing.md,
    ...shadows.card,
    shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  appName:    { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  appTagline: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
    marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },

  // Error
  errorBox:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger + '12', borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, flex: 1 },

  // Name row
  nameRow: { flexDirection: 'row', gap: spacing.sm },

  // Fields
  fieldGroup: { marginBottom: spacing.sm },
  label: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md,
    paddingVertical: 13, fontSize: fontSize.base,
    backgroundColor: colors.surfaceMuted, color: colors.textPrimary,
  },

  // Password toggle
  pwWrap: { flexDirection: 'row', alignItems: 'stretch' },
  pwToggle: {
    borderWidth: 1.5, borderColor: colors.border, borderLeftWidth: 0,
    borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center', alignItems: 'center',
  },

  // Button
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingVertical: 15, alignItems: 'center', marginTop: spacing.sm,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: colors.textInverse, fontSize: fontSize.base, fontWeight: '700', letterSpacing: 0.3 },

  // Sign in link
  signInLink:     { alignItems: 'center', paddingVertical: spacing.sm },
  signInLinkText: { fontSize: fontSize.sm, color: colors.textSecondary },
  signInLinkBold: { color: colors.primary, fontWeight: '700' },
});
