import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

export const TOKEN_KEY = 'auth_token';

const client = axios.create({ baseURL: API_BASE });

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
