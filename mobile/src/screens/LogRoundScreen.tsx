import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, FlatList, Alert,
  KeyboardAvoidingView, Platform, Animated, Dimensions, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../api/client';
import { RootStackParamList, User } from '../../App';
import { colors, fontSize, spacing, radius } from '../theme';
import Svg, { Circle as SvgCircle } from 'react-native-svg';

// ── Constants ────────────────────────────────────────────────────────────────


const HOLE_WORDS = [
  'ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE',
  'TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN',
] as const;
function holeWord(n: number) { return HOLE_WORDS[n - 1] ?? String(n); }

// ── Types ────────────────────────────────────────────────────────────────────

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'LogRound'> };

type CourseResult = {
  id: string;
  club_name: string;
  location: { city: string; country: string };
};

type Tee = {
  name: string;
  colour: string;
  gender?: string;
  slopeRating: number | null;
  courseRating: number | null;
  parTotal: number | null;
  holes: { number: number; par: number; si: number }[];
};

type HoleEntry = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  score: number;
  scored: boolean;
  stablefordPoints: number;
  fairwayHit: boolean | null;
  gir: boolean | null;
  putts: number | null;
};

type ScanResult = {
  scores:         { hole: number; score: number }[];
  holes:          { hole: number; par: number; si: number }[];
  pickups:        number[];
  courseName:     string | null;
  teeName:        string | null;
  stablefordTotal: number | null;
};

type ClubMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function calcPlayingHandicap(idx: number, slope: number, rating: number, par: number) {
  // WHS formula: Course Handicap = HCP Index × (Slope ÷ 113) + (Course Rating − Par)

  // Course Rating rounding (WHS Rules of Handicapping 5.1):
  // Round to nearest whole number; exactly 0.5 rounds UP → use Math.round()
  // e.g. 71.5 → 72,  71.4 → 71
  const roundedRating = Math.round(rating);

  const raw = idx * (slope / 113) + (roundedRating - par);

  // Final result rounding (WHS Rules of Handicapping 6.1):
  // Round to nearest whole number; exactly 0.5 rounds DOWN
  // Math.ceil(x − 0.5) achieves this: 18.5 → ceil(18.0) = 18,  18.6 → ceil(18.1) = 19
  return Math.ceil(raw - 0.5);
}

function calcStableford(par: number, si: number, score: number, ph: number): number {
  // Extra strokes received on this hole based on stroke index and playing handicap
  // Base strokes = floor(ph / 18), plus 1 extra if this hole's SI falls within the remainder
  const extra = Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0);
  // Stableford points: 2 = net par, +1 per shot under, 0 if worse than net bogey
  return Math.max(0, 2 + par + extra - score);
}

function scoreLabel(score: number, par: number) {
  const d = score - par;
  if (d <= -2) return { text: 'Eagle',  color: '#f59e0b' };
  if (d === -1) return { text: 'Birdie', color: '#3b82f6' };
  if (d === 0)  return { text: 'Par',    color: colors.primary };
  if (d === 1)  return { text: 'Bogey',  color: '#f97316' };
  return             { text: `+${d}`,    color: colors.danger };
}

// ── Step 3 dial constants ─────────────────────────────────────────────────────

const D3_R    = 88;
const D3_CX   = 105;
const D3_CY   = 105;
const D3_SW   = 12;
const D3_CIRC = 2 * Math.PI * D3_R;  // ≈ 552.92
const D3_MAX  = D3_CIRC * 0.82;      // 82 % sweep ≈ 453.4
const D3_ROT  = -90;                 // arc starts at 12 o'clock

function d3FillRatio(score: number): number {
  return Math.max(0, Math.min(1, (score - 1) / 9));
}

function d3Color(pts: number): string {
  if (pts >= 4)  return '#F0C040';  // net eagle+ → vivid gold
  if (pts === 3) return '#3B82F6';  // net birdie → blue
  if (pts === 2) return '#4CAF50';  // net par    → green
  if (pts === 1) return '#F97316';  // net bogey  → vivid orange
  return '#EF4444';                 // net double+ → vivid red
}

function d3GrossLabel(score: number, par: number): string {
  const d = score - par;
  if (d <= -3) return 'albatross';
  if (d === -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0)  return 'par';
  if (d === 1)  return 'bogey';
  if (d === 2)  return 'double bogey';
  return 'triple bogey+';
}

function d3NetLabel(score: number, par: number, extra: number): string {
  const diff = (score - extra) - par;
  if (diff <= -2) return 'net eagle+';
  if (diff === -1) return 'net birdie';
  if (diff === 0)  return 'net par';
  if (diff === 1)  return 'net bogey';
  return 'net double+';
}

const AnimatedD3Circle = Animated.createAnimatedComponent(
  SvgCircle as React.ComponentType<any>,
);

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  const LABELS = ['Course', 'Tee', 'Scores', 'Review', 'Save'];
  return (
    <View style={sb.row}>
      {LABELS.map((label, i) => {
        const n      = i + 1;
        const active = n === current;
        const done   = n < current;
        return (
          <React.Fragment key={n}>
            <View style={sb.step}>
              <View style={[sb.dot, done && sb.dotDone, active && sb.dotActive]}>
                <Text style={[sb.dotNum, (done || active) && sb.dotNumLight]}>
                  {done ? '✓' : n}
                </Text>
              </View>
              <Text style={[sb.label, active && sb.labelActive]}>{label}</Text>
            </View>
            {i < 4 && <View style={[sb.line, done && sb.lineDone]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const sb = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 16 },
  step:         { alignItems: 'center', width: 44 },
  dot:          { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  dotDone:      { backgroundColor: colors.primary, borderColor: colors.primary },
  dotActive:    { borderColor: colors.primary },
  dotNum:       { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  dotNumLight:  { color: colors.textInverse },
  label:        { fontSize: 9, color: colors.textSecondary, marginTop: 4, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.3 },
  labelActive:  { color: colors.primary },
  line:         { flex: 1, height: 2, backgroundColor: colors.border, marginTop: 13, marginHorizontal: -4 },
  lineDone:     { backgroundColor: colors.primary },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LogRoundScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [step, setStep]       = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [saving, setSaving]   = useState(false);
  const [userHcpIdx, setUserHcpIdx] = useState(0);
  const [roundMode, setRoundMode] = useState<'solo' | 'group' | 'past' | 'scan'>('solo');
  const [scanResult, setScanResult] = useState<ScanResult>({ scores: [], holes: [], pickups: [], courseName: null, teeName: null, stablefordTotal: null });
  const slideAnim             = useRef(new Animated.Value(0)).current;

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    client.get<User>('/api/users/profile')
      .then(r => { setCurrentUser(r.data); setUserHcpIdx(Number(r.data.handicap) || 0); })
      .catch(() => {});
    client.get<ClubMember[]>('/api/clubs/mine/members')
      .then(r => setClubMembers(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  // Step 1
  const [date, setDate]               = useState(today());
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState<CourseResult[]>([]);
  const [searching, setSearching]     = useState(false);
  const [course, setCourse]           = useState<CourseResult | null>(null);
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2
  const [tees, setTees]               = useState<Tee[]>([]);
  const [teeIdx, setTeeIdx]           = useState(0);
  const [loadingTees, setLoadingTees] = useState(false);
  const [playingHcp, setPlayingHcp]   = useState('');
  const [nineHole, setNineHole]       = useState(false);
  const [nineHoleSide, setNineHoleSide] = useState<'front' | 'back'>('front');

  // Step 3
  const [holes, setHoles]             = useState<HoleEntry[]>([]);
  const [holeIdx, setHoleIdx]         = useState(0);   // 0-17
  const [pickedUpHoles, setPickedUpHoles] = useState<boolean[]>([]);
  const [liveRoundId, setLiveRoundId] = useState<number | null>(null);
  const liveRoundIdRef                = useRef<number | null>(null);

  // Step 4 / 5
  const [notes, setNotes]           = useState('');
  const [savedRound, setSavedRound] = useState<any>(null);
  const [roundType, setRoundType]   = useState<'social' | 'scoring'>('social');
  const [clubMembers, setClubMembers] = useState<ClubMember[]>([]);
  const [partnerSearch, setPartnerSearch]       = useState('');
  const [selectedPartner, setSelectedPartner]   = useState<ClubMember | null>(null);

  // Group round
  const [groupRoundId, setGroupRoundId]     = useState<string | null>(null);
  const [groupPlayers, setGroupPlayers]     = useState<ClubMember[]>([]);
  const [groupPlayerSearch, setGroupPlayerSearch] = useState('');
  const [groupCreating, setGroupCreating]   = useState(false);
  const [showGroupScores, setShowGroupScores] = useState(false);
  const [groupScores, setGroupScores]       = useState<any[]>([]);

  // Disable the swipe-down gesture while actively scoring a live round.
  // setOptions must be the first line of defence — beforeRemove alone fires too
  // late on iOS modal: the native gesture can complete before preventDefault runs.
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: step < 3 || liveRoundId === null,
    });
  }, [step, liveRoundId, navigation]);

  // Belt-and-suspenders: catch hardware-back / programmatic goBack calls.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (step < 3 || liveRoundId === null) return;
      e.preventDefault();
      Alert.alert(
        'Exit Scoring?',
        'Your scores so far are saved. Tap "Round In Progress" on the home screen to return.',
        [
          { text: 'Keep Scoring', style: 'cancel' },
          {
            text: 'Exit', style: 'destructive',
            onPress: () => {
              navigation.dispatch(e.data.action);
              if (currentUser) {
                navigation.navigate('Home', { user: currentUser });
              }
            },
          },
        ],
      );
    });
    return unsub;
  }, [navigation, step, liveRoundId, currentUser]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  function animateStep(next: 0 | 1 | 2 | 3 | 4 | 5) {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue:   0, duration: 140, useNativeDriver: true }),
    ]).start();
    setStep(next);
  }

  function back() {
    if (step === 0) navigation.goBack();
    else animateStep((step - 1) as any);
  }

  async function startGroupRound() {
    setRoundMode('group');
    if (!groupPlayers.length) { animateStep(1); return; }
    setGroupCreating(true);
    try {
      const { data } = await client.post('/api/rounds/group', {
        playerIds: groupPlayers.map(p => p.id),
      });
      setGroupRoundId(data.groupId);
    } catch {}
    setGroupCreating(false);
    animateStep(1);
  }

  function startSoloRound() {
    setRoundMode('solo');
    setGroupRoundId(null);
    setGroupPlayers([]);
    animateStep(1);
  }

  function startPastRound() {
    setRoundMode('past');
    setGroupRoundId(null);
    setGroupPlayers([]);
    animateStep(1);
  }

  function startScanRound() {
    setRoundMode('scan');
    setScanResult({ scores: [], holes: [], pickups: [], courseName: null, teeName: null, stablefordTotal: null });
    setGroupRoundId(null);
    setGroupPlayers([]);
    animateStep(1);
  }

  async function fetchGroupScores() {
    if (!groupRoundId) return;
    try {
      const { data } = await client.get(`/api/rounds/group/${groupRoundId}`);
      setGroupScores(data);
    } catch {}
  }

  // ── Step 1: course search ───────────────────────────────────────────────────

  function onQueryChange(text: string) {
    setQuery(text);
    setCourse(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await client.get<{ courses: CourseResult[] }>('/api/courses/search', { params: { q: text } });
        setResults(data.courses);
      } finally { setSearching(false); }
    }, 300);
  }

  function selectCourse(c: CourseResult) {
    setCourse(c);
    setQuery(c.club_name);
    setResults([]);
  }

  function goToManualCourse() {
    navigation.navigate('ManualCourse', {
      onSave: (courseResult, savedTees) => {
        setCourse(courseResult);
        setQuery(courseResult.club_name);
        setResults([]);
        setTees(savedTees);
        setTeeIdx(0);
        const tee = savedTees[0];
        if (!tee || tee.holes.length !== 18) { animateStep(2); return; }
        const ph = calcPlayingHandicap(userHcpIdx, tee.slopeRating ?? 113, tee.courseRating ?? 72, tee.parTotal ?? 72);
        setPlayingHcp(String(ph));
        const initialHoles = tee.holes.map(h => ({
          holeNumber: h.number, par: h.par, strokeIndex: h.si,
          score: h.par, scored: false, stablefordPoints: 0,
          fairwayHit: null, gir: null, putts: null,
        }));
        setHoles(initialHoles);
        setPickedUpHoles(Array(initialHoles.length).fill(false));
        setHoleIdx(0);
        if (roundMode !== 'past' && liveRoundIdRef.current === null) {
          client.post('/api/rounds/start', {
            playedAt: date, courseName: courseResult.club_name, teeName: tee.colour,
            slopeRating: tee.slopeRating, courseRating: tee.courseRating,
            courseHandicap: ph, handicapIndex: userHcpIdx, holeData: tee.holes,
          }).then(({ data }) => {
            liveRoundIdRef.current = data.id;
            setLiveRoundId(data.id);
          }).catch(() => {});
        }
        animateStep(3);
      },
    });
  }

  async function goToStep2() {
    if (!course) return;
    setLoadingTees(true);
    try {
      const { data } = await client.get<{ tees: Tee[] }>(`/api/courses/detail/${course.id}`);
      setTees(data.tees);
      setTeeIdx(0);
      const tee = data.tees[0];
      if (tee) setPlayingHcp(String(calcPlayingHandicap(userHcpIdx, tee.slopeRating ?? 113, tee.courseRating ?? 72, tee.parTotal ?? 72)));
    } catch {
      Alert.alert('Error', 'Could not load course details');
      return;
    } finally { setLoadingTees(false); }
    animateStep(2);
  }

  // ── Step 2: tee / handicap ──────────────────────────────────────────────────

  const selectedTee = tees[teeIdx] ?? null;

  useEffect(() => {
    if (!selectedTee) return;
    const ph = calcPlayingHandicap(userHcpIdx, selectedTee.slopeRating ?? 113, selectedTee.courseRating ?? 72, selectedTee.parTotal ?? 72);
    setPlayingHcp(String(ph));
  }, [teeIdx]);

  async function goToStep3() {
    if (!selectedTee || selectedTee.holes.length !== 18) {
      Alert.alert('Incomplete data', 'This tee does not have full hole data.');
      return;
    }
    const ph = parseInt(playingHcp, 10) || 0;
    const teeHoles = nineHole
      ? (nineHoleSide === 'front' ? selectedTee.holes.slice(0, 9) : selectedTee.holes.slice(9, 18))
      : selectedTee.holes;
    const initialHoles = teeHoles.map(h => ({
      holeNumber: h.number, par: h.par, strokeIndex: h.si,
      score: h.par, scored: false, stablefordPoints: 0,
      fairwayHit: null, gir: null, putts: null,
    }));
    setHoles(initialHoles);
    setPickedUpHoles(Array(initialHoles.length).fill(false));
    setHoleIdx(0);

    if (roundMode !== 'past' && liveRoundIdRef.current === null) {
      try {
        const { data } = await client.post('/api/rounds/start', {
          playedAt:      date,
          courseName:    course!.club_name,
          teeName:       selectedTee.colour,
          slopeRating:   selectedTee.slopeRating,
          courseRating:  selectedTee.courseRating,
          courseHandicap: ph,
          handicapIndex: userHcpIdx,
          holeData:      teeHoles,
          groupRoundId:  groupRoundId || undefined,
          isNineHole:    nineHole,
        });
        liveRoundIdRef.current = data.id;
        setLiveRoundId(data.id);
      } catch {
        // Non-fatal — scoring still works, just won't broadcast live
      }
    }

    animateStep(3);
  }

  // Fire-and-forget hole patch to keep the live round in sync
  function patchHole(roundId: number, hole: HoleEntry) {
    client.patch(`/api/rounds/${roundId}/hole`, {
      holeNumber:       hole.holeNumber,
      par:              hole.par,
      strokeIndex:      hole.strokeIndex,
      score:            hole.score,
      stablefordPoints: hole.stablefordPoints,
      fairwayHit:       hole.fairwayHit,
      gir:              hole.gir,
      putts:            hole.putts,
    }).catch(() => {});
  }

  function setFIR(val: boolean | null) {
    setHoles(prev => {
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, fairwayHit: val });
      if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
      return next;
    });
  }

  function setGIR(val: boolean | null) {
    setHoles(prev => {
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, gir: val });
      if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
      return next;
    });
  }

  function adjustPutts(delta: number) {
    setHoles(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        if (h.putts === null) return { ...h, putts: delta > 0 ? 0 : null };
        const n = h.putts + delta;
        return { ...h, putts: n < 0 ? null : n };
      });
      if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
      return next;
    });
  }

  // ── Step 3: hole scores ─────────────────────────────────────────────────────

  const ph = parseInt(playingHcp, 10) || 0;
  const currentHole = holes[holeIdx];

  function adjustScore(delta: number) {
    if (!currentHole) return;
    setHoles(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        if (!h.scored) {
          // First press on an unscored hole snaps to par; delta is ignored
          return { ...h, score: h.par, scored: true, stablefordPoints: calcStableford(h.par, h.strokeIndex, h.par, ph) };
        }
        const s = Math.max(1, h.score + delta);
        return { ...h, score: s, scored: true, stablefordPoints: calcStableford(h.par, h.strokeIndex, s, ph) };
      });
      // Sync to live round (fire-and-forget)
      if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
      return next;
    });
  }

  function togglePickup() {
    if (!currentHole) return;
    setPickedUpHoles(prev => {
      const base = prev.length === holes.length ? prev : Array(holes.length).fill(false);
      const n = [...base];
      n[holeIdx] = !n[holeIdx];
      const nowPickedUp = n[holeIdx];

      setHoles(hprev => {
        const next = hprev.map((h, i) => {
          if (i !== holeIdx) return h;
          if (nowPickedUp) {
            // A pick-up forfeits the hole — it must always score 0, never the
            // last-entered/last-calculated stableford value.
            return { ...h, scored: true, stablefordPoints: 0 };
          }
          // Undo: recompute points from whatever score is still on the hole.
          return h.scored
            ? { ...h, stablefordPoints: calcStableford(h.par, h.strokeIndex, h.score, ph) }
            : h;
        });
        if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
        return next;
      });

      return n;
    });
  }

  // Gross strokes exclude picked-up holes (no valid finished score); stableford
  // points don't need the same filter since a pick-up already forces 0 above.
  const totalStrokes    = holes.filter((h, i) => h.scored && !pickedUpHoles[i]).reduce((s, h) => s + h.score, 0);
  const totalStableford = holes.filter(h => h.scored).reduce((s, h) => s + h.stablefordPoints, 0);

  // ── Step 5: save ────────────────────────────────────────────────────────────

  async function saveRound() {
    setSaving(true);
    try {
      let data: any;

      const roundId = liveRoundIdRef.current;
      if (roundId) {
        // Patch any holes not yet synced, then finish the live round
        await Promise.allSettled(
          holes.map(h => client.patch(`/api/rounds/${roundId}/hole`, {
            holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex,
            score: h.score, stablefordPoints: h.stablefordPoints,
            fairwayHit: h.fairwayHit, gir: h.gir, putts: h.putts,
          }))
        );
        const res = await client.post(`/api/rounds/${roundId}/finish`, {
          roundType,
          scoringPartnerId: selectedPartner?.id ?? null,
        });
        data = res.data;
      } else {
        // Fallback: batch save if live round never started
        const res = await client.post('/api/rounds', {
          playedAt:   date,
          courseName: course!.club_name,
          score:      totalStrokes,
          stableford: totalStableford,
          notes:      notes.trim() || null,
          roundType,
          scoringPartnerId: selectedPartner?.id ?? null,
          isNineHole: nineHole,
          slopeRating:    selectedTee?.slopeRating ?? null,
          courseRating:   selectedTee?.courseRating ?? null,
          courseHandicap: ph,
          holes:      holes.map(h => ({
            holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex,
            score: h.score, stablefordPoints: h.stablefordPoints,
            fairwayHit: h.fairwayHit, gir: h.gir, putts: h.putts,
          })),
        });
        data = res.data;
      }

      setSavedRound(data);
      animateStep(5);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not save round');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {step === 3 ? null : step === 0 ? (
        /* ── Group picker header ─────────────────────────────────────── */
        <View style={styles.header}>
          <TouchableOpacity onPress={back} style={styles.backBtn} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
            <Text style={styles.backIcon}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Start Round</Text>
          <View style={{ width: 36 }} />
        </View>
      ) : (
        /* ── Standard header (+ step bar for non-scan modes) ────────── */
        <>
          <View style={styles.header}>
            <TouchableOpacity onPress={back} style={styles.backBtn} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{roundMode === 'scan' ? 'Scan Scorecard' : 'Log Round'}</Text>
            <View style={{ width: 36 }} />
          </View>
          {roundMode !== 'scan' && <StepBar current={step} />}
        </>
      )}

      {/* ── Group scores modal ──────────────────────────────────────────── */}
      {showGroupScores && (
        <View style={styles.groupModal}>
          <View style={styles.groupModalCard}>
            <View style={styles.groupModalHeader}>
              <Text style={styles.groupModalTitle}>Group Scores</Text>
              <TouchableOpacity onPress={() => setShowGroupScores(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {groupScores.length === 0 ? (
              <Text style={styles.groupModalEmpty}>No rounds started yet</Text>
            ) : groupScores.map((p, i) => (
              <View key={p.id} style={styles.groupScoreRow}>
                <Text style={styles.groupScoreRank}>{i + 1}</Text>
                <Text style={styles.groupScoreName} numberOfLines={1}>
                  {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}
                </Text>
                <View style={styles.groupScoreCols}>
                  <Text style={styles.groupScorePts}>{p.stableford} pts</Text>
                  <Text style={styles.groupScoreHoles}>{p.holes_played}/18</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.groupModalRefresh} onPress={fetchGroupScores}>
              <Ionicons name="refresh" size={15} color={colors.primary} />
              <Text style={styles.groupModalRefreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {step === 0 && <Step0
          clubMembers={clubMembers}
          groupPlayers={groupPlayers}
          setGroupPlayers={setGroupPlayers}
          groupPlayerSearch={groupPlayerSearch}
          setGroupPlayerSearch={setGroupPlayerSearch}
          groupCreating={groupCreating}
          onSolo={startSoloRound}
          onGroup={startGroupRound}
          onPast={startPastRound}
          onScan={startScanRound}
        />}

        {step === 1 && (roundMode === 'scan'
          ? <ScanUploadStep
              onComplete={result => { setScanResult(result); animateStep(2); }}
            />
          : <Step1 date={date} setDate={setDate} query={query} onQueryChange={onQueryChange}
              results={results} searching={searching} course={course} selectCourse={selectCourse}
              onNext={goToStep2} loading={loadingTees} onAddManually={goToManualCourse}
              isPast={roundMode === 'past'} />
        )}

        {step === 2 && (roundMode === 'scan'
          ? <ScanReviewStep
              scanResult={scanResult}
              userHcpIdx={userHcpIdx}
              onSaved={(data, finalHoles, finalCourse) => {
                setSavedRound(data);
                setHoles(finalHoles);
                setCourse(finalCourse);
                animateStep(5);
              }}
            />
          : <Step2 tees={tees} teeIdx={teeIdx} setTeeIdx={setTeeIdx}
              playingHcp={playingHcp} setPlayingHcp={setPlayingHcp} userHcpIdx={userHcpIdx} onNext={goToStep3}
              nineHole={nineHole} setNineHole={setNineHole}
              nineHoleSide={nineHoleSide} setNineHoleSide={setNineHoleSide} />
        )}

        {step === 3 && (roundMode === 'past'
          ? <PastRoundScoreGrid holes={holes} setHoles={setHoles} onNext={() => animateStep(4)} playingHcp={playingHcp} />
          : <Step3
              holes={holes} holeIdx={holeIdx} setHoleIdx={setHoleIdx}
              adjustScore={adjustScore} onNext={() => animateStep(4)} playingHcp={playingHcp}
              setFIR={setFIR} setGIR={setGIR} adjustPutts={adjustPutts}
              pickedUpHoles={pickedUpHoles} togglePickup={togglePickup}
              course={course} onExit={back} onFinish={() => animateStep(4)}
              groupRoundId={groupRoundId} roundMode={roundMode}
              fetchGroupScores={fetchGroupScores} setShowGroupScores={setShowGroupScores}
            />
        )}

        {step === 4 && <Step4 holes={holes} totalStrokes={totalStrokes} totalStableford={totalStableford}
          notes={notes} setNotes={setNotes} onNext={() => animateStep(5)} saving={saving} saveRound={saveRound}
          courseName={course?.club_name ?? ''} date={date}
          roundType={roundType} setRoundType={setRoundType}
          clubMembers={clubMembers} partnerSearch={partnerSearch} setPartnerSearch={setPartnerSearch}
          selectedPartner={selectedPartner} setSelectedPartner={setSelectedPartner} />}

        {step === 5 && <Step5 savedRound={savedRound}
          totalStableford={totalStableford} totalStrokes={totalStrokes}
          courseName={course?.club_name ?? ''} onDone={() => navigation.goBack()}
          roundId={savedRound?.id ?? null} />}
      </Animated.View>
    </View>
  );
}

// ── Step 0: Solo or Group ─────────────────────────────────────────────────────

function Step0({ clubMembers, groupPlayers, setGroupPlayers, groupPlayerSearch, setGroupPlayerSearch, groupCreating, onSolo, onGroup, onPast, onScan }: any) {
  const [mode, setMode] = useState<'choose' | 'pick'>('choose');

  const memberName = (m: ClubMember) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;

  const filtered = groupPlayerSearch.trim()
    ? clubMembers.filter((m: ClubMember) =>
        memberName(m).toLowerCase().includes(groupPlayerSearch.toLowerCase()) ||
        m.email.toLowerCase().includes(groupPlayerSearch.toLowerCase())
      )
    : clubMembers;

  const toggle = (m: ClubMember) => {
    setGroupPlayers((prev: ClubMember[]) =>
      prev.find(p => p.id === m.id) ? prev.filter(p => p.id !== m.id) : [...prev, m]
    );
  };

  if (mode === 'choose') {
    return (
      <ScrollView contentContainerStyle={s0.container}>
        <Text style={s0.title}>What type of round?</Text>

        <TouchableOpacity style={s0.card} onPress={onSolo}>
          <View style={s0.cardIcon}>
            <Ionicons name="person" size={28} color={colors.primary} />
          </View>
          <View style={s0.cardBody}>
            <Text style={s0.cardTitle}>Solo Round</Text>
            <Text style={s0.cardSub}>Just you — track your scores live</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={s0.card} onPress={() => setMode('pick')}>
          <View style={[s0.cardIcon, { backgroundColor: '#e8f5e9' }]}>
            <Ionicons name="people" size={28} color="#2e7d32" />
          </View>
          <View style={s0.cardBody}>
            <Text style={s0.cardTitle}>Group Round</Text>
            <Text style={s0.cardSub}>Play with club members and see live scores</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={s0.card} onPress={onPast}>
          <View style={[s0.cardIcon, { backgroundColor: '#fef3c7' }]}>
            <Ionicons name="time-outline" size={28} color="#d97706" />
          </View>
          <View style={s0.cardBody}>
            <Text style={s0.cardTitle}>Past Round</Text>
            <Text style={s0.cardSub}>Enter scores from a round you already played</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={s0.card} onPress={onScan}>
          <View style={[s0.cardIcon, { backgroundColor: '#ede9fe' }]}>
            <Ionicons name="camera" size={28} color="#7c3aed" />
          </View>
          <View style={s0.cardBody}>
            <Text style={s0.cardTitle}>Scan Score Upload</Text>
            <Text style={s0.cardSub}>Upload a photo of your scorecard — AI reads the scores</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={s0.backRow} onPress={() => setMode('choose')}>
        <Ionicons name="arrow-back" size={18} color={colors.primary} />
        <Text style={s0.backRowText}>Back</Text>
      </TouchableOpacity>
      <Text style={[s0.title, { paddingHorizontal: 20 }]}>Select players</Text>
      {groupPlayers.length > 0 && (
        <View style={s0.selected}>
          {groupPlayers.map((p: ClubMember) => (
            <TouchableOpacity key={p.id} style={s0.chip} onPress={() => toggle(p)}>
              <Text style={s0.chipText}>{memberName(p)}</Text>
              <Ionicons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TextInput
        style={s0.search}
        placeholder="Search members..."
        placeholderTextColor={colors.textSecondary}
        value={groupPlayerSearch}
        onChangeText={setGroupPlayerSearch}
      />
      <FlatList
        data={filtered}
        keyExtractor={(m: ClubMember) => m.id}
        renderItem={({ item: m }: { item: ClubMember }) => {
          const selected = !!groupPlayers.find((p: ClubMember) => p.id === m.id);
          return (
            <TouchableOpacity style={s0.memberRow} onPress={() => toggle(m)}>
              <View style={[s0.memberCheck, selected && s0.memberCheckOn]}>
                {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={s0.memberName}>{memberName(m)}</Text>
            </TouchableOpacity>
          );
        }}
      />
      <TouchableOpacity
        style={[s0.continueBtn, groupCreating && { opacity: 0.6 }]}
        onPress={onGroup}
        disabled={groupCreating}
      >
        {groupCreating
          ? <ActivityIndicator color="#fff" />
          : <Text style={s0.continueBtnText}>
              {groupPlayers.length ? `Start with ${groupPlayers.length + 1} players` : 'Continue without group'}
            </Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const s0 = StyleSheet.create({
  container:     { padding: 20, paddingTop: 32 },
  title:         { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 24 },
  card:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 14, gap: 14 },
  cardIcon:      { width: 52, height: 52, borderRadius: 14, backgroundColor: '#e8f0e9', alignItems: 'center', justifyContent: 'center' },
  cardBody:      { flex: 1 },
  cardTitle:     { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  cardSub:       { fontSize: 13, color: colors.textSecondary },
  backRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backRowText:   { fontSize: 15, color: colors.primary, fontWeight: '600' },
  selected:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10 },
  chipText:      { fontSize: 13, color: '#fff', fontWeight: '600' },
  search:        { marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.textPrimary, backgroundColor: colors.surface },
  memberRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  memberCheck:   { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  memberCheckOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  memberName:    { fontSize: 15, color: colors.textPrimary },
  continueBtn:   { margin: 20, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  continueBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});

// ── Date picker calendar ──────────────────────────────────────────────────────

function DatePickerCalendar({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const [viewYear,  setViewYear]  = useState(() => {
    const d = date ? new Date(date + 'T00:00:00') : today;
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = date ? new Date(date + 'T00:00:00') : today;
    return d.getMonth();
  });

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const DAY_LABELS  = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    const nm = viewMonth === 11 ? 0 : viewMonth + 1;
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    if (ny > today.getFullYear() || (ny === today.getFullYear() && nm > today.getMonth())) return;
    setViewMonth(nm);
    setViewYear(ny);
  }

  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon=0

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function selectDay(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const selected = `${viewYear}-${m}-${d}`;
    if (selected > todayStr) return;
    setDate(selected);
  }

  function isFuture(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${viewYear}-${m}-${d}` > todayStr;
  }

  function isSelected(day: number) {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return date === `${viewYear}-${m}-${d}`;
  }

  const isNextDisabled = (() => {
    const nm = viewMonth === 11 ? 0 : viewMonth + 1;
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    return ny > today.getFullYear() || (ny === today.getFullYear() && nm > today.getMonth());
  })();

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={cal.monthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity onPress={nextMonth} disabled={isNextDisabled}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-forward" size={22} color={isNextDisabled ? colors.border : colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={cal.dayLabels}>
        {DAY_LABELS.map(l => <Text key={l} style={cal.dayLabel}>{l}</Text>)}
      </View>

      <View style={cal.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={cal.cell} />;
          const future   = isFuture(day);
          const selected = isSelected(day);
          return (
            <TouchableOpacity key={day} style={[cal.cell, selected && cal.cellSelected]}
              onPress={() => selectDay(day)} disabled={future} activeOpacity={0.7}>
              <Text style={[cal.cellText, future && cal.cellFuture, selected && cal.cellSelectedText]}>
                {day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const cal = StyleSheet.create({
  wrap:             { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginHorizontal: 0, marginBottom: 8, paddingBottom: 6 },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  monthLabel:       { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  dayLabels:        { flexDirection: 'row', paddingHorizontal: 6, marginBottom: 2 },
  dayLabel:         { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase' },
  grid:             { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 },
  cell:             { width: `${100 / 7}%`, height: 34, alignItems: 'center', justifyContent: 'center' },
  cellSelected:     { backgroundColor: colors.primary, borderRadius: 100 },
  cellText:         { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  cellFuture:       { color: colors.border },
  cellSelectedText: { color: '#fff', fontWeight: '700' },
});

// ── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({ date, setDate, query, onQueryChange, results, searching, course, selectCourse, onNext, loading, onAddManually, isPast }: any) {
  const DATE_OPTS = [
    { label: 'Today',     value: new Date().toISOString().split('T')[0] },
    { label: 'Yesterday', value: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
  ];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>When did you play?</Text>

        {isPast ? (
          <DatePickerCalendar date={date} setDate={setDate} />
        ) : (
          <View style={styles.dateRow}>
            {DATE_OPTS.map(opt => (
              <TouchableOpacity key={opt.value} style={[styles.datePill, date === opt.value && styles.datePillActive]}
                onPress={() => setDate(opt.value)}>
                <Text style={[styles.datePillText, date === opt.value && styles.datePillTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TextInput style={[styles.datePill, styles.dateInput, !DATE_OPTS.find(o => o.value === date) && styles.datePillActive]}
              value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numeric" />
          </View>
        )}

        <Text style={[styles.stepTitle, { marginTop: 24 }]}>Where did you play?</Text>
        <View style={styles.searchWrap}>
          <TextInput style={styles.searchInput} value={query} onChangeText={onQueryChange}
            placeholder="Search course name…" autoCapitalize="none" returnKeyType="search" />
          {searching && <ActivityIndicator style={styles.searchSpinner} color={colors.primary} />}
        </View>

        {results.length > 0 && (
          <View style={styles.resultsList}>
            {results.map((r: CourseResult) => (
              <TouchableOpacity key={r.id} style={styles.resultRow} onPress={() => selectCourse(r)}>
                <Text style={styles.resultName}>{r.club_name}</Text>
                <Text style={styles.resultSub}>{r.location.city}, {r.location.country}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Manual entry trigger — shown when search returns nothing */}
        {results.length === 0 && !searching && !course && query.trim().length >= 2 && (
          <TouchableOpacity style={styles.manualEntryBtn} onPress={onAddManually} activeOpacity={0.75}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.manualEntryText}>Can't find it? Add course manually</Text>
          </TouchableOpacity>
        )}

        {course && (
          <View style={styles.selectedBadge}>
            <Ionicons name="golf-outline" size={24} color={colors.primary} />
            <View>
              <Text style={styles.selectedBadgeName}>{course.club_name}</Text>
              <Text style={styles.selectedBadgeSub}>{course.location.city}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.nextBtn, !course && styles.nextBtnDisabled]}
          onPress={onNext} disabled={!course || loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextBtnText}>Choose Tee →</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({ tees, teeIdx, setTeeIdx, playingHcp, setPlayingHcp, userHcpIdx, onNext,
                  nineHole, setNineHole, nineHoleSide, setNineHoleSide }: any) {
  const tee: Tee | undefined = tees[teeIdx];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent}>
        <Text style={styles.stepTitle}>Select your tee</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.teeScroll}>
          {tees.map((t: Tee, i: number) => (
            <TouchableOpacity key={t.name} style={[styles.teePill, i === teeIdx && styles.teePillActive]}
              onPress={() => setTeeIdx(i)}>
              <View style={[styles.teeColourDot, { backgroundColor: t.colour.toLowerCase() === 'white' ? '#e5e7eb' : t.colour.toLowerCase() }]} />
              <Text style={[styles.teePillText, i === teeIdx && styles.teePillTextActive]}>{t.colour}</Text>
              <Text style={styles.teeGender}>{t.gender ?? ''}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {tee && (
          <View style={styles.teeInfoCard}>
            <View style={styles.teeInfoRow}>
              <TeeInfoCell label="Course Rating" value={tee.courseRating?.toFixed(1) ?? '—'} />
              <TeeInfoCell label="Slope Rating"  value={tee.slopeRating?.toString() ?? '—'} />
              <TeeInfoCell label="Par"            value={tee.parTotal?.toString() ?? '—'} />
            </View>
          </View>
        )}

        <Text style={[styles.stepTitle, { marginTop: 24 }]}>Playing handicap</Text>
        <Text style={styles.stepSub}>
          Auto-calculated from your handicap index of {Number(userHcpIdx).toFixed(1)} × slope ÷ 113 + (course rating − par). Adjust if needed.
        </Text>
        <View style={styles.hcpRow}>
          <TouchableOpacity style={styles.hcpBtn} onPress={() => setPlayingHcp(String(Math.max(0, parseInt(playingHcp || '0') - 1)))}>
            <Text style={styles.hcpBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput style={styles.hcpInput} value={playingHcp} onChangeText={setPlayingHcp}
            keyboardType="number-pad" textAlign="center" />
          <TouchableOpacity style={styles.hcpBtn} onPress={() => setPlayingHcp(String(parseInt(playingHcp || '0') + 1))}>
            <Text style={styles.hcpBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.stepTitle, { marginTop: 24 }]}>Holes</Text>
        <View style={s2.holeToggleRow}>
          <TouchableOpacity
            style={[s2.holeToggleBtn, !nineHole && s2.holeToggleBtnActive]}
            onPress={() => setNineHole(false)}
            activeOpacity={0.8}
          >
            <Text style={[s2.holeToggleTxt, !nineHole && s2.holeToggleTxtActive]}>18 Holes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s2.holeToggleBtn, nineHole && s2.holeToggleBtnActive]}
            onPress={() => setNineHole(true)}
            activeOpacity={0.8}
          >
            <Text style={[s2.holeToggleTxt, nineHole && s2.holeToggleTxtActive]}>9 Holes</Text>
          </TouchableOpacity>
        </View>

        {nineHole && (
          <View style={s2.nineSideRow}>
            <TouchableOpacity
              style={[s2.nineSideBtn, nineHoleSide === 'front' && s2.nineSideBtnActive]}
              onPress={() => setNineHoleSide('front')}
              activeOpacity={0.8}
            >
              <Text style={[s2.nineSideTxt, nineHoleSide === 'front' && s2.nineSideTxtActive]}>Front 9 (1–9)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s2.nineSideBtn, nineHoleSide === 'back' && s2.nineSideBtnActive]}
              onPress={() => setNineHoleSide('back')}
              activeOpacity={0.8}
            >
              <Text style={[s2.nineSideTxt, nineHoleSide === 'back' && s2.nineSideTxtActive]}>Back 9 (10–18)</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.nextBtn, !tee && styles.nextBtnDisabled]} onPress={onNext} disabled={!tee}>
          <Text style={styles.nextBtnText}>Enter Scores →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s2 = StyleSheet.create({
  holeToggleRow:        { flexDirection: 'row', gap: 10, marginTop: 8 },
  holeToggleBtn:        { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  holeToggleBtnActive:  { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  holeToggleTxt:        { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  holeToggleTxtActive:  { color: colors.primary, fontWeight: '700' },
  nineSideRow:          { flexDirection: 'row', gap: 10, marginTop: 10 },
  nineSideBtn:          { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  nineSideBtnActive:    { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  nineSideTxt:          { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  nineSideTxtActive:    { color: colors.primary, fontWeight: '700' },
});

function TeeInfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.teeInfoCell}>
      <Text style={styles.teeInfoValue}>{value}</Text>
      <Text style={styles.teeInfoLabel}>{label}</Text>
    </View>
  );
}

// ── Scan upload step ──────────────────────────────────────────────────────────

type PhotoSlot = { uri: string; base64: string; mimeType: string } | null;

function ScanUploadStep({ onComplete }: {
  onComplete: (result: ScanResult) => void;
}) {
  const [photo, setPhoto]       = useState<PhotoSlot>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function compressForScan(uri: string): Promise<{ base64: string; mimeType: string }> {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 800 } }],
      { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return { base64: result.base64!, mimeType: 'image/jpeg' };
  }

  async function pickPhoto() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to scan scorecards.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    const { base64, mimeType } = await compressForScan(result.assets[0].uri);
    setPhoto({ uri: result.assets[0].uri, base64, mimeType });
  }

  async function takePhoto() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow camera access to photograph your scorecard.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    const { base64, mimeType } = await compressForScan(result.assets[0].uri);
    setPhoto({ uri: result.assets[0].uri, base64, mimeType });
  }

  function showPickOptions() {
    Alert.alert('Add Photo', undefined, [
      { text: 'Take Photo',          onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickPhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function scanAndContinue() {
    if (!photo) return;
    setScanning(true);
    setError(null);
    try {
      const { data } = await client.post('/api/rounds/scan-scorecard', {
        imageBase64: photo.base64,
        mediaType: photo.mimeType,
      });
      const result: ScanResult = {
        scores:          data.scores          ?? [],
        holes:           data.holes           ?? [],
        pickups:         data.pickups         ?? [],
        courseName:      data.courseName      ?? null,
        teeName:         data.teeName         ?? null,
        stablefordTotal: data.stablefordTotal ?? null,
      };
      if (!result.scores.length && !result.pickups.length) {
        setError('No scores could be read. Try a clearer photo with better lighting.');
        return;
      }
      onComplete(result);
    } catch (err: any) {
      const d = err.response?.data;
      setError(d?.detail ?? d?.error ?? `Scan failed (${err.message ?? 'unknown'})`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={ssu.container} showsVerticalScrollIndicator={false}>
        <Text style={ssu.title}>Upload Scorecard</Text>
        <Text style={ssu.subtitle}>Upload a screenshot of your MiScore round. AI will read all 18 hole scores automatically.</Text>

        <PhotoSlotCard label="Scorecard Screenshot" photo={photo} onPress={showPickOptions} onRemove={() => setPhoto(null)} />

        {error && (
          <View style={ssu.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={ssu.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.nextBtn, !photo && styles.nextBtnDisabled]}
          onPress={scanAndContinue}
          disabled={!photo || scanning}
          activeOpacity={0.85}
        >
          {scanning
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.nextBtnText}>Scan & Continue →</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={ssu.skipBtn} onPress={() => onComplete({ scores: [], holes: [], pickups: [], courseName: null, teeName: null, stablefordTotal: null })}>
          <Text style={ssu.skipText}>Skip — enter scores manually</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PhotoSlotCard({ label, photo, onPress, onRemove }: {
  label: string;
  photo: PhotoSlot;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={ssu.slotWrap}>
      <Text style={ssu.slotLabel}>{label}</Text>
      {photo ? (
        <View style={ssu.previewWrap}>
          <Image source={{ uri: photo.uri }} style={ssu.preview} resizeMode="cover" />
          <View style={ssu.previewOverlay}>
            <TouchableOpacity style={ssu.previewBtn} onPress={onPress}>
              <Ionicons name="swap-horizontal" size={16} color="#fff" />
              <Text style={ssu.previewBtnText}>Replace</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ssu.previewBtn, ssu.previewBtnRemove]} onPress={onRemove}>
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={ssu.previewBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={ssu.emptySlot} onPress={onPress} activeOpacity={0.8}>
          <View style={ssu.emptyIcon}>
            <Ionicons name="camera-outline" size={28} color="#7c3aed" />
          </View>
          <Text style={ssu.emptyText}>Tap to add photo</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const ssu = StyleSheet.create({
  container:        { padding: 20, paddingTop: 24, paddingBottom: 12 },
  title:            { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 6 },
  subtitle:         { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: 24 },
  slotWrap:         { marginBottom: 20 },
  slotLabel:        { fontSize: 11, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  emptySlot:        { height: 140, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: '#c4b5fd', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon:        { width: 56, height: 56, borderRadius: 16, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  emptyText:        { fontSize: 14, color: '#7c3aed', fontWeight: '600' },
  previewWrap:      { borderRadius: 14, overflow: 'hidden', height: 180 },
  preview:          { width: '100%', height: '100%' },
  previewOverlay:   { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 8, padding: 10, backgroundColor: 'rgba(0,0,0,0.45)' },
  previewBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)' },
  previewBtnRemove: { backgroundColor: 'rgba(239,68,68,0.5)' },
  previewBtnText:   { fontSize: 13, color: '#fff', fontWeight: '600' },
  errorBox:         { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  errorText:        { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },
  skipBtn:          { alignItems: 'center', paddingVertical: 12 },
  skipText:         { fontSize: 13, color: colors.textSecondary, textDecorationLine: 'underline' },
});

// ── Scan review step ──────────────────────────────────────────────────────────

type ScanScore = { hole: number; score: number; par: number; si: number; scanPar: number | null; scanSi: number | null; stableford: number; pickup: boolean };

function ScanReviewStep({ scanResult, userHcpIdx, onSaved }: {
  scanResult: ScanResult;
  userHcpIdx: number;
  onSaved: (data: any, finalHoles: HoleEntry[], finalCourse: CourseResult) => void;
}) {
  const { width } = Dimensions.get('window');
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const [date, setDate]               = useState(today());
  const [query, setQuery]             = useState(scanResult.courseName ?? '');
  const [results, setResults]         = useState<CourseResult[]>([]);
  const [searching, setSearching]     = useState(false);
  const [course, setCourse]           = useState<CourseResult | null>(null);
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tees, setTees]               = useState<Tee[]>([]);
  const [teeIdx, setTeeIdx]           = useState(0);
  const [loadingTees, setLoadingTees] = useState(false);
  const [playingHcp, setPlayingHcp]   = useState('');
  const [saving, setSaving]           = useState(false);

  const [scores, setScores] = useState<ScanScore[]>(() => {
    const base: ScanScore[] = Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1, score: 0, par: 4, si: i + 1,
      scanPar: null as number | null, scanSi: null as number | null,
      stableford: 0, pickup: false,
    }));
    // Apply per-hole par and SI from the dedicated holes array (all 18 holes)
    for (const h of scanResult.holes) {
      const idx = base.findIndex(b => b.hole === h.hole);
      if (idx !== -1) base[idx] = { ...base[idx], scanPar: h.par, scanSi: h.si };
    }
    // Apply scores
    for (const s of scanResult.scores) {
      const idx = base.findIndex(b => b.hole === s.hole);
      if (idx !== -1) base[idx] = { ...base[idx], score: s.score, pickup: false };
    }
    for (const h of scanResult.pickups) {
      const idx = base.findIndex(b => b.hole === h);
      if (idx !== -1) base[idx] = { ...base[idx], score: 0, stableford: 0, pickup: true };
    }
    return base;
  });

  // Auto-search course name from scan
  useEffect(() => {
    if (scanResult.courseName && scanResult.courseName.trim().length >= 2) {
      onQueryChange(scanResult.courseName);
    }
  }, []);

  const selectedTee = tees[teeIdx] ?? null;

  function applyTee(tee: Tee, ph: number) {
    setScores(prev => prev.map(s => {
      const hole = tee.holes.find(h => h.number === s.hole);
      if (!hole) return s;
      const par = s.scanPar ?? hole.par;
      const si  = s.scanSi  ?? hole.si;
      if (s.pickup) return { ...s, par, si, stableford: 0 };
      const sc = s.score > 0 ? calcStableford(par, si, s.score, ph) : 0;
      return { ...s, par, si, stableford: sc };
    }));
  }

  useEffect(() => {
    if (!selectedTee) return;
    const ph = calcPlayingHandicap(userHcpIdx, selectedTee.slopeRating ?? 113, selectedTee.courseRating ?? 72, selectedTee.parTotal ?? 72);
    setPlayingHcp(String(ph));
    applyTee(selectedTee, ph);
  }, [teeIdx, selectedTee]);

  function onQueryChange(text: string) {
    setQuery(text);
    setCourse(null);
    setTees([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await client.get<{ courses: CourseResult[] }>('/api/courses/search', { params: { q: text } });
        setResults(data.courses);
      } finally { setSearching(false); }
    }, 300);
  }

  async function selectCourse(c: CourseResult) {
    setCourse(c);
    setQuery(c.club_name);
    setResults([]);
    setLoadingTees(true);
    try {
      const { data } = await client.get<{ tees: Tee[] }>(`/api/courses/detail/${c.id}`);
      setTees(data.tees);
      // Try to auto-match the tee name from the scan
      let matchIdx = 0;
      if (scanResult.teeName) {
        const scanTee = scanResult.teeName.toLowerCase();
        const found = data.tees.findIndex((t: Tee) =>
          t.name.toLowerCase().includes(scanTee) || t.colour?.toLowerCase().includes(scanTee)
        );
        if (found >= 0) matchIdx = found;
      }
      setTeeIdx(matchIdx);
      const tee = data.tees[matchIdx];
      if (tee) {
        const ph = calcPlayingHandicap(userHcpIdx, tee.slopeRating ?? 113, tee.courseRating ?? 72, tee.parTotal ?? 72);
        setPlayingHcp(String(ph));
        applyTee(tee, ph);
      }
      // Immediately persist scanned par/SI corrections for CSV courses
      if (tee && !c.id.startsWith('custom-') && scanResult.holes.length > 0) {
        const correctionHoles = scanResult.holes.map(h => ({ number: h.hole, par: h.par, si: h.si }));
        client.post(`/api/courses/${c.id}/corrections`, {
          teeName: tee.name,
          holes:   correctionHoles,
        }).catch(() => {});
      }
    } finally { setLoadingTees(false); }
  }

  function adjScore(holeNum: number, delta: number) {
    const ph = parseInt(playingHcp, 10) || 0;
    setScores(prev => prev.map(s => {
      if (s.hole !== holeNum) return s;
      const base = s.pickup ? 0 : s.score;
      const n = Math.max(1, base + delta);
      const sb = selectedTee ? calcStableford(s.par, s.si, n, ph) : 0;
      return { ...s, score: n, stableford: sb, pickup: false };
    }));
  }

  async function save() {
    if (!course) { Alert.alert('Course required', 'Please select a course before saving.'); return; }
    setSaving(true);
    try {
      const ph = parseInt(playingHcp, 10) || 0;
      const scoredHoles = scores.filter(s => s.score > 0 && !s.pickup);
      const totalStrokes    = scoredHoles.reduce((sum, s) => sum + s.score, 0);
      const totalStableford = scoredHoles.reduce((sum, s) => sum + s.stableford, 0);
      const { data } = await client.post('/api/rounds', {
        playedAt:   date,
        courseName: course.club_name,
        score:      totalStrokes,
        stableford: totalStableford,
        roundType:  'social',
        isNineHole: scoredHoles.length <= 9,
        slopeRating:    selectedTee?.slopeRating ?? null,
        courseRating:   selectedTee?.courseRating ?? null,
        courseHandicap: ph,
        holes:      scoredHoles.map(s => ({
          holeNumber: s.hole, par: s.par, strokeIndex: s.si,
          score: s.score, stablefordPoints: s.stableford,
          fairwayHit: null, gir: null, putts: null,
        })),
      });
      const finalHoles: HoleEntry[] = scoredHoles.map(s => ({
        holeNumber: s.hole, par: s.par, strokeIndex: s.si,
        score: s.score, scored: true, stablefordPoints: s.stableford,
        fairwayHit: null, gir: null, putts: null,
      }));

      onSaved(data, finalHoles, course);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error ?? 'Could not save round');
    } finally {
      setSaving(false);
    }
  }

  const LABEL_W = 52;
  const COL_W   = (width - LABEL_W - 16) / 9;

  function renderNine(start: number) {
    const nine  = scores.slice(start, start + 9);
    const label = start === 0 ? 'FRONT 9' : 'BACK 9';
    const total = nine.filter(h => h.score > 0).reduce((s, h) => s + h.score, 0);
    const pts   = nine.reduce((s, h) => s + h.stableford, 0);

    return (
      <View key={start} style={{ width }}>
        <View style={sr.sectionHeader}>
          <Text style={sr.sectionTitle}>{label}</Text>
          <View style={sr.sectionTotals}>
            {total > 0 && <Text style={sr.sectionScr}>{total} strokes</Text>}
            {selectedTee && pts > 0 && <Text style={sr.sectionPts}>{pts} pts</Text>}
          </View>
        </View>

        <View style={sr.tableWrap}>
          <View style={sr.row}>
            <View style={[sr.labelCell, { width: LABEL_W }]}><Text style={sr.labelTxt}>HOLE</Text></View>
            {nine.map(h => (
              <View key={h.hole} style={[sr.dataCell, { width: COL_W }]}>
                <Text style={sr.holeTxt}>{h.hole}</Text>
              </View>
            ))}
          </View>

          <View style={[sr.row, { backgroundColor: '#f1f5f9' }]}>
            <View style={[sr.labelCell, { width: LABEL_W }]}><Text style={sr.labelTxt}>PAR</Text></View>
            {nine.map(h => (
              <View key={h.hole} style={[sr.dataCell, { width: COL_W }]}>
                <Text style={sr.parTxt}>{selectedTee ? h.par : '—'}</Text>
              </View>
            ))}
          </View>

          <View style={[sr.row, { minHeight: 90 }]}>
            <View style={[sr.labelCell, { width: LABEL_W }]}><Text style={sr.labelTxt}>SCR</Text></View>
            {nine.map(h => {
              const diff = selectedTee && h.score > 0 ? h.score - h.par : 0;
              const sc = h.pickup
                ? '#f97316'
                : h.score === 0 ? colors.border
                : !selectedTee ? colors.primary
                : diff <= -2 ? '#f59e0b' : diff === -1 ? '#3b82f6' : diff === 0 ? colors.primary : diff === 1 ? '#f97316' : colors.danger;
              return (
                <View key={h.hole} style={[sr.dataCell, sr.adjStack, { width: COL_W }]}>
                  <TouchableOpacity onPress={() => adjScore(h.hole, +1)} hitSlop={{ top: 4, bottom: 2, left: 8, right: 8 }} style={sr.adjBtn}>
                    <Text style={sr.adjTxt}>+</Text>
                  </TouchableOpacity>
                  <Text style={[sr.scoreTxt, { color: sc }]}>{h.pickup ? 'P' : h.score > 0 ? h.score : '—'}</Text>
                  <TouchableOpacity onPress={() => adjScore(h.hole, -1)} hitSlop={{ top: 2, bottom: 4, left: 8, right: 8 }} style={sr.adjBtn}>
                    <Text style={sr.adjTxt}>−</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          {selectedTee && (
            <View style={[sr.row, { backgroundColor: '#f1f5f9' }]}>
              <View style={[sr.labelCell, { width: LABEL_W }]}><Text style={sr.labelTxt}>PTS</Text></View>
              {nine.map(h => (
                <View key={h.hole} style={[sr.dataCell, { width: COL_W }]}>
                  <Text style={[sr.ptsTxt, h.stableford >= 3 ? sr.ptsGold : h.stableford >= 2 ? sr.ptsGreen : sr.ptsDim]}>
                    {h.pickup ? <Text style={{ color: '#f97316' }}>P</Text> : h.score > 0 ? h.stableford : '—'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={sr.swipeHint}>
          {start === 0
            ? <Text style={sr.swipeHintTxt}>Swipe for Back 9  →</Text>
            : <Text style={sr.swipeHintTxt}>←  Swipe for Front 9</Text>}
        </View>
      </View>
    );
  }

  const DATE_OPTS = [
    { label: 'Today',     value: new Date().toISOString().split('T')[0] },
    { label: 'Yesterday', value: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
  ];

  const scoredHoles     = scores.filter(s => s.score > 0 && !s.pickup);
  const totalStrokes    = scoredHoles.reduce((s, h) => s + h.score, 0);
  const totalStableford = scoredHoles.reduce((s, h) => s + h.stableford, 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={sr.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <Text style={sr.pageTitle}>Review Your Round</Text>

        {/* Date */}
        <Text style={sr.fieldLabel}>Date Played</Text>
        <View style={sr.dateRow}>
          {DATE_OPTS.map(opt => (
            <TouchableOpacity key={opt.value} style={[sr.datePill, date === opt.value && sr.datePillActive]}
              onPress={() => setDate(opt.value)}>
              <Text style={[sr.datePillText, date === opt.value && sr.datePillTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={[sr.datePill, sr.dateInput, !DATE_OPTS.find(o => o.value === date) && sr.datePillActive]}
            value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numeric"
          />
        </View>

        {/* Course */}
        <Text style={[sr.fieldLabel, { marginTop: 18 }]}>Course</Text>
        <View style={sr.searchWrap}>
          <TextInput
            style={sr.searchInput}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search course name…"
            autoCapitalize="none"
            returnKeyType="search"
          />
          {(searching || loadingTees) && <ActivityIndicator style={{ marginRight: 12 }} color={colors.primary} />}
        </View>
        {results.length > 0 && (
          <View style={sr.resultsList}>
            {results.map(r => (
              <TouchableOpacity key={r.id} style={sr.resultRow} onPress={() => selectCourse(r)}>
                <Text style={sr.resultName}>{r.club_name}</Text>
                <Text style={sr.resultSub}>{r.location.city}, {r.location.country}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {course && (
          <View style={sr.selectedBadge}>
            <Ionicons name="golf-outline" size={16} color={colors.primary} />
            <Text style={sr.selectedBadgeName}>{course.club_name}</Text>
          </View>
        )}

        {/* Tee */}
        {tees.length > 0 && (
          <>
            <Text style={[sr.fieldLabel, { marginTop: 18 }]}>Tee</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {tees.map((t, i) => (
                <TouchableOpacity key={t.name} style={[sr.teePill, i === teeIdx && sr.teePillActive]}
                  onPress={() => setTeeIdx(i)}>
                  <View style={[sr.teeColourDot, { backgroundColor: t.colour.toLowerCase() === 'white' ? '#e5e7eb' : t.colour.toLowerCase() }]} />
                  <Text style={[sr.teePillText, i === teeIdx && sr.teePillTextActive]}>{t.colour}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {selectedTee && (
              <Text style={sr.teeInfoLine}>
                CR {selectedTee.courseRating?.toFixed(1) ?? '—'} · Slope {selectedTee.slopeRating ?? '—'} · Par {selectedTee.parTotal ?? '—'} · Playing HCP {playingHcp}
              </Text>
            )}
          </>
        )}

        {/* Score grid */}
        <Text style={[sr.fieldLabel, { marginTop: 22 }]}>Scores</Text>
        {!selectedTee && (
          <Text style={sr.noTeeNote}>Select a course & tee to see par and stableford points</Text>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          style={{ marginHorizontal: -20 }}
          contentContainerStyle={{ flexGrow: 0 }}
        >
          {renderNine(0)}
          {renderNine(9)}
        </ScrollView>

        <View style={sr.dotRow}>
          {[0, 1].map(i => (
            <TouchableOpacity key={i} onPress={() => { scrollRef.current?.scrollTo({ x: i * width, animated: true }); setPage(i); }}>
              <View style={[sr.pageDot, i === page && sr.pageDotActive]} />
            </TouchableOpacity>
          ))}
        </View>

        {totalStrokes > 0 && (
          <View style={sr.totalsRow}>
            <View style={sr.totalCard}>
              <Text style={sr.totalVal}>{totalStrokes}</Text>
              <Text style={sr.totalLabel}>Strokes</Text>
            </View>
            {selectedTee && (
              <View style={sr.totalCard}>
                <Text style={[sr.totalVal, { color: colors.primary }]}>{totalStableford}</Text>
                <Text style={sr.totalLabel}>Stableford pts</Text>
              </View>
            )}
          </View>
        )}

      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.nextBtn, (!course || saving) && styles.nextBtnDisabled]}
          onPress={save}
          disabled={!course || saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.nextBtnText}>Save Round</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const sr = StyleSheet.create({
  container:          { padding: 20, paddingTop: 16, paddingBottom: 12 },
  pageTitle:          { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 20 },
  fieldLabel:         { fontSize: 11, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  dateRow:            { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  datePill:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  datePillActive:     { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  datePillText:       { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  datePillTextActive: { color: colors.primary },
  dateInput:          { flex: 1, minWidth: 120, fontSize: 13, color: colors.textPrimary },
  searchWrap:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface },
  searchInput:        { flex: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.textPrimary },
  resultsList:        { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, marginTop: 4, overflow: 'hidden' },
  resultRow:          { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultName:         { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  resultSub:          { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  selectedBadge:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: colors.primary + '12', borderRadius: 10, padding: 10 },
  selectedBadgeName:  { fontSize: 14, fontWeight: '600', color: colors.primary, flex: 1 },
  teePill:            { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8 },
  teePillActive:      { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  teeColourDot:       { width: 12, height: 12, borderRadius: 6 },
  teePillText:        { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  teePillTextActive:  { color: colors.primary },
  teeInfoLine:        { fontSize: 12, color: colors.textSecondary, marginTop: 8 },
  noTeeNote:          { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginBottom: 8 },
  sectionHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 28, paddingTop: 12, paddingBottom: 8 },
  sectionTitle:       { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  sectionTotals:      { alignItems: 'flex-end', gap: 1 },
  sectionScr:         { fontSize: 11, color: colors.textSecondary },
  sectionPts:         { fontSize: 13, fontWeight: '700', color: colors.primary },
  tableWrap:          { marginHorizontal: 8, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  row:                { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  labelCell:          { justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#f8fafc' },
  labelTxt:           { fontSize: 8, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  dataCell:           { justifyContent: 'center', alignItems: 'center', paddingVertical: 5 },
  adjStack:           { paddingVertical: 3 },
  adjBtn:             { width: '100%', alignItems: 'center', paddingVertical: 4 },
  adjTxt:             { fontSize: 16, fontWeight: '800', color: colors.primary, lineHeight: 18 },
  holeTxt:            { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  parTxt:             { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  scoreTxt:           { fontSize: 20, fontWeight: '800', textAlign: 'center', lineHeight: 26 },
  ptsTxt:             { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  ptsGold:            { color: '#f59e0b' },
  ptsGreen:           { color: colors.primary },
  ptsDim:             { color: colors.textSecondary },
  swipeHint:          { alignItems: 'center', paddingVertical: 6 },
  swipeHintTxt:       { fontSize: 11, color: colors.textSecondary },
  dotRow:             { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: 10, marginTop: 4 },
  pageDot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  pageDotActive:      { width: 20, backgroundColor: colors.primary },
  totalsRow:          { flexDirection: 'row', gap: 12, marginTop: 16 },
  totalCard:          { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center' },
  totalVal:           { fontSize: 28, fontWeight: '800', color: colors.textPrimary },
  totalLabel:         { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});

// ── Past round score grid ─────────────────────────────────────────────────────

function PastRoundScoreGrid({ holes, setHoles, onNext, playingHcp }: any) {
  const { width } = Dimensions.get('window');
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [scanning, setScanning] = useState(false);

  async function handleScan() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to scan scorecards.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const compressed = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 800 } }],
      { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    setScanning(true);
    try {
      const { data } = await client.post('/api/rounds/scan-scorecard', {
        imageBase64: compressed.base64,
        mediaType: 'image/jpeg',
      });
      const scores: { hole: number; score: number }[] = data.scores ?? [];
      if (!scores.length) {
        Alert.alert('No scores found', 'Could not read any scores from this image. Try a clearer photo.');
        return;
      }
      const preview = scores.map((s: { hole: number; score: number }) => `H${s.hole}: ${s.score}`).join('   ');
      Alert.alert(
        'Scores found — apply?',
        preview,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Apply',
            onPress: () => {
              const ph = parseInt(playingHcp, 10) || 0;
              setHoles((prev: HoleEntry[]) => prev.map((h: HoleEntry) => {
                const found = scores.find((s: { hole: number; score: number }) => s.hole === h.holeNumber);
                if (!found) return h;
                const s = found.score;
                return { ...h, score: s, scored: true, stablefordPoints: calcStableford(h.par, h.strokeIndex, s, ph) };
              }));
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Scan failed', err.response?.data?.error ?? 'Could not scan scorecard. Try again.');
    } finally {
      setScanning(false);
    }
  }

  const LABEL_W = 46;
  const COL_W   = (width - LABEL_W - 16) / 9; // 8px margin each side

  function adjScore(idx: number, d: number) {
    setHoles((prev: HoleEntry[]) => prev.map((h: HoleEntry, i: number) => {
      if (i !== idx) return h;
      const ph = parseInt(playingHcp, 10) || 0;
      const s  = Math.max(1, h.score + d);
      return { ...h, score: s, scored: true, stablefordPoints: calcStableford(h.par, h.strokeIndex, s, ph) };
    }));
  }

  function cycleFIR(idx: number) {
    setHoles((prev: HoleEntry[]) => prev.map((h: HoleEntry, i: number) => {
      if (i !== idx) return h;
      const v = h.fairwayHit === null ? true : h.fairwayHit === true ? false : null;
      return { ...h, fairwayHit: v };
    }));
  }

  function cycleGIR(idx: number) {
    setHoles((prev: HoleEntry[]) => prev.map((h: HoleEntry, i: number) => {
      if (i !== idx) return h;
      const v = h.gir === null ? true : h.gir === true ? false : null;
      return { ...h, gir: v };
    }));
  }

  function adjPutts(idx: number, d: number) {
    setHoles((prev: HoleEntry[]) => prev.map((h: HoleEntry, i: number) => {
      if (i !== idx) return h;
      if (h.putts === null) return { ...h, putts: d > 0 ? 0 : null };
      const n = h.putts + d;
      return { ...h, putts: n < 0 ? null : n };
    }));
  }

  function renderNine(start: number) {
    const nine      = holes.slice(start, start + 9);
    const label     = start === 0 ? 'FRONT 9' : 'BACK 9';
    const totalPts  = nine.filter((h: HoleEntry) => h.scored).reduce((s: number, h: HoleEntry) => s + h.stablefordPoints, 0);
    const totalScr  = nine.filter((h: HoleEntry) => h.scored).reduce((s: number, h: HoleEntry) => s + h.score, 0);

    return (
      <View key={start} style={{ width }}>
        <View style={pg.sectionHeader}>
          <Text style={pg.sectionTitle}>{label}</Text>
          <View style={pg.sectionTotals}>
            <Text style={pg.sectionScr}>{totalScr} strokes</Text>
            <Text style={pg.sectionPts}>{totalPts} pts</Text>
          </View>
        </View>

        <View style={pg.tableWrap}>
          {/* Hole numbers */}
          <View style={pg.row}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>HOLE</Text></View>
            {nine.map((h: HoleEntry) => (
              <View key={h.holeNumber} style={[pg.dataCell, { width: COL_W }]}>
                <Text style={pg.holeTxt}>{h.holeNumber}</Text>
              </View>
            ))}
          </View>

          {/* Par */}
          <View style={[pg.row, { backgroundColor: '#f1f5f9' }]}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>PAR</Text></View>
            {nine.map((h: HoleEntry) => (
              <View key={h.holeNumber} style={[pg.dataCell, { width: COL_W }]}>
                <Text style={pg.parTxt}>{h.par}</Text>
              </View>
            ))}
          </View>

          {/* Score */}
          <View style={[pg.row, { backgroundColor: colors.surface, minHeight: 90 }]}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>SCR</Text></View>
            {nine.map((h: HoleEntry, i: number) => {
              const diff = h.score - h.par;
              const sc = !h.scored ? '#bbb' : diff <= -2 ? '#f59e0b' : diff === -1 ? '#3b82f6' : diff === 0 ? colors.primary : diff === 1 ? '#f97316' : colors.danger;
              return (
                <View key={h.holeNumber} style={[pg.dataCell, pg.adjStack, { width: COL_W }]}>
                  <TouchableOpacity onPress={() => adjScore(start + i, +1)} hitSlop={{ top: 4, bottom: 2, left: 8, right: 8 }} style={pg.adjBtn}>
                    <Text style={pg.adjTxt}>+</Text>
                  </TouchableOpacity>
                  <Text style={[pg.scoreTxt, { color: sc }]}>{h.scored ? h.score : '—'}</Text>
                  <TouchableOpacity onPress={() => adjScore(start + i, -1)} hitSlop={{ top: 2, bottom: 4, left: 8, right: 8 }} style={pg.adjBtn}>
                    <Text style={pg.adjTxt}>−</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={pg.sectionDivider} />

          {/* FIR */}
          <View style={pg.row}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>FIR</Text></View>
            {nine.map((h: HoleEntry, i: number) => (
              <TouchableOpacity
                key={h.holeNumber}
                style={[pg.dataCell, { width: COL_W }]}
                onPress={() => { if (h.par !== 3) cycleFIR(start + i); }}
                activeOpacity={h.par === 3 ? 1 : 0.65}
              >
                {h.par === 3
                  ? <Text style={pg.naTxt}>—</Text>
                  : <View style={[pg.indicator, h.fairwayHit === true && pg.indGreen, h.fairwayHit === false && pg.indRed]}>
                      <Text style={[pg.indTxt, h.fairwayHit !== null && pg.indTxtOn]}>
                        {h.fairwayHit === true ? 'Y' : h.fairwayHit === false ? 'N' : '·'}
                      </Text>
                    </View>
                }
              </TouchableOpacity>
            ))}
          </View>

          {/* GIR */}
          <View style={[pg.row, { backgroundColor: '#f1f5f9' }]}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>GIR</Text></View>
            {nine.map((h: HoleEntry, i: number) => (
              <TouchableOpacity
                key={h.holeNumber}
                style={[pg.dataCell, { width: COL_W }]}
                onPress={() => cycleGIR(start + i)}
                activeOpacity={0.65}
              >
                <View style={[pg.indicator, h.gir === true && pg.indGreen, h.gir === false && pg.indRed]}>
                  <Text style={[pg.indTxt, h.gir !== null && pg.indTxtOn]}>
                    {h.gir === true ? 'Y' : h.gir === false ? 'N' : '·'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Putts */}
          <View style={[pg.row, { minHeight: 78 }]}>
            <View style={[pg.labelCell, { width: LABEL_W }]}><Text style={pg.labelTxt}>PUTT</Text></View>
            {nine.map((h: HoleEntry, i: number) => (
              <View key={h.holeNumber} style={[pg.dataCell, pg.adjStack, { width: COL_W }]}>
                <TouchableOpacity onPress={() => adjPutts(start + i, +1)} hitSlop={{ top: 4, bottom: 2, left: 8, right: 8 }} style={pg.adjBtn}>
                  <Text style={pg.adjTxt}>+</Text>
                </TouchableOpacity>
                <Text style={pg.puttTxt}>{h.putts === null ? 'N/A' : h.putts}</Text>
                <TouchableOpacity onPress={() => adjPutts(start + i, -1)} hitSlop={{ top: 2, bottom: 4, left: 8, right: 8 }} style={pg.adjBtn}>
                  <Text style={pg.adjTxt}>−</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {/* Swipe hint */}
        <View style={pg.swipeHint}>
          {start === 0
            ? <Text style={pg.swipeHintTxt}>Swipe for Back 9  →</Text>
            : <Text style={pg.swipeHintTxt}>←  Swipe for Front 9</Text>
          }
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Scan button */}
      <TouchableOpacity style={pg.scanRow} onPress={handleScan} disabled={scanning} activeOpacity={0.8}>
        {scanning
          ? <ActivityIndicator size="small" color="#7c3aed" />
          : <Ionicons name="camera-outline" size={18} color="#7c3aed" />}
        <Text style={pg.scanTxt}>{scanning ? 'Scanning…' : 'Scan scorecard image'}</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 0 }}
      >
        {renderNine(0)}
        {renderNine(9)}
      </ScrollView>

      {/* Page dots */}
      <View style={pg.dotRow}>
        {[0, 1].map(i => (
          <TouchableOpacity key={i} onPress={() => {
            scrollRef.current?.scrollTo({ x: i * width, animated: true });
            setPage(i);
          }}>
            <View style={[pg.pageDot, i === page && pg.pageDotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
          <Text style={styles.nextBtnText}>Review →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const pg = StyleSheet.create({
  sectionHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingTop: 14, paddingBottom: 10 },
  sectionTitle:   { fontSize: 16, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.4 },
  sectionTotals:  { alignItems: 'flex-end', gap: 2 },
  sectionScr:     { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  sectionPts:     { fontSize: 14, fontWeight: '700', color: colors.primary },
  tableWrap:      { marginHorizontal: 8, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  row:            { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionDivider: { height: 2, backgroundColor: colors.border },
  labelCell:      { justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#f8fafc' },
  labelTxt:       { fontSize: 8, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  dataCell:       { justifyContent: 'center', alignItems: 'center', paddingVertical: 5 },
  adjStack:       { paddingVertical: 3 },
  adjBtn:         { width: '100%', alignItems: 'center', paddingVertical: 4 },
  adjTxt:         { fontSize: 16, fontWeight: '800', color: colors.primary, lineHeight: 18 },
  holeTxt:        { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  parTxt:         { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  scoreTxt:       { fontSize: 20, fontWeight: '800', textAlign: 'center', lineHeight: 26 },
  indicator:      { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  indGreen:       { backgroundColor: '#22c55e' },
  indRed:         { backgroundColor: '#ef4444' },
  indTxt:         { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
  indTxtOn:       { color: '#fff' },
  naTxt:          { fontSize: 11, color: colors.textSecondary },
  puttTxt:        { fontSize: 14, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
  swipeHint:      { alignItems: 'center', paddingVertical: 6 },
  swipeHintTxt:   { fontSize: 11, color: colors.textSecondary },
  dotRow:         { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: 6 },
  pageDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  pageDotActive:  { width: 20, backgroundColor: colors.primary },
  scanRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 16, marginTop: 10, marginBottom: 4, paddingVertical: 10, borderRadius: 12, backgroundColor: '#ede9fe', borderWidth: 1, borderColor: '#c4b5fd' },
  scanTxt:        { fontSize: 14, fontWeight: '700', color: '#7c3aed' },
});

// ── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({ holes, holeIdx, setHoleIdx, adjustScore, onNext, playingHcp, setFIR, setGIR, adjustPutts,
                  pickedUpHoles, togglePickup,
                  course, onExit, onFinish, groupRoundId, roundMode, fetchGroupScores, setShowGroupScores }: any) {
  const insets = useSafeAreaInsets();
  const hole: HoleEntry | undefined = holes[holeIdx];

  const isPU = pickedUpHoles[holeIdx] ?? false;
  const togglePU = togglePickup;

  if (!hole) return null;

  const ph    = Number(playingHcp) || 0;
  const extra = Math.floor(ph / 18) + (hole.strokeIndex <= ph % 18 ? 1 : 0);
  const pts   = hole.stablefordPoints;
  const color = isPU ? '#ff8a7a' : (hole.scored ? d3Color(pts) : 'rgba(255,255,255,0.25)');

  // Running totals – exclude unscored and picked-up holes' gross strokes.
  // Stableford points don't need the filter: a pick-up already forces stablefordPoints to 0.
  const totalStrokes    = (holes as HoleEntry[]).filter((h, i) => h.scored && !pickedUpHoles[i]).reduce((s, h) => s + h.score, 0);
  const totalStableford = (holes as HoleEntry[]).filter((h) => h.scored).reduce((s, h) => s + h.stablefordPoints, 0);

  // ── Arc animation ─────────────────────────────────────────────────────────────
  const arcOffset  = useRef(new Animated.Value(D3_MAX)).current;
  const minusScale = useRef(new Animated.Value(1)).current;
  const plusScale  = useRef(new Animated.Value(1)).current;
  const prevIdxRef = useRef(holeIdx);

  useEffect(() => {
    const target = (isPU || !hole.scored) ? D3_MAX : D3_MAX * (1 - d3FillRatio(hole.score));
    if (prevIdxRef.current !== holeIdx) {
      arcOffset.setValue(target);
      prevIdxRef.current = holeIdx;
    } else {
      Animated.timing(arcOffset, { toValue: target, duration: 200, useNativeDriver: false }).start();
    }
  }, [hole.score, hole.scored, holeIdx, isPU]);

  function springBtn(anim: Animated.Value) {
    Animated.sequence([
      Animated.spring(anim, { toValue: 0.91, speed: 60, bounciness: 0, useNativeDriver: true }),
      Animated.spring(anim, { toValue: 1,    speed: 40, bounciness: 8, useNativeDriver: true }),
    ]).start();
  }

  const isFirst = holeIdx === 0;
  const isLast  = holeIdx === holes.length - 1;

  // Stroke colour for arc
  const arcStroke = isPU ? 'rgba(192,57,43,0.4)' : color;

  return (
    <View style={styles.s3Root}>

      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <View style={[styles.s3Header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={onExit} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
          <Text style={styles.s3ExitText}>Exit</Text>
        </TouchableOpacity>
        <Text style={styles.s3CourseName} numberOfLines={1}>{course?.club_name ?? ''}</Text>
        {groupRoundId ? (
          <TouchableOpacity style={styles.s3GroupPill} onPress={() => { fetchGroupScores(); setShowGroupScores(true); }}>
            <Ionicons name="people" size={13} color="#fff" />
            <Text style={styles.s3GroupPillText}>Group</Text>
          </TouchableOpacity>
        ) : (
          <LinearGradient colors={['#4e8a27', '#3d6b1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.s3FinishPill}>
            <TouchableOpacity onPress={onFinish}>
              <Text style={styles.s3FinishText}>{roundMode === 'past' ? 'Review' : 'Finish'}</Text>
            </TouchableOpacity>
          </LinearGradient>
        )}
      </View>

      {groupRoundId && (
        <View style={styles.s3GroupBar}>
          <LinearGradient colors={['#4e8a27', '#3d6b1f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.s3FinishPill}>
            <TouchableOpacity onPress={onFinish}>
              <Text style={styles.s3FinishText}>Finish Round</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      )}

      {roundMode !== 'past' && (
        <View style={styles.s3LiveBar}>
          <View style={styles.s3LiveDot} />
          <Text style={styles.s3LiveText}>LIVE · SAVING</Text>
        </View>
      )}

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Hole header */}
        <View style={styles.s3HoleHeader}>
          <TouchableOpacity
            style={[styles.s3HoleNavBtn, isFirst && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))}
            disabled={isFirst}
          >
            <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <View style={styles.s3HoleTitleBlock}>
            <Text style={styles.s3HoleLabel}>HOLE</Text>
            <Text style={styles.s3HoleNum}>{hole.holeNumber}</Text>
          </View>
          <TouchableOpacity
            style={[styles.s3HoleNavBtn, isLast && { opacity: 0.3 }]}
            onPress={() => setHoleIdx(Math.min(holes.length - 1, holeIdx + 1))}
            disabled={isLast}
          >
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* Meta pills */}
        <View style={styles.s3MetaRow}>
          <View style={styles.s3MetaPill}>
            <Text style={styles.s3MetaPillText}>Par {hole.par}</Text>
          </View>
          <View style={styles.s3MetaPill}>
            <Text style={styles.s3MetaPillText}>SI {hole.strokeIndex}</Text>
          </View>
          {extra > 0 && (
            <View style={[styles.s3MetaPill, styles.s3ShotsPill]}>
              <View style={styles.s3ShotsDot} />
              <Text style={[styles.s3MetaPillText, styles.s3ShotsPillText]}>
                {extra} shot{extra !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Dial */}
        <View style={styles.s3DialFlex}>
          <View style={styles.s3DialWrap}>
            <Svg width={180} height={180} viewBox="0 0 210 210">
              <SvgCircle cx={D3_CX} cy={D3_CY} r={D3_R} fill="none"
                stroke="rgba(255,255,255,0.08)" strokeWidth={D3_SW + 2} />
              <AnimatedD3Circle
                cx={D3_CX} cy={D3_CY} r={D3_R}
                fill="none"
                stroke={arcStroke}
                strokeWidth={D3_SW}
                strokeLinecap="round"
                strokeDasharray={`${D3_MAX} ${D3_CIRC}`}
                strokeDashoffset={arcOffset}
                transform={`rotate(${D3_ROT}, ${D3_CX}, ${D3_CY})`}
              />
            </Svg>
            <View style={styles.s3DialCenter} pointerEvents="none">
              {isPU ? (
                <>
                  <Text style={[styles.s3DialScore, { color: '#ff8a7a', fontSize: 38 }]}>PU</Text>
                  <Text style={[styles.s3DialOutcome, { color: '#ff8a7a' }]}>Picked up</Text>
                  <Text style={styles.s3DialNet}>0 pts</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.s3DialScore, { color }]}>
                    {hole.scored ? hole.score : '—'}
                  </Text>
                  <Text style={[styles.s3DialOutcome, { color }]}>
                    {hole.scored ? d3GrossLabel(hole.score, hole.par) : ''}
                  </Text>
                  <Text style={styles.s3DialNet}>
                    {hole.scored ? `${pts} pts` : '0 pts'}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* +/- buttons */}
        <View style={styles.s3BtnRow}>
          <Animated.View style={{ transform: [{ scale: minusScale }] }}>
            <TouchableOpacity
              style={[styles.s3ScoreBtn, styles.s3MinusBtn, isPU && { opacity: 0.3 }]}
              onPress={() => { if (!isPU) { springBtn(minusScale); adjustScore(-1); } }}
              disabled={isPU}
              activeOpacity={0.8}
            >
              <Ionicons name="remove" size={26} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={{ transform: [{ scale: plusScale }] }}>
            <LinearGradient
              colors={isPU ? ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.05)'] : ['#4e8a27', '#3d6b1f']}
              style={styles.s3PlusBtnGrad}
            >
              <TouchableOpacity
                style={styles.s3PlusBtnInner}
                onPress={() => { if (!isPU) { springBtn(plusScale); adjustScore(+1); } }}
                disabled={isPU}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={26} color={isPU ? 'rgba(255,255,255,0.2)' : '#fff'} />
              </TouchableOpacity>
            </LinearGradient>
          </Animated.View>
        </View>

        {/* Pick up button */}
        <View style={styles.s3PuWrap}>
          <TouchableOpacity
            style={[styles.s3PuBtn, isPU && styles.s3PuBtnUndo]}
            onPress={togglePU}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPU ? 'refresh-outline' : 'close-circle-outline'}
              size={14}
              color={isPU ? 'rgba(255,255,255,0.45)' : '#ff8a7a'}
            />
            <Text style={[styles.s3PuBtnTx, isPU && styles.s3PuBtnUndoTx]}>
              {isPU ? 'Undo pick up' : 'Pick up'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Summary bar */}
        <View style={styles.s3SummaryBar}>
          <View style={styles.s3SumItem}>
            <Text style={styles.s3SumVal}>{totalStrokes}</Text>
            <Text style={styles.s3SumLabel}>Gross</Text>
          </View>
          <View style={styles.s3SumDivider} />
          <View style={styles.s3SumItem}>
            <Text style={[styles.s3SumVal, { color: '#a8e063' }]}>{totalStableford}</Text>
            <Text style={styles.s3SumLabel}>Stableford</Text>
          </View>
          <View style={styles.s3SumDivider} />
          <View style={styles.s3SumItem}>
            <Text style={styles.s3SumVal}>
              {holeIdx + 1}<Text style={styles.s3SumDenom}>/{holes.length}</Text>
            </Text>
            <Text style={styles.s3SumLabel}>Hole</Text>
          </View>
        </View>

        {/* Stats stack */}
        <View style={styles.s3StatsStack}>

          {/* Fairway */}
          <View style={styles.s3StatCard}>
            <Text style={styles.s3StatCardLabel}>Fairway</Text>
            <View style={styles.s3TogRow}>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.fairwayHit === true && styles.s3TogBtnHit]}
                onPress={() => setFIR(hole.fairwayHit === true ? null : true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.fairwayHit === true && styles.s3TogTxHit]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.fairwayHit === false && styles.s3TogBtnMiss]}
                onPress={() => setFIR(hole.fairwayHit === false ? null : false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.fairwayHit === false && styles.s3TogTxMiss]}>Miss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.fairwayHit === null && styles.s3TogBtnNA]}
                onPress={() => setFIR(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.fairwayHit === null && styles.s3TogTxNA]}>N/A</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* GIR */}
          <View style={styles.s3StatCard}>
            <Text style={styles.s3StatCardLabel}>Green in Regulation (GIR)</Text>
            <View style={styles.s3TogRow}>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.gir === true && styles.s3TogBtnHit]}
                onPress={() => setGIR(hole.gir === true ? null : true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.gir === true && styles.s3TogTxHit]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.gir === false && styles.s3TogBtnMiss]}
                onPress={() => setGIR(hole.gir === false ? null : false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.gir === false && styles.s3TogTxMiss]}>Miss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.s3TogBtn, hole.gir === null && styles.s3TogBtnNA]}
                onPress={() => setGIR(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TogBtnTx, hole.gir === null && styles.s3TogTxNA]}>N/A</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Putts */}
          <View style={styles.s3StatCard}>
            <View style={styles.s3PuttsTop}>
              <Text style={styles.s3StatCardLabel}>Putts</Text>
              {hole.putts !== null && hole.scored && (
                <Text style={styles.s3PuttsHint}>on green in {hole.score - hole.putts}</Text>
              )}
            </View>
            <View style={styles.s3PuttsControls}>
              <TouchableOpacity
                style={styles.s3PuttsCircBtn}
                onPress={() => adjustPutts(-1)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="remove" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
              <Text style={styles.s3PuttsNum}>{hole.putts === null ? '—' : hole.putts}</Text>
              <TouchableOpacity
                style={styles.s3PuttsCircBtn}
                onPress={() => adjustPutts(+1)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="add" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          </View>

        </View>{/* end stats stack */}

        {/* Next / Review button */}
        <View style={styles.s3NextWrap}>
          <LinearGradient
            colors={['#4e8a27', '#3d6b1f']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.s3NextGrad}
          >
            <TouchableOpacity
              style={styles.s3NextBtn}
              onPress={isLast ? onNext : () => setHoleIdx(holeIdx + 1)}
              activeOpacity={0.88}
            >
              <Text style={styles.s3NextBtnTx}>
                {isLast ? 'Review Round' : 'Next Hole'}
              </Text>
              <Ionicons
                name={isLast ? 'checkmark' : 'arrow-forward'}
                size={18}
                color="#fff"
                style={{ marginLeft: 10 }}
              />
            </TouchableOpacity>
          </LinearGradient>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Step 4 ───────────────────────────────────────────────────────────────────

function Step4({ holes, totalStrokes, totalStableford, notes, setNotes, courseName, date, saving, saveRound,
  roundType, setRoundType, clubMembers, partnerSearch, setPartnerSearch, selectedPartner, setSelectedPartner }: any) {
  const front = holes.slice(0, 9);
  const back  = holes.slice(9, 18);
  const frontStrokes    = front.reduce((s: number, h: HoleEntry) => s + h.score, 0);
  const backStrokes     = back.reduce((s: number, h: HoleEntry) => s + h.score, 0);
  const frontStableford = front.reduce((s: number, h: HoleEntry) => s + h.stablefordPoints, 0);
  const backStableford  = back.reduce((s: number, h: HoleEntry) => s + h.stablefordPoints, 0);

  const memberName = (m: ClubMember) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;

  const filteredMembers = partnerSearch.trim().length > 0
    ? (clubMembers as ClubMember[]).filter(m =>
        memberName(m).toLowerCase().includes(partnerSearch.toLowerCase()) ||
        m.email.toLowerCase().includes(partnerSearch.toLowerCase())
      )
    : (clubMembers as ClubMember[]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>Review scorecard</Text>
        <Text style={styles.stepSub}>{courseName} · {date}</Text>

        {/* ── Round type ─────────────────────────────────────────────── */}
        <Text style={[styles.stepTitle, { fontSize: 15, marginBottom: 8 }]}>Round type</Text>
        <View style={styles.roundTypeRow}>
          {(['social', 'scoring'] as const).map(rt => {
            const labels = { social: 'Social', scoring: 'Scoring Round' };
            const icons  = { social: 'people-outline', scoring: 'ribbon-outline' };
            const active = roundType === rt;
            return (
              <TouchableOpacity
                key={rt}
                style={[styles.roundTypeBtn, active && styles.roundTypeBtnActive]}
                onPress={() => { setRoundType(rt); if (rt === 'social') setSelectedPartner(null); }}
                activeOpacity={0.8}
              >
                <Ionicons name={icons[rt] as any} size={16} color={active ? colors.primary : colors.textSecondary} />
                <Text style={[styles.roundTypeBtnText, active && styles.roundTypeBtnTextActive]}>
                  {labels[rt]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Playing partner (scoring rounds only) ─────────────────── */}
        {roundType === 'scoring' && (
          <View style={styles.partnerSection}>
            <Text style={[styles.stepTitle, { fontSize: 15, marginBottom: 8 }]}>Playing partner</Text>
            {selectedPartner ? (
              <View style={styles.partnerSelected}>
                <View style={styles.partnerAvatar}>
                  <Text style={styles.partnerAvatarText}>
                    {[selectedPartner.first_name?.[0], selectedPartner.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'}
                  </Text>
                </View>
                <Text style={styles.partnerName}>{memberName(selectedPartner)}</Text>
                <TouchableOpacity onPress={() => setSelectedPartner(null)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={20} color="#aaa" />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.partnerSearch}
                  value={partnerSearch}
                  onChangeText={setPartnerSearch}
                  placeholder="Search club members…"
                  autoCapitalize="none"
                />
                {filteredMembers.length === 0 ? (
                  <Text style={styles.partnerEmpty}>
                    {clubMembers.length === 0 ? 'Join a club to add a playing partner' : 'No members match'}
                  </Text>
                ) : (
                  <View style={styles.partnerList}>
                    {filteredMembers.slice(0, 8).map((m: ClubMember) => (
                      <TouchableOpacity
                        key={m.id}
                        style={styles.partnerRow}
                        onPress={() => { setSelectedPartner(m); setPartnerSearch(''); }}
                        activeOpacity={0.75}
                      >
                        <View style={styles.partnerAvatar}>
                          <Text style={styles.partnerAvatarText}>
                            {[m.first_name?.[0], m.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'}
                          </Text>
                        </View>
                        <Text style={styles.partnerRowName}>{memberName(m)}</Text>
                        <Ionicons name="chevron-forward" size={14} color="#ccc" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <ScorecardTable label="Front 9" holes={front} totalStrokes={frontStrokes} totalStableford={frontStableford} />
        <ScorecardTable label="Back 9"  holes={back}  totalStrokes={backStrokes}  totalStableford={backStableford} />

        <View style={styles.grandTotal}>
          <View style={styles.grandItem}>
            <Text style={styles.grandValue}>{totalStrokes}</Text>
            <Text style={styles.grandLabel}>Total Strokes</Text>
          </View>
          <View style={styles.grandDivider} />
          <View style={styles.grandItem}>
            <Text style={[styles.grandValue, { color: colors.primary }]}>{totalStableford}</Text>
            <Text style={styles.grandLabel}>Stableford</Text>
          </View>
        </View>

        <Text style={[styles.stepTitle, { marginTop: 20 }]}>Notes (optional)</Text>
        <TextInput style={styles.notesInput} value={notes} onChangeText={setNotes}
          placeholder="How did you play?" multiline numberOfLines={3} textAlignVertical="top" />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.nextBtn} onPress={saveRound} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextBtnText}>Save Round ✓</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function ScorecardTable({ label, holes, totalStrokes, totalStableford }: any) {
  return (
    <View style={styles.scorecardCard}>
      <Text style={styles.scorecardLabel}>{label}</Text>
      <View style={styles.scorecardHeader}>
        <Text style={[styles.scCell, styles.scHole]}>Hole</Text>
        <Text style={[styles.scCell, styles.scPar]}>Par</Text>
        <Text style={[styles.scCell, styles.scSI]}>SI</Text>
        <Text style={[styles.scCell, styles.scScore]}>Score</Text>
        <Text style={[styles.scCell, styles.scPts]}>Pts</Text>
      </View>
      {(holes as HoleEntry[]).map(h => {
        const sl = scoreLabel(h.score, h.par);
        return (
          <View key={h.holeNumber} style={styles.scorecardRow}>
            <Text style={[styles.scCell, styles.scHole]}>{h.holeNumber}</Text>
            <Text style={[styles.scCell, styles.scPar]}>{h.par}</Text>
            <Text style={[styles.scCell, styles.scSI]}>{h.strokeIndex}</Text>
            <Text style={[styles.scCell, styles.scScore, { color: sl.color }]}>{h.score}</Text>
            <Text style={[styles.scCell, styles.scPts, { color: colors.primary }]}>{h.stablefordPoints}</Text>
          </View>
        );
      })}
      <View style={[styles.scorecardRow, styles.scorecardTotalRow]}>
        <Text style={[styles.scCell, styles.scHole, styles.scorecardTotalText]}>Total</Text>
        <Text style={[styles.scCell, styles.scPar]} />
        <Text style={[styles.scCell, styles.scSI]} />
        <Text style={[styles.scCell, styles.scScore, styles.scorecardTotalText]}>{totalStrokes}</Text>
        <Text style={[styles.scCell, styles.scPts, styles.scorecardTotalText, { color: colors.primary }]}>{totalStableford}</Text>
      </View>
    </View>
  );
}

// ── Step 5 ───────────────────────────────────────────────────────────────────

function Step5({ totalStableford, totalStrokes, courseName, onDone, roundId }: any) {
  const [photo, setPhoto]       = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded]  = useState(false);

  async function pickAndUpload() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    const uri = `data:image/jpeg;base64,${result.assets[0].base64}`;
    setPhoto(uri);
    if (!roundId) return;
    setUploading(true);
    try {
      await client.post(`/api/rounds/${roundId}/photo`, { photo_data: uri });
      setUploaded(true);
    } catch {
      Alert.alert('Error', 'Could not upload photo');
    } finally { setUploading(false); }
  }

  return (
    <ScrollView style={styles.stepScroll} contentContainerStyle={[styles.stepContent, styles.step5Content]}>
      <View style={styles.successIcon}>
        <Text style={{ fontSize: 48 }}>🏆</Text>
      </View>
      <Text style={styles.step5Title}>Round Saved!</Text>
      <Text style={styles.step5Sub}>{courseName}</Text>

      <View style={styles.step5Card}>
        <View style={styles.step5Row}>
          <Text style={styles.step5RowLabel}>Stableford Points</Text>
          <Text style={[styles.step5RowValue, { color: colors.primary }]}>{totalStableford}</Text>
        </View>
        <View style={styles.step5Divider} />
        <View style={styles.step5Row}>
          <Text style={styles.step5RowLabel}>Gross Score</Text>
          <Text style={styles.step5RowValue}>{totalStrokes}</Text>
        </View>
      </View>

      {/* Photo share */}
      {photo ? (
        <View style={styles.step5PhotoWrap}>
          <Image source={{ uri: photo }} style={styles.step5Photo} resizeMode="cover" />
          {uploaded && (
            <View style={styles.step5PhotoBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.step5PhotoBadgeText}>Shared to feed</Text>
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.step5PhotoBtn}
          onPress={pickAndUpload}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {uploading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <>
                <Ionicons name="image-outline" size={20} color={colors.primary} />
                <Text style={styles.step5PhotoBtnText}>Add Photo to Feed</Text>
              </>
          }
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  backBtn:     { width: 36, height: 36, justifyContent: 'center' },
  backIcon:    { fontSize: fontSize.lg, color: colors.textPrimary },

  stepScroll:   { flex: 1 },
  stepContent:  { padding: spacing.md, paddingBottom: 32 },
  stepTitle:    { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  stepSub:      { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 12, marginTop: -8 },

  // Date
  dateRow:             { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: 4 },
  datePill:            { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  datePillActive:      { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  datePillText:        { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  datePillTextActive:  { color: colors.primary },
  dateInput:           { flex: 1, minWidth: 120, fontSize: 14, color: colors.textPrimary, paddingHorizontal: 10 },

  // Search
  searchWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 14, marginBottom: spacing.sm },
  searchInput:   { flex: 1, height: 46, fontSize: 16, color: colors.textPrimary },
  searchSpinner: { marginLeft: spacing.sm },
  resultsList:   { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 12 },
  resultRow:     { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  resultName:    { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  resultSub:     { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  manualEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4, marginTop: 4,
  },
  manualEntryText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },

  selectedBadge:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '12', borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, padding: 14, gap: 12, marginTop: spacing.sm },
  selectedBadgeIcon: {},
  selectedBadgeName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  selectedBadgeSub:  { fontSize: fontSize.xs, color: colors.textSecondary },

  // Tee
  teeScroll:         { marginBottom: spacing.md },
  teePill:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, marginRight: spacing.sm },
  teePillActive:     { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  teeColourDot:      { width: 10, height: 10, borderRadius: 5 },
  teePillText:       { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  teePillTextActive: { color: colors.primary },
  teeGender:         { fontSize: fontSize.xs, color: colors.textSecondary },

  teeInfoCard:    { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, marginBottom: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  teeInfoRow:     { flexDirection: 'row' },
  teeInfoCell:    { flex: 1, alignItems: 'center' },
  teeInfoValue:   { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  teeInfoLabel:   { fontSize: 10, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  hcpRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: 4 },
  hcpBtn:      { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  hcpBtnText:  { fontSize: 22, color: colors.primary, fontWeight: '300' },
  hcpInput:    { width: 80, height: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, fontSize: 28, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },

  // Hole scoring
  holeProgress:    { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: spacing.md },
  holeDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  holeDotActive:   { backgroundColor: colors.primary, transform: [{ scale: 1.4 }] },
  holeDotDone:     { backgroundColor: colors.primaryLight },

  holeCard:       { backgroundColor: colors.surface, borderRadius: 20, marginHorizontal: spacing.md, padding: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  holeLabel:      { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase' },
  holeNumber:     { fontSize: 72, fontWeight: '800', color: colors.textPrimary, lineHeight: 80 },
  holeChips:      { flexDirection: 'row', gap: spacing.sm, marginBottom: 24 },
  chip:           { paddingHorizontal: 12, paddingVertical: 5, borderRadius: spacing.sm, backgroundColor: colors.surfaceMuted },
  chipText:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },

  scoreRow:        { flexDirection: 'row', alignItems: 'center', gap: 24 },
  scoreBtn:        { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' },
  scoreBtnText:    { fontSize: 28, color: colors.textPrimary, fontWeight: '300', lineHeight: 34 },
  scoreDisplay:    { alignItems: 'center', width: 80 },
  scoreNum:        { fontSize: 64, fontWeight: '800', lineHeight: 68 },
  scoreSubLabel:   { fontSize: fontSize.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  stablefordBadge: { marginTop: spacing.md, fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },

  holePrevNext:      { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: spacing.md, marginTop: spacing.md },
  holeNavBtn:        { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  holeNavBtnDisabled:{ opacity: 0.35 },
  holeNavBtnGreen:   { backgroundColor: colors.primary, borderColor: colors.primary },
  holeNavText:       { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },

  runningTotal:   { flexDirection: 'row', backgroundColor: colors.textPrimary, marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: 14, padding: spacing.md, justifyContent: 'space-around' },
  runningItem:    { alignItems: 'center' },
  runningValue:   { fontSize: 22, fontWeight: '800', color: colors.textInverse },
  runningLabel:   { fontSize: 10, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  runningDivider: { width: 1, backgroundColor: colors.border },

  // Scorecard
  scorecardCard:      { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  scorecardLabel:     { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  scorecardHeader:    { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted, marginBottom: 4 },
  scorecardRow:       { flexDirection: 'row', paddingVertical: 5 },
  scorecardTotalRow:  { borderTopWidth: 1, borderTopColor: colors.surfaceMuted, marginTop: 4, paddingTop: spacing.sm },
  scorecardTotalText: { fontWeight: '700', color: colors.textPrimary },
  scCell:   { textAlign: 'center', fontSize: fontSize.sm, color: colors.textPrimary },
  scHole:   { width: 36 },
  scPar:    { width: 32 },
  scSI:     { width: 28 },
  scScore:  { flex: 1, fontWeight: '600' },
  scPts:    { width: 36, fontWeight: '600' },

  grandTotal:   { flexDirection: 'row', backgroundColor: colors.primary + '12', borderRadius: 14, padding: 20, marginTop: spacing.sm, justifyContent: 'center' },
  grandItem:    { flex: 1, alignItems: 'center' },
  grandValue:   { fontSize: 32, fontWeight: '800', color: colors.textPrimary },
  grandLabel:   { fontSize: fontSize.xs, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  grandDivider: { width: 1, backgroundColor: colors.primary + '40', marginVertical: 4 },

  notesInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: 14, fontSize: fontSize.base, minHeight: 80 },

  // Round type + partner picker (Step 4)
  roundTypeRow:          { flexDirection: 'row', gap: 10, marginBottom: spacing.md },
  roundTypeBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  roundTypeBtnActive:    { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  roundTypeBtnText:      { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  roundTypeBtnTextActive:{ color: colors.primary },

  partnerSection:    { marginBottom: spacing.md },
  partnerSelected:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primary + '12', borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, padding: 12 },
  partnerAvatar:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  partnerAvatarText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  partnerName:       { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  partnerSearch:     { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.base, color: colors.textPrimary, marginBottom: spacing.sm },
  partnerEmpty:      { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.sm },
  partnerList:       { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  partnerRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  partnerRowName:    { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '500' },

  // Step 5
  step5Content:  { alignItems: 'center', paddingTop: 24 },
  successIcon:   { marginBottom: 12 },
  step5Title:    { fontSize: 28, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  step5Sub:      { fontSize: fontSize.base, color: colors.textSecondary, marginBottom: 28 },
  step5Card:     { backgroundColor: colors.surface, borderRadius: 20, width: '100%', padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3, marginBottom: 24 },
  step5Row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  step5RowLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  step5RowValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  step5Divider:  { height: 1, backgroundColor: colors.surfaceMuted },
  doneBtn:       { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
  doneBtnText:   { color: colors.textInverse, fontSize: fontSize.md, fontWeight: '700' },

  step5PhotoBtn:      { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14, marginBottom: spacing.md },
  step5PhotoBtnText:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  step5PhotoWrap:     { width: '100%', marginBottom: spacing.md },
  step5Photo:         { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  step5PhotoBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 5, alignSelf: 'center', marginTop: spacing.sm },
  step5PhotoBadgeText:{ fontSize: fontSize.xs, fontWeight: '700', color: '#fff' },

  // Footer / next
  footer:           { padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  nextBtn:          { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: spacing.md, alignItems: 'center' },
  nextBtnDisabled:  { opacity: 0.45 },
  nextBtnText:      { color: colors.textInverse, fontSize: fontSize.md, fontWeight: '700' },

  // ── Step 3 live scoring (dark theme) ──────────────────────────────────────

  s3Root: { flex: 1, backgroundColor: '#1a2a10' },

  s3Header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 10,
  },
  s3ExitText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  s3CourseName: {
    flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700',
    color: '#fff', paddingHorizontal: 8, letterSpacing: -0.2,
  },
  s3FinishPill: {
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden',
  },
  s3FinishText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  s3GroupPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2e7d32', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  s3GroupPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  s3GroupBar: { alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 4 },

  // Group scores modal
  groupModal: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  groupModalCard: {
    backgroundColor: colors.surface, borderRadius: 20, margin: 20, padding: 20, width: '90%',
  },
  groupModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  groupModalTitle:  { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  groupModalEmpty:  { color: colors.textSecondary, textAlign: 'center', paddingVertical: 20 },
  groupScoreRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  groupScoreRank:   { width: 22, fontSize: 13, fontWeight: '800', color: colors.textSecondary, textAlign: 'center' },
  groupScoreName:   { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  groupScoreCols:   { alignItems: 'flex-end' },
  groupScorePts:    { fontSize: 15, fontWeight: '800', color: colors.primary },
  groupScoreHoles:  { fontSize: 11, color: colors.textSecondary },
  groupModalRefresh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  groupModalRefreshText: { fontSize: 14, color: colors.primary, fontWeight: '600' },

  s3LiveBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10, gap: 6,
  },
  s3LiveDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: '#a8e063',
  },
  s3LiveText: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1, textTransform: 'uppercase',
  },

  // Hole header
  s3HoleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 6,
  },
  s3HoleNavBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  s3HoleTitleBlock: { alignItems: 'center' },
  s3HoleLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  },
  s3HoleNum: {
    fontSize: 52, fontWeight: '800', color: '#fff', letterSpacing: -2, lineHeight: 56,
  },

  // Meta pills
  s3MetaRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  s3MetaPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 5,
  },
  s3MetaPillText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  s3ShotsPill: {
    backgroundColor: 'rgba(168,224,99,0.15)',
    borderWidth: 1, borderColor: 'rgba(168,224,99,0.25)',
  },
  s3ShotsDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#a8e063', marginRight: 5 },
  s3ShotsPillText: { color: '#a8e063' },

  // Dial
  s3DialFlex:   { alignItems: 'center', paddingBottom: 10 },
  s3DialWrap:   { width: 180, height: 180 },
  s3DialCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  s3DialScore:  { fontSize: 64, fontWeight: '800', lineHeight: 68, letterSpacing: -2, includeFontPadding: false },
  s3DialOutcome:{ fontSize: 13, fontWeight: '700', marginTop: 3, textTransform: 'capitalize' },
  s3DialNet:    { fontSize: 11, marginTop: 2, color: 'rgba(255,255,255,0.4)', fontWeight: '700' },

  // +/- buttons
  s3BtnRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingBottom: 12 },
  s3ScoreBtn: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  s3MinusBtn: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
  },
  s3PlusBtnGrad: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  s3PlusBtnInner: {
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
  },

  // Pick up button
  s3PuWrap: { paddingHorizontal: 12, paddingBottom: 10 },
  s3PuBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(192,57,43,0.3)',
    backgroundColor: 'rgba(192,57,43,0.07)',
  },
  s3PuBtnTx: { fontSize: 13, fontWeight: '700', color: '#ff8a7a' },
  s3PuBtnUndo: {
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  s3PuBtnUndoTx: { color: 'rgba(255,255,255,0.45)' },

  // Summary bar
  s3SummaryBar: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, marginHorizontal: 12, marginBottom: 0,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  s3SumItem:  { flex: 1, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 8 },
  s3SumVal:   { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5, lineHeight: 26 },
  s3SumLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginTop: 3 },
  s3SumDenom: { fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.4)' },
  s3SumDivider:{ width: 0.5, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 8 },

  // Stats stack
  s3StatsStack: { gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  s3StatCard: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
  },
  s3StatCardLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)', marginBottom: 10,
  },
  s3TogRow:    { flexDirection: 'row', gap: 8 },
  s3TogBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  s3TogBtnHit:  { backgroundColor: 'rgba(61,107,31,0.2)', borderColor: 'rgba(168,224,99,0.4)' },
  s3TogBtnMiss: { backgroundColor: 'rgba(192,57,43,0.12)', borderColor: 'rgba(192,57,43,0.35)' },
  s3TogBtnNA:   { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' },
  s3TogBtnTx:   { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  s3TogTxHit:   { color: '#a8e063' },
  s3TogTxMiss:  { color: '#ff8a7a' },
  s3TogTxNA:    { color: 'rgba(255,255,255,0.3)' },

  // Putts card extras
  s3PuttsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  s3PuttsHint: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  s3PuttsControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  s3PuttsCircBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  s3PuttsNum: {
    fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: -1,
    lineHeight: 44, minWidth: 48, textAlign: 'center',
  },

  // Next button
  s3NextWrap: { paddingHorizontal: 12, paddingTop: 10 },
  s3NextGrad: { borderRadius: 16, overflow: 'hidden' },
  s3NextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16,
  },
  s3NextBtnTx: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },

  // Legacy aliases (unused by Step3 now but kept so other code compiles)
  s3Body:       { flex: 1 },
  s3Chevron:    { width: 44, alignItems: 'center', justifyContent: 'center' },
  s3Scroll:     { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  s3TrackRow:   { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.sm },
  s3Footer:     { backgroundColor: '#f7f5f1', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  s3PrimaryBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 15, alignItems: 'center' },
  s3PrimaryInner: { flexDirection: 'row', alignItems: 'center' },
  s3PrimaryBtnText: { color: colors.textInverse, fontSize: fontSize.base, fontWeight: '700' },

  s3StripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  s3StripLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  s3StripHint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  // Fixed-height wrapper prevents the ScrollView from expanding vertically
  s3StripContainer: {
    height: 72,
  },
  s3StripScroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 6,
    alignItems: 'center',
  },
  s3Chip: {
    width: 44,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  s3ChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  s3ChipDone: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  s3ChipNum: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 14,
  },
  s3ChipPar: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 12,
  },
  s3ChipParLight: {
    color: 'rgba(255,255,255,0.65)',
  },
  s3ChipScore: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 16,
  },
  s3ChipTextLight: {
    color: colors.textInverse,
  },
});
