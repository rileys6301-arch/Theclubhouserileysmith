import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

export type HoleUpdate = {
  roundId: number;
  userId: string;
  holeNumber: number;
  score: number;
  stablefordPoints: number;
  totalScore: number;
  totalStableford: number;
};

export function useLiveRound(roundId: number | null) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState<HoleUpdate[]>([]);

  useEffect(() => {
    if (!roundId) return;
    let mounted = true;

    (async () => {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!mounted || !token) return;

      const socket = io(API_BASE, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15000,
        reconnectionAttempts: Infinity,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        if (!mounted) return;
        setConnected(true);
        socket.emit('join_round', { roundId });
      });

      socket.on('disconnect', () => {
        if (!mounted) return;
        setConnected(false);
      });

      // On reconnect, re-join the room so we don't miss future updates
      socket.on('reconnect', () => {
        if (!mounted) return;
        socket.emit('join_round', { roundId });
      });

      socket.on('score_update', (update: HoleUpdate) => {
        if (!mounted) return;
        setUpdates(prev => {
          // Replace existing update for same userId+hole, or append
          const filtered = prev.filter(
            u => !(u.holeNumber === update.holeNumber && u.userId === update.userId)
          );
          return [...filtered, update];
        });
      });
    })();

    return () => {
      mounted = false;
      socketRef.current?.emit('leave_round', { roundId });
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      setUpdates([]);
    };
  }, [roundId]);

  return { connected, updates };
}
