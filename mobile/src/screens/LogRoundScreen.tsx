import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, FlatList, Alert,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius } from '../theme';

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
  stablefordPoints: number;
  fairwayHit: boolean | null;
  gir: boolean | null;
  putts: number;
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
  return Math.round(idx * (slope / 113) + (rating - par));
}

function calcStableford(par: number, si: number, score: number, ph: number): number {
  const extra = Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0);
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

  const [step, setStep]       = useState<1 | 2 | 3 | 4 | 5>(1);
  const [saving, setSaving]   = useState(false);
  const [userHcpIdx, setUserHcpIdx] = useState(0);
  const slideAnim             = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    client.get<{ handicap: number | null }>('/api/users/profile')
      .then(r => setUserHcpIdx(Number(r.data.handicap) || 0))
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

  // Step 3
  const [holes, setHoles]             = useState<HoleEntry[]>([]);
  const [holeIdx, setHoleIdx]         = useState(0);   // 0-17
  const [liveRoundId, setLiveRoundId] = useState<number | null>(null);
  const liveRoundIdRef                = useRef<number | null>(null);

  // Step 4 / 5
  const [notes, setNotes]           = useState('');
  const [savedRound, setSavedRound] = useState<any>(null);
  const [roundType, setRoundType]   = useState<'social' | 'scoring'>('social');
  const [clubMembers, setClubMembers] = useState<ClubMember[]>([]);
  const [partnerSearch, setPartnerSearch]       = useState('');
  const [selectedPartner, setSelectedPartner]   = useState<ClubMember | null>(null);

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
          score: h.par, stablefordPoints: calcStableford(h.par, h.si, h.par, ph),
          fairwayHit: null, gir: null, putts: 2,
        }));
        setHoles(initialHoles);
        setHoleIdx(0);
        client.post('/api/rounds/start', {
          playedAt: date, courseName: courseResult.club_name, teeName: tee.colour,
          slopeRating: tee.slopeRating, courseRating: tee.courseRating,
          courseHandicap: ph, handicapIndex: userHcpIdx, holeData: tee.holes,
        }).then(({ data }) => {
          liveRoundIdRef.current = data.id;
          setLiveRoundId(data.id);
        }).catch(() => {});
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
      const next = prev.map((h, i) => i !== holeIdx ? h : { ...h, putts: Math.max(0, h.putts + delta) });
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

      {step === 3 ? (
        /* ── Live scoring header ─────────────────────────────────────── */
        <>
          <View style={styles.s3Header}>
            <TouchableOpacity onPress={back} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
              <Text style={styles.s3ExitText}>Exit</Text>
            </TouchableOpacity>
            <Text style={styles.s3CourseName} numberOfLines={1}>{course?.club_name ?? ''}</Text>
            <TouchableOpacity style={styles.s3FinishPill} onPress={() => animateStep(4)}>
              <Text style={styles.s3FinishText}>Finish</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.s3LiveBar}>
            <View style={styles.s3LiveDot} />
            <Text style={styles.s3LiveText}>LIVE · SAVING</Text>
          </View>
        </>
      ) : (
        /* ── Standard header + step bar ─────────────────────────────── */
        <>
          <View style={styles.header}>
            <TouchableOpacity onPress={back} style={styles.backBtn} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
              <Text style={styles.backIcon}>{step === 1 ? '✕' : '←'}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Log Round</Text>
            <View style={{ width: 36 }} />
          </View>
          <StepBar current={step} />
        </>
      )}

      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {step === 1 && <Step1 date={date} setDate={setDate} query={query} onQueryChange={onQueryChange}
          results={results} searching={searching} course={course} selectCourse={selectCourse}
          onNext={goToStep2} loading={loadingTees} onAddManually={goToManualCourse} />}

        {step === 2 && <Step2 tees={tees} teeIdx={teeIdx} setTeeIdx={setTeeIdx}
          playingHcp={playingHcp} setPlayingHcp={setPlayingHcp} userHcpIdx={userHcpIdx} onNext={goToStep3} />}

        {step === 3 && <Step3 holes={holes} holeIdx={holeIdx} setHoleIdx={setHoleIdx}
          adjustScore={adjustScore} onNext={() => animateStep(4)} playingHcp={playingHcp}
          setFIR={setFIR} setGIR={setGIR} adjustPutts={adjustPutts} />}

        {step === 4 && <Step4 holes={holes} totalStrokes={totalStrokes} totalStableford={totalStableford}
          notes={notes} setNotes={setNotes} onNext={() => animateStep(5)} saving={saving} saveRound={saveRound}
          courseName={course?.club_name ?? ''} date={date}
          roundType={roundType} setRoundType={setRoundType}
          clubMembers={clubMembers} partnerSearch={partnerSearch} setPartnerSearch={setPartnerSearch}
          selectedPartner={selectedPartner} setSelectedPartner={setSelectedPartner} />}

        {step === 5 && <Step5 savedRound={savedRound}
          totalStableford={totalStableford} totalStrokes={totalStrokes}
          courseName={course?.club_name ?? ''} onDone={() => navigation.goBack()} />}
      </Animated.View>
    </View>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({ date, setDate, query, onQueryChange, results, searching, course, selectCourse, onNext, loading, onAddManually }: any) {
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

function Step3({ holes, holeIdx, setHoleIdx, adjustScore, onNext, playingHcp, setFIR, setGIR, adjustPutts }: any) {
  const hole: HoleEntry | undefined = holes[holeIdx];
  if (!hole) return null;

  const sl       = scoreLabel(hole.score, hole.par);
  const ph       = Number(playingHcp) || 0;
  const extra    = Math.floor(ph / 18) + (hole.strokeIndex <= ph % 18 ? 1 : 0);
  const netScore = hole.score > 0 ? hole.score - extra : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>

      {/* ── Hole info bar ──────────────────────────────────────────────── */}
      <View style={styles.s3HoleBar}>
        <View>
          <Text style={styles.s3HoleWord}>HOLE {holeWord(hole.holeNumber)}</Text>
          <Text style={styles.s3HoleNum}>{hole.holeNumber}</Text>
          <Text style={styles.s3HoleMeta}>PAR {hole.par} · SI {hole.strokeIndex}</Text>
        </View>
        {extra > 0 && (
          <View style={styles.s3ShotPill}>
            <Text style={styles.s3ShotPillText}>+{extra} shot{extra > 1 ? 's' : ''}</Text>
          </View>
        )}
      </View>

      {/* ── Score input area ───────────────────────────────────────────── */}
      <View style={styles.s3ScoreArea}>
        <TouchableOpacity style={styles.s3ScoreBtn} onPress={() => adjustScore(-1)}>
          <Text style={styles.s3ScoreBtnText}>−</Text>
        </TouchableOpacity>

        <View style={styles.s3ScoreCenter}>
          <Text style={[styles.s3ScoreNum, { color: hole.score > 0 ? sl.color : colors.textSecondary }]}>
            {hole.score > 0 ? hole.score : '—'}
          </Text>
          <Text style={styles.s3ScoreLabel}>STROKES</Text>
        </View>

        <TouchableOpacity style={styles.s3ScoreBtn} onPress={() => adjustScore(+1)}>
          <Text style={styles.s3ScoreBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ── FIR / GIR / Putts ─────────────────────────────────────────── */}
      <View style={styles.s3TrackRow}>
        <View style={styles.s3TrackBlock}>
          <Text style={styles.s3TrackLabel}>FAIRWAY</Text>
          {hole.par === 3 ? (
            <Text style={styles.s3TrackNA}>N/A</Text>
          ) : (
            <View style={styles.s3TrackToggle}>
              <TouchableOpacity
                style={[styles.s3TrackBtn, hole.fairwayHit === true && styles.s3TrackBtnGreen]}
                onPress={() => setFIR(hole.fairwayHit === true ? null : true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TrackBtnText, hole.fairwayHit === true && styles.s3TrackBtnTextOn]}>Hit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.s3TrackBtn, hole.fairwayHit === false && styles.s3TrackBtnRed]}
                onPress={() => setFIR(hole.fairwayHit === false ? null : false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.s3TrackBtnText, hole.fairwayHit === false && styles.s3TrackBtnTextOn]}>Miss</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.s3TrackDivider} />

        <View style={styles.s3TrackBlock}>
          <Text style={styles.s3TrackLabel}>GREEN (GIR)</Text>
          <View style={styles.s3TrackToggle}>
            <TouchableOpacity
              style={[styles.s3TrackBtn, hole.gir === true && styles.s3TrackBtnGreen]}
              onPress={() => setGIR(hole.gir === true ? null : true)}
              activeOpacity={0.8}
            >
              <Text style={[styles.s3TrackBtnText, hole.gir === true && styles.s3TrackBtnTextOn]}>Hit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.s3TrackBtn, hole.gir === false && styles.s3TrackBtnRed]}
              onPress={() => setGIR(hole.gir === false ? null : false)}
              activeOpacity={0.8}
            >
              <Text style={[styles.s3TrackBtnText, hole.gir === false && styles.s3TrackBtnTextOn]}>Miss</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.s3TrackDivider} />

        <View style={styles.s3TrackBlock}>
          <Text style={styles.s3TrackLabel}>PUTTS</Text>
          <View style={styles.s3PuttRow}>
            <TouchableOpacity style={styles.s3PuttBtn} onPress={() => adjustPutts(-1)}>
              <Text style={styles.s3PuttBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.s3PuttCount}>{hole.putts}</Text>
            <TouchableOpacity style={styles.s3PuttBtn} onPress={() => adjustPutts(+1)}>
              <Text style={styles.s3PuttBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Net score banner ───────────────────────────────────────────── */}
      <View style={styles.s3NetBanner}>
        <View style={styles.s3NetSide}>
          <Text style={styles.s3NetLabel}>NET SCORE</Text>
          <Text style={styles.s3NetValue}>{netScore !== null ? netScore : '—'}</Text>
        </View>
        <View style={styles.s3NetDivider} />
        <View style={styles.s3NetSide}>
          <Text style={styles.s3NetLabel}>EARNED</Text>
          <Text style={styles.s3EarnedValue}>
            {hole.score > 0 ? `${hole.stablefordPoints} pts` : '—'}
          </Text>
        </View>
      </View>

      {/* ── Hole navigation ────────────────────────────────────────────── */}
      <View style={styles.s3NavRow}>
        <TouchableOpacity
          style={[styles.s3NavBtnOutline, holeIdx === 0 && styles.s3NavBtnDisabled]}
          onPress={() => setHoleIdx(Math.max(0, holeIdx - 1))}
          disabled={holeIdx === 0}
        >
          <Text style={styles.s3NavBtnOutlineText}>
            {holeIdx > 0 ? `← Hole ${holeIdx}` : '← Prev'}
          </Text>
        </TouchableOpacity>

        {holeIdx < 17 ? (
          <TouchableOpacity style={styles.s3NavBtnFilled} onPress={() => setHoleIdx(holeIdx + 1)}>
            <Text style={styles.s3NavBtnFilledText}>Hole {holeIdx + 2} →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.s3NavBtnFilled} onPress={onNext}>
            <Text style={styles.s3NavBtnFilledText}>Review →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Scorecard strip ────────────────────────────────────────────── */}
      <View style={styles.s3StripHeader}>
        <Text style={styles.s3StripLabel}>SCORECARD</Text>
        <Text style={styles.s3StripHint}>Tap a hole to edit</Text>
      </View>
      <View style={styles.s3StripContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.s3StripScroll}
        >
          {holes.map((h: HoleEntry, i: number) => {
            const isCurrent   = i === holeIdx;
            const isCompleted = h.score > 0;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.s3Chip,
                  isCurrent   && styles.s3ChipActive,
                  isCompleted && !isCurrent && styles.s3ChipDone,
                ]}
                onPress={() => setHoleIdx(i)}
                activeOpacity={0.75}
              >
                <Text style={[styles.s3ChipNum, isCurrent && styles.s3ChipTextLight]}>
                  {h.holeNumber}
                </Text>
                <Text style={[styles.s3ChipPar, isCurrent && styles.s3ChipParLight]}>
                  p{h.par}
                </Text>
                {isCompleted && (
                  <Text style={[styles.s3ChipScore, isCurrent && styles.s3ChipTextLight]}>
                    {h.score}
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

function Step5({ totalStableford, totalStrokes, courseName, onDone }: any) {
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

  // Footer / next
  footer:           { padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  nextBtn:          { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: spacing.md, alignItems: 'center' },
  nextBtnDisabled:  { opacity: 0.45 },
  nextBtnText:      { color: colors.textInverse, fontSize: fontSize.md, fontWeight: '700' },

  // ── Step 3 live scoring ────────────────────────────────────────────────────

  s3Header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  s3ExitText: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  s3CourseName: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
  },
  s3FinishPill: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  s3FinishText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },

  s3LiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  s3LiveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  s3LiveText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.8,
  },

  s3HoleBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  s3HoleWord: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  s3HoleNum: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 44,
  },
  s3HoleMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  s3ShotPill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  s3ShotPillText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  s3ScoreArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  s3ScoreBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  s3ScoreBtnText: {
    fontSize: fontSize.xxl,
    color: colors.textPrimary,
    fontWeight: '300',
    lineHeight: 36,
  },
  s3ScoreCenter: {
    alignItems: 'center',
    minWidth: 80,
  },
  s3ScoreNum: {
    fontSize: fontSize.display,
    fontWeight: '800',
    lineHeight: 44,
  },
  s3ScoreLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },

  s3TrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  s3TrackBlock:    { flex: 1, alignItems: 'center', gap: 7 },
  s3TrackLabel:    { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  s3TrackNA:       { fontSize: fontSize.xs, color: colors.border, fontStyle: 'italic' },
  s3TrackDivider:  { width: 1, height: 44, backgroundColor: colors.border, marginHorizontal: 4 },
  s3TrackToggle:   { flexDirection: 'row', gap: 4 },
  s3TrackBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
  },
  s3TrackBtnGreen: { backgroundColor: colors.primary + '18', borderColor: colors.primary },
  s3TrackBtnRed:   { backgroundColor: colors.danger + '18', borderColor: colors.danger },
  s3TrackBtnText:  { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  s3TrackBtnTextOn:{ color: colors.textPrimary, fontWeight: '700' },
  s3PuttRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  s3PuttBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  s3PuttBtnText:   { fontSize: fontSize.base, fontWeight: '300', color: colors.textPrimary },
  s3PuttCount:     { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary, minWidth: 22, textAlign: 'center' },

  s3NetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  s3NetSide: {
    alignItems: 'center',
    flex: 1,
  },
  s3NetDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  s3NetLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  s3NetValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  s3EarnedValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.primary,
  },

  s3NavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  s3NavBtnOutline: {
    flex: 1,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  s3NavBtnFilled: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  s3NavBtnOutlineText: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  s3NavBtnFilledText: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.textInverse,
  },
  s3NavBtnDisabled: {
    opacity: 0.35,
  },

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
