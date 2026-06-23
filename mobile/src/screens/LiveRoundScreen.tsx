import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, Alert, Modal,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import client from '../api/client';
import { useLiveRound } from '../hooks/useLiveRound';
import { colors, fontSize, spacing, radius } from '../theme';
import { RootStackParamList, User } from '../../App';

// ── Scoring helpers — copied verbatim from LiveRound.jsx ──────────────────────

function calcPoints(
  score: number | null,
  par: number,
  si: number,
  hcp: number,
): number | null {
  if (score === null) return null;
  const shots = Math.floor(hcp / 18) + (si <= hcp % 18 ? 1 : 0);
  return Math.max(0, 2 + par + shots - score);
}

function shotsOnHole(si: number, hcp: number): number {
  return Math.floor(hcp / 18) + (si <= hcp % 18 ? 1 : 0);
}

// ── Arc geometry constants ────────────────────────────────────────────────────
//
//  210 × 210 SVG viewport, circle centred at (105, 105), radius 88, stroke 12.
//  The arc starts at 12 o'clock (rotate −90°) and sweeps clockwise.
//  Maximum sweep = 82 % of the full circumference.
//  Fill ratio = clamp((score − 1) / 9, 0, 1)  (score range 1–12 maps to 0–1 at 10+)

const ARC_R     = 88;
const ARC_CX    = 105;
const ARC_CY    = 105;
const ARC_SW    = 12;
const ARC_CIRC  = 2 * Math.PI * ARC_R;   // ≈ 552.92
const ARC_MAX   = ARC_CIRC * 0.82;       // 82 % ≈ 453.4
const ARC_ROT   = -90;                   // start at top (12 o'clock)

function fillRatio(score: number): number {
  return Math.max(0, Math.min(1, (score - 1) / 9));
}

// ── Colour helpers ────────────────────────────────────────────────────────────

// Arc / score colour — based on NET outcome (handicap-adjusted)
function dialColor(pts: number | null): string {
  if (pts === null)  return colors.border;
  if (pts >= 4)      return '#C4A35A';           // eagle or better  → gold/amber
  if (pts === 3)     return colors.primaryLight; // net birdie       → green
  if (pts >= 1)      return colors.textSecondary;// net par / bogey  → muted
  return colors.danger;                          // double bogey+    → red
}

// Gross outcome word (displayed large inside the dial)
function grossLabel(score: number, par: number): string {
  const d = score - par;
  if (d <= -3) return 'albatross';
  if (d === -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0)  return 'par';
  if (d === 1)  return 'bogey';
  if (d === 2)  return 'double bogey';
  return 'triple bogey+';
}

// Net outcome hint (shown smaller below the gross label)
function netLabel(score: number, par: number, si: number, hcp: number): string {
  const shots = shotsOnHole(si, hcp);
  const diff  = (score - shots) - par;
  if (diff <= -2) return 'net eagle+';
  if (diff === -1) return 'net birdie';
  if (diff === 0)  return 'net par';
  if (diff === 1)  return 'net bogey';
  return 'net double+';
}

// ── AnimatedCircle ────────────────────────────────────────────────────────────
// createAnimatedComponent requires 'any' cast so Animated.Value is accepted
// for numeric SVG props (strokeDashoffset) that the SVG typings declare as
// number | string — the runtime handles Animated.Value correctly.

const AnimatedCircle = Animated.createAnimatedComponent(
  Circle as React.ComponentType<any>,
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type LiveHole = { number: number; par: number; si: number };

type RoundResult = {
  score:         number;
  stableford:    number;
  slope_rating:  number | null;
  course_rating: number | null;
  handicap_index: number | null;
  coursePar:     number;   // sum of hole pars from holeData
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'LiveRound'>;
  route:      RouteProp<RootStackParamList, 'LiveRound'>;
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LiveRoundScreen({ navigation, route }: Props) {
  const {
    roundId, holeData, courseHcp, courseName,
    teeName, competitionName, initScores, user,
  } = route.params;

  const insets = useSafeAreaInsets();

  // Socket connection — only the banner depends on this; do not alter internals
  const { connected, connectionError } = useLiveRound(roundId);

  // ── Score state ───────────────────────────────────────────────────────────

  const [currentHole, setCurrentHole] = useState(() => {
    const idx = initScores.findIndex(s => s === null);
    return idx === -1 ? 0 : idx;
  });
  const [scores,      setScores]      = useState<(number | null)[]>(initScores);
  const [savedScores, setSavedScores] = useState<(number | null)[]>([...initScores]);
  const [savingSet,   setSavingSet]   = useState(new Set<number>());
  const [errorSet,    setErrorSet]    = useState(new Set<number>());
  const [finishing,    setFinishing]   = useState(false);
  const [finishError,  setFinishError] = useState('');
  const [roundResult,  setRoundResult] = useState<RoundResult | null>(null);

  const saveTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>(
    Array(holeData.length).fill(null),
  );

  // Refs that track the latest state values for use in the unmount cleanup below.
  // State closures would be stale in an effect with empty deps.
  const scoresRef      = useRef(scores);
  const savedScoresRef = useRef(savedScores);
  useEffect(() => { scoresRef.current = scores; },      [scores]);
  useEffect(() => { savedScoresRef.current = savedScores; }, [savedScores]);

  // On unmount: flush any scores still waiting in the debounce queue.
  // This fires if the screen is dismissed before the 1200 ms timer fires
  // (e.g., by a programmatic navigation call). The gestureEnabled:false flag
  // in App.tsx prevents the swipe-dismiss, but this is a belt-and-suspenders guard.
  useEffect(() => {
    return () => {
      for (let i = 0; i < holeData.length; i++) {
        const t = saveTimers.current[i];
        if (t != null) {
          clearTimeout(t);
          const s = scoresRef.current[i];
          if (s !== null && s !== savedScoresRef.current[i]) {
            // Fire-and-forget: component is unmounting so setState calls inside
            // doSave are no-ops, but the API write still reaches the server.
            doSave(i, s);
          }
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const hole     = holeData[currentHole] ?? { par: 4, si: 1, number: currentHole + 1 };
  const hShots   = shotsOnHole(hole.si, courseHcp);
  const curScore = scores[currentHole] ?? null;
  const curPts   = calcPoints(curScore, hole.par, hole.si, courseHcp);

  const holesPlayed = scores.filter(s => s !== null).length;
  const totalScore: number = scores.reduce((acc: number, s) => acc + (s ?? 0), 0);
  const totalPts: number = scores.reduce((acc: number, s, i) => {
    if (s === null) return acc;
    return acc + Math.max(0, calcPoints(s, holeData[i].par, holeData[i].si, courseHcp) ?? 0);
  }, 0);

  const isFirst = currentHole === 0;
  const isLast  = currentHole === holeData.length - 1;
  const allDone = holesPlayed === holeData.length;

  const color       = dialColor(curPts);
  const primaryLabel = (isLast || allDone) ? 'Finish Round' : 'Next Hole';

  // ── Arc animation ─────────────────────────────────────────────────────────

  // strokeDashoffset: ARC_MAX = nothing shown, 0 = full arc shown.
  // Visible arc length = ARC_MAX − offset, so offset = ARC_MAX × (1 − fillRatio)
  const arcOffset  = useRef(new Animated.Value(ARC_MAX)).current;
  const minusScale = useRef(new Animated.Value(1)).current;
  const plusScale  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const target = curScore !== null
      ? ARC_MAX * (1 - fillRatio(curScore))
      : ARC_MAX;
    Animated.timing(arcOffset, {
      toValue: target,
      duration: 200,
      useNativeDriver: false, // SVG props are on the JS thread
    }).start();
  }, [curScore, arcOffset]);

  function springBtn(anim: Animated.Value) {
    Animated.sequence([
      Animated.spring(anim, { toValue: 0.91, speed: 60, bounciness: 0, useNativeDriver: true }),
      Animated.spring(anim, { toValue: 1,    speed: 40, bounciness: 8, useNativeDriver: true }),
    ]).start();
  }

  // ── Save logic — preserved from web PhasePlaying ──────────────────────────

  function scheduleSave(holeIdx: number, score: number) {
    const t = saveTimers.current[holeIdx];
    if (t) clearTimeout(t);
    setSavingSet(prev => new Set([...prev, holeIdx]));
    setErrorSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
    saveTimers.current[holeIdx] = setTimeout(() => doSave(holeIdx, score), 1200);
  }

  async function doSave(holeIdx: number, score: number) {
    const h   = holeData[holeIdx];
    const pts = Math.max(0, calcPoints(score, h.par, h.si, courseHcp) ?? 0);
    try {
      await client.patch(`/api/rounds/${roundId}/hole`, {
        holeNumber:       holeIdx + 1,
        par:              h.par,
        strokeIndex:      h.si,
        score,
        stablefordPoints: pts,
      });
      setSavedScores(prev => { const n = [...prev]; n[holeIdx] = score; return n; });
      setSavingSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
    } catch {
      setSavingSet(prev => { const n = new Set(prev); n.delete(holeIdx); return n; });
      setErrorSet(prev => new Set([...prev, holeIdx]));
    }
  }

  function changeScore(delta: number) {
    springBtn(delta < 0 ? minusScale : plusScale);
    setScores(prev => {
      const n = [...prev];
      if (n[currentHole] === null) {
        // First press snaps to par; subsequent presses adjust from there
        n[currentHole] = hole.par;
        scheduleSave(currentHole, n[currentHole] as number);
        return n;
      }
      n[currentHole] = Math.max(1, Math.min(12, (n[currentHole] as number) + delta));
      scheduleSave(currentHole, n[currentHole] as number);
      return n;
    });
  }

  async function handleFinish() {
    setFinishing(true);
    setFinishError('');
    // Flush any pending debounced saves
    for (let i = 0; i < holeData.length; i++) {
      const t = saveTimers.current[i];
      if (t != null) {
        clearTimeout(t);
        const s = scores[i];
        if (s !== null && s !== savedScores[i]) await doSave(i, s);
      }
    }
    try {
      const { data } = await client.post(`/api/rounds/${roundId}/finish`);
      const coursePar = holeData.reduce((sum, h) => sum + h.par, 0);
      setRoundResult({
        score:          data.score,
        stableford:     data.stableford,
        slope_rating:   data.slope_rating   ?? null,
        course_rating:  data.course_rating  ?? null,
        handicap_index: data.handicap_index ?? null,
        coursePar,
      });
    } catch (err: any) {
      setFinishError(err.response?.data?.error ?? err.message ?? 'Could not finish round');
      setFinishing(false);
    }
  }

  function handleAbandon() {
    Alert.alert(
      'Exit Round',
      'Exit this round? Your scores so far are saved — you can start a new round whenever you\'re ready.',
      [
        { text: 'Keep Playing', style: 'cancel' },
        {
          text: 'Exit', style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ],
    );
  }

  function handlePrimary() {
    if (isLast || allDone) {
      handleFinish();
      return;
    }
    // Flush pending save for the current hole immediately before advancing
    const t = saveTimers.current[currentHole];
    if (t != null) {
      clearTimeout(t);
      saveTimers.current[currentHole] = null;
      const s = scores[currentHole];
      if (s !== null && s !== savedScores[currentHole]) doSave(currentHole, s);
    }
    setCurrentHole(h => Math.min(holeData.length - 1, h + 1));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>

      {/* ── Reconnect banner (keep above scoring view, do not modify logic) ── */}
      {!connected && connectionError != null && (
        <View style={st.banner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={st.bannerText}>Reconnecting…</Text>
        </View>
      )}

      {/* ── Scrollable body ── */}
      <ScrollView
        contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 118 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Course / abandon row */}
        <View style={st.courseRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.courseName} numberOfLines={1}>{courseName}</Text>
            <View style={st.tagRow}>
              <View style={st.teePill}>
                <Text style={st.teePillText}>{teeName}</Text>
              </View>
              {!!competitionName && (
                <View style={st.compPill}>
                  <Text style={st.compPillText}>🏆 {competitionName}</Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            onPress={handleAbandon}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={st.abandonText}>Exit Round</Text>
          </TouchableOpacity>
        </View>

        {/* ── 1. Hole header row ── */}
        <View style={st.holeHeader}>
          <TouchableOpacity
            onPress={() => setCurrentHole(h => Math.max(0, h - 1))}
            disabled={isFirst}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            style={st.chevron}
          >
            <Ionicons
              name="chevron-back"
              size={32}
              color={isFirst ? colors.border : colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={st.holeTitleBlock}>
            <Text style={st.holeLabel}>HOLE</Text>
            <Text style={st.holeNum}>{currentHole + 1}</Text>
          </View>

          <TouchableOpacity
            onPress={() => setCurrentHole(h => Math.min(holeData.length - 1, h + 1))}
            disabled={isLast}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            style={st.chevron}
          >
            <Ionicons
              name="chevron-forward"
              size={32}
              color={isLast ? colors.border : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>

        {/* ── 2. Meta pills ── */}
        <View style={st.metaRow}>
          <View style={st.metaPill}>
            <Text style={st.metaPillText}>Par {hole.par}</Text>
          </View>
          <View style={st.metaPill}>
            <Text style={st.metaPillText}>SI {hole.si}</Text>
          </View>
          {hShots > 0 && (
            <View style={[st.metaPill, st.shotsPill]}>
              <View style={st.shotsDot} />
              <Text style={[st.metaPillText, st.shotsPillText]}>
                {hShots} shot{hShots !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>

        {/* ── 3. Dial ── */}
        <View style={st.dialWrap}>
          <Svg width={210} height={210}>
            {/* Background — full ring */}
            <Circle
              cx={ARC_CX}
              cy={ARC_CY}
              r={ARC_R}
              fill="none"
              stroke={colors.surfaceMuted}
              strokeWidth={ARC_SW + 2}
            />
            {/* Foreground arc — animated offset, starts at top */}
            <AnimatedCircle
              cx={ARC_CX}
              cy={ARC_CY}
              r={ARC_R}
              fill="none"
              stroke={color}
              strokeWidth={ARC_SW}
              strokeLinecap="round"
              strokeDasharray={`${ARC_MAX} ${ARC_CIRC}`}
              strokeDashoffset={arcOffset}
              transform={`rotate(${ARC_ROT}, ${ARC_CX}, ${ARC_CY})`}
            />
          </Svg>

          {/* Centre overlay */}
          <View style={st.dialCenter} pointerEvents="none">
            {curScore !== null ? (
              <>
                <Text style={[st.dialScore, { color }]}>{curScore}</Text>
                <Text style={[st.dialOutcome, { color }]}>
                  {grossLabel(curScore, hole.par)}
                </Text>
                {hShots > 0 && (
                  <Text style={st.dialNet}>
                    {netLabel(curScore, hole.par, hole.si, courseHcp)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={st.dialEmpty}>—</Text>
            )}
          </View>
        </View>

        {/* ── 4. − / + buttons ── */}
        <View style={st.btnRow}>
          <Animated.View style={{ transform: [{ scale: minusScale }] }}>
            <TouchableOpacity
              style={[
                st.scoreBtn, st.minusBtn,
                curScore !== null && curScore <= 1 && st.btnDisabled,
              ]}
              onPress={() => changeScore(-1)}
              disabled={curScore !== null && curScore <= 1}
              activeOpacity={0.85}
            >
              <Text style={[st.btnText, st.minusBtnText]}>−</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: plusScale }] }}>
            <TouchableOpacity
              style={[
                st.scoreBtn, st.plusBtn,
                curScore !== null && curScore >= 12 && st.btnDisabled,
              ]}
              onPress={() => changeScore(+1)}
              disabled={curScore !== null && curScore >= 12}
              activeOpacity={0.85}
            >
              <Text style={[st.btnText, st.plusBtnText]}>+</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ── Hole strip (mini scorecard) ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={hs.content}
          style={hs.scroll}
        >
          {holeData.map((h, i) => {
            const sc     = scores[i];
            const pts_   = sc !== null ? calcPoints(sc, h.par, h.si, courseHcp) : null;
            const isCur  = i === currentHole;
            const isSav  = savingSet.has(i);
            const isErr  = errorSet.has(i);
            const dc     = pts_ !== null ? dialColor(pts_) : colors.border;
            return (
              <TouchableOpacity
                key={i}
                style={[hs.cell, isCur && hs.cellActive]}
                onPress={() => setCurrentHole(i)}
                activeOpacity={0.7}
              >
                <Text style={[hs.num, isCur && hs.numActive]}>{i + 1}</Text>
                <Text style={[hs.score, { color: isCur ? colors.textInverse : dc }]}>
                  {isSav ? '…' : isErr ? '!' : sc !== null ? String(sc) : '—'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {finishError !== '' && (
          <View style={st.errBox}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
            <Text style={st.errText}>{finishError}</Text>
          </View>
        )}

      </ScrollView>

      {/* ── Round complete overlay ── */}
      {roundResult && (
        <RoundCompleteModal
          result={roundResult}
          courseName={courseName}
          onDone={() => navigation.navigate('Home', { user })}
        />
      )}

      {/* ── Sticky footer: 5. Summary bar + 6. Primary button ── */}
      <View style={[st.footer, { paddingBottom: insets.bottom + 10 }]}>

        {/* 5. Sticky summary bar */}
        <View style={st.summaryBar}>
          <View style={st.sumItem}>
            <Text style={st.sumVal}>
              {holesPlayed > 0 ? totalScore : '—'}
            </Text>
            <Text style={st.sumLabel}>Gross</Text>
          </View>
          <View style={st.sumDivider} />
          <View style={st.sumItem}>
            <Text style={[
              st.sumVal,
              holesPlayed > 0 && totalPts >= 36 ? { color: colors.primaryLight }
              : holesPlayed > 0 && totalPts <= 28 ? { color: colors.danger }
              : undefined,
            ]}>
              {holesPlayed > 0 ? totalPts : '—'}
            </Text>
            <Text style={st.sumLabel}>Stableford</Text>
          </View>
          <View style={st.sumDivider} />
          <View style={st.sumItem}>
            <Text style={st.sumVal}>
              {holesPlayed}<Text style={st.sumDenom}>/18</Text>
            </Text>
            <Text style={st.sumLabel}>Holes</Text>
          </View>
        </View>

        {/* 6. Save & next / Finish */}
        <TouchableOpacity
          style={[st.primaryBtn, finishing && st.primaryBtnDisabled]}
          onPress={handlePrimary}
          disabled={finishing}
          activeOpacity={0.88}
        >
          {finishing ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <View style={st.primaryInner}>
              <Text style={st.primaryText}>
                {isLast || allDone ? 'Finish Round' : 'Save & next hole'}
              </Text>
              {!isLast && !allDone && (
                <Ionicons
                  name="arrow-forward"
                  size={17}
                  color={colors.textInverse}
                  style={{ marginLeft: 6 }}
                />
              )}
            </View>
          )}
        </TouchableOpacity>

      </View>
    </View>
  );
}

// ── Round Complete Modal ──────────────────────────────────────────────────────

function RoundCompleteModal({
  result,
  courseName,
  onDone,
}: {
  result:     RoundResult;
  courseName: string;
  onDone:     () => void;
}) {
  const { score, stableford, slope_rating, course_rating, handicap_index, coursePar } = result;

  // Handicap differential: (Adjusted Gross Score − Course Rating) × (113 / Slope)
  const differential: number | null =
    slope_rating != null && course_rating != null
      ? parseFloat(((score - course_rating) * (113 / slope_rating)).toFixed(1))
      : null;

  // Is this round's diff better (lower) than the going-in handicap?
  const diffDelta: number | null =
    differential != null && handicap_index != null
      ? parseFloat((differential - handicap_index).toFixed(1))
      : null;

  const scoreToPar = score - coursePar;
  const scoreToParStr =
    scoreToPar === 0 ? 'E' : scoreToPar > 0 ? `+${scoreToPar}` : `${scoreToPar}`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={mo.backdrop}>
        <View style={mo.card}>

          {/* Header */}
          <View style={mo.header}>
            <Text style={mo.headerEmoji}>🏌️</Text>
            <Text style={mo.headerTitle}>Round Complete</Text>
            <Text style={mo.headerSub} numberOfLines={1}>{courseName}</Text>
          </View>

          {/* Score row */}
          <View style={mo.scoreRow}>
            <View style={mo.scoreBlock}>
              <Text style={mo.scoreVal}>{score}</Text>
              <Text style={mo.scoreLabel}>Gross</Text>
            </View>
            <View style={mo.scoreDivider} />
            <View style={mo.scoreBlock}>
              <Text style={[mo.scoreVal, { color: colors.primary }]}>{stableford}</Text>
              <Text style={mo.scoreLabel}>Stableford</Text>
            </View>
            <View style={mo.scoreDivider} />
            <View style={mo.scoreBlock}>
              <Text style={[
                mo.scoreVal,
                scoreToPar < 0 ? { color: '#C4A35A' }
                : scoreToPar === 0 ? { color: colors.primaryLight }
                : undefined,
              ]}>
                {scoreToParStr}
              </Text>
              <Text style={mo.scoreLabel}>To Par</Text>
            </View>
          </View>

          {/* Handicap differential section */}
          {differential != null ? (
            <View style={mo.hcpSection}>
              <Text style={mo.hcpTitle}>HANDICAP DIFFERENTIAL</Text>
              <View style={mo.hcpRow}>
                <View style={mo.hcpBlock}>
                  <Text style={mo.hcpVal}>{differential}</Text>
                  <Text style={mo.hcpLabel}>This Round</Text>
                </View>
                {handicap_index != null && (
                  <>
                    <View style={mo.hcpArrow}>
                      <Ionicons
                        name={diffDelta! < 0 ? 'trending-down' : diffDelta! > 0 ? 'trending-up' : 'remove'}
                        size={22}
                        color={diffDelta! < 0 ? colors.primaryLight : diffDelta! > 0 ? colors.danger : colors.textSecondary}
                      />
                    </View>
                    <View style={mo.hcpBlock}>
                      <Text style={mo.hcpVal}>{handicap_index}</Text>
                      <Text style={mo.hcpLabel}>Going-In HCP</Text>
                    </View>
                  </>
                )}
              </View>
              {diffDelta != null && (
                <View style={[
                  mo.diffBadge,
                  diffDelta < 0 ? mo.diffBadgeGood : diffDelta > 0 ? mo.diffBadgeBad : mo.diffBadgeNeutral,
                ]}>
                  <Text style={[
                    mo.diffBadgeText,
                    diffDelta < 0 ? { color: colors.primaryLight }
                    : diffDelta > 0 ? { color: colors.danger }
                    : { color: colors.textSecondary },
                  ]}>
                    {diffDelta < 0
                      ? `${Math.abs(diffDelta)} below your handicap index — great round!`
                      : diffDelta > 0
                      ? `${diffDelta} above your handicap index`
                      : 'Matched your handicap index exactly'}
                  </Text>
                </View>
              )}
              <Text style={mo.hcpNote}>
                ({score} − {course_rating} CR) × (113 ÷ {slope_rating} SR)
              </Text>
            </View>
          ) : (
            <View style={mo.hcpSection}>
              <Text style={mo.hcpNote}>
                Course rating / slope not set — differential unavailable
              </Text>
            </View>
          )}

          {/* Done button */}
          <TouchableOpacity style={mo.doneBtn} onPress={onDone} activeOpacity={0.88}>
            <Text style={mo.doneBtnText}>Back to Home</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const mo = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%', backgroundColor: colors.surface,
    borderRadius: radius.lg, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 20, elevation: 12,
  },

  // Header
  header: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg + 4, paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  headerEmoji: { fontSize: 36, marginBottom: 4 },
  headerTitle: {
    fontSize: fontSize.xl, fontWeight: '800',
    color: colors.textInverse, letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: fontSize.sm, color: colors.textInverse + 'BB',
    marginTop: 2, fontWeight: '500',
  },

  // Score row
  scoreRow: {
    flexDirection: 'row',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  scoreBlock:   { flex: 1, alignItems: 'center' },
  scoreVal:     { fontSize: 32, fontWeight: '800', color: colors.textPrimary, letterSpacing: -1 },
  scoreLabel:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

  // HCP section
  hcpSection: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    alignItems: 'center',
  },
  hcpTitle: {
    fontSize: fontSize.xs, fontWeight: '800', color: colors.textSecondary,
    letterSpacing: 2, marginBottom: spacing.sm,
  },
  hcpRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  hcpBlock: { alignItems: 'center', minWidth: 70 },
  hcpVal:  { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  hcpLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  hcpArrow: { paddingHorizontal: 4 },
  diffBadge: {
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6,
    marginBottom: 6,
  },
  diffBadgeGood:    { backgroundColor: colors.primaryLight + '18' },
  diffBadgeBad:     { backgroundColor: colors.danger + '14' },
  diffBadgeNeutral: { backgroundColor: colors.surfaceMuted },
  diffBadgeText: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' },
  hcpNote: {
    fontSize: 11, color: colors.textSecondary + '99',
    textAlign: 'center', marginTop: 2,
  },

  // Done button
  doneBtn: {
    margin: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm, paddingVertical: 15,
    alignItems: 'center',
  },
  doneBtnText: {
    color: colors.textInverse, fontSize: fontSize.base,
    fontWeight: '700', letterSpacing: 0.3,
  },
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // Reconnect banner
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger,
    paddingVertical: 7, paddingHorizontal: spacing.lg,
  },
  bannerText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '600' },

  // Scrollable content
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  // Course / abandon row
  courseRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.md, gap: spacing.sm,
  },
  courseName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  tagRow:     { flexDirection: 'row', gap: 6, marginTop: 4 },
  teePill: {
    backgroundColor: colors.primary + '18',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3,
  },
  teePillText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  compPill: {
    backgroundColor: colors.gold + '22',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3,
  },
  compPillText: { fontSize: fontSize.xs, color: colors.secondary, fontWeight: '600' },
  abandonText:  { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' },

  // 1. Hole header
  holeHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  chevron:      { width: 44, alignItems: 'center', justifyContent: 'center' },
  holeTitleBlock: { alignItems: 'center' },
  holeLabel: {
    fontSize: fontSize.xs, fontWeight: '800', color: colors.textSecondary,
    letterSpacing: 2.5, textTransform: 'uppercase',
  },
  holeNum: {
    fontSize: 56, fontWeight: '900', color: colors.textPrimary,
    lineHeight: 60, letterSpacing: -2,
  },

  // 2. Meta pills
  metaRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: spacing.sm, marginBottom: spacing.lg,
  },
  metaPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  metaPillText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  shotsPill: {
    backgroundColor: colors.primaryLight + '1A',
    borderColor: colors.primaryLight + '44',
  },
  shotsDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.primaryLight, marginRight: 5,
  },
  shotsPillText: { color: colors.primaryLight },

  // 3. Dial
  dialWrap: {
    alignSelf: 'center', width: 210, height: 210,
    marginBottom: spacing.lg,
  },
  dialCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  dialScore: {
    fontSize: 64, fontWeight: '800', lineHeight: 68, letterSpacing: -2,
    includeFontPadding: false,
  },
  dialOutcome: {
    fontSize: fontSize.sm, fontWeight: '700', marginTop: 2,
    textTransform: 'capitalize',
  },
  dialNet: {
    fontSize: fontSize.xs, color: colors.textSecondary,
    marginTop: 2, fontWeight: '500',
  },
  dialEmpty: {
    fontSize: 56, fontWeight: '300', color: colors.border,
    lineHeight: 60,
  },

  // 4. Buttons
  btnRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 40, marginBottom: spacing.lg,
  },
  scoreBtn: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10, shadowRadius: 6, elevation: 4,
  },
  minusBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: colors.border,
  },
  plusBtn: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.30 },
  btnText:     { fontSize: 32, fontWeight: '300', lineHeight: 36, includeFontPadding: false },
  minusBtnText: { color: colors.primary },
  plusBtnText:  { color: colors.textInverse },

  // Error box
  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger + '12', borderRadius: radius.sm,
    padding: spacing.sm, marginTop: spacing.sm,
  },
  errText: { color: colors.danger, fontSize: fontSize.sm, flex: 1 },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 8,
  },

  // 5. Summary bar
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  sumItem:    { flex: 1, alignItems: 'center' },
  sumVal:     { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  sumLabel:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  sumDenom:   { fontSize: fontSize.sm, fontWeight: '400', color: colors.textSecondary },
  sumDivider: { width: 1, backgroundColor: colors.border },

  // 6. Primary button
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingVertical: 15, alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryInner: { flexDirection: 'row', alignItems: 'center' },
  primaryText: {
    color: colors.textInverse, fontSize: fontSize.base,
    fontWeight: '700', letterSpacing: 0.3,
  },
});

// ── Hole strip styles ─────────────────────────────────────────────────────────

const hs = StyleSheet.create({
  scroll:  { marginHorizontal: -spacing.lg, marginBottom: spacing.md },
  content: { paddingHorizontal: spacing.lg, gap: 5 },
  cell: {
    width: 40, alignItems: 'center', paddingVertical: 8,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  cellActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  num:        { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
  numActive:  { color: colors.textInverse },
  score:      { fontSize: fontSize.sm, fontWeight: '700', marginTop: 2 },
});
