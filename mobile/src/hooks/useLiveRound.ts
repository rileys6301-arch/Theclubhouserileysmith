import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket } from '../api/socketClient';

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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<HoleUpdate[]>([]);

  useEffect(() => {
    if (!roundId) return;
    let mounted = true;

    const onConnect = () => {
      if (!mounted) return;
      setConnected(true);
      setConnectionError(null);
      socketRef.current?.emit('join_round', { roundId });
    };

    const onDisconnect = () => {
      if (!mounted) return;
      setConnected(false);
    };

    const onReconnect = () => {
      if (!mounted) return;
      socketRef.current?.emit('join_round', { roundId });
    };

    const onConnectError = (err: Error) => {
      if (!mounted) return;
      console.error('Socket connect_error:', err.message);
      setConnected(false);
      setConnectionError(err.message);
    };

    const onRoundState = (initialUpdates: HoleUpdate[]) => {
      if (!mounted) return;
      setUpdates(initialUpdates);
    };

    const onScoreUpdate = (update: HoleUpdate) => {
      if (!mounted) return;
      setUpdates(prev => {
        const filtered = prev.filter(
          u => !(u.holeNumber === update.holeNumber && u.userId === update.userId)
        );
        return [...filtered, update];
      });
    };

    (async () => {
      const socket = await getSocket();
      if (!mounted) return;
      socketRef.current = socket;

      socket.on('connect',       onConnect);
      socket.on('disconnect',    onDisconnect);
      socket.on('reconnect',     onReconnect);
      socket.on('connect_error', onConnectError);
      socket.on('round_state',   onRoundState);
      socket.on('score_update',  onScoreUpdate);

      // Socket may already be connected before listeners were attached
      if (socket.connected) onConnect();
    })();

    return () => {
      mounted = false;
      const socket = socketRef.current;
      if (socket) {
        socket.emit('leave_round', { roundId });
        socket.off('connect',       onConnect);
        socket.off('disconnect',    onDisconnect);
        socket.off('reconnect',     onReconnect);
        socket.off('connect_error', onConnectError);
        socket.off('round_state',   onRoundState);
        socket.off('score_update',  onScoreUpdate);
      }
      socketRef.current = null;
      setConnected(false);
      setUpdates([]);
    };
  }, [roundId]);

  return { connected, connectionError, updates };
}
