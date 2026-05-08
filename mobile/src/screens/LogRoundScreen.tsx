import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, FlatList, Alert,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { RootStackParamList } from '../../App';

// ── Constants ────────────────────────────────────────────────────────────────

const GREEN        = '#1a7f3c';
const BG           = '#f5f5f7';
const DIFFERENTIALS_KEY = 'whs_differentials';

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
  stablefordPoints: number;
};

type Differential = { date: string; value: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function calcPlayingHandicap(idx: number, slope: number, rating: number, par: number) {
  return Math.round(idx * (slope / 113) + (rating - par));
}

function calcStableford(par: number, si: number, score: number, ph: number): number {
  const extra = Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0);
  return Math.max(0, 2 + par + extra - score);
}

function scoreLabel(score: number, par: number) {
  const d = score - par;
  if (d <= -2) return { text: 'Eagle', color: '#f59e0b' };
  if (d === -1) return { text: 'Birdie', color: '#3b82f6' };
  if (d === 0)  return { text: 'Par',    color: GREEN };
  if (d === 1)  return { text: 'Bogey',  color: '#f97316' };
  return             { text: `+${d}`,    color: '#ef4444' };
}

async function computeAndSaveHandicap(
  differential: number,
  currentHandicap: number | null,
): Promise<number> {
  const raw = await AsyncStorage.getItem(DIFFERENTIALS_KEY);
  const history: Differential[] = raw ? JSON.parse(raw) : [];
  history.push({ date: today(), value: parseFloat(differential.toFixed(1)) });
  const last20 = history.slice(-20);
  await AsyncStorage.setItem(DIFFERENTIALS_KEY, JSON.stringify(last20));

  if (last20.length < 3) {
    // Not enough rounds — apply a gentle single-round adjustment
    const base = currentHandicap ?? differential;
    return parseFloat((base + (differential - base) * 0.1).toFixed(1));
  }

  const sorted = [...last20].sort((a, b) => a.value - b.value);
  const take   = last20.length >= 20 ? 8 : last20.length >= 10 ? 6 : last20.length >= 6 ? 4 : 2;
  const best   = sorted.slice(0, take);
  const avg    = best.reduce((s, d) => s + d.value, 0) / best.length;
  return parseFloat((avg * 0.96).toFixed(1));
}

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
  dot:          { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#d1d5db', backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  dotDone:      { backgroundColor: GREEN, borderColor: GREEN },
  dotActive:    { borderColor: GREEN },
  dotNum:       { fontSize: 11, fontWeight: '700', color: '#9ca3af' },
  dotNumLight:  { color: '#fff' },
  label:        { fontSize: 9, color: '#9ca3af', marginTop: 4, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.3 },
  labelActive:  { color: GREEN },
  line:         { flex: 1, height: 2, backgroundColor: '#e5e7eb', marginTop: 13, marginHorizontal: -4 },
  lineDone:     { backgroundColor: GREEN },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LogRoundScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [step, setStep]       = useState<1 | 2 | 3 | 4 | 5>(1);
  const [saving, setSaving]   = useState(false);
  const [userHcpIdx, setUserHcpIdx] = useState(0);
  const slideAnim             = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    client.get<{ handicap: number | null }>('/api/users/profile')
      .then(r => setUserHcpIdx(Number(r.data.handicap) || 0))
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

  // Step 3
  const [holes, setHoles]             = useState<HoleEntry[]>([]);
  const [holeIdx, setHoleIdx]         = useState(0);   // 0-17
  const [liveRoundId, setLiveRoundId] = useState<number | null>(null);
  const liveRoundIdRef                = useRef<number | null>(null);

  // Step 4 / 5
  const [notes, setNotes]             = useState('');
  const [savedRound, setSavedRound]   = useState<any>(null);
  const [newHandicap, setNewHandicap] = useState<number | null>(null);

  // ── Navigation ──────────────────────────────────────────────────────────────

  function animateStep(next: 1 | 2 | 3 | 4 | 5) {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue:   0, duration: 140, useNativeDriver: true }),
    ]).start();
    setStep(next);
  }

  function back() {
    if (step === 1) navigation.goBack();
    else animateStep((step - 1) as any);
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
    const initialHoles = selectedTee.holes.map(h => ({
      holeNumber: h.number, par: h.par, strokeIndex: h.si,
      score: h.par, stablefordPoints: calcStableford(h.par, h.si, h.par, ph),
    }));
    setHoles(initialHoles);
    setHoleIdx(0);

    // Start a live round so others can watch in real-time
    try {
      const { data } = await client.post('/api/rounds/start', {
        playedAt:      date,
        courseName:    course!.club_name,
        teeName:       selectedTee.colour,
        slopeRating:   selectedTee.slopeRating,
        courseRating:  selectedTee.courseRating,
        courseHandicap: ph,
        handicapIndex: userHcpIdx,
        holeData:      selectedTee.holes,
      });
      liveRoundIdRef.current = data.id;
      setLiveRoundId(data.id);
    } catch {
      // Non-fatal — scoring still works, just won't broadcast live
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
    }).catch(() => {});
  }

  // ── Step 3: hole scores ─────────────────────────────────────────────────────

  const ph = parseInt(playingHcp, 10) || 0;
  const currentHole = holes[holeIdx];

  function adjustScore(delta: number) {
    if (!currentHole) return;
    setHoles(prev => {
      const next = prev.map((h, i) => {
        if (i !== holeIdx) return h;
        const s = Math.max(1, h.score + delta);
        return { ...h, score: s, stablefordPoints: calcStableford(h.par, h.strokeIndex, s, ph) };
      });
      // Sync to live round (fire-and-forget)
      if (liveRoundIdRef.current) patchHole(liveRoundIdRef.current, next[holeIdx]);
      return next;
    });
  }

  const totalStrokes    = holes.reduce((s, h) => s + h.score, 0);
  const totalStableford = holes.reduce((s, h) => s + h.stablefordPoints, 0);

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
          }))
        );
        const res = await client.post(`/api/rounds/${roundId}/finish`);
        data = res.data;
      } else {
        // Fallback: batch save if live round never started
        const res = await client.post('/api/rounds', {
          playedAt:   date,
          courseName: course!.club_name,
          score:      totalStrokes,
          stableford: totalStableford,
          notes:      notes.trim() || null,
          holes:      holes.map(h => ({
            holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex,
            score: h.score, stablefordPoints: h.stablefordPoints,
          })),
        });
        data = res.data;
      }

      setSavedRound(data);

      // Compute & store updated handicap index
      const tee = selectedTee;
      if (tee?.slopeRating && tee?.courseRating) {
        const diff    = (totalStrokes - tee.courseRating) * (113 / tee.slopeRating);
        const updated = await computeAndSaveHandicap(diff, userHcpIdx || null);
        await client.patch('/api/users/profile', { handicap: updated });
        setNewHandicap(updated);
      }

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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={back} style={styles.backBtn} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
          <Text style={styles.backIcon}>{step === 1 ? '✕' : '←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Round</Text>
        <View style={{ width: 36 }} />
      </View>

      <StepBar current={step} />

      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {step === 1 && <Step1 date={date} setDate={setDate} query={query} onQueryChange={onQueryChange}
          results={results} searching={searching} course={course} selectCourse={selectCourse}
          onNext={goToStep2} loading={loadingTees} />}

        {step === 2 && <Step2 tees={tees} teeIdx={teeIdx} setTeeIdx={setTeeIdx}
          playingHcp={playingHcp} setPlayingHcp={setPlayingHcp} userHcpIdx={userHcpIdx} onNext={goToStep3} />}

        {step === 3 && <Step3 holes={holes} holeIdx={holeIdx} setHoleIdx={setHoleIdx}
          adjustScore={adjustScore} totalStrokes={totalStrokes} totalStableford={totalStableford}
          onNext={() => animateStep(4)} />}

        {step === 4 && <Step4 holes={holes} totalStrokes={totalStrokes} totalStableford={totalStableford}
          notes={notes} setNotes={setNotes} onNext={() => animateStep(5)} saving={saving} saveRound={saveRound}
          courseName={course?.club_name ?? ''} date={date} />}

        {step === 5 && <Step5 savedRound={savedRound} newHandicap={newHandicap}
          totalStableford={totalStableford} totalStrokes={totalStrokes}
          courseName={course?.club_name ?? ''} onDone={() => navigation.goBack()} />}
      </Animated.View>
    </View>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({ date, setDate, query, onQueryChange, results, searching, course, selectCourse, onNext, loading }: any) {
  const DATE_OPTS = [
    { label: 'Today',     value: new Date().toISOString().split('T')[0] },
    { label: 'Yesterday', value: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
  ];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepTitle}>When did you play?</Text>

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

        <Text style={[styles.stepTitle, { marginTop: 24 }]}>Where did you play?</Text>
        <View style={styles.searchWrap}>
          <TextInput style={styles.searchInput} value={query} onChangeText={onQueryChange}
            placeholder="Search course name…" autoCapitalize="none" returnKeyType="search" />
          {searching && <ActivityIndicator style={styles.searchSpinner} color={GREEN} />}
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

        {course && (
          <View style={styles.selectedBadge}>
            <Ionicons name="golf-outline" size={24} color={GREEN} />
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

function Step2({ tees, teeIdx, setTeeIdx, playingHcp, setPlayingHcp, userHcpIdx, onNext }: any) {
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
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.nextBtn, !tee && styles.nextBtnDisabled]} onPress={onNext} disabled={!tee}>
          <Text style={styles.nextBtnText}>Enter Scores →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TeeInfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.teeInfoCell}>
      <Text style={styles.teeInfoValue}>{value}</Text>
      <Text style={styles.teeInfoLabel}>{label}</Text>
    </View>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({ holes, holeIdx, setHoleIdx, adjustScore, totalStrokes, totalStableford, onNext }: any) {
  const hole: HoleEntry | undefined = holes[holeIdx];
  if (!hole) return null;

  const sl     = scoreLabel(hole.score, hole.par);
  const filled = holes.filter((h: HoleEntry) => h.score > 0).length;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.holeProgress}>
        {holes.map((_: any, i: number) => (
          <TouchableOpacity key={i} onPress={() => setHoleIdx(i)}>
            <View style={[styles.holeDot, i === holeIdx && styles.holeDotActive, i < holeIdx && styles.holeDotDone]} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.holeCard}>
        <Text style={styles.holeLabel}>HOLE</Text>
        <Text style={styles.holeNumber}>{hole.holeNumber}</Text>
        <View style={styles.holeChips}>
          <View style={styles.chip}><Text style={styles.chipText}>Par {hole.par}</Text></View>
          <View style={styles.chip}><Text style={styles.chipText}>SI {hole.strokeIndex}</Text></View>
        </View>

        <View style={styles.scoreRow}>
          <TouchableOpacity style={styles.scoreBtn} onPress={() => adjustScore(-1)}>
            <Text style={styles.scoreBtnText}>−</Text>
          </TouchableOpacity>

          <View style={styles.scoreDisplay}>
            <Text style={[styles.scoreNum, { color: sl.color }]}>{hole.score}</Text>
            <Text style={[styles.scoreSubLabel, { color: sl.color }]}>{sl.text}</Text>
          </View>

          <TouchableOpacity style={styles.scoreBtn} onPress={() => adjustScore(+1)}>
            <Text style={styles.scoreBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.stablefordBadge}>
          {hole.stablefordPoints} pts
        </Text>
      </View>

      <View style={styles.holePrevNext}>
        <TouchableOpacity style={[styles.holeNavBtn, holeIdx === 0 && styles.holeNavBtnDisabled]}
          onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))} disabled={holeIdx === 0}>
          <Text style={styles.holeNavText}>← Prev</Text>
        </TouchableOpacity>
        {holeIdx < 17
          ? <TouchableOpacity style={styles.holeNavBtn} onPress={() => setHoleIdx(holeIdx + 1)}>
              <Text style={styles.holeNavText}>Next →</Text>
            </TouchableOpacity>
          : <TouchableOpacity style={[styles.holeNavBtn, styles.holeNavBtnGreen]} onPress={onNext}>
              <Text style={[styles.holeNavText, { color: '#fff' }]}>Review →</Text>
            </TouchableOpacity>
        }
      </View>

      <View style={styles.runningTotal}>
        <View style={styles.runningItem}>
          <Text style={styles.runningValue}>{totalStrokes}</Text>
          <Text style={styles.runningLabel}>Strokes</Text>
        </View>
        <View style={styles.runningDivider} />
        <View style={styles.runningItem}>
          <Text style={[styles.runningValue, { color: GREEN }]}>{totalStableford}</Text>
          <Text style={styles.runningLabel}>Stableford</Text>
        </View>
        <View style={styles.runningDivider} />
        <View style={styles.runningItem}>
          <Text style={styles.runningValue}>{filled}/18</Text>
          <Text style={styles.runningLabel}>Holes</Text>
        </View>
      </View>
    </View>
  );
}

// ── Step 4 ───────────────────────────────────────────────────────────────────

function Step4({ holes, totalStrokes, totalStableford, notes, setNotes, courseName, date, saving, saveRound }: any) {
  const front = holes.slice(0, 9);
  const back  = holes.slice(9, 18);
  const frontStrokes    = front.reduce((s: number, h: HoleEntry) => s + h.score, 0);
  const backStrokes     = back.reduce((s: number, h: HoleEntry) => s + h.score, 0);
  const frontStableford = front.reduce((s: number, h: HoleEntry) => s + h.stablefordPoints, 0);
  const backStableford  = back.reduce((s: number, h: HoleEntry) => s + h.stablefordPoints, 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent}>
        <Text style={styles.stepTitle}>Review scorecard</Text>
        <Text style={styles.stepSub}>{courseName} · {date}</Text>

        <ScorecardTable label="Front 9" holes={front} totalStrokes={frontStrokes} totalStableford={frontStableford} />
        <ScorecardTable label="Back 9"  holes={back}  totalStrokes={backStrokes}  totalStableford={backStableford} />

        <View style={styles.grandTotal}>
          <View style={styles.grandItem}>
            <Text style={styles.grandValue}>{totalStrokes}</Text>
            <Text style={styles.grandLabel}>Total Strokes</Text>
          </View>
          <View style={styles.grandDivider} />
          <View style={styles.grandItem}>
            <Text style={[styles.grandValue, { color: GREEN }]}>{totalStableford}</Text>
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
            <Text style={[styles.scCell, styles.scPts, { color: GREEN }]}>{h.stablefordPoints}</Text>
          </View>
        );
      })}
      <View style={[styles.scorecardRow, styles.scorecardTotalRow]}>
        <Text style={[styles.scCell, styles.scHole, styles.scorecardTotalText]}>Total</Text>
        <Text style={[styles.scCell, styles.scPar]} />
        <Text style={[styles.scCell, styles.scSI]} />
        <Text style={[styles.scCell, styles.scScore, styles.scorecardTotalText]}>{totalStrokes}</Text>
        <Text style={[styles.scCell, styles.scPts, styles.scorecardTotalText, { color: GREEN }]}>{totalStableford}</Text>
      </View>
    </View>
  );
}

// ── Step 5 ───────────────────────────────────────────────────────────────────

function Step5({ totalStableford, totalStrokes, courseName, newHandicap, onDone }: any) {
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
          <Text style={[styles.step5RowValue, { color: GREEN }]}>{totalStableford}</Text>
        </View>
        <View style={styles.step5Divider} />
        <View style={styles.step5Row}>
          <Text style={styles.step5RowLabel}>Gross Score</Text>
          <Text style={styles.step5RowValue}>{totalStrokes}</Text>
        </View>
        {newHandicap != null && (
          <>
            <View style={styles.step5Divider} />
            <View style={styles.step5Row}>
              <Text style={styles.step5RowLabel}>Handicap Index</Text>
              <Text style={[styles.step5RowValue, { color: GREEN }]}>{newHandicap.toFixed(1)}</Text>
            </View>
          </>
        )}
      </View>

      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  backBtn:     { width: 36, height: 36, justifyContent: 'center' },
  backIcon:    { fontSize: 20, color: '#111' },

  stepScroll:   { flex: 1 },
  stepContent:  { padding: 16, paddingBottom: 32 },
  stepTitle:    { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 12 },
  stepSub:      { fontSize: 13, color: '#888', marginBottom: 12, marginTop: -8 },

  // Date
  dateRow:             { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  datePill:            { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  datePillActive:      { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  datePillText:        { fontSize: 14, color: '#555', fontWeight: '500' },
  datePillTextActive:  { color: GREEN },
  dateInput:           { flex: 1, minWidth: 120, fontSize: 14, color: '#111', paddingHorizontal: 10 },

  // Search
  searchWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', paddingHorizontal: 14, marginBottom: 8 },
  searchInput:   { flex: 1, height: 46, fontSize: 16, color: '#111' },
  searchSpinner: { marginLeft: 8 },
  resultsList:   { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden', marginBottom: 12 },
  resultRow:     { padding: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  resultName:    { fontSize: 15, fontWeight: '600', color: '#111' },
  resultSub:     { fontSize: 12, color: '#888', marginTop: 2 },

  selectedBadge:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', borderRadius: 12, borderWidth: 1.5, borderColor: GREEN, padding: 14, gap: 12, marginTop: 8 },
  selectedBadgeIcon: {},
  selectedBadgeName: { fontSize: 15, fontWeight: '700', color: '#111' },
  selectedBadgeSub:  { fontSize: 12, color: '#888' },

  // Tee
  teeScroll:         { marginBottom: 16 },
  teePill:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff', marginRight: 8 },
  teePillActive:     { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  teeColourDot:      { width: 10, height: 10, borderRadius: 5 },
  teePillText:       { fontSize: 14, fontWeight: '600', color: '#555' },
  teePillTextActive: { color: GREEN },
  teeGender:         { fontSize: 11, color: '#aaa' },

  teeInfoCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  teeInfoRow:     { flexDirection: 'row' },
  teeInfoCell:    { flex: 1, alignItems: 'center' },
  teeInfoValue:   { fontSize: 20, fontWeight: '700', color: '#111' },
  teeInfoLabel:   { fontSize: 10, color: '#888', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  hcpRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 4 },
  hcpBtn:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' },
  hcpBtnText:  { fontSize: 22, color: GREEN, fontWeight: '300' },
  hcpInput:    { width: 80, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff', fontSize: 28, fontWeight: '700', color: '#111', textAlign: 'center' },

  // Hole scoring
  holeProgress:    { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 16 },
  holeDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e5e7eb' },
  holeDotActive:   { backgroundColor: GREEN, transform: [{ scale: 1.4 }] },
  holeDotDone:     { backgroundColor: '#86efac' },

  holeCard:       { backgroundColor: '#fff', borderRadius: 20, marginHorizontal: 16, padding: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  holeLabel:      { fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 2, textTransform: 'uppercase' },
  holeNumber:     { fontSize: 72, fontWeight: '800', color: '#111', lineHeight: 80 },
  holeChips:      { flexDirection: 'row', gap: 8, marginBottom: 24 },
  chip:           { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: '#f3f4f6' },
  chipText:       { fontSize: 13, fontWeight: '600', color: '#555' },

  scoreRow:        { flexDirection: 'row', alignItems: 'center', gap: 24 },
  scoreBtn:        { width: 56, height: 56, borderRadius: 28, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  scoreBtnText:    { fontSize: 28, color: '#111', fontWeight: '300', lineHeight: 34 },
  scoreDisplay:    { alignItems: 'center', width: 80 },
  scoreNum:        { fontSize: 64, fontWeight: '800', lineHeight: 68 },
  scoreSubLabel:   { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  stablefordBadge: { marginTop: 16, fontSize: 15, fontWeight: '600', color: '#9ca3af' },

  holePrevNext:      { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 16 },
  holeNavBtn:        { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  holeNavBtnDisabled:{ opacity: 0.35 },
  holeNavBtnGreen:   { backgroundColor: GREEN, borderColor: GREEN },
  holeNavText:       { fontSize: 15, fontWeight: '600', color: '#374151' },

  runningTotal:   { flexDirection: 'row', backgroundColor: '#111', marginHorizontal: 16, marginTop: 16, borderRadius: 14, padding: 16, justifyContent: 'space-around' },
  runningItem:    { alignItems: 'center' },
  runningValue:   { fontSize: 22, fontWeight: '800', color: '#fff' },
  runningLabel:   { fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  runningDivider: { width: 1, backgroundColor: '#374151' },

  // Scorecard
  scorecardCard:      { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  scorecardLabel:     { fontSize: 12, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  scorecardHeader:    { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', marginBottom: 4 },
  scorecardRow:       { flexDirection: 'row', paddingVertical: 5 },
  scorecardTotalRow:  { borderTopWidth: 1, borderTopColor: '#f3f4f6', marginTop: 4, paddingTop: 8 },
  scorecardTotalText: { fontWeight: '700', color: '#111' },
  scCell:   { textAlign: 'center', fontSize: 13, color: '#374151' },
  scHole:   { width: 36 },
  scPar:    { width: 32 },
  scSI:     { width: 28 },
  scScore:  { flex: 1, fontWeight: '600' },
  scPts:    { width: 36, fontWeight: '600' },

  grandTotal:   { flexDirection: 'row', backgroundColor: '#f0fdf4', borderRadius: 14, padding: 20, marginTop: 8, justifyContent: 'center' },
  grandItem:    { flex: 1, alignItems: 'center' },
  grandValue:   { fontSize: 32, fontWeight: '800', color: '#111' },
  grandLabel:   { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  grandDivider: { width: 1, backgroundColor: '#d1fae5', marginVertical: 4 },

  notesInput: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', padding: 14, fontSize: 15, minHeight: 80 },

  // Step 5
  step5Content:  { alignItems: 'center', paddingTop: 24 },
  successIcon:   { marginBottom: 12 },
  step5Title:    { fontSize: 28, fontWeight: '800', color: '#111', marginBottom: 4 },
  step5Sub:      { fontSize: 15, color: '#888', marginBottom: 28 },
  step5Card:     { backgroundColor: '#fff', borderRadius: 20, width: '100%', padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3, marginBottom: 24 },
  step5Row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  step5RowLabel: { fontSize: 15, color: '#555' },
  step5RowValue: { fontSize: 20, fontWeight: '800', color: '#111' },
  step5Divider:  { height: 1, backgroundColor: '#f3f4f6' },
  doneBtn:       { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 48 },
  doneBtnText:   { color: '#fff', fontSize: 17, fontWeight: '700' },

  // Footer / next
  footer:           { padding: 16, backgroundColor: BG, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  nextBtn:          { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnDisabled:  { opacity: 0.45 },
  nextBtnText:      { color: '#fff', fontSize: 17, fontWeight: '700' },
});
