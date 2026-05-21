import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TournamentScoring'>;
  route: { params: { competitionId: number; userId: string } };
};

// ── Types ─────────────────────────────────────────────────────────────────────

type EntryRow = {
  player_id: string;
  player_first: string | null;
  player_last: string | null;
  player_email: string;
  handicap: number | null;
  scorer_id: string | null;
};

type HoleRaw = { number: number; par: number; si: number };

type ScoreRecord = { hole_number: number; score: number; stableford_points: number };

type CompDetail = {
  id: number;
  name: string;
  format: string;
  course_name: string;
  status: string;
  hole_data: HoleRaw[] | null;
  entries: EntryRow[];
  myEntry: EntryRow | null;
  scoringFor: EntryRow | null;
  myScorecard: { selfScores: ScoreRecord[]; markerScores: ScoreRecord[] } | null;
  partnerScorecard: { markerScores: ScoreRecord[]; selfScores: ScoreRecord[] } | null;
};

type HoleEntry = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  score: number;
  stablefordPoints: number;
  fairwayHit: boolean | null;
  gir: boolean | null;
  putts: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const HOLE_WORDS = [
  'ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE',
  'TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN',
];
function holeWord(n: number) { return HOLE_WORDS[n - 1] ?? String(n); }

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function personInitials(first: string | null, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}

function calcStableford(par: number, si: number, score: number, ph: number): number {
  const extra = Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0);
  return Math.max(0, 2 + par + extra - score);
}

function scoreColor(score: number, par: number): string {
  const d = score - par;
  if (d <= -2) return '#f59e0b';
  if (d === -1) return '#3b82f6';
  if (d === 0)  return colors.primary;
  if (d === 1)  return '#f97316';
  return colors.danger;
}

function buildHoles(holeData: HoleRaw[] | null, ph: number, existing: ScoreRecord[]): HoleEntry[] {
  const scoreMap = new Map(existing.map(s => [s.hole_number, s]));
  const rawHoles: Array<{ holeNumber: number; par: number; strokeIndex: number }> =
    holeData && holeData.length === 18
      ? holeData.map(h => ({ holeNumber: h.number, par: h.par, strokeIndex: h.si }))
      : Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

  return rawHoles.map(h => {
    const ex = scoreMap.get(h.holeNumber);
    const score = ex?.score ?? h.par;
    return {
      ...h,
      score,
      stablefordPoints: ex?.stableford_points ?? calcStableford(h.par, h.strokeIndex, score, ph),
      fairwayHit: null,
      gir: null,
      putts: 2,
    };
  });
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TournamentScoringScreen({ navigation, route }: Props) {
  const { competitionId, userId } = route.params;
  const insets = useSafeAreaInsets();

  const [phase,   setPhase]   = useState<'loading' | 'partner' | 'scoring'>('loading');
  const [comp,    setComp]    = useState<CompDetail | null>(null);
  const [userHcp, setUserHcp] = useState(0);
  const [partner, setPartner] = useState<EntryRow | null>(null);
  const [pairing, setPairing] = useState(false);

  const [currentPlayer, setCurrentPlayer] = useState<'A' | 'B'>('A');
  const [holesA, setHolesA] = useState<HoleEntry[]>([]);
  const [holesB, setHolesB] = useState<HoleEntry[]>([]);
  const [holeIdx, setHoleIdx] = useState(0);

  // Load competition + user profile
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

      // Determine if we already have a partner
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
    } finally {
      setPairing(false);
    }
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

  function adjustFIR(val: boolean | null) {
    const isA = currentPlayer === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const setter = isA ? setHolesA : setHolesB;
    setter(prev => {
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, fairwayHit: val });
      submitScore(playerId, next[holeIdx]);
      return next;
    });
  }

  function adjustGIR(val: boolean | null) {
    const isA = currentPlayer === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const setter = isA ? setHolesA : setHolesB;
    setter(prev => {
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, gir: val });
      submitScore(playerId, next[holeIdx]);
      return next;
    });
  }

  function adjustPutts(delta: number) {
    const isA = currentPlayer === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const setter = isA ? setHolesA : setHolesB;
    setter(prev => {
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, putts: Math.max(0, h.putts + delta) });
      submitScore(playerId, next[holeIdx]);
      return next;
    });
  }

  function adjustScore(delta: number) {
    const isA     = currentPlayer === 'A';
    const playerId = isA ? userId : (partner?.player_id ?? userId);
    const ph       = isA ? Math.round(userHcp) : Math.round(Number(partner?.handicap) || 0);
    const setter   = isA ? setHolesA : setHolesB;

    setter(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        const s = Math.max(1, h.score + delta);
        return { ...h, score: s, stablefordPoints: calcStableford(h.par, h.strokeIndex, s, ph) };
      });
      submitScore(playerId, next[holeIdx]);
      return next;
    });
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Partner picker ────────────────────────────────────────────────────────────

  if (phase === 'partner') {
    const otherEntries = (comp?.entries ?? []).filter(e => e.player_id !== userId);
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
            <Text style={styles.exitText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pick Partner</Text>
          <View style={{ width: 56 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.partnerContent}>
          <Text style={styles.partnerSubtitle}>
            Choose your playing partner. You'll enter their official scorecard hole by hole — and they'll mark yours. The score you enter for them is the one that counts in the competition.
          </Text>

          <View style={styles.partnerList}>
            {otherEntries.map((e, i) => (
              <TouchableOpacity
                key={e.player_id}
                style={[styles.partnerRow, i < otherEntries.length - 1 && styles.partnerRowBorder]}
                onPress={() => handleSelectPartner(e)}
                disabled={pairing}
                activeOpacity={0.75}
              >
                <View style={styles.partnerAvatar}>
                  <Text style={styles.partnerAvatarText}>
                    {personInitials(e.player_first, e.player_last)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.partnerName}>
                    {personName(e.player_first, e.player_last, e.player_email)}
                  </Text>
                  {e.handicap != null && (
                    <Text style={styles.partnerHcp}>HCP {Number(e.handicap).toFixed(1)}</Text>
                  )}
                </View>
                {pairing
                  ? <ActivityIndicator color={colors.primary} size="small" />
                  : <Ionicons name="chevron-forward" size={18} color={colors.border} />
                }
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.skipBtn} onPress={() => setPhase('scoring')}>
            <Text style={styles.skipBtnText}>Continue solo (no marker)</Text>
          </TouchableOpacity>
          <Text style={styles.skipNote}>
            Note: without a marker your score may not count for official competitions.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Live scoring ──────────────────────────────────────────────────────────────

  const holes   = currentPlayer === 'A' ? holesA : holesB;
  const hole    = holes[holeIdx];
  if (!hole) return null;

  const ph        = currentPlayer === 'A' ? Math.round(userHcp) : Math.round(Number(partner?.handicap) || 0);
  const extra     = Math.floor(ph / 18) + (hole.strokeIndex <= ph % 18 ? 1 : 0);
  const netScore  = hole.score - extra;
  const sc        = scoreColor(hole.score, hole.par);
  const totalPtsA = holesA.reduce((s, h) => s + h.stablefordPoints, 0);
  const totalPtsB = holesB.reduce((s, h) => s + h.stablefordPoints, 0);
  const nameB     = partner ? personName(partner.player_first, partner.player_last, partner.player_email) : 'Partner';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
          <Text style={styles.exitText}>Exit</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{comp?.course_name ?? ''}</Text>
        <TouchableOpacity style={styles.finishPill} onPress={() => navigation.goBack()}>
          <Text style={styles.finishText}>Finish</Text>
        </TouchableOpacity>
      </View>

      {/* Live bar */}
      <View style={styles.liveBar}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>LIVE · SAVING</Text>
      </View>

      {/* Player A/B toggle */}
      <View style={styles.playerToggle}>
        <TouchableOpacity
          style={[styles.playerTab, currentPlayer === 'A' && styles.playerTabActive]}
          onPress={() => setCurrentPlayer('A')}
          activeOpacity={0.8}
        >
          <Text style={[styles.playerTabLabel, currentPlayer === 'A' && styles.playerTabLabelActive]}>A</Text>
          <Text style={[styles.playerTabName,  currentPlayer === 'A' && styles.playerTabNameActive]}>
            You
          </Text>
          <Text style={[styles.playerTabPts, currentPlayer === 'A' && styles.playerTabPtsActive]}>
            {totalPtsA} pts
          </Text>
        </TouchableOpacity>

        {partner && (
          <TouchableOpacity
            style={[styles.playerTab, currentPlayer === 'B' && styles.playerTabActive]}
            onPress={() => setCurrentPlayer('B')}
            activeOpacity={0.8}
          >
            <Text style={[styles.playerTabLabel, currentPlayer === 'B' && styles.playerTabLabelActive]}>MARKING</Text>
            <Text style={[styles.playerTabName, currentPlayer === 'B' && styles.playerTabNameActive]} numberOfLines={1}>
              {nameB}
            </Text>
            <Text style={[styles.playerTabPts, currentPlayer === 'B' && styles.playerTabPtsActive]}>
              {totalPtsB} pts
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Marking banner — shown when entering partner's official card */}
      {currentPlayer === 'B' && partner && (
        <View style={styles.markingBanner}>
          <Ionicons name="create-outline" size={13} color={colors.primary} />
          <Text style={styles.markingBannerText}>
            Entering {personName(partner.player_first, partner.player_last, partner.player_email)}'s official card
          </Text>
        </View>
      )}

      {/* Hole info bar */}
      <View style={styles.holeBar}>
        <View>
          <Text style={styles.holeWord}>HOLE {holeWord(hole.holeNumber)}</Text>
          <Text style={styles.holeNum}>{hole.holeNumber}</Text>
          <Text style={styles.holeMeta}>PAR {hole.par} · SI {hole.strokeIndex}</Text>
        </View>
        {extra > 0 && (
          <View style={styles.shotPill}>
            <Text style={styles.shotPillText}>+{extra} shot{extra > 1 ? 's' : ''}</Text>
          </View>
        )}
      </View>

      {/* Score input */}
      <View style={styles.scoreArea}>
        <TouchableOpacity style={styles.scoreBtn} onPress={() => adjustScore(-1)}>
          <Text style={styles.scoreBtnText}>−</Text>
        </TouchableOpacity>
        <View style={styles.scoreCenter}>
          <Text style={[styles.scoreNum, { color: sc }]}>{hole.score}</Text>
          <Text style={styles.scoreSubLabel}>STROKES</Text>
        </View>
        <TouchableOpacity style={styles.scoreBtn} onPress={() => adjustScore(+1)}>
          <Text style={styles.scoreBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Stats banner */}
      <View style={styles.statsBanner}>
        <View style={styles.statsSide}>
          <Text style={styles.statsLabel}>NET SCORE</Text>
          <Text style={styles.statsValue}>{netScore}</Text>
        </View>
        <View style={styles.statsDivider} />
        <View style={styles.statsSide}>
          <Text style={styles.statsLabel}>POINTS</Text>
          <Text style={[styles.statsValue, { color: colors.primary }]}>{hole.stablefordPoints}</Text>
        </View>
      </View>

      {/* FIR / GIR / Putts */}
      <View style={styles.trackRow}>
        <View style={styles.trackBlock}>
          <Text style={styles.trackLabel}>FAIRWAY</Text>
          {hole.par === 3 ? (
            <Text style={styles.trackNA}>N/A</Text>
          ) : (
            <View style={styles.trackToggle}>
              <TouchableOpacity
                style={[styles.trackBtn, hole.fairwayHit === true && styles.trackBtnGreen]}
                onPress={() => adjustFIR(hole.fairwayHit === true ? null : true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.trackBtnText, hole.fairwayHit === true && styles.trackBtnTextOn]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.trackBtn, hole.fairwayHit === false && styles.trackBtnRed]}
                onPress={() => adjustFIR(hole.fairwayHit === false ? null : false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.trackBtnText, hole.fairwayHit === false && styles.trackBtnTextOn]}>Miss</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.statsDivider} />

        <View style={styles.trackBlock}>
          <Text style={styles.trackLabel}>GREEN (GIR)</Text>
          <View style={styles.trackToggle}>
            <TouchableOpacity
              style={[styles.trackBtn, hole.gir === true && styles.trackBtnGreen]}
              onPress={() => adjustGIR(hole.gir === true ? null : true)}
              activeOpacity={0.8}
            >
              <Text style={[styles.trackBtnText, hole.gir === true && styles.trackBtnTextOn]}>Hit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.trackBtn, hole.gir === false && styles.trackBtnRed]}
              onPress={() => adjustGIR(hole.gir === false ? null : false)}
              activeOpacity={0.8}
            >
              <Text style={[styles.trackBtnText, hole.gir === false && styles.trackBtnTextOn]}>Miss</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsDivider} />

        <View style={styles.trackBlock}>
          <Text style={styles.trackLabel}>PUTTS</Text>
          <View style={styles.puttRow}>
            <TouchableOpacity style={styles.puttBtn} onPress={() => adjustPutts(-1)}>
              <Text style={styles.puttBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.puttCount}>{hole.putts}</Text>
            <TouchableOpacity style={styles.puttBtn} onPress={() => adjustPutts(+1)}>
              <Text style={styles.puttBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Hole navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navBtnOutline, holeIdx === 0 && styles.navBtnDisabled]}
          onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))}
          disabled={holeIdx === 0}
        >
          <Text style={styles.navBtnOutlineText}>
            {holeIdx > 0 ? `← Hole ${holeIdx}` : '← Prev'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navBtnFilled}
          onPress={() => holeIdx < 17 ? setHoleIdx(holeIdx + 1) : navigation.goBack()}
        >
          <Text style={styles.navBtnFilledText}>
            {holeIdx < 17 ? `Hole ${holeIdx + 2} →` : 'Finish →'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Scorecard strip — both players */}
      <View style={styles.stripHeader}>
        <Text style={styles.stripLabel}>SCORECARD</Text>
        <Text style={styles.stripHint}>Tap a hole to edit</Text>
      </View>
      <View style={styles.stripContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripScroll}
        >
          {holesA.map((h, i) => {
            const isCurrent = i === holeIdx;
            const hB = holesB[i];
            return (
              <TouchableOpacity
                key={i}
                style={[styles.chip, isCurrent && styles.chipActive]}
                onPress={() => setHoleIdx(i)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipHole, isCurrent && styles.chipTextLight]}>
                  {h.holeNumber}
                </Text>
                <Text style={[styles.chipPar, isCurrent && styles.chipParLight]}>
                  p{h.par}
                </Text>
                <Text style={[styles.chipScoreA, isCurrent ? styles.chipTextLight : { color: scoreColor(h.score, h.par) }]}>
                  {h.score}
                </Text>
                {partner && hB && (
                  <Text style={[styles.chipScoreB, isCurrent && styles.chipTextLightB]}>
                    {hB.score}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exitText: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary, width: 56 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
  },
  finishPill: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    width: 56,
    alignItems: 'center',
  },
  finishText: { color: colors.textInverse, fontSize: fontSize.sm, fontWeight: '700' },

  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.primary },
  liveText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, letterSpacing: 0.8 },

  // Player A/B toggle
  playerToggle: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    padding: 4,
    gap: 4,
  },
  playerTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: 2,
  },
  playerTabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  playerTabLabel:       { fontSize: 10, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5 },
  playerTabLabelActive: { color: colors.primary },
  playerTabName:        { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  playerTabNameActive:  { color: colors.textPrimary },
  playerTabPts:         { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
  playerTabPtsActive:   { color: colors.primary },

  // Hole info
  holeBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  holeWord: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  holeNum:  { fontSize: fontSize.display, fontWeight: '800', color: colors.textPrimary, lineHeight: 44 },
  holeMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  shotPill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  shotPillText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textPrimary },

  // Score input
  scoreArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  scoreBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreBtnText:  { fontSize: fontSize.xxl, color: colors.textPrimary, fontWeight: '300', lineHeight: 36 },
  scoreCenter:   { alignItems: 'center', minWidth: 80 },
  scoreNum:      { fontSize: fontSize.display, fontWeight: '800', lineHeight: 44 },
  scoreSubLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },

  // Stats banner
  statsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  statsSide:    { alignItems: 'center', flex: 1 },
  statsDivider: { width: 1, height: 32, backgroundColor: colors.border },
  statsLabel:   {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  statsValue:   { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },

  // Hole navigation
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navBtnOutline: {
    flex: 1,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  navBtnFilled: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  navBtnOutlineText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  navBtnFilledText:  { fontSize: fontSize.sm, fontWeight: '600', color: colors.textInverse },
  navBtnDisabled:    { opacity: 0.35 },

  // Scorecard strip
  stripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  stripLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  stripHint:      { fontSize: fontSize.xs, color: colors.textSecondary },
  stripContainer: { height: 88 },
  stripScroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    width: 44,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
  },
  chipActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  chipHole:       { fontSize: 12, fontWeight: '700', color: colors.textPrimary, lineHeight: 14 },
  chipPar:        { fontSize: 10, fontWeight: '500', color: colors.textSecondary, lineHeight: 12 },
  chipParLight:   { color: 'rgba(255,255,255,0.65)' },
  chipScoreA:     { fontSize: 14, fontWeight: '800', lineHeight: 16, color: colors.textPrimary },
  chipScoreB:     { fontSize: 11, fontWeight: '600', color: colors.textSecondary, lineHeight: 13 },
  chipTextLight:  { color: colors.textInverse },
  chipTextLightB: { color: 'rgba(255,255,255,0.7)' },

  // Marking banner
  markingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.primary + '12',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  markingBannerText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600', flex: 1 },

  // Partner picker
  partnerContent: { padding: spacing.md, paddingBottom: 40 },
  partnerSubtitle:{ fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  partnerList:    {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  partnerRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14, paddingHorizontal: spacing.md },
  partnerRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  partnerAvatar:    { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  partnerAvatarText:{ color: colors.textInverse, fontSize: fontSize.sm, fontWeight: '700' },
  partnerName:      { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  partnerHcp:       { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  skipBtn:          { alignItems: 'center', paddingVertical: 12 },
  skipBtnText:      { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500' },
  skipNote:         { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.lg, lineHeight: 17, opacity: 0.7 },

  // FIR / GIR / Putts tracking row
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  trackBlock:    { flex: 1, alignItems: 'center', gap: 7 },
  trackLabel:    { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  trackNA:       { fontSize: fontSize.xs, color: colors.border, fontStyle: 'italic' },
  trackToggle:   { flexDirection: 'row', gap: 4 },
  trackBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
  },
  trackBtnGreen:   { backgroundColor: colors.primary + '18', borderColor: colors.primary },
  trackBtnRed:     { backgroundColor: colors.danger + '18', borderColor: colors.danger },
  trackBtnText:    { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  trackBtnTextOn:  { color: colors.textPrimary, fontWeight: '700' },
  puttRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  puttBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  puttBtnText:     { fontSize: fontSize.base, fontWeight: '300', color: colors.textPrimary },
  puttCount:       { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary, minWidth: 22, textAlign: 'center' },
});
