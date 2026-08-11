import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  useWindowDimensions, TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import DonutChart, { DonutSegment } from '../components/DonutChart';
import { fontSize, spacing } from '../theme';

// ── Palette ───────────────────────────────────────────────────────────────────

const PAGE_BG  = '#edeae4';
const G_DARK   = '#2a4a18';
const G_MID    = '#3d6b1f';
const G_LIGHT  = '#4e8a27';
const COL_EAGLE     = '#c9a227';
const COL_BIRDIE    = '#3d6b1f';
const COL_PAR       = '#5a7a42';
const COL_PAR_AMBER = '#E09050';
const COL_BOGEY     = '#d4845a';
const COL_DOUBLE    = '#c0392b';

// ── Types ─────────────────────────────────────────────────────────────────────

type Hole = {
  hole_number: number;
  par: number;
  stroke_index: number | null;
  score: number;
  stableford_points: number;
  fairway_hit: boolean | null;
  gir: boolean | null;
  putts: number | null;
};

type RoundDetail = {
  id: number;
  course_name: string;
  played_at: string;
  score: number;
  stableford: number;
  tee_name: string | null;
  slope_rating: number | null;
  course_rating: number | null;
  course_handicap: number | null;
  notes: string | null;
  holes: Hole[];
};

type Props = { route: { params: { roundId: string } }; navigation: any };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

type CellStyle = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double';
function holeCell(score: number, par: number): CellStyle {
  const d = score - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d ===  0) return 'par';
  if (d ===  1) return 'bogey';
  return 'double';
}

function ptsColor(pts: number): string {
  if (pts === 0) return COL_DOUBLE;
  if (pts === 1) return '#ccc';
  if (pts === 2) return '#888';
  return COL_BIRDIE;
}

function stablefordColor(pts: number): string {
  return pts >= 36 ? '#a8e063' : '#fff';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BarRow({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[s.barPct, { color }]}>{pct}%</Text>
    </View>
  );
}

function ParDonutCol({ par, holes }: { par: number; holes: Hole[] }) {
  const n = holes.length;
  if (!n) return null;
  const birdiePlus = holes.filter(h => h.score <= h.par - 1).length;
  const parCount   = holes.filter(h => h.score === h.par).length;
  const bogeyPlus  = holes.filter(h => h.score >= h.par + 1).length;
  const avgScore   = holes.reduce((sum, h) => sum + h.score, 0) / n;

  const segs: DonutSegment[] = [
    { label: 'Birdie+', count: birdiePlus, color: COL_BIRDIE },
    { label: 'Par',     count: parCount,   color: COL_PAR_AMBER },
    { label: 'Bogey+',  count: bogeyPlus,  color: COL_DOUBLE },
  ];

  return (
    <View style={s.sbpCol}>
      <DonutChart
        segments={segs}
        size={104}
        strokeWidth={11}
        centerText={avgScore.toFixed(1)}
        centerSub="avg score"
      />
      <Text style={s.sbpParLabel}>PAR {par}</Text>
    </View>
  );
}

function NineTable({ holes, cw, lw, tw }: {
  holes: Hole[]; cw: number; lw: number; tw: number;
}) {
  const tot    = holes.reduce((sum, h) => sum + h.score, 0);
  const pts    = holes.reduce((sum, h) => sum + h.stableford_points, 0);
  const parTot = holes.reduce((sum, h) => sum + h.par, 0);
  const cellSz = Math.max(cw - 4, 20);
  const scoreFs = Math.max(Math.round(cw * 0.42), 11);

  return (
    <View style={{ paddingHorizontal: 4 }}>
      {/* Hole row */}
      <View style={[s.tRow, s.tRowDiv]}>
        <Text style={[s.tLbl, { width: lw }]}>Hole</Text>
        {holes.map(h => <Text key={h.hole_number} style={[s.tHole, { width: cw }]}>{h.hole_number}</Text>)}
        <Text style={[s.tTot, { width: tw }]}>Tot</Text>
      </View>

      {/* Par row */}
      <View style={[s.tRow, s.tRowDiv]}>
        <Text style={[s.tLbl, { width: lw }]}>Par</Text>
        {holes.map(h => <Text key={h.hole_number} style={[s.tPar, { width: cw }]}>{h.par}</Text>)}
        <Text style={[s.tParTot, { width: tw }]}>{parTot}</Text>
      </View>

      {/* SI row */}
      <View style={[s.tRow, s.tRowDiv]}>
        <Text style={[s.tLbl, { width: lw }]}>SI</Text>
        {holes.map(h => <Text key={h.hole_number} style={[s.tSi, { width: cw }]}>{h.stroke_index ?? '—'}</Text>)}
        <View style={{ width: tw }} />
      </View>

      {/* Score row */}
      <View style={[s.tRow, s.tRowDiv, { marginVertical: 2 }]}>
        <Text style={[s.tLbl, { width: lw }]}>Score</Text>
        {holes.map(h => {
          const cs = holeCell(h.score, h.par);
          return (
            <View key={h.hole_number} style={[s.tScoreCell, { width: cw }]}>
              <View style={[
                s.cell,
                { width: cellSz, height: cellSz },
                cs === 'eagle'  && s.cellEagle,
                cs === 'birdie' && s.cellBirdie,
                cs === 'bogey'  && s.cellBogey,
                cs === 'double' && s.cellDouble,
              ]}>
                <Text style={[
                  s.cellTxt,
                  { fontSize: scoreFs },
                  cs === 'eagle'  && { color: '#a67c00' },
                  cs === 'birdie' && { color: '#2a4a18' },
                  cs === 'par'    && { color: '#999', fontWeight: '600' },
                  cs === 'bogey'  && { color: '#666' },
                  cs === 'double' && { color: COL_DOUBLE },
                ]}>{h.score}</Text>
              </View>
            </View>
          );
        })}
        <Text style={[s.tScoreTot, { fontSize: scoreFs, width: tw }]}>{tot}</Text>
      </View>

      {/* Pts row */}
      <View style={s.tRow}>
        <Text style={[s.tLbl, { width: lw }]}>Pts</Text>
        {holes.map(h => (
          <Text key={h.hole_number} style={[s.tPts, { width: cw, color: ptsColor(h.stableford_points) }]}>
            {h.stableford_points}
          </Text>
        ))}
        <Text style={[s.tPtsTot, {
          width: tw,
          color: pts >= 18 ? COL_BIRDIE : pts <= 14 ? COL_DOUBLE : '#888',
        }]}>
          {pts}
        </Text>
      </View>
    </View>
  );
}

// ── Edit mode ──────────────────────────────────────────────────────────────────

type HoleEdit = { score: number; fairwayHit: boolean | null; gir: boolean | null; putts: number | null };

function TriToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <View style={s.triRow}>
      <TouchableOpacity
        style={[s.triBtn, value === true && s.triBtnHitActive]}
        onPress={() => onChange(value === true ? null : true)}
      >
        <Text style={[s.triBtnTxt, value === true && s.triBtnTxtActive]}>Hit</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.triBtn, value === false && s.triBtnMissActive]}
        onPress={() => onChange(value === false ? null : false)}
      >
        <Text style={[s.triBtnTxt, value === false && s.triBtnTxtActive]}>Miss</Text>
      </TouchableOpacity>
    </View>
  );
}

function Stepper({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <View style={s.stepRow}>
      <TouchableOpacity
        style={s.stepBtn}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
      >
        <Ionicons name="remove" size={16} color={value <= min ? '#ddd' : '#1a1a1a'} />
      </TouchableOpacity>
      <Text style={s.stepVal}>{value}</Text>
      <TouchableOpacity style={s.stepBtn} onPress={() => onChange(value + 1)}>
        <Ionicons name="add" size={16} color="#1a1a1a" />
      </TouchableOpacity>
    </View>
  );
}

function EditHoleRow({ hole, edit, onChange }: {
  hole: Hole; edit: HoleEdit; onChange: (patch: Partial<HoleEdit>) => void;
}) {
  return (
    <View style={s.editRow}>
      <View style={s.editRowHeader}>
        <Text style={s.editRowHole}>Hole {hole.hole_number}</Text>
        <Text style={s.editRowPar}>Par {hole.par}</Text>
      </View>

      <View style={s.editField}>
        <Text style={s.editFieldLbl}>Score</Text>
        <Stepper value={edit.score} min={1} onChange={v => onChange({ score: v })} />
      </View>

      <View style={s.editField}>
        <Text style={s.editFieldLbl}>Putts</Text>
        <Stepper value={edit.putts ?? 0} min={0} onChange={v => onChange({ putts: v })} />
      </View>

      {hole.par >= 4 && (
        <View style={s.editField}>
          <Text style={s.editFieldLbl}>Fairway</Text>
          <TriToggle value={edit.fairwayHit} onChange={v => onChange({ fairwayHit: v })} />
        </View>
      )}

      <View style={s.editField}>
        <Text style={s.editFieldLbl}>Green (GIR)</Text>
        <TriToggle value={edit.gir} onChange={v => onChange({ gir: v })} />
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RoundDetailScreen({ route, navigation }: Props) {
  const { roundId }  = route.params;
  const insets       = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();

  const [round,   setRound]   = useState<RoundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const [editing,   setEditing]   = useState(false);
  const [editHoles, setEditHoles] = useState<Record<number, HoleEdit>>({});
  const [saving,    setSaving]    = useState(false);

  const [editingCourseInfo, setEditingCourseInfo] = useState(false);
  const [savingCourseInfo,  setSavingCourseInfo]   = useState(false);
  const [teeNameInput,      setTeeNameInput]       = useState('');
  const [slopeInput,        setSlopeInput]         = useState('');
  const [courseRatingInput, setCourseRatingInput]  = useState('');
  const [courseHcpInput,    setCourseHcpInput]     = useState('');

  useEffect(() => {
    client.get<RoundDetail>(`/api/rounds/${roundId}`)
      .then(r => setRound(r.data))
      .catch(() => setError('Could not load round'))
      .finally(() => setLoading(false));
  }, [roundId]);

  function startEdit() {
    if (!round) return;
    const init: Record<number, HoleEdit> = {};
    for (const h of round.holes) {
      init[h.hole_number] = { score: h.score, fairwayHit: h.fairway_hit, gir: h.gir, putts: h.putts };
    }
    setEditHoles(init);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditHoles({});
  }

  async function saveEdits() {
    setSaving(true);
    try {
      const payload = {
        holes: Object.entries(editHoles).map(([holeNumber, h]) => ({
          holeNumber: parseInt(holeNumber, 10),
          score: h.score,
          fairwayHit: h.fairwayHit,
          gir: h.gir,
          putts: h.putts,
        })),
      };
      const { data } = await client.patch(`/api/rounds/${roundId}/holes`, payload);
      setRound(prev => prev ? { ...prev, score: data.score, stableford: data.stableford, holes: data.holes } : prev);
      setEditing(false);
      setEditHoles({});
    } catch {
      Alert.alert('Error', 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  function startCourseInfoEdit() {
    if (!round) return;
    setTeeNameInput(round.tee_name ?? '');
    setSlopeInput(round.slope_rating != null ? String(round.slope_rating) : '');
    setCourseRatingInput(round.course_rating != null ? String(round.course_rating) : '');
    setCourseHcpInput(round.course_handicap != null ? String(round.course_handicap) : '');
    setEditingCourseInfo(true);
  }

  function cancelCourseInfoEdit() {
    setEditingCourseInfo(false);
  }

  async function saveCourseInfo() {
    const slope  = slopeInput.trim()        ? parseInt(slopeInput, 10)      : null;
    const rating = courseRatingInput.trim() ? parseFloat(courseRatingInput) : null;
    const chcp   = courseHcpInput.trim()    ? parseInt(courseHcpInput, 10)  : null;

    if (slope != null && (isNaN(slope) || slope < 55 || slope > 155)) {
      Alert.alert('Invalid slope rating', 'Slope rating must be between 55 and 155.'); return;
    }
    if (rating != null && (isNaN(rating) || rating < 55 || rating > 85)) {
      Alert.alert('Invalid course rating', 'Course rating must be between 55 and 85.'); return;
    }
    if (chcp != null && (isNaN(chcp) || chcp < -10 || chcp > 54)) {
      Alert.alert('Invalid course handicap', 'Course handicap must be between -10 and 54.'); return;
    }

    setSavingCourseInfo(true);
    try {
      const { data } = await client.patch(`/api/rounds/${roundId}/course-info`, {
        teeName: teeNameInput.trim() || null,
        slopeRating: slope,
        courseRating: rating,
        courseHandicap: chcp,
      });
      setRound(prev => prev ? {
        ...prev,
        tee_name: data.tee_name,
        slope_rating: data.slope_rating,
        course_rating: data.course_rating,
        course_handicap: data.course_handicap,
      } : prev);
      setEditingCourseInfo(false);
    } catch {
      Alert.alert('Error', 'Could not save course info');
    } finally {
      setSavingCourseInfo(false);
    }
  }

  useEffect(() => {
    // Style the native header to match the page palette
    navigation.setOptions({
      title: 'Round Stats',
      headerStyle: { backgroundColor: PAGE_BG },
      headerTintColor: G_MID,
      headerTitleStyle: { fontWeight: '700', fontSize: 17, color: '#1a1a1a' },
      headerBackTitle: 'Back',
      headerShadowVisible: false,
    });
  }, []);

  if (loading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={G_MID} /></View>;
  }
  if (error || !round) {
    return <View style={s.centered}><Text style={s.errTxt}>{error || 'Round not found'}</Text></View>;
  }

  const holes  = round.holes ?? [];
  const front9 = holes.filter(h => h.hole_number <= 9);
  const back9  = holes.filter(h => h.hole_number >= 10);

  const displayScore = holes.length > 0
    ? holes.reduce((sum, h) => sum + h.score, 0) : round.score;
  const displayPts = holes.length > 0
    ? holes.reduce((sum, h) => sum + h.stableford_points, 0) : round.stableford;

  // Hole breakdown counts
  const nH      = holes.length;
  const eagles  = holes.filter(h => h.score <= h.par - 2).length;
  const birdies = holes.filter(h => h.score === h.par - 1).length;
  const pars    = holes.filter(h => h.score === h.par).length;
  const bogeys  = holes.filter(h => h.score === h.par + 1).length;
  const doubles = holes.filter(h => h.score >= h.par + 2).length;

  const donutSegs: DonutSegment[] = [
    { label: 'Eagle+',  count: eagles,  color: COL_EAGLE  },
    { label: 'Birdie',  count: birdies, color: COL_BIRDIE },
    { label: 'Par',     count: pars,    color: COL_PAR    },
    { label: 'Bogey',   count: bogeys,  color: COL_BOGEY  },
    { label: 'Double+', count: doubles, color: COL_DOUBLE },
  ];

  // Course management
  const fwHoles = holes.filter(h => h.fairway_hit !== null);
  const fwHit   = fwHoles.filter(h => h.fairway_hit).length;
  const fwPct   = fwHoles.length > 0 ? Math.round((fwHit / fwHoles.length) * 100) : null;

  const girHoles = holes.filter(h => h.gir !== null);
  const girHit   = girHoles.filter(h => h.gir).length;
  const girPct   = girHoles.length > 0 ? Math.round((girHit / girHoles.length) * 100) : null;

  // Putting
  const puttHoles    = holes.filter(h => h.putts !== null);
  const totalPutts   = puttHoles.reduce((sum, h) => sum + (h.putts ?? 0), 0);
  const perHolePutts = puttHoles.length > 0
    ? (totalPutts / puttHoles.length).toFixed(1) : null;
  const girPuttHoles = holes.filter(h => h.gir === true && h.putts !== null);
  const perGirPutts  = girPuttHoles.length > 0
    ? (girPuttHoles.reduce((sum, h) => sum + (h.putts ?? 0), 0) / girPuttHoles.length).toFixed(1)
    : null;

  const hasMgmt  = fwPct !== null || girPct !== null;
  const hasPutts = puttHoles.length > 0;

  const par3 = holes.filter(h => h.par === 3);
  const par4 = holes.filter(h => h.par === 4);
  const par5 = holes.filter(h => h.par === 5);

  // Scoring by par type — birdie+/par/bogey+ split, combined across all par values
  const parTypeHoles = [...par3, ...par4, ...par5];
  const parTypeTotal = parTypeHoles.length;
  const parTypeLegend = parTypeTotal > 0 ? [
    { label: 'Birdie or better', color: COL_BIRDIE,
      pct: Math.round((parTypeHoles.filter(h => h.score <= h.par - 1).length / parTypeTotal) * 100) },
    { label: 'Par', color: COL_PAR_AMBER,
      pct: Math.round((parTypeHoles.filter(h => h.score === h.par).length / parTypeTotal) * 100) },
    { label: 'Bogey or worse', color: COL_DOUBLE,
      pct: Math.round((parTypeHoles.filter(h => h.score >= h.par + 1).length / parTypeTotal) * 100) },
  ] : [];

  // Scorecard column widths
  const LW = 38;
  const TW = 34;
  const CW = Math.max(26, Math.floor((W - 32 - LW - TW) / 9)); // 32 = card px*2

  // Tee pill text
  const teeParts = [
    round.tee_name   ? `${round.tee_name} tees`       : null,
    round.slope_rating  ? `Slope ${round.slope_rating}`  : null,
    round.course_rating ? `Rating ${round.course_rating}` : null,
  ].filter(Boolean);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Hero card ── */}
      <View style={s.heroWrap}>
        <LinearGradient
          colors={[G_DARK, G_MID, G_LIGHT]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={s.heroCard}
        >
          <View style={s.heroGlow} pointerEvents="none" />
          <View style={s.heroRing} pointerEvents="none" />

          <Text style={s.heroMeta}>{fmtDate(round.played_at)}</Text>
          <Text style={s.heroCourse}>{round.course_name}</Text>

          <View style={s.heroStats}>
            <View style={s.heroStat}>
              <Text style={s.heroStatVal}>{displayScore}</Text>
              <Text style={s.heroStatLbl}>Gross</Text>
            </View>
            <View style={s.heroVDiv} />
            <View style={s.heroStat}>
              <Text style={[s.heroStatVal, { color: stablefordColor(displayPts) }]}>{displayPts}</Text>
              <Text style={s.heroStatLbl}>Stableford</Text>
            </View>
            {round.course_handicap != null && (
              <>
                <View style={s.heroVDiv} />
                <View style={s.heroStat}>
                  <Text style={s.heroStatVal}>{round.course_handicap}</Text>
                  <Text style={s.heroStatLbl}>C. Handicap</Text>
                </View>
              </>
            )}
          </View>

          {teeParts.length > 0 && (
            <View style={s.teePill}>
              <View style={s.teeDot} />
              <Text style={s.teeTxt}>{teeParts.join(' · ')}</Text>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* ── Course Info ── */}
      <View style={s.card}>
        <View style={s.ciHeader}>
          <Text style={[s.sectionLbl, { paddingTop: 16, paddingBottom: 0 }]}>Course Info</Text>
          {!editingCourseInfo && (
            <TouchableOpacity
              style={s.scEditBtn}
              onPress={startCourseInfoEdit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil-outline" size={14} color={G_MID} />
              <Text style={s.scEditBtnTxt}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {editingCourseInfo ? (
          <View style={s.ciForm}>
            <View style={s.ciFieldCol}>
              <Text style={s.ciFieldLbl}>Tee</Text>
              <TextInput
                style={s.ciInput}
                value={teeNameInput}
                onChangeText={setTeeNameInput}
                placeholder="e.g. White"
                placeholderTextColor="#ccc"
              />
            </View>
            <View style={s.ciFieldRow}>
              <View style={[s.ciFieldCol, { flex: 1 }]}>
                <Text style={s.ciFieldLbl}>Slope Rating</Text>
                <TextInput
                  style={s.ciInput}
                  value={slopeInput}
                  onChangeText={setSlopeInput}
                  placeholder="55–155"
                  placeholderTextColor="#ccc"
                  keyboardType="number-pad"
                />
              </View>
              <View style={[s.ciFieldCol, { flex: 1 }]}>
                <Text style={s.ciFieldLbl}>Course Rating</Text>
                <TextInput
                  style={s.ciInput}
                  value={courseRatingInput}
                  onChangeText={setCourseRatingInput}
                  placeholder="e.g. 71.4"
                  placeholderTextColor="#ccc"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <View style={s.ciFieldCol}>
              <Text style={s.ciFieldLbl}>Course Handicap</Text>
              <TextInput
                style={s.ciInput}
                value={courseHcpInput}
                onChangeText={setCourseHcpInput}
                placeholder="e.g. 14"
                placeholderTextColor="#ccc"
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <View style={s.editActions}>
              <TouchableOpacity style={s.editCancelBtn} onPress={cancelCourseInfoEdit} disabled={savingCourseInfo}>
                <Text style={s.editCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.editSaveBtn, savingCourseInfo && { opacity: 0.6 }]}
                onPress={saveCourseInfo}
                disabled={savingCourseInfo}
              >
                {savingCourseInfo
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.editSaveTxt}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View style={s.ciGrid}>
              <View style={s.ciTile}>
                <Text style={s.ciTileLbl}>Tee</Text>
                <Text style={s.ciTileVal}>{round.tee_name ?? '—'}</Text>
              </View>
              <View style={s.ciTile}>
                <Text style={s.ciTileLbl}>Slope</Text>
                <Text style={s.ciTileVal}>{round.slope_rating ?? '—'}</Text>
              </View>
              <View style={s.ciTile}>
                <Text style={s.ciTileLbl}>Rating</Text>
                <Text style={s.ciTileVal}>{round.course_rating != null ? round.course_rating.toFixed(1) : '—'}</Text>
              </View>
              <View style={s.ciTile}>
                <Text style={s.ciTileLbl}>C. Hcp</Text>
                <Text style={s.ciTileVal}>{round.course_handicap ?? '—'}</Text>
              </View>
            </View>
            {(round.slope_rating == null || round.course_rating == null) && (
              <Text style={s.ciHint}>Add slope & course rating to include this round in your Handicap Trend</Text>
            )}
          </>
        )}
      </View>

      {/* ── Hole performance ── */}
      {holes.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionLbl}>Hole performance</Text>

          <View style={s.donutSection}>
            <DonutChart
              segments={donutSegs}
              size={110}
              strokeWidth={14}
              centerText={String(nH)}
              centerSub="holes"
            />
            <View style={s.legend}>
              {donutSegs.filter(d => d.count > 0).map(d => (
                <View key={d.label} style={s.legRow}>
                  <View style={[s.legDot, { backgroundColor: d.color }]} />
                  <Text style={s.legName}>{d.label}</Text>
                  <Text style={s.legPct}>{nH > 0 ? `${Math.round((d.count / nH) * 100)}%` : '0%'}</Text>
                  <Text style={s.legN}>{d.count}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.sep} />

          <View style={s.barSection}>
            {eagles  > 0 && <BarRow label="Eagle+"  count={eagles}  total={nH} color={COL_EAGLE} />}
            {birdies > 0 && <BarRow label="Birdie"  count={birdies} total={nH} color={COL_BIRDIE} />}
            {pars    > 0 && <BarRow label="Par"     count={pars}    total={nH} color={COL_PAR} />}
            {bogeys  > 0 && <BarRow label="Bogey"   count={bogeys}  total={nH} color={COL_BOGEY} />}
            {doubles > 0 && <BarRow label="Double+" count={doubles} total={nH} color={COL_DOUBLE} />}
          </View>
        </View>
      )}

      {/* ── Scoring by par type ── */}
      {holes.length > 0 && (par3.length > 0 || par4.length > 0 || par5.length > 0) && (
        <View style={s.card}>
          <Text style={s.sectionLbl}>Scoring by par type</Text>
          <View style={s.sbpRow}>
            <ParDonutCol par={3} holes={par3} />
            <ParDonutCol par={4} holes={par4} />
            <ParDonutCol par={5} holes={par5} />
          </View>
          {parTypeLegend.length > 0 && (
            <>
              <View style={s.sep} />
              <View style={s.sbpLegendWrap}>
                {parTypeLegend.map(l => (
                  <View key={l.label} style={s.legRow}>
                    <View style={[s.legDot, { backgroundColor: l.color }]} />
                    <Text style={s.legName}>{l.label}</Text>
                    <Text style={[s.legPct, { color: l.color }]}>{l.pct}%</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {/* ── Course management ── */}
      {hasMgmt && (
        <View style={s.card}>
          <Text style={s.sectionLbl}>Course management</Text>
          <View style={s.mgmtGrid}>
            {fwPct !== null && (
              <View style={[s.mgmtTile, s.mgmtTileGreen]}>
                <Text style={s.mgmtLbl}>Fairways hit</Text>
                <Text style={[s.mgmtVal, { color: fwPct >= 50 ? G_MID : COL_DOUBLE }]}>{fwPct}%</Text>
                <Text style={s.mgmtSub}>{fwHit} of {fwHoles.length}</Text>
              </View>
            )}
            {girPct !== null && (
              <View style={[s.mgmtTile, s.mgmtTileRed]}>
                <Text style={s.mgmtLbl}>Greens (GIR)</Text>
                <Text style={[s.mgmtVal, { color: girPct >= 50 ? G_MID : COL_DOUBLE }]}>{girPct}%</Text>
                <Text style={s.mgmtSub}>{girHit} of {girHoles.length}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Putting ── */}
      {hasPutts && (
        <View style={s.card}>
          <Text style={s.sectionLbl}>Putting</Text>
          <View style={s.puttsGrid}>
            <View style={s.puttsTile}>
              <Text style={s.puttsVal}>{totalPutts}</Text>
              <Text style={s.puttsLbl}>Total putts</Text>
            </View>
            <View style={s.puttsTile}>
              <Text style={[s.puttsVal, { color: G_MID }]}>{perHolePutts}</Text>
              <Text style={s.puttsLbl}>Per hole</Text>
            </View>
            <View style={s.puttsTile}>
              <Text style={[s.puttsVal, { color: perGirPutts ? G_MID : '#ccc' }]}>
                {perGirPutts ?? '—'}
              </Text>
              <Text style={s.puttsLbl}>Per GIR</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Scorecard / Edit ── */}
      {holes.length > 0 && !editing && (
        <View style={s.scEditBar}>
          <Text style={s.scEditBarLbl}>Scorecard</Text>
          <TouchableOpacity style={s.scEditBtn} onPress={startEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="pencil-outline" size={14} color={G_MID} />
            <Text style={s.scEditBtnTxt}>Edit</Text>
          </TouchableOpacity>
        </View>
      )}
      {editing ? (
        <View style={s.card}>
          <View style={s.editHeader}>
            <Text style={[s.sectionLbl, { paddingTop: 0, paddingBottom: 0 }]}>Edit Round</Text>
            <Text style={s.editHeaderSub}>Fix a score or fill in fairways / GIR / putts</Text>
          </View>
          {holes.map(h => (
            <EditHoleRow
              key={h.hole_number}
              hole={h}
              edit={editHoles[h.hole_number] ?? { score: h.score, fairwayHit: h.fairway_hit, gir: h.gir, putts: h.putts }}
              onChange={patch => setEditHoles(prev => ({
                ...prev,
                [h.hole_number]: {
                  ...(prev[h.hole_number] ?? { score: h.score, fairwayHit: h.fairway_hit, gir: h.gir, putts: h.putts }),
                  ...patch,
                },
              }))}
            />
          ))}
          <View style={s.editActions}>
            <TouchableOpacity style={s.editCancelBtn} onPress={cancelEdit} disabled={saving}>
              <Text style={s.editCancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.editSaveBtn, saving && { opacity: 0.6 }]}
              onPress={saveEdits}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.editSaveTxt}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : holes.length > 0 ? (
        <View style={s.card}>
          {front9.length > 0 && (
            <>
              <Text style={s.scSectionLbl}>Front 9</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <NineTable holes={front9} cw={CW} lw={LW} tw={TW} />
              </ScrollView>
            </>
          )}
          {back9.length > 0 && (
            <>
              <View style={s.scMidDiv} />
              <Text style={s.scSectionLbl}>Back 9</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <NineTable holes={back9} cw={CW} lw={LW} tw={TW} />
              </ScrollView>
            </>
          )}
          <View style={{ height: 12 }} />
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.noHolesText}>Total score only — no hole-by-hole data recorded.</Text>
        </View>
      )}

      {round.notes ? (
        <View style={s.card}>
          <Text style={s.sectionLbl}>Notes</Text>
          <Text style={s.notesText}>{round.notes}</Text>
        </View>
      ) : null}

    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: PAGE_BG },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAGE_BG },
  errTxt:  { fontSize: fontSize.base, color: COL_DOUBLE },

  // ── Hero ──────────────────────────────────────────────────────────────────

  heroWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: G_DARK,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  heroCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    position: 'relative',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -50, right: -30,
  },
  heroRing: {
    position: 'absolute',
    bottom: -40, left: -20,
    width: 150, height: 150, borderRadius: 75,
    borderWidth: 28, borderColor: 'rgba(255,255,255,0.04)',
  },

  heroMeta:   { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '500', marginBottom: 4 },
  heroCourse: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: -0.3, marginBottom: 18 },

  heroStats: { flexDirection: 'row', alignItems: 'stretch' },
  heroStat:  { flex: 1, alignItems: 'center' },
  heroStatVal: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 38 },
  heroStatLbl: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: 5,
  },
  heroVDiv: { width: 0.5, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 4 },

  teePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 14, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)',
  },
  teeDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#4fc3f7',
  },
  teeTxt: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  // ── Cards ─────────────────────────────────────────────────────────────────

  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.07)',
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },

  sectionLbl: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#aaa',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
  },

  sep: { height: 0.5, backgroundColor: 'rgba(0,0,0,0.07)', marginHorizontal: 18 },

  // ── Hole performance ──────────────────────────────────────────────────────

  donutSection: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 18, paddingBottom: 14,
  },
  legend:  { flex: 1, gap: 8 },
  legRow:  { flexDirection: 'row', alignItems: 'center' },
  legDot:  { width: 9, height: 9, borderRadius: 3, marginRight: 8, flexShrink: 0 },
  legName: { flex: 1, fontSize: 12, color: '#666' },
  legPct:  { fontSize: 12, fontWeight: '700', color: '#1a1a1a', minWidth: 36, textAlign: 'right' },
  legN:    { fontSize: 11, color: '#ccc', minWidth: 22, textAlign: 'right', marginLeft: 4 },

  barSection: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, gap: 8 },
  barRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel:   { fontSize: 11, color: '#888', width: 56, textAlign: 'right', fontWeight: '500', flexShrink: 0 },
  barTrack:   { flex: 1, height: 7, backgroundColor: '#f0ede8', borderRadius: 4, overflow: 'hidden' },
  barFill:    { height: '100%', borderRadius: 4 },
  barPct:     { fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right', flexShrink: 0 },

  // ── Par type ──────────────────────────────────────────────────────────────

  sbpRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16,
  },
  sbpCol:       { alignItems: 'center', gap: 8 },
  sbpParLabel:  { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  sbpLegendWrap: { paddingHorizontal: 18, paddingVertical: 16, gap: 10 },

  // ── Course management ─────────────────────────────────────────────────────

  mgmtGrid: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingBottom: 16,
  },
  mgmtTile: {
    flex: 1, borderRadius: 14, padding: 14,
    borderWidth: 0.5,
  },
  mgmtTileGreen: {
    backgroundColor: 'rgba(61,107,31,0.07)',
    borderColor: 'rgba(61,107,31,0.15)',
  },
  mgmtTileRed: {
    backgroundColor: 'rgba(192,57,43,0.05)',
    borderColor: 'rgba(192,57,43,0.12)',
  },
  mgmtLbl: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.7,
    textTransform: 'uppercase', color: '#bbb', marginBottom: 6,
  },
  mgmtVal: { fontSize: 32, fontWeight: '800', lineHeight: 36, letterSpacing: -0.5 },
  mgmtSub: { fontSize: 11, color: '#aaa', marginTop: 4 },

  // ── Putting ───────────────────────────────────────────────────────────────

  puttsGrid: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingBottom: 16,
  },
  puttsTile: {
    flex: 1, backgroundColor: '#f7f5f1', borderRadius: 14, padding: 12,
    alignItems: 'center',
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)',
  },
  puttsVal: { fontSize: 26, fontWeight: '800', color: '#1a1a1a', letterSpacing: -0.5, lineHeight: 30 },
  puttsLbl: { fontSize: 10, color: '#bbb', fontWeight: '500', marginTop: 4 },

  // ── Scorecard ─────────────────────────────────────────────────────────────

  scSectionLbl: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', color: '#aaa',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },
  scMidDiv: { height: 0.5, backgroundColor: 'rgba(0,0,0,0.06)', marginHorizontal: 14, marginTop: 4 },

  // Table rows
  tRow:    { flexDirection: 'row', alignItems: 'center' },
  tRowDiv: { borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.06)' },
  tLbl:    {
    fontSize: 8, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', color: '#ccc',
    textAlign: 'left', paddingLeft: 12, paddingVertical: 8,
  },
  tHole:   { fontSize: 11, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', paddingVertical: 8 },
  tTot:    { fontSize: 11, fontWeight: '800', color: '#1a1a1a', textAlign: 'center', paddingVertical: 8 },
  tPar:    { fontSize: 11, fontWeight: '500', color: '#888', textAlign: 'center', paddingVertical: 5 },
  tParTot: { fontSize: 11, fontWeight: '700', color: '#888', textAlign: 'center', paddingVertical: 5 },
  tSi:     { fontSize: 9, color: '#ccc', textAlign: 'center', paddingVertical: 4 },

  tScoreCell: { alignItems: 'center', justifyContent: 'center', paddingVertical: 5 },
  tScoreTot:  { textAlign: 'center', paddingVertical: 5, fontWeight: '700', color: '#1a1a1a' },

  cell: {
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 3, backgroundColor: 'transparent',
  },
  cellEagle: {
    borderRadius: 99,
    backgroundColor: 'rgba(201,162,39,0.12)',
    borderWidth: 2, borderColor: '#c9a227',
  },
  cellBirdie: {
    borderRadius: 99,
    backgroundColor: 'rgba(61,107,31,0.13)',
    borderWidth: 2, borderColor: '#3d6b1f',
  },
  cellBogey: {
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.16)',
  },
  cellDouble: {
    backgroundColor: 'rgba(192,57,43,0.07)',
    borderWidth: 2, borderColor: COL_DOUBLE,
  },
  cellTxt: { fontWeight: '800' },

  tPts:    { fontSize: 11, fontWeight: '700', textAlign: 'center', paddingVertical: 5 },
  tPtsTot: { fontSize: 12, fontWeight: '800', textAlign: 'center', paddingVertical: 5 },

  // ── Edit mode ─────────────────────────────────────────────────────────────

  scEditBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 2,
  },
  scEditBarLbl: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', color: '#aaa',
  },
  scEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, backgroundColor: 'rgba(61,107,31,0.08)',
  },
  scEditBtnTxt: { fontSize: 12, fontWeight: '700', color: G_MID },

  editHeader:    { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  editHeaderSub: { fontSize: 11, color: '#aaa', marginTop: 2 },

  editRow: {
    paddingHorizontal: 18, paddingVertical: 14,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)',
  },
  editRowHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: 10,
  },
  editRowHole: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  editRowPar:  { fontSize: 12, color: '#aaa', fontWeight: '600' },

  editField: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  editFieldLbl: { fontSize: 12, color: '#888', fontWeight: '500' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#f0ede8',
    justifyContent: 'center', alignItems: 'center',
  },
  stepVal: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', minWidth: 20, textAlign: 'center' },

  triRow: { flexDirection: 'row', gap: 6 },
  triBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 12, backgroundColor: '#f0ede8',
  },
  triBtnHitActive:  { backgroundColor: COL_BIRDIE },
  triBtnMissActive: { backgroundColor: COL_DOUBLE },
  triBtnTxt:       { fontSize: 11, fontWeight: '700', color: '#999' },
  triBtnTxtActive: { color: '#fff' },

  editActions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18,
  },
  editCancelBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', backgroundColor: '#f0ede8',
  },
  editCancelTxt: { fontSize: 14, fontWeight: '700', color: '#888' },
  editSaveBtn: {
    flex: 2, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', backgroundColor: G_MID,
  },
  editSaveTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // ── Course info ───────────────────────────────────────────────────────────

  ciHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, marginBottom: 4,
  },
  ciGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16,
  },
  ciTile: {
    flex: 1, minWidth: '22%', backgroundColor: '#f7f5f1', borderRadius: 12, padding: 10,
    alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)',
  },
  ciTileLbl: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: '#bbb', marginBottom: 4 },
  ciTileVal: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  ciHint: {
    fontSize: 11, color: '#c9a227', paddingHorizontal: 18, paddingBottom: 16,
    fontStyle: 'italic',
  },

  ciForm: { paddingHorizontal: 18, paddingTop: 10 },
  ciFieldRow: { flexDirection: 'row', gap: 10 },
  ciFieldCol: { marginBottom: 12 },
  ciFieldLbl: { fontSize: 11, color: '#888', fontWeight: '600', marginBottom: 6 },
  ciInput: {
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: '#1a1a1a', backgroundColor: '#faf9f7',
  },

  // ── Notes ─────────────────────────────────────────────────────────────────

  noHolesText: {
    fontSize: fontSize.sm, color: '#888',
    textAlign: 'center', padding: 28,
  },
  notesText: {
    fontSize: fontSize.sm, color: '#1a1a1a',
    lineHeight: 20, paddingHorizontal: 18, paddingBottom: 18,
  },
});
