import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
    const score = ex?.score ?? h.par;
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
    <TouchableOpacity
      style={[s.scCell, isActiveHole && s.scCellActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {isActiveHole ? (
        <Text style={s.scCellActiveTx}>{h.score}</Text>
      ) : pickedUp ? (
        <Text style={s.scPuTx}>PU</Text>
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
  const h     = holeCurrent;
  const sc    = scoreColor(h.score, h.par);
  const label = outcomeLabel(h.score, h.par);
  const net   = h.score - extra;

  return (
    <TouchableOpacity
      activeOpacity={0.95}
      onPress={onActivate}
      style={[s.card, isActive && s.cardActive, pickedUp && s.cardDimmed]}
    >
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.cardAvatar, { backgroundColor: avBg }]}>
          <Text style={s.cardAvatarTx}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.cardName}>{name}</Text>
            {isYou
              ? <View style={s.youPill}><Text style={s.youPillTx}>You</Text></View>
              : <View style={s.markPill}><Text style={s.markPillTx}>Marking</Text></View>}
          </View>
          <Text style={s.cardHcp}>HCP {hcp.toFixed(1)}</Text>
        </View>
        <View style={s.totalBadge}>
          <Text style={s.totalBadgePts}>{totalPts}</Text>
          <Text style={s.totalBadgeLbl}>pts</Text>
        </View>
      </View>

      {/* Dial or picked-up indicator */}
      {!pickedUp ? (
        <View style={s.dialRow}>
          <TouchableOpacity style={s.dialBtn} onPress={() => onAdjust(-1)} activeOpacity={0.7}>
            <Text style={s.dialBtnTx}>−</Text>
          </TouchableOpacity>
          <View style={s.dialCenter}>
            <Text style={[s.dialScore, { color: sc }]}>{h.score}</Text>
            <Text style={[s.dialOutcome, { color: sc }]}>{label}</Text>
            <Text style={s.dialNet}>Net {net}</Text>
          </View>
          <TouchableOpacity style={s.dialBtn} onPress={() => onAdjust(+1)} activeOpacity={0.7}>
            <Text style={s.dialBtnTx}>+</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.puRow}>
          <View style={s.puBadge}><Text style={s.puBadgeTx}>PICKED UP</Text></View>
        </View>
      )}

      {/* Stat tiles */}
      <View style={s.statTiles}>
        <View style={s.statTileNeutral}>
          <Text style={s.statTileVal}>{h.score}</Text>
          <Text style={s.statTileLbl}>Shots</Text>
        </View>
        <LinearGradient
          colors={[G_MID, G_LIGHT]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.statTileGreen}
        >
          <Text style={[s.statTileVal, { color: '#fff' }]}>{h.scored ? h.stablefordPoints : '—'}</Text>
          <Text style={[s.statTileLbl, { color: 'rgba(255,255,255,0.8)' }]}>Points</Text>
        </LinearGradient>
        <LinearGradient
          colors={[G_DARK, G_MID]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.statTileDark}
        >
          <Text style={[s.statTileVal, { color: '#fff' }]}>{totalPts}</Text>
          <Text style={[s.statTileLbl, { color: 'rgba(255,255,255,0.7)' }]}>Total</Text>
        </LinearGradient>
      </View>

      {/* Pick up button */}
      <TouchableOpacity
        style={[s.puBtn, pickedUp && s.puBtnUndo]}
        onPress={onTogglePickup}
        activeOpacity={0.8}
      >
        <Text style={[s.puBtnTx, pickedUp && s.puBtnUndoTx]}>
          {pickedUp ? 'Undo pick up' : 'Pick up'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function TournamentScoringScreen({ navigation, route }: Props) {
  const { competitionId, userId } = route.params;
  const insets = useSafeAreaInsets();

  const [phase,      setPhase]      = useState<'loading'|'partner'|'scoring'>('loading');
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

  useEffect(() => {
    Promise.all([
      client.get<CompDetail>(`/api/competitions/${competitionId}`),
      client.get<{ handicap: number | null }>('/api/users/profile'),
    ]).then(([compRes, profileRes]) => {
      const c   = compRes.data;
      const hcp = Number(profileRes.data.handicap) || 0;
      setComp(c);
      setUserHcp(hcp);
      navigation.setOptions({ title: c.name });

      const ph = Math.round(hcp);
      setHolesA(buildHoles(c.hole_data, ph, c.myScorecard?.selfScores ?? []));

      let partnerEntry: EntryRow | null = null;
      if (c.myEntry?.scorer_id) {
        partnerEntry = c.entries.find(e => e.player_id === c.myEntry!.scorer_id) ?? null;
      } else if (c.scoringFor) {
        partnerEntry = c.entries.find(e => e.player_id === c.scoringFor!.player_id) ?? null;
      }

      if (partnerEntry) {
        const pHcp = Math.round(Number(partnerEntry.handicap) || 0);
        setPartner(partnerEntry);
        setHolesB(buildHoles(c.hole_data, pHcp, c.partnerScorecard?.markerScores ?? []));
        setPhase('scoring');
      } else {
        const others = c.entries.filter(e => e.player_id !== userId);
        setPhase(others.length > 0 ? 'partner' : 'scoring');
      }
    }).catch(() => {
      Alert.alert('Error', 'Could not load competition');
      navigation.goBack();
    });
  }, [competitionId, userId]);

  async function handleSelectPartner(entry: EntryRow) {
    setPairing(true);
    try {
      await client.post(`/api/competitions/${competitionId}/partner`, { partnerId: entry.player_id });
      const pHcp = Math.round(Number(entry.handicap) || 0);
      setPartner(entry);
      setHolesB(buildHoles(comp!.hole_data, pHcp, []));
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

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    const flush = (holes: HoleEntry[], pid: string) =>
      Promise.all(holes.map(h => client.post(`/api/competitions/${competitionId}/scores`, {
        playerId: pid, holeNumber: h.holeNumber, score: h.score,
        stablefordPoints: h.stablefordPoints,
        fairwayHit: h.fairwayHit, gir: h.gir, putts: h.putts,
      }).catch(() => {})));
    try {
      const tasks: Promise<any>[] = [flush(holesA, userId)];
      if (partner) tasks.push(flush(holesB, partner.player_id));
      await Promise.all(tasks);
    } catch { /* best-effort */ } finally { setFinishing(false); }
    navigation.goBack();
  }

  function adjustScore(player: 'A'|'B', delta: number) {
    const isA      = player === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const ph       = isA ? Math.round(userHcp) : Math.round(Number(partner?.handicap) || 0);
    const setter   = isA ? setHolesA : setHolesB;
    setter(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        const newScore = Math.max(1, h.score + delta);
        return { ...h, score: newScore, scored: true,
          stablefordPoints: calcStableford(h.par, h.strokeIndex, newScore, ph) };
      });
      submitScore(playerId, next[holeIdx]);
      return next;
    });
  }

  function togglePickup(player: 'A'|'B') {
    const setter = player === 'A' ? setPickedUpA : setPickedUpB;
    setter(prev => { const n = [...prev]; n[holeIdx] = !n[holeIdx]; return n; });
  }

  // ── Loading ────────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={G_LIGHT} />
      </View>
    );
  }

  // ── Partner picker ─────────────────────────────────────────────────────────────
  if (phase === 'partner') {
    const others = (comp?.entries ?? []).filter(e => e.player_id !== userId);
    return (
      <View style={[s.fill, { paddingTop: insets.top }]}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}
            hitSlop={{ top:12, left:12, bottom:12, right:12 }}>
            <Text style={s.exitBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.topTitle}>Pick Partner</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={{ flex:1 }}
          contentContainerStyle={{ padding:16, paddingBottom:40 }}>
          <Text style={s.partnerSubtitle}>
            Choose your playing partner. You'll enter their official scorecard hole by hole.
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
            <Text style={s.soloBtn}>Continue solo (no marker)</Text>
          </TouchableOpacity>
          <Text style={s.soloNote}>
            Without a marker your score may not count for official competitions.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Live scoring ───────────────────────────────────────────────────────────────
  const hole = holesA[holeIdx];
  if (!hole) return null;

  const holeB  = holesB[holeIdx];
  const phA    = Math.round(userHcp);
  const phB    = Math.round(Number(partner?.handicap) || 0);
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

  return (
    <View style={s.fill}>
      {/* ── Fixed top ──────────────────────────────────────────────── */}
      <View style={{ paddingTop: insets.top, backgroundColor: BG }}>

        {/* Header bar */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.exitWrap}
            onPress={() => navigation.goBack()}
            hitSlop={{ top:12, left:12, bottom:12, right:12 }}>
            <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
            <Text style={s.exitBtn}>Exit</Text>
          </TouchableOpacity>
          <Text style={s.topTitle} numberOfLines={1}>{comp?.course_name ?? ''}</Text>
          <TouchableOpacity style={s.finishPill} onPress={handleFinish} disabled={finishing}>
            {finishing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.finishTx}>Finish</Text>}
          </TouchableOpacity>
        </View>

        {/* Live badge */}
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text style={s.liveTx}>Live · Saving</Text>
        </View>

        {/* Hole header */}
        <View style={s.holeHeader}>
          <TouchableOpacity
            style={[s.holeArrow, holeIdx === 0 && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))}
            disabled={holeIdx === 0}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>

          <View style={{ alignItems: 'center' }}>
            <Text style={s.holeLbl}>HOLE</Text>
            <Text style={s.holeNum}>{hole.holeNumber}</Text>
          </View>

          <TouchableOpacity
            style={[s.holeArrow, holeIdx === 17 && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.min(17, holeIdx + 1))}
            disabled={holeIdx === 17}
          >
            <Ionicons name="chevron-forward" size={22} color="#fff" />
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
      </View>

      {/* ── Scrollable cards + scorecard ───────────────────────────── */}
      <ScrollView
        style={{ flex: 1, backgroundColor: BG }}
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: insets.bottom + 90,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Player A card */}
        <PlayerCard
          isYou={true}
          name="You"
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

        {/* Player B card */}
        {partner && holeB && (
          <>
            <View style={{ height: 10 }} />
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
          </>
        )}

        {/* ── Mini Scorecard ─────────────────────────────────────── */}
        <View style={s.scorecardWrap}>
          <View style={s.scorecardHeader}>
            <Text style={s.scorecardTitle}>SCORECARD</Text>
            <Text style={s.scorecardHint}>Tap a hole to edit</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Hole numbers row */}
              <View style={s.scRow}>
                <View style={s.scLabelCell}>
                  <Text style={s.scLabelTx}>Hole</Text>
                </View>
                {holesA.map((h, i) => (
                  <TouchableOpacity
                    key={i}
                    style={s.scNumCell}
                    onPress={() => setHoleIdx(i)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.scNumTx, i === holeIdx && s.scNumTxActive]}>
                      {h.holeNumber}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Player A scores */}
              <View style={s.scRow}>
                <View style={s.scLabelCell}>
                  <Text style={s.scLabelTx}>{myInitials || 'Me'}</Text>
                </View>
                {holesA.map((h, i) => (
                  <ScCell
                    key={i}
                    h={h}
                    pickedUp={pickedUpA[i]}
                    isActiveHole={i === holeIdx}
                    onPress={() => setHoleIdx(i)}
                  />
                ))}
              </View>

              {/* Player A points */}
              <View style={[s.scRow, { marginBottom: partner ? 6 : 0 }]}>
                <View style={s.scLabelCell}>
                  <Text style={[s.scLabelTx, { color: G_LIGHT }]}>Pts</Text>
                </View>
                {holesA.map((h, i) => (
                  <View key={i} style={s.scPtsCell}>
                    <Text style={[s.scPtsTx, i === holeIdx && { color: G_MID, fontWeight: '700' }]}>
                      {pickedUpA[i] ? '—' : h.scored ? h.stablefordPoints : '—'}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Player B scores + points */}
              {partner && holesB.length > 0 && (<>
                <View style={s.scRow}>
                  <View style={s.scLabelCell}>
                    <Text style={s.scLabelTx}>{partnerInitials || 'P2'}</Text>
                  </View>
                  {holesB.map((h, i) => (
                    <ScCell
                      key={i}
                      h={h}
                      pickedUp={pickedUpB[i]}
                      isActiveHole={i === holeIdx}
                      onPress={() => setHoleIdx(i)}
                    />
                  ))}
                </View>
                <View style={s.scRow}>
                  <View style={s.scLabelCell}>
                    <Text style={[s.scLabelTx, { color: G_LIGHT }]}>Pts</Text>
                  </View>
                  {holesB.map((h, i) => (
                    <View key={i} style={s.scPtsCell}>
                      <Text style={[s.scPtsTx, i === holeIdx && { color: G_MID, fontWeight: '700' }]}>
                        {pickedUpB[i] ? '—' : h.scored ? h.stablefordPoints : '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              </>)}
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      {/* ── Bottom nav ─────────────────────────────────────────────── */}
      <View style={[s.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={s.navItem}>
          <Ionicons name="trophy-outline" size={20} color="rgba(0,0,0,0.35)" />
          <Text style={s.navItemTx}>Leaderboard</Text>
        </View>
        <View style={s.navItem}>
          <Ionicons name="map-outline" size={20} color="rgba(0,0,0,0.35)" />
          <Text style={s.navItemTx}>Map</Text>
        </View>
        <LinearGradient
          colors={[G_MID, G_LIGHT]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.navCenterBtn}
        >
          <Ionicons name="golf-outline" size={22} color="#fff" />
        </LinearGradient>
        <View style={s.navItem}>
          <Ionicons name="people-outline" size={20} color="rgba(0,0,0,0.35)" />
          <Text style={s.navItemTx}>Group</Text>
        </View>
        <View style={s.navItem}>
          <Ionicons name="ellipsis-horizontal-outline" size={20} color="rgba(0,0,0,0.35)" />
          <Text style={s.navItemTx}>More</Text>
        </View>
      </View>
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
    paddingHorizontal: 16, paddingVertical: 10,
  },
  exitWrap:  { flexDirection: 'row', alignItems: 'center', gap: 4, width: 64 },
  exitBtn:   { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500' },
  topTitle:  {
    flex: 1, textAlign: 'center', color: '#fff',
    fontSize: 15, fontWeight: '700', paddingHorizontal: 8,
  },
  finishPill: {
    backgroundColor: G_MID, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 7,
    minWidth: 64, alignItems: 'center',
  },
  finishTx:  { color: '#fff', fontSize: 13, fontWeight: '700' },

  // ── Live badge
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 4 },
  liveDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: G_LIGHT },
  liveTx:    { color: G_LIGHT, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // ── Hole header
  holeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 32, paddingVertical: 6,
  },
  holeArrow: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  holeLbl: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  holeNum: { color: '#fff', fontSize: 52, fontWeight: '800', lineHeight: 58, textAlign: 'center' },

  // ── Meta pills
  metaRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 12 },
  metaPill: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  metaTx:   { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  shotPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: G_MID + 'cc', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
  },
  shotDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: G_LIGHT },
  shotTx:   { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ── Player card
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardActive: { borderColor: G_MID },
  cardDimmed: { opacity: 0.6 },

  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  cardAvatar:   { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  cardAvatarTx: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardName:     { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  cardHcp:      { fontSize: 12, color: '#999', marginTop: 2 },

  youPill:    { backgroundColor: '#eef5e8', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  youPillTx:  { fontSize: 10, fontWeight: '700', color: G_MID },
  markPill:   { backgroundColor: '#e8f0f7', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  markPillTx: { fontSize: 10, fontWeight: '700', color: '#4a7a9b' },

  totalBadge:    { alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  totalBadgePts: { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  totalBadgeLbl: { fontSize: 10, color: '#999', fontWeight: '600', letterSpacing: 0.5 },

  // ── Dial
  dialRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  dialBtn:    { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  dialBtnTx:  { fontSize: 34, fontWeight: '300', color: '#333', lineHeight: 42 },
  dialCenter: { alignItems: 'center', flex: 1 },
  dialScore:  { fontSize: 52, fontWeight: '800', lineHeight: 58 },
  dialOutcome:{ fontSize: 13, fontWeight: '600', marginTop: -2 },
  dialNet:    { fontSize: 12, color: '#bbb', marginTop: 3 },

  // ── Picked up
  puRow:      { justifyContent: 'center', alignItems: 'center', paddingVertical: 14, marginBottom: 14 },
  puBadge:    { backgroundColor: '#fdecea', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  puBadgeTx:  { color: '#c0392b', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  puBtn:      { borderWidth: 1.5, borderColor: '#c0392b', borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginTop: 2 },
  puBtnUndo:  { borderColor: '#bbb', backgroundColor: '#f8f8f8' },
  puBtnTx:    { color: '#c0392b', fontSize: 13, fontWeight: '600' },
  puBtnUndoTx:{ color: '#888' },

  // ── Stat tiles
  statTiles:     { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statTileNeutral:{ flex: 1, backgroundColor: '#f7f7f7', borderRadius: 12, padding: 10, alignItems: 'center' },
  statTileGreen: { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  statTileDark:  { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  statTileVal:   { fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  statTileLbl:   { fontSize: 10, color: '#999', fontWeight: '600', letterSpacing: 0.5, marginTop: 1 },

  // ── Scorecard
  scorecardWrap: {
    backgroundColor: '#fff', borderRadius: 20, padding: 14, marginTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  scorecardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  scorecardTitle:  { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 1.5 },
  scorecardHint:   { fontSize: 11, color: '#ccc' },

  scRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  scLabelCell:   { width: 32, alignItems: 'flex-start' },
  scLabelTx:     { fontSize: 11, fontWeight: '700', color: '#aaa' },
  scNumCell:     { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  scNumTx:       { fontSize: 11, fontWeight: '600', color: '#bbb' },
  scNumTxActive: { color: G_MID, fontWeight: '800' },

  scCell:          { width: 30, height: 28, alignItems: 'center', justifyContent: 'center' },
  scCellActive:    { backgroundColor: G_MID, borderRadius: 6 },
  scCellActiveTx:  { color: '#fff', fontSize: 12, fontWeight: '800' },
  scPuTx:          { color: '#c0392b', fontSize: 10, fontWeight: '700' },
  scUnscored:      { color: '#ddd', fontSize: 12 },
  scParTx:         { color: '#666', fontSize: 12, fontWeight: '600' },
  scCircle:        { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  scCircleTx:      { color: '#fff', fontSize: 11, fontWeight: '700' },
  scSquare:        { width: 22, height: 22, borderRadius: 3, borderWidth: 1.5, borderColor: '#999', justifyContent: 'center', alignItems: 'center' },
  scDblSquare:     { width: 22, height: 22, borderRadius: 3, borderWidth: 2, borderColor: '#c0392b', justifyContent: 'center', alignItems: 'center' },
  scSquareTx:      { fontSize: 11, fontWeight: '700', color: '#999' },
  scPtsCell:       { width: 30, height: 20, alignItems: 'center', justifyContent: 'center' },
  scPtsTx:         { fontSize: 10, fontWeight: '600', color: '#ccc' },

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

  // ── Bottom nav
  bottomNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: 8,
  },
  navItem:     { alignItems: 'center', gap: 3, minWidth: 52 },
  navItemTx:   { fontSize: 10, color: 'rgba(0,0,0,0.35)', fontWeight: '500' },
  navCenterBtn: {
    width: 54, height: 54, borderRadius: 27,
    justifyContent: 'center', alignItems: 'center',
    marginTop: -14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 5, elevation: 5,
  },
});
