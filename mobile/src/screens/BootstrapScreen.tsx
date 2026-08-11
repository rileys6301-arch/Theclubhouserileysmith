import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client, { TOKEN_KEY } from '../api/client';
import { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Bootstrap'>;
};

export default function BootstrapScreen({ navigation }: Props) {
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    setConnectionError(false);
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) {
        navigation.replace('Login');
        return;
      }
      // Token exists — verify it with the server and get fresh user data
      const { data: user } = await client.get('/api/auth/me');
      navigation.replace('Home', { user });
    } catch (err) {
      // A response that came back with a 4xx means the server definitively rejected
      // the request (bad/expired token, or the endpoint plain doesn't recognize it) —
      // that's not a connectivity problem, so send the user to Login rather than
      // trapping them in an unrecoverable retry loop.
      // Only a missing response (offline/timeout) or a 5xx should be treated as
      // transient — those must NOT wipe a valid saved login, otherwise flaky signal
      // (e.g. on a golf course) forces a re-login every time.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status != null && status >= 400 && status < 500) {
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        navigation.replace('Login');
      } else {
        setConnectionError(true);
      }
    }
  }

  return (
    <LinearGradient
      colors={['#2a4a18', '#3d6b1f', '#4e8a27']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.root}
    >
      <View style={styles.iconBox}>
        <Ionicons name="golf" size={32} color="rgba(255,255,255,0.92)" />
      </View>
      <Text style={styles.appName}>FairwayIQ</Text>
      {connectionError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Can't reach the server. Check your connection.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={checkAuth}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBox: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 28, fontWeight: '800', color: '#fff',
    letterSpacing: -0.5,
  },
  errorBox: {
    marginTop: 24,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
});
