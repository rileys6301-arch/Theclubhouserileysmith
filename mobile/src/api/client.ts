import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://golf-app-production-205b.up.railway.app';
export const TOKEN_KEY = 'auth_token';

const client = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
