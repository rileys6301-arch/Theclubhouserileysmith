import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../api/client';

const ACTIVE_KEY = 'fiq_active_club_id';
const LEGACY_KEY = 'fiq_club';

const ClubContext = createContext(null);

export function ClubProvider({ children }) {
  const { user } = useAuth();
  const [myClubs,      setMyClubs]      = useState([]);
  const [activeClub,   setActiveClub]   = useState(null);
  const [loadingClubs, setLoadingClubs] = useState(true);

  useEffect(() => {
    if (!user) {
      setMyClubs([]);
      setActiveClub(null);
      setLoadingClubs(false);
      return;
    }

    setLoadingClubs(true);
    api.get('/clubs/mine')
      .then(async (clubs) => {
        // One-time migration: if no clubs in DB but legacy localStorage data, try to join by code
        if (clubs.length === 0) {
          const raw = localStorage.getItem(LEGACY_KEY);
          if (raw) {
            try {
              const local = JSON.parse(raw);
              if (local?.code) {
                const club = await api.post('/clubs/join', { code: local.code });
                clubs = [club];
              }
            } catch { /* club code not found — ignore */ }
            localStorage.removeItem(LEGACY_KEY);
          }
        }

        setMyClubs(clubs);

        // Restore previously active club
        const savedId = localStorage.getItem(ACTIVE_KEY);
        if (savedId) {
          const found = clubs.find(c => String(c.id) === savedId);
          if (found) {
            setActiveClub(found);
          } else {
            localStorage.removeItem(ACTIVE_KEY);
            if (clubs.length === 1) {
              setActiveClub(clubs[0]);
              localStorage.setItem(ACTIVE_KEY, String(clubs[0].id));
            }
          }
        } else if (clubs.length === 1) {
          // Auto-enter when user only has one club
          setActiveClub(clubs[0]);
          localStorage.setItem(ACTIVE_KEY, String(clubs[0].id));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingClubs(false));
  }, [user]);

  const enterClub = useCallback((clubId) => {
    setMyClubs(prev => {
      const club = prev.find(c => c.id === clubId);
      if (club) {
        setActiveClub(club);
        localStorage.setItem(ACTIVE_KEY, String(clubId));
      }
      return prev;
    });
  }, []);

  const exitClub = useCallback(() => {
    setActiveClub(null);
    localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const createClub = useCallback(async (name) => {
    const club = await api.post('/clubs', { name });
    setMyClubs(prev => [club, ...prev]);
    setActiveClub(club);
    localStorage.setItem(ACTIVE_KEY, String(club.id));
    return club;
  }, []);

  const joinClub = useCallback(async (code) => {
    const club = await api.post('/clubs/join', { code });
    setMyClubs(prev => prev.find(c => c.id === club.id) ? prev : [club, ...prev]);
    setActiveClub(club);
    localStorage.setItem(ACTIVE_KEY, String(club.id));
    return club;
  }, []);

  const leaveClub = useCallback(async (clubId) => {
    await api.delete(`/clubs/${clubId}/leave`);
    setMyClubs(prev => prev.filter(c => c.id !== clubId));
    setActiveClub(prev => {
      if (prev?.id === clubId) {
        localStorage.removeItem(ACTIVE_KEY);
        return null;
      }
      return prev;
    });
  }, []);

  const deleteClub = useCallback(async (clubId) => {
    await api.delete(`/clubs/${clubId}`);
    setMyClubs(prev => prev.filter(c => c.id !== clubId));
    setActiveClub(prev => {
      if (prev?.id === clubId) {
        localStorage.removeItem(ACTIVE_KEY);
        return null;
      }
      return prev;
    });
  }, []);

  return (
    <ClubContext.Provider value={{
      myClubs, activeClub, loadingClubs,
      enterClub, exitClub, createClub, joinClub, leaveClub, deleteClub,
    }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClub must be used within <ClubProvider>');
  return ctx;
}
