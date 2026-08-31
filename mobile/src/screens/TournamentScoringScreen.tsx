import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import client from '../api/client';
import { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TournamentScoring'>;
  route: { params: { competitionId: number; userId: string } };
};

// ── Types ──────────────────────────────────────────────────────────────────────
type EntryRow = {
  player_id: string; player_first: string | null; player_last: string | null;
  player_email: string; handicap: number | null; scorer_id: string | null;
  team_id: number | null;
};
type HoleRaw     = { number: number; par: number; si: number };
type ScoreRecord = { hole_number: number; score: number; stableford_points: number };
type CompDetail  = {
  id: number; name: string; format: string; course_name: string; status: string;
  hole_data: HoleRaw[] | null; entries: EntryRow[]; myEntry: EntryRow | null;
  scoringFor: EntryRow | null;
  myScorecard:      { selfScores: ScoreRecord[]; markerScores: ScoreRecord[] } | null;
  partnerScorecard: { markerScores: ScoreRecord[]; selfScores: ScoreRecord[] } | null;
};
type HoleEntry = {
  holeNumber: number; par: number; strokeIndex: number;
  score: number; scored: boolean; stablefordPoints: number;
  fairwayHit: boolean | null; gir: boolean | null; putts: number | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────
const BG      = '#1a2a10';
const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';

// ── Helpers ────────────────────────────────────────────────────────────────────
const personName     = (f: string|null, l: string|null, e: string) => [f,l].filter(Boolean).join(' ') || e;
const personInitials = (f: string|null, l: string|null) =>
  [f?.[0], l?.[0]].filter(Boolean).join('').toUpperCase() || '?';

function calcStableford(par: number, si: number, score: number, ph: number): number {
  const extra = Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0);
  return Math.max(0, 2 + par + extra - score);
}

function outcomeLabel(score: number, par: number): string {
  const d = score - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d ===  0) return 'Par';
  if (d ===  1) return 'Bogey';
  if (d ===  2) return 'Double Bogey';
  return 'Triple+';
}

function netLabel(score: number, par: number, extra: number): string {
  const net = par + extra - score;
  if (net >= 2) return `net eagle · ${2 + net} pts`;
  if (net === 1) return 'net birdie · 3 pts';
  if (net === 0) return 'net par · 2 pts';
  if (net === -1) return 'net bogey · 1 pt';
  return 'net double+ · 0 pts';
}

function scoreColor(score: number, par: number): string {
  const d = score - par;
  if (d <= -2) return '#c9a227';
  if (d === -1) return '#3d6b1f';
  if (d ===  0) return '#3d6b1f';
  if (d ===  1) return '#888888';
  return '#c0392b';
}

function buildHoles(holeData: HoleRaw[] | null, ph: number, existing: ScoreRecord[]): HoleEntry[] {
  const scoreMap = new Map(existing.map(s => [s.hole_number, s]));
  const raw = holeData?.length === 18
    ? holeData.map(h => ({ holeNumber: h.number, par: h.par, strokeIndex: h.si }))
    : Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));
  return raw.map(h => {
    const ex    = scoreMap.get(h.holeNumber);
    const score = ex?.score ?? 0;
    const scored = !!ex;
    return {
      ...h, score, scored,
      stablefordPoints: scored
        ? (ex!.stableford_points ?? calcStableford(h.par, h.strokeIndex, score, ph))
        : 0,
      fairwayHit: null, gir: null, putts: null,
    };
  });
}

// A picked-up hole is always saved with score: 0 (see togglePickup) — no real
// played hole ever has a 0 gross score, so that's a safe, unique signal to
// reconstruct "picked up" from server data. Without this, pickedUpA/pickedUpB
// silently reset to all-false on every reload: the hole looks unscored again,
// the stepper re-enables, and the pick-up gets overwritten the next tap.
function derivePickedUp(existing: ScoreRecord[]): boolean[] {
  const arr = Array(18).fill(false);
  for (const r of existing) if (r.score === 0) arr[r.hole_number - 1] = true;
  return arr;
}

const AVATAR_PALETTE = ['#2a4a18','#1e5a8e','#8e3d1e','#5a1e8e','#1e8e7a','#8e7a1e'];
function avatarBg(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ── Sub-components (defined outside to avoid re-mount on every render) ─────────

type ScCellProps = {
  h: HoleEntry; pickedUp: boolean; isActiveHole: boolean; onPress: () => void;
};
function ScCell({ h, pickedUp, isActiveHole, onPress }: ScCellProps) {
  const d = h.score - h.par;
  return (
    <TouchableOpacity style={s.scCell} onPress={onPress} activeOpacity={0.75}>
      {isActiveHole ? (
        <LinearGradient colors={[G_DARK, G_MID]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.scCellActiveGrad}>
          <Text style={s.scCellActiveTx}>{h.scored ? h.score : '—'}</Text>
        </LinearGradient>
      ) : pickedUp ? (
        <View style={s.scPuCell}><Text style={s.scPuTx}>PU</Text></View>
      ) : !h.scored ? (
        <Text style={s.scUnscored}>—</Text>
      ) : d <= -1 ? (
        <View style={[s.scCircle, { backgroundColor: d <= -2 ? '#c9a227' : G_MID }]}>
          <Text style={s.scCircleTx}>{h.score}</Text>
        </View>
      ) : d === 0 ? (
        <Text style={s.scParTx}>{h.score}</Text>
      ) : d === 1 ? (
        <View style={s.scSquare}>
          <Text style={s.scSquareTx}>{h.score}</Text>
        </View>
      ) : (
        <View style={s.scDblSquare}>
          <Text style={[s.scSquareTx, { color: '#c0392b' }]}>{h.score}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

type PlayerCardProps = {
  isYou:         boolean;
  name:          string;
  initials:      string;
  hcp:           number;
  avBg:          string;
  isActive:      boolean;
  pickedUp:      boolean;
  holeCurrent:   HoleEntry;
  extra:         number;
  totalPts:      number;
  onActivate:    () => void;
  onAdjust:      (delta: number) => void;
  onTogglePickup:() => void;
};
function PlayerCard({
  isYou, name, initials, hcp, avBg, isActive, pickedUp,
  holeCurrent, extra, totalPts,
  onActivate, onAdjust, onTogglePickup,
}: PlayerCardProps) {
  const h      = holeCurrent;
  const sc     = pickedUp ? '#c0392b' : (h.scored ? scoreColor(h.score, h.par) : '#aaa');
  const label  = pickedUp ? 'picked up · 0 pts' : (h.scored ? outcomeLabel(h.score, h.par).toLowerCase() : '');
  const netTx  = pickedUp ? 'no points awarded' : (h.scored ? netLabel(h.score, h.par, extra) : '');
  const pts    = pickedUp ? 0 : (h.scored ? h.stablefordPoints : undefined);

  return (
    <TouchableOpacity
      activeOpacity={0.97}
      onPress={onActivate}
      style={[s.card, isActive && s.cardActive, pickedUp && s.cardDimmed]}
    >
      {/* ── Header ── */}
      <View style={s.cardHeader}>
        <LinearGradient
          colors={[avBg, avBg + 'cc']}
          style={s.cardAvatar}
        >
          <Text style={s.cardAvatarTx}>{initials}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={s.cardName}>{name}</Text>
            {isYou && <Text style={s.youTx}>(You)</Text>}
          </View>
          <Text style={s.cardHcp}>
            HCP {Math.ceil(hcp - 0.5)} · {extra} shot{extra !== 1 ? 's' : ''} on this hole
          </Text>
        </View>
        <View style={s.totalBadge}>
          <Text style={s.totalBadgePts}>{totalPts} pts</Text>
        </View>
      </View>

      {/* ── Body ── */}
      <View style={s.cardBody}>
        {/* Dial */}
        <View style={s.dialRow}>
          <TouchableOpacity
            style={[s.dialBtn, pickedUp && { opacity: 0.3 }]}
            onPress={() => onAdjust(-1)}
            disabled={pickedUp}
            activeOpacity={0.7}
          >
            <Ionicons name="remove" size={20} color="#555" />
          </TouchableOpacity>
          <View style={s.dialCenter}>
            <Text style={[s.dialScore, pickedUp && { fontSize: 32 }, { color: sc }]}>
              {pickedUp ? 'PU' : (h.scored ? h.score : '—')}
            </Text>
            <Text style={[s.dialOutcome, { color: sc }]}>{label}</Text>
            <Text style={s.dialNet}>{netTx}</Text>
          </View>
          <TouchableOpacity
            style={[s.dialBtn, pickedUp && { opacity: 0.3 }]}
            onPress={() => onAdjust(+1)}
            disabled={pickedUp}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={20} color="#555" />
          </TouchableOpacity>
        </View>

        {/* Stat tiles */}
        <View style={s.statTiles}>
          <View style={s.statTileNeutral}>
            <Text style={s.statTileLbl}>Shots</Text>
            <Text style={s.statTileVal}>{extra}</Text>
          </View>
          <View style={s.statTileNeutral}>
            <Text style={s.statTileLbl}>Points</Text>
            <Text style={[s.statTileVal, { color: '#3d6b1f' }]}>
              {pts !== undefined ? pts : '—'}
            </Text>
          </View>
          <LinearGradient
            colors={[G_DARK, G_MID]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={s.statTileDark}
          >
            <Text style={[s.statTileLbl, { color: 'rgba(255,255,255,0.55)' }]}>Total</Text>
            <Text style={[s.statTileVal, { color: '#fff' }]}>{totalPts}</Text>
          </LinearGradient>
        </View>

        {/* Pick up */}
        <TouchableOpacity
          style={[s.puBtn, pickedUp && s.puBtnUndo]}
          onPress={onTogglePickup}
          activeOpacity={0.8}
        >
          <Ionicons
            name={pickedUp ? 'refresh-outline' : 'close-circle-outline'}
            size={14}
            color={pickedUp ? '#888' : '#c0392b'}
          />
          <Text style={[s.puBtnTx, pickedUp && s.puBtnUndoTx]}>
            {pickedUp ? 'Undo pick up' : 'Pick up'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function TournamentScoringScreen({ navigation, route }: Props) {
  const { competitionId, userId } = route.params;
  const insets = useSafeAreaInsets();

  const [phase,      setPhase]      = useState<'loading'|'ninehole'|'partner'|'scoring'>('loading');
  const [pendingPhase, setPendingPhase] = useState<'partner'|'scoring'>('scoring');
  const [nineHole,   setNineHole]   = useState(false);
  const [nineHoleSide, setNineHoleSide] = useState<'front'|'back'>('front');
  const [comp,       setComp]       = useState<CompDetail | null>(null);
  const [userHcp,    setUserHcp]    = useState(0);
  const [partner,    setPartner]    = useState<EntryRow | null>(null);
  const [pairing,    setPairing]    = useState(false);
  const [holesA,     setHolesA]     = useState<HoleEntry[]>([]);
  const [holesB,     setHolesB]     = useState<HoleEntry[]>([]);
  const [holeIdx,    setHoleIdx]    = useState(0);
  const [finishing,  setFinishing]  = useState(false);
  const [activeCard, setActiveCard] = useState<'A'|'B'>('A');
  const [pickedUpA,  setPickedUpA]  = useState<boolean[]>(Array(18).fill(false));
  const [pickedUpB,  setPickedUpB]  = useState<boolean[]>(Array(18).fill(false));
  const [scanning,   setScanning]   = useState(false);

  // Debounce per-hole submissions — rapid +/- taps used to fire one POST per tap,
  // which on a flaky connection can arrive out of order and leave a stale score
  // persisted even though the UI shows the latest one. Only the last tap per hole
  // (after a short pause) actually goes out, same pattern as LiveRoundScreen.
  const saveTimersA = useRef<(ReturnType<typeof setTimeout> | null)[]>(Array(18).fill(null));
  const saveTimersB = useRef<(ReturnType<typeof setTimeout> | null)[]>(Array(18).fill(null));

  useEffect(() => {
    (async () => {
      try {
        const [compRes, profileRes] = await Promise.all([
          client.get<CompDetail>(`/api/competitions/${competitionId}`),
          client.get<{ handicap: number | null }>('/api/users/profile'),
        ]);
        const c = compRes.data;
        // Prefer the tournament-specific handicap the creator set for this player
        // over their profile default, so an override actually affects their own scoring.
        const myEntry = c.entries.find(e => e.player_id === userId);
        const hcp = Number(myEntry?.handicap ?? profileRes.data.handicap) || 0;
        setComp(c);
        setUserHcp(hcp);
        navigation.setOptions({ title: c.name });

        const ph = Math.ceil(hcp - 0.5); // WHS: 0.5 rounds down

        let partnerEntry: EntryRow | null = null;
        if (c.format === 'best_ball') {
          // Best ball: "partner" here is just the first teammate for the dual-card
          // scoring UI — team membership (not a pairwise marker) is what the
          // leaderboard and scoring rights actually key off for this format.
          if (myEntry?.team_id != null) {
            partnerEntry = c.entries.find(e => e.team_id === myEntry.team_id && e.player_id !== userId) ?? null;
          }
        } else if (c.myEntry?.scorer_id) {
          partnerEntry = c.entries.find(e => e.player_id === c.myEntry!.scorer_id) ?? null;
        } else if (c.scoringFor) {
          partnerEntry = c.entries.find(e => e.player_id === c.scoringFor!.player_id) ?? null;
        }

        if (c.format === 'best_ball') {
          // No single scorer_id to key off, so fetch each side's resolved scores
          // directly rather than relying on the marker-shaped myScorecard/partnerScorecard.
          const [mine, theirs] = await Promise.all([
            client.get<ScoreRecord[]>(`/api/competitions/${competitionId}/player/${userId}/scores`),
            partnerEntry
              ? client.get<ScoreRecord[]>(`/api/competitions/${competitionId}/player/${partnerEntry.player_id}/scores`)
              : Promise.resolve({ data: [] as ScoreRecord[] }),
          ]);
          setHolesA(buildHoles(c.hole_data, ph, mine.data));
          setPickedUpA(derivePickedUp(mine.data));
          if (partnerEntry) {
            const pHcp = Math.ceil((Number(partnerEntry.handicap) || 0) - 0.5);
            setHolesB(buildHoles(c.hole_data, pHcp, theirs.data));
            setPickedUpB(derivePickedUp(theirs.data));
          }
        } else {
          const selfScores = c.myScorecard?.selfScores ?? [];
          setHolesA(buildHoles(c.hole_data, ph, selfScores));
          setPickedUpA(derivePickedUp(selfScores));
          if (partnerEntry) {
            const pHcp = Math.ceil((Number(partnerEntry.handicap) || 0) - 0.5); // WHS: 0.5 rounds down
            const markerScores = c.partnerScorecard?.markerScores ?? [];
            setHolesB(buildHoles(c.hole_data, pHcp, markerScores));
            setPickedUpB(derivePickedUp(markerScores));
          }
        }

        if (partnerEntry) {
          setPartner(partnerEntry);
          setPendingPhase('scoring');
        } else {
          const others = c.format === 'best_ball'
            ? c.entries.filter(e => e.player_id !== userId && e.team_id == null)
            : c.entries.filter(e => e.player_id !== userId);
          setPendingPhase(others.length > 0 ? 'partner' : 'scoring');
        }
        setPhase('ninehole');
      } catch {
        Alert.alert('Error', 'Could not load competition');
        navigation.goBack();
      }
    })();
  }, [competitionId, userId]);

  function confirmNineHoleSelection() {
    if (nineHole) {
      // Slice, don't reset — a returning player with an already-picked-up hole
      // in the selected 9 would otherwise have that state silently wiped here.
      function sliceFn<T>(arr: T[]): T[] {
        return nineHoleSide === 'front' ? arr.slice(0, 9) : arr.slice(9, 18);
      }
      setHolesA(prev => sliceFn(prev));
      if (holesB.length > 0) setHolesB(prev => sliceFn(prev));
      setPickedUpA(prev => sliceFn(prev));
      setPickedUpB(prev => sliceFn(prev));
    }
    setPhase(pendingPhase);
  }

  async function handleSelectPartner(entry: EntryRow) {
    setPairing(true);
    try {
      const endpoint = comp?.format === 'best_ball' ? 'team' : 'partner';
      const body = comp?.format === 'best_ball' ? { teammateId: entry.player_id } : { partnerId: entry.player_id };
      await client.post(`/api/competitions/${competitionId}/${endpoint}`, body);
      const pHcp = Math.ceil((Number(entry.handicap) || 0) - 0.5); // WHS: 0.5 rounds down
      setPartner(entry);
      const fullHolesB = buildHoles(comp!.hole_data, pHcp, []);
      setHolesB(nineHole
        ? (nineHoleSide === 'front' ? fullHolesB.slice(0, 9) : fullHolesB.slice(9, 18))
        : fullHolesB
      );
      setPhase('scoring');
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not pair with partner');
    } finally { setPairing(false); }
  }

  function submitScore(playerId: string, hole: HoleEntry) {
    client.post(`/api/competitions/${competitionId}/scores`, {
      playerId,
      holeNumber:       hole.holeNumber,
      score:            hole.score,
      stablefordPoints: hole.stablefordPoints,
      fairwayHit:       hole.fairwayHit,
      gir:              hole.gir,
      putts:            hole.putts,
    }).catch(() => {});
  }

  function scheduleSubmit(player: 'A' | 'B', playerId: string, hole: HoleEntry) {
    const timers = player === 'A' ? saveTimersA : saveTimersB;
    const idx = hole.holeNumber - 1;
    const existing = timers.current[idx];
    if (existing) clearTimeout(existing);
    timers.current[idx] = setTimeout(() => {
      timers.current[idx] = null;
      submitScore(playerId, hole);
    }, 900);
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    // Cancel any pending debounced saves — the flush below re-sends every scored
    // hole's current state anyway, so a stray timer firing after finish would just
    // be a redundant (harmless but pointless) duplicate.
    for (const timers of [saveTimersA, saveTimersB]) {
      for (let i = 0; i < timers.current.length; i++) {
        if (timers.current[i]) { clearTimeout(timers.current[i]!); timers.current[i] = null; }
      }
    }
    // Every scored hole is re-sent here as a last-resort sync — individual taps during
    // play (submitScore) fire-and-forget and can fail silently on patchy course signal.
    // Unlike that path, failures here are tracked: if any hole still won't save, the
    // player is asked to retry rather than leaving with scores quietly lost.
    const flush = (holes: HoleEntry[], pid: string) =>
      Promise.all(holes.filter(h => h.scored).map(h =>
        client.post(`/api/competitions/${competitionId}/scores`, {
          playerId: pid, holeNumber: h.holeNumber, score: h.score,
          stablefordPoints: h.stablefordPoints,
          fairwayHit: h.fairwayHit, gir: h.gir, putts: h.putts,
        }).then(() => true).catch(() => false)
      ));

    let allOk = true;
    try {
      const tasks: Promise<boolean[]>[] = [flush(holesA, userId)];
      if (partner) tasks.push(flush(holesB, partner.player_id));
      const results = (await Promise.all(tasks)).flat();
      allOk = results.every(Boolean);
    } catch {
      allOk = false;
    } finally {
      setFinishing(false);
    }

    if (!allOk) {
      Alert.alert(
        'Some scores didn\'t save',
        'A poor connection stopped some hole scores from saving. Try again before leaving, or your scorecard may be missing holes.',
        [
          { text: 'Leave anyway', style: 'destructive', onPress: () => navigation.goBack() },
          { text: 'Retry', onPress: handleFinish },
        ]
      );
      return;
    }
    navigation.goBack();
  }

  function adjustScore(player: 'A'|'B', delta: number) {
    const isA      = player === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const ph       = isA ? Math.ceil(userHcp - 0.5) : Math.ceil((Number(partner?.handicap) || 0) - 0.5); // WHS: 0.5 rounds down
    const setter   = isA ? setHolesA : setHolesB;
    setter(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        // First press on an unscored hole snaps to par
        const baseScore = h.scored ? h.score : h.par;
        const newScore  = h.scored ? Math.max(1, baseScore + delta) : baseScore;
        return { ...h, score: newScore, scored: true,
          stablefordPoints: calcStableford(h.par, h.strokeIndex, newScore, ph) };
      });
      scheduleSubmit(player, playerId, next[holeIdx]);
      return next;
    });
  }

  function togglePickup(player: 'A'|'B') {
    const isA          = player === 'A';
    const holesSetter  = isA ? setHolesA : setHolesB;
    const pickedSetter = isA ? setPickedUpA : setPickedUpB;
    const playerId     = isA ? userId : (partner?.player_id ?? userId);

    pickedSetter(prev => {
      const n = [...prev];
      n[holeIdx] = !n[holeIdx];
      const nowPickedUp = n[holeIdx];

      holesSetter(hprev => {
        const next = hprev.map((h, i) => {
          if (i !== holeIdx) return h;
          if (nowPickedUp) {
            // A pick-up forfeits the hole. score: 0 is a deliberate, always-locked
            // sentinel — no real played hole ever has a 0 gross score, so this is
            // what derivePickedUp() reconstructs "picked up" from after a reload.
            return { ...h, score: 0, scored: true, stablefordPoints: 0 };
          }
          // Undo: score is now guaranteed 0 (the pickup sentinel), so there's
          // nothing meaningful to recompute points from — go back to a genuinely
          // unscored hole and let the player enter a real score via the stepper.
          return { ...h, score: 0, scored: false, stablefordPoints: 0 };
        });
        // Only the pickup itself needs saving — undo has nothing new to persist
        // until the player enters an actual score, which submits on its own.
        if (nowPickedUp) scheduleSubmit(player, playerId, next[holeIdx]);
        return next;
      });

      return n;
    });
  }

  // ── Stat tracking for player A (you) ──────────────────────────────────────────
  // These previously only updated local state — if a hole's score was already
  // saved, a FIR/GIR/putts change made afterward never reached the server unless
  // the player also happened to re-tap the score stepper. Now resaves (debounced)
  // whenever the hole already has a score.
  function setFIRA(val: boolean | null) {
    setHolesA(prev => prev.map((h, i) => {
      if (i !== holeIdx) return h;
      const next = { ...h, fairwayHit: val };
      if (next.scored) scheduleSubmit('A', userId, next);
      return next;
    }));
  }
  function setGIRA(val: boolean | null) {
    setHolesA(prev => prev.map((h, i) => {
      if (i !== holeIdx) return h;
      const next = { ...h, gir: val };
      if (next.scored) scheduleSubmit('A', userId, next);
      return next;
    }));
  }
  function adjustPuttsA(delta: number) {
    setHolesA(prev => prev.map((h, i) => {
      if (i !== holeIdx) return h;
      const putts = h.putts === null ? (delta > 0 ? 0 : null) : (h.putts + delta < 0 ? null : h.putts + delta);
      const next = { ...h, putts };
      if (next.scored) scheduleSubmit('A', userId, next);
      return next;
    }));
  }

  // ── Scan scorecard image ────────────────────────────────────────────────────
  function applyScannedScores(target: 'A' | 'B', scores: { hole: number; score: number }[]) {
    const isA      = target === 'A';
    const ph       = isA ? Math.ceil(userHcp - 0.5) : Math.ceil((Number(partner?.handicap) || 0) - 0.5);
    const setter   = isA ? setHolesA : setHolesB;
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    setter(prev => {
      const next = prev.map(h => {
        const found = scores.find(s => s.hole === h.holeNumber);
        if (!found) return h;
        const newScore = found.score;
        return { ...h, score: newScore, scored: true, stablefordPoints: calcStableford(h.par, h.strokeIndex, newScore, ph) };
      });
      next.forEach(h => { if (scores.find(s => s.hole === h.holeNumber)) submitScore(playerId, h); });
      return next;
    });
  }

  async function handleScanScorecard(target: 'A' | 'B') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to scan scorecards.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset     = result.assets[0];
    const mediaType = (asset.mimeType ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    setScanning(true);
    try {
      // Longer timeout than the client default — this uploads a multi-MB base64
      // image and Claude vision analysis takes real time, unlike the tiny score POSTs.
      const { data } = await client.post(`/api/competitions/${competitionId}/scan-scorecard`, {
        imageBase64: asset.base64,
        mediaType,
      }, { timeout: 60000 });
      const scores: { hole: number; score: number }[] = data.scores ?? [];
      if (!scores.length) {
        Alert.alert('No scores found', 'Could not read any scores from this image. Try a clearer photo.');
        return;
      }
      const targetName = target === 'A' ? 'your' : `${personName(partner?.player_first ?? null, partner?.player_last ?? null, partner?.player_email ?? '')}'s`;
      const preview = scores.map(s => `H${s.hole}: ${s.score}`).join('   ');
      Alert.alert(
        `Apply to ${targetName} scorecard?`,
        preview,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Apply', onPress: () => applyScannedScores(target, scores) },
        ]
      );
    } catch (err: any) {
      Alert.alert('Scan failed', err.response?.data?.error ?? 'Could not scan scorecard. Please try again.');
    } finally {
      setScanning(false);
    }
  }

  function promptScanTarget() {
    if (!partner) { handleScanScorecard('A'); return; }
    const partnerName = personName(partner.player_first, partner.player_last, partner.player_email);
    Alert.alert('Scan scorecard for', 'Choose a player', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'You', onPress: () => handleScanScorecard('A') },
      { text: partnerName, onPress: () => handleScanScorecard('B') },
    ]);
  }

  // ── Loading ────────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={G_LIGHT} />
      </View>
    );
  }

  // ── 9 / 18 hole selection ──────────────────────────────────────────────────────
  if (phase === 'ninehole') {
    return (
      <View style={[s.fill, { paddingTop: insets.top }]}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
            <Text style={s.exitBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.topTitle}>Holes</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={s.partnerSubtitle}>How many holes are you playing?</Text>

          <View style={s9.toggleRow}>
            <TouchableOpacity
              style={[s9.toggleBtn, !nineHole && s9.toggleBtnActive]}
              onPress={() => setNineHole(false)}
              activeOpacity={0.8}
            >
              <Text style={[s9.toggleTxt, !nineHole && s9.toggleTxtActive]}>18 Holes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s9.toggleBtn, nineHole && s9.toggleBtnActive]}
              onPress={() => setNineHole(true)}
              activeOpacity={0.8}
            >
              <Text style={[s9.toggleTxt, nineHole && s9.toggleTxtActive]}>9 Holes</Text>
            </TouchableOpacity>
          </View>

          {nineHole && (
            <>
              <Text style={[s.partnerSubtitle, { marginTop: 24 }]}>Which 9?</Text>
              <View style={s9.toggleRow}>
                <TouchableOpacity
                  style={[s9.toggleBtn, nineHoleSide === 'front' && s9.toggleBtnActive]}
                  onPress={() => setNineHoleSide('front')}
                  activeOpacity={0.8}
                >
                  <Text style={[s9.toggleTxt, nineHoleSide === 'front' && s9.toggleTxtActive]}>Front 9 (1–9)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s9.toggleBtn, nineHoleSide === 'back' && s9.toggleBtnActive]}
                  onPress={() => setNineHoleSide('back')}
                  activeOpacity={0.8}
                >
                  <Text style={[s9.toggleTxt, nineHoleSide === 'back' && s9.toggleTxtActive]}>Back 9 (10–18)</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
          <TouchableOpacity style={s9.continueBtn} onPress={confirmNineHoleSelection} activeOpacity={0.85}>
            <LinearGradient colors={['#4e8a27', '#3d6b1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s9.continueBtnGrad}>
              <Text style={s9.continueTx}>Continue →</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Partner / teammate picker ────────────────────────────────────────────────
  if (phase === 'partner') {
    const isBestBall = comp?.format === 'best_ball';
    const others = isBestBall
      ? (comp?.entries ?? []).filter(e => e.player_id !== userId && e.team_id == null)
      : (comp?.entries ?? []).filter(e => e.player_id !== userId);
    return (
      <View style={[s.fill, { paddingTop: insets.top }]}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}
            hitSlop={{ top:12, left:12, bottom:12, right:12 }}>
            <Text style={s.exitBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.topTitle}>{isBestBall ? 'Pick Teammate' : 'Pick Partner'}</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={{ flex:1 }}
          contentContainerStyle={{ padding:16, paddingBottom:40 }}>
          <Text style={s.partnerSubtitle}>
            {isBestBall
              ? "Choose your best-ball teammate. Each hole, the better of your two stableford scores counts for your team."
              : "Choose your playing partner. You'll enter their official scorecard hole by hole."}
          </Text>
          <View style={s.partnerCard}>
            {others.map((e, i) => {
              const nm = personName(e.player_first, e.player_last, e.player_email);
              return (
                <TouchableOpacity
                  key={e.player_id}
                  style={[s.partnerRow,
                    i < others.length - 1 && { borderBottomWidth:1, borderBottomColor:'#eee' }]}
                  onPress={() => handleSelectPartner(e)}
                  disabled={pairing}
                  activeOpacity={0.75}
                >
                  <View style={[s.pAvatar, { backgroundColor: avatarBg(nm) }]}>
                    <Text style={s.pAvatarTx}>{personInitials(e.player_first, e.player_last)}</Text>
                  </View>
                  <View style={{ flex:1 }}>
                    <Text style={s.pName}>{nm}</Text>
                    {e.handicap != null &&
                      <Text style={s.pHcp}>HCP {Number(e.handicap).toFixed(1)}</Text>}
                  </View>
                  {pairing
                    ? <ActivityIndicator color={G_MID} size="small" />
                    : <Ionicons name="chevron-forward" size={18} color="#ccc" />}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={{ alignItems:'center', paddingVertical:14 }}
            onPress={() => setPhase('scoring')}>
            <Text style={s.soloBtn}>{isBestBall ? 'Continue without a team' : 'Continue solo (no marker)'}</Text>
          </TouchableOpacity>
          <Text style={s.soloNote}>
            {isBestBall
              ? "You'll score for yourself only — no best-ball benefit without a teammate."
              : 'Without a marker your score may not count for official competitions.'}
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Live scoring ───────────────────────────────────────────────────────────────
  const hole = holesA[holeIdx];
  if (!hole) return null;

  const holeB  = holesB[holeIdx];
  const phA    = Math.ceil(userHcp - 0.5); // WHS: 0.5 rounds down
  const phB    = Math.ceil((Number(partner?.handicap) || 0) - 0.5);
  const extraA = Math.floor(phA / 18) + (hole.strokeIndex <= phA % 18 ? 1 : 0);
  const extraB = holeB
    ? Math.floor(phB / 18) + (holeB.strokeIndex <= phB % 18 ? 1 : 0)
    : 0;

  const totalPtsA = holesA.reduce((acc, h) => acc + h.stablefordPoints, 0);
  const totalPtsB = holesB.reduce((acc, h) => acc + h.stablefordPoints, 0);

  const myEntry    = comp?.entries.find(e => e.player_id === userId);
  const myInitials = personInitials(myEntry?.player_first ?? null, myEntry?.player_last ?? null);
  const myAvBg     = avatarBg(myEntry ? personName(myEntry.player_first, myEntry.player_last, myEntry.player_email) : 'Me');

  const partnerInitials = partner ? personInitials(partner.player_first, partner.player_last) : '';
  const partnerAvBg     = partner ? avatarBg(personName(partner.player_first, partner.player_last, partner.player_email)) : '';

  const isFirst = holeIdx === 0;
  const isLast  = holeIdx === holesA.length - 1;

  return (
    <View style={s.fill}>

      {/* ── Fixed top nav ──────────────────────────────────────────── */}
      <View style={[s.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.exitWrap}
          onPress={() => navigation.goBack()}
          hitSlop={{ top:12, left:12, bottom:12, right:12 }}>
          <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={s.exitBtn}>Exit</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{comp?.name ?? ''}</Text>
        <LinearGradient colors={['#4e8a27', '#3d6b1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.finishPill}>
          <TouchableOpacity onPress={handleFinish} disabled={finishing}>
            {finishing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.finishTx}>Finish</Text>}
          </TouchableOpacity>
        </LinearGradient>
      </View>

      {/* ── Scrollable content ─────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Hole header */}
        <View style={s.holeHeader}>
          <TouchableOpacity
            style={[s.holeArrow, isFirst && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))}
            disabled={isFirst}
          >
            <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={s.holeLbl}>HOLE</Text>
            <Text style={s.holeNum}>{hole.holeNumber}</Text>
          </View>
          <TouchableOpacity
            style={[s.holeArrow, isLast && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.min(holesA.length - 1, holeIdx + 1))}
            disabled={isLast}
          >
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* Meta pills */}
        <View style={s.metaRow}>
          <View style={s.metaPill}><Text style={s.metaTx}>Par {hole.par}</Text></View>
          <View style={s.metaPill}><Text style={s.metaTx}>SI {hole.strokeIndex}</Text></View>
          {extraA > 0 && (
            <View style={s.shotPill}>
              <View style={s.shotDot} />
              <Text style={s.shotTx}>You get {extraA} shot{extraA > 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>

        {/* Live badge */}
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text style={s.liveTx}>Live · Saving</Text>
        </View>

        {/* ── Player cards ─────────────────────────────────────────── */}
        <View style={s.playersPanel}>
          <PlayerCard
            isYou={true}
            name={personName(myEntry?.player_first ?? null, myEntry?.player_last ?? null, myEntry?.player_email ?? '')}
            initials={myInitials}
            hcp={userHcp}
            avBg={myAvBg}
            isActive={activeCard === 'A'}
            pickedUp={pickedUpA[holeIdx]}
            holeCurrent={hole}
            extra={extraA}
            totalPts={totalPtsA}
            onActivate={() => setActiveCard('A')}
            onAdjust={delta => adjustScore('A', delta)}
            onTogglePickup={() => togglePickup('A')}
          />

          {partner && holeB && (
            <PlayerCard
              isYou={false}
              name={personName(partner.player_first, partner.player_last, partner.player_email)}
              initials={partnerInitials}
              hcp={Number(partner.handicap ?? 0)}
              avBg={partnerAvBg}
              isActive={activeCard === 'B'}
              pickedUp={pickedUpB[holeIdx]}
              holeCurrent={holeB}
              extra={extraB}
              totalPts={totalPtsB}
              onActivate={() => setActiveCard('B')}
              onAdjust={delta => adjustScore('B', delta)}
              onTogglePickup={() => togglePickup('B')}
            />
          )}
        </View>

        {/* ── Scorecard photo upload ─────────────────────────────────── */}
        <TouchableOpacity
          style={s.uploadZone}
          onPress={promptScanTarget}
          disabled={scanning}
          activeOpacity={0.8}
        >
          {scanning ? (
            <>
              <ActivityIndicator size="large" color={G_LIGHT} />
              <Text style={s.uploadZoneTitle}>Reading scorecard…</Text>
              <Text style={s.uploadZoneSub}>AI is extracting your scores</Text>
            </>
          ) : (
            <>
              <View style={s.uploadIconWrap}>
                <Ionicons name="cloud-upload-outline" size={32} color={G_LIGHT} />
              </View>
              <Text style={s.uploadZoneTitle}>Upload Scorecard Photo</Text>
              <Text style={s.uploadZoneSub}>Tap to choose from camera roll — AI reads and enters all scores</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── Mini Scorecard ─────────────────────────────────────────── */}
        <View style={s.scorecardWrap}>
          <View style={s.scorecardHeader}>
            <Text style={s.scorecardTitle}>Scorecard</Text>
            <Text style={s.scorecardHint}>Tap a hole to edit</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 2 }}>
            <View>
              {/* Hole numbers */}
              <View style={s.scRow}>
                <View style={s.scLabelCell} />
                {holesA.map((h, i) => (
                  <TouchableOpacity key={i} style={s.scNumCell} onPress={() => setHoleIdx(i)} activeOpacity={0.7}>
                    <Text style={[s.scNumTx, i === holeIdx && s.scNumTxActive]}>{h.holeNumber}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Player A scores */}
              <View style={s.scRow}>
                <View style={s.scLabelCell}>
                  <Text style={[s.scLabelTx, { color: G_MID }]}>{myInitials || 'Me'}</Text>
                </View>
                {holesA.map((h, i) => (
                  <ScCell key={i} h={h} pickedUp={pickedUpA[i]} isActiveHole={i === holeIdx} onPress={() => setHoleIdx(i)} />
                ))}
              </View>
              {/* Player A points */}
              <View style={[s.scRow, s.scRowDivider]}>
                <View style={s.scLabelCell} />
                {holesA.map((h, i) => (
                  <View key={i} style={s.scPtsCell}>
                    {pickedUpA[i] ? (
                      <Text style={s.scPtsZero}>0</Text>
                    ) : h.scored ? (
                      <Text style={h.stablefordPoints === 0 ? s.scPtsZero : s.scPts}>{h.stablefordPoints}</Text>
                    ) : (
                      <Text style={s.scPtsMuted}>—</Text>
                    )}
                  </View>
                ))}
              </View>
              {/* Player B */}
              {partner && holesB.length > 0 && (<>
                <View style={s.scRow}>
                  <View style={s.scLabelCell}>
                    <Text style={[s.scLabelTx, { color: partnerAvBg }]}>{partnerInitials || 'P2'}</Text>
                  </View>
                  {holesB.map((h, i) => (
                    <ScCell key={i} h={h} pickedUp={pickedUpB[i]} isActiveHole={i === holeIdx} onPress={() => setHoleIdx(i)} />
                  ))}
                </View>
                <View style={[s.scRow, s.scRowDivider]}>
                  <View style={s.scLabelCell} />
                  {holesB.map((h, i) => (
                    <View key={i} style={s.scPtsCell}>
                      {pickedUpB[i] ? (
                        <Text style={s.scPtsZero}>0</Text>
                      ) : h.scored ? (
                        <Text style={h.stablefordPoints === 0 ? s.scPtsZero : s.scPts}>{h.stablefordPoints}</Text>
                      ) : (
                        <Text style={s.scPtsMuted}>—</Text>
                      )}
                    </View>
                  ))}
                </View>
              </>)}
            </View>
          </ScrollView>
          <View style={{ height: 10 }} />
        </View>

        {/* ── Stats (for you / player A) ─────────────────────────────── */}
        <View style={s.statsStack}>

          <View style={s.statCard}>
            <Text style={s.statCardLabel}>Fairway</Text>
            <View style={s.togRow}>
              <TouchableOpacity style={[s.togBtn, hole.fairwayHit === true && s.togBtnHit]}
                onPress={() => setFIRA(hole.fairwayHit === true ? null : true)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.fairwayHit === true && s.togTxHit]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.togBtn, hole.fairwayHit === false && s.togBtnMiss]}
                onPress={() => setFIRA(hole.fairwayHit === false ? null : false)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.fairwayHit === false && s.togTxMiss]}>Miss</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.togBtn, hole.fairwayHit === null && s.togBtnNA]}
                onPress={() => setFIRA(null)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.fairwayHit === null && s.togTxNA]}>N/A</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.statCard}>
            <Text style={s.statCardLabel}>Green in Regulation (GIR)</Text>
            <View style={s.togRow}>
              <TouchableOpacity style={[s.togBtn, hole.gir === true && s.togBtnHit]}
                onPress={() => setGIRA(hole.gir === true ? null : true)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.gir === true && s.togTxHit]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.togBtn, hole.gir === false && s.togBtnMiss]}
                onPress={() => setGIRA(hole.gir === false ? null : false)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.gir === false && s.togTxMiss]}>Miss</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.togBtn, hole.gir === null && s.togBtnNA]}
                onPress={() => setGIRA(null)} activeOpacity={0.8}>
                <Text style={[s.togBtnTx, hole.gir === null && s.togTxNA]}>N/A</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.statCard}>
            <View style={s.puttsTop}>
              <Text style={s.statCardLabel}>Putts</Text>
              {hole.putts !== null && hole.scored && (
                <Text style={s.puttsHint}>on green in {hole.score - hole.putts}</Text>
              )}
            </View>
            <View style={s.puttsControls}>
              <TouchableOpacity style={s.puttsCircBtn} onPress={() => adjustPuttsA(-1)} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
                <Ionicons name="remove" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
              <Text style={s.puttsNum}>{hole.putts === null ? '—' : hole.putts}</Text>
              <TouchableOpacity style={s.puttsCircBtn} onPress={() => adjustPuttsA(+1)} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
                <Ionicons name="add" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          </View>

        </View>

        {/* ── Next / Review Hole button ─────────────────────────────── */}
        <View style={s.nextWrap}>
          <LinearGradient colors={['#4e8a27', '#3d6b1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.nextGrad}>
            <TouchableOpacity
              style={s.nextBtn}
              onPress={isLast ? handleFinish : () => setHoleIdx(holeIdx + 1)}
              activeOpacity={0.88}
            >
              <Text style={s.nextBtnTx}>{isLast ? 'Finish Round' : 'Next Hole'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" style={{ marginLeft: 10 }} />
            </TouchableOpacity>
          </LinearGradient>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  fill:        { flex: 1, backgroundColor: BG },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },

  // ── Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  exitWrap:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  exitBtn:   { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  topTitle:  { flex: 1, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '700', paddingHorizontal: 8, letterSpacing: -0.2 },
  finishPill:{ borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden' },
  finishTx:  { color: '#fff', fontSize: 13, fontWeight: '700' },

  // ── Hole header
  holeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingBottom: 0,
  },
  holeArrow: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  holeLbl: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  holeNum: { color: '#fff', fontSize: 48, fontWeight: '800', lineHeight: 52, textAlign: 'center', letterSpacing: -2 },

  // ── Meta pills
  metaRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  metaPill: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },
  metaTx:   { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  shotPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(168,224,99,0.15)',
    borderWidth: 1, borderColor: 'rgba(168,224,99,0.25)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
  },
  shotDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#a8e063' },
  shotTx:   { color: '#a8e063', fontSize: 12, fontWeight: '600' },

  // ── Live badge (centered)
  liveBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 10 },
  liveDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a8e063' },
  liveTx:    { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  // ── Players panel
  playersPanel: { paddingHorizontal: 12, gap: 10 },

  // ── Player card (white)
  card: {
    backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  cardActive: { borderWidth: 1.5, borderColor: 'rgba(168,224,99,0.4)' },
  cardDimmed: { opacity: 0.6 },

  cardHeader:   {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 16,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  cardAvatar:   { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  cardAvatarTx: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardName:     { fontSize: 14, fontWeight: '700', color: '#1a1a1a', letterSpacing: -0.2 },
  cardHcp:      { fontSize: 11, color: '#bbb', marginTop: 1 },
  youTx:        { fontSize: 11, fontWeight: '600', color: G_MID },

  totalBadge:    { backgroundColor: '#f5f2ed', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  totalBadgePts: { fontSize: 12, fontWeight: '700', color: '#555' },

  cardBody: { paddingHorizontal: 16, paddingVertical: 14 },

  // ── Dial
  dialRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 12 },
  dialBtn:    { width: 56, height: 56, borderRadius: 28, backgroundColor: '#f7f5f1', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.12)', justifyContent: 'center', alignItems: 'center' },
  dialCenter: { alignItems: 'center', minWidth: 100 },
  dialScore:  { fontSize: 52, fontWeight: '800', lineHeight: 56, letterSpacing: -2 },
  dialOutcome:{ fontSize: 12, fontWeight: '600', marginTop: 2 },
  dialNet:    { fontSize: 10, color: '#bbb', marginTop: 1 },

  // ── Stat tiles
  statTiles:      { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statTileNeutral:{ flex: 1, backgroundColor: '#f7f5f1', borderRadius: 12, padding: 9, alignItems: 'center' },
  statTileDark:   { flex: 1, borderRadius: 12, padding: 9, alignItems: 'center' },
  statTileVal:    { fontSize: 18, fontWeight: '800', color: '#1a1a1a', letterSpacing: -0.5, lineHeight: 20 },
  statTileLbl:    { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: '#bbb', marginBottom: 3 },

  // ── Pick up (on white card)
  puBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5, borderColor: 'rgba(192,57,43,0.25)', borderRadius: 12, paddingVertical: 10, backgroundColor: 'rgba(192,57,43,0.05)' },
  puBtnUndo:  { borderColor: 'rgba(0,0,0,0.12)', backgroundColor: '#f7f5f1' },
  puBtnTx:    { color: '#c0392b', fontSize: 13, fontWeight: '700' },
  puBtnUndoTx:{ color: '#888' },

  // ── Scorecard (white card)
  scorecardWrap: {
    backgroundColor: '#fff', borderRadius: 18, marginHorizontal: 12, marginTop: 12, overflow: 'hidden',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  scorecardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  scorecardTitle:  { fontSize: 11, fontWeight: '700', color: '#aaa', letterSpacing: 0.6, textTransform: 'uppercase' },
  scorecardHint:   { fontSize: 11, color: '#bbb', fontWeight: '500' },

  uploadZone: {
    marginHorizontal: 12, marginTop: 12, borderRadius: 18,
    borderWidth: 1.5, borderColor: 'rgba(78,138,39,0.35)', borderStyle: 'dashed',
    backgroundColor: 'rgba(78,138,39,0.07)',
    paddingVertical: 24, alignItems: 'center', gap: 6,
  },
  uploadIconWrap:  { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(78,138,39,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  uploadZoneTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  uploadZoneSub:   { color: 'rgba(255,255,255,0.45)', fontSize: 12, textAlign: 'center', paddingHorizontal: 32, lineHeight: 17 },

  scRow:       { flexDirection: 'row', alignItems: 'center' },
  scRowDivider:{ borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  scLabelCell: { width: 28, paddingLeft: 14 },
  scLabelTx:   { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: '#ccc' },
  scNumCell:   { width: 32, height: 26, alignItems: 'center', justifyContent: 'center' },
  scNumTx:     { fontSize: 10, fontWeight: '700', color: '#1a1a1a' },
  scNumTxActive:{ color: G_MID },

  scCell:         { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  scCellActiveGrad: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  scCellActiveTx: { color: '#fff', fontSize: 11, fontWeight: '800' },
  scPuCell:       { width: 24, height: 24, borderRadius: 4, backgroundColor: 'rgba(192,57,43,0.07)', justifyContent: 'center', alignItems: 'center' },
  scPuTx:         { color: '#c0392b', fontSize: 9, fontWeight: '800' },
  scUnscored:     { color: '#ddd', fontSize: 11 },
  scParTx:        { color: '#aaa', fontSize: 11, fontWeight: '600' },
  scCircle:       { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  scCircleTx:     { color: '#fff', fontSize: 10, fontWeight: '700' },
  scSquare:       { width: 24, height: 24, borderRadius: 4, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', justifyContent: 'center', alignItems: 'center' },
  scDblSquare:    { width: 24, height: 24, borderRadius: 4, borderWidth: 1.5, borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.07)', justifyContent: 'center', alignItems: 'center' },
  scSquareTx:     { fontSize: 10, fontWeight: '700', color: '#666' },
  scPtsCell:      { width: 32, height: 20, alignItems: 'center', justifyContent: 'center' },
  scPts:          { fontSize: 10, fontWeight: '700', color: G_MID },
  scPtsZero:      { fontSize: 10, fontWeight: '700', color: '#c0392b' },
  scPtsMuted:     { fontSize: 10, fontWeight: '600', color: '#ccc' },

  // ── Stats section (dark cards)
  statsStack: { gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  statCard: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', padding: 14,
  },
  statCardLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 },
  togRow:    { flexDirection: 'row', gap: 8 },
  togBtn:    { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.06)' },
  togBtnHit: { backgroundColor: 'rgba(61,107,31,0.2)', borderColor: 'rgba(168,224,99,0.4)' },
  togBtnMiss:{ backgroundColor: 'rgba(192,57,43,0.12)', borderColor: 'rgba(192,57,43,0.35)' },
  togBtnNA:  { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' },
  togBtnTx:  { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  togTxHit:  { color: '#a8e063' },
  togTxMiss: { color: '#ff8a7a' },
  togTxNA:   { color: 'rgba(255,255,255,0.3)' },

  puttsTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  puttsHint:     { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  puttsControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  puttsCircBtn:  { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  puttsNum:      { fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 44, minWidth: 48, textAlign: 'center' },

  // ── Next button
  nextWrap: { paddingHorizontal: 12, paddingTop: 10 },
  nextGrad: { borderRadius: 16, overflow: 'hidden' },
  nextBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  nextBtnTx:{ fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },

  // ── Partner picker
  partnerSubtitle: { color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19, marginBottom: 20 },
  partnerCard:     { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  partnerRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  pAvatar:         { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  pAvatarTx:       { color: '#fff', fontSize: 14, fontWeight: '700' },
  pName:           { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  pHcp:            { fontSize: 12, color: '#999', marginTop: 2 },
  soloBtn:         { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '500' },
  soloNote:        { fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', paddingHorizontal: 24, lineHeight: 17 },
});

// ── 9-hole selection styles ─────────────────────────────────────────────────────
const s9 = StyleSheet.create({
  toggleRow:       { flexDirection: 'row', gap: 10 },
  toggleBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
  toggleBtnActive: { borderColor: G_LIGHT, backgroundColor: G_LIGHT + '22' },
  toggleTxt:       { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  toggleTxtActive: { color: '#fff', fontWeight: '700' },
  continueBtn:     { borderRadius: 16, overflow: 'hidden' },
  continueBtnGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 16 },
  continueTx:      { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
