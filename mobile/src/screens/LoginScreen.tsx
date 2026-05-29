import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client, { TOKEN_KEY } from '../api/client';
import { RootStackParamList } from '../../App';
import { colors } from '../theme';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Login'> };

const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';
const PAGE_BG = '#edeae4';

export default function LoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPw,   setShowPw]   = useState(false);

  async function handleLogin() {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/api/auth/login', { email, password });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      navigation.replace('Home', { user: data.user });
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Hero ── */}
        <LinearGradient
          colors={[G_DARK, G_MID, G_LIGHT]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[s.hero, { paddingTop: insets.top + 44 }]}
        >
          {/* Decorative glow */}
          <View style={s.glowCircle} pointerEvents="none" />
          {/* Decorative rings */}
          <View style={s.ringTL} pointerEvents="none" />
          <View style={s.ringBR} pointerEvents="none" />

          {/* App icon */}
          <View style={s.iconBox}>
            <Ionicons name="golf" size={28} color="rgba(255,255,255,0.92)" />
          </View>

          <Text style={s.appName}>FairwayIQ</Text>
          <Text style={s.tagline}>Golf with your people</Text>
        </LinearGradient>

        {/* ── Wave divider ── */}
        {/* Simulated with overlapping views */}
        <View style={s.waveWrap}>
          <View style={[s.waveLayer, { backgroundColor: G_LIGHT,  bottom: 20, borderTopLeftRadius: 0, borderTopRightRadius: 80 }]} />
          <View style={[s.waveLayer, { backgroundColor: G_MID,    bottom: 12, borderTopLeftRadius: 60, borderTopRightRadius: 20 }]} />
          <View style={[s.waveLayer, { backgroundColor: PAGE_BG,  bottom: 0,  borderTopLeftRadius: 30, borderTopRightRadius: 50 }]} />
        </View>

        {/* ── Form area ── */}
        <View style={[s.formArea, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={s.formTitle}>Welcome back</Text>
          <Text style={s.formSub}>Sign in to your account</Text>

          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Email */}
          <View style={s.inputWrap}>
            <View style={s.inputIcon}>
              <Ionicons name="mail-outline" size={16} color="#bbb" />
            </View>
            <TextInput
              style={s.input}
              placeholder="Email address"
              placeholderTextColor="#bbb"
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          {/* Password */}
          <View style={[s.inputWrap, { marginBottom: 0 }]}>
            <View style={s.inputIcon}>
              <Ionicons name="lock-closed-outline" size={16} color="#bbb" />
            </View>
            <TextInput
              style={[s.input, { paddingRight: 46 }]}
              placeholder="Password"
              placeholderTextColor="#bbb"
              secureTextEntry={!showPw}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              value={password}
              onChangeText={setPassword}
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPw(v => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={showPw ? 'eye-off-outline' : 'eye-outline'}
                size={17}
                color="#bbb"
              />
            </TouchableOpacity>
          </View>

          {/* Forgot password */}
          <TouchableOpacity style={s.forgotWrap} activeOpacity={0.7}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {/* Sign in button */}
          <TouchableOpacity
            style={[s.signInBtn, loading && { opacity: 0.75 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.signInBtnText}>Sign in</Text>}
          </TouchableOpacity>

          {/* Divider */}
          <View style={s.dividerRow}>
            <View style={s.divLine} />
            <Text style={s.divText}>New to FairwayIQ?</Text>
            <View style={s.divLine} />
          </View>

          {/* Create account */}
          <TouchableOpacity
            style={s.createBtn}
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.85}
          >
            <Text style={s.createBtnText}>Create an account</Text>
          </TouchableOpacity>

          <Text style={s.footer}>
            By signing in you agree to our{' '}
            <Text style={s.footerLink}>Terms</Text>
            {' '}and{' '}
            <Text style={s.footerLink}>Privacy Policy</Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },

  // ── Hero
  hero: {
    paddingHorizontal: 32,
    paddingBottom: 48,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  glowCircle: {
    position: 'absolute',
    top: -80, alignSelf: 'center',
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  ringTL: {
    position: 'absolute', top: -50, left: -50,
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 35, borderColor: 'rgba(255,255,255,0.04)',
  },
  ringBR: {
    position: 'absolute', bottom: -60, right: -40,
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 40, borderColor: 'rgba(255,255,255,0.04)',
  },
  iconBox: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 32, fontWeight: '800', color: '#fff',
    letterSpacing: -0.8, lineHeight: 34,
  },
  tagline: {
    fontSize: 14, color: 'rgba(255,255,255,0.55)',
    marginTop: 8, fontWeight: '500',
  },

  // ── Wave
  waveWrap: { height: 40, backgroundColor: G_MID, overflow: 'hidden' },
  waveLayer: {
    position: 'absolute', left: 0, right: 0,
    height: 60,
  },

  // ── Form
  formArea: {
    backgroundColor: PAGE_BG,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  formTitle: {
    fontSize: 22, fontWeight: '800', color: '#1a1a1a',
    letterSpacing: -0.4, marginBottom: 4,
  },
  formSub: {
    fontSize: 14, color: '#aaa', fontWeight: '500', marginBottom: 24,
  },

  // ── Error
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger + '12',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },

  // ── Inputs
  inputWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  inputIcon: {
    position: 'absolute', left: 14, top: 0, bottom: 0,
    justifyContent: 'center',
    zIndex: 1,
  },
  input: {
    width: '100%',
    paddingTop: 15, paddingBottom: 15,
    paddingLeft: 42, paddingRight: 14,
    borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: '#fff',
    fontSize: 15, color: '#1a1a1a',
  },
  eyeBtn: {
    position: 'absolute', right: 14, top: 0, bottom: 0,
    justifyContent: 'center',
  },

  // ── Forgot
  forgotWrap: { alignSelf: 'flex-end', marginTop: 10, marginBottom: 20 },
  forgotText: { fontSize: 12, fontWeight: '600', color: G_MID },

  // ── Sign in button
  signInBtn: {
    borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginBottom: 20,
    backgroundColor: G_DARK,
    shadowColor: G_MID,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12,
    elevation: 6,
  },
  signInBtnText: {
    fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2,
  },

  // ── Divider
  dividerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20,
  },
  divLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(0,0,0,0.1)' },
  divText: { fontSize: 12, color: '#bbb', fontWeight: '500' },

  // ── Create account
  createBtn: {
    borderRadius: 16, paddingVertical: 15,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1.5, borderColor: 'rgba(61,107,31,0.3)',
    backgroundColor: 'rgba(61,107,31,0.05)',
  },
  createBtnText: {
    fontSize: 15, fontWeight: '700', color: G_MID, letterSpacing: -0.2,
  },

  // ── Footer
  footer:     { textAlign: 'center', fontSize: 11, color: '#bbb', lineHeight: 17 },
  footerLink: { color: '#aaa', textDecorationLine: 'underline' },
});
