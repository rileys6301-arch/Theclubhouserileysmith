import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

export const TOKEN_KEY = 'auth_token';

// Without a timeout, a request stalled on a bad course connection hangs forever —
// it never resolves or rejects, so retry/error-alert logic downstream (e.g. the
// tournament finish flush) never fires and just waits indefinitely.
const client = axios.create({ baseURL: API_BASE, timeout: 15000 });

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
