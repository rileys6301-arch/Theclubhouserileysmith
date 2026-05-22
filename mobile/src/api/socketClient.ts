import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { TOKEN_KEY } from './client';
import { API_BASE } from '../config';

let _socket: Socket | null = null;

export async function getSocket(): Promise<Socket> {
  // Return existing connected socket
  if (_socket?.connected) return _socket;

  // If socket exists but is disconnected, reconnect it
  if (_socket) {
    _socket.connect();
    return _socket;
  }

  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  _socket = io(API_BASE, {
    auth: { token: token ?? '' },
    transports: ['websocket', 'polling'], // allow polling fallback
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
  });
  return _socket;
}
