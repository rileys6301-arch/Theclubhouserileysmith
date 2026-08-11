import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions, TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import client from '../api/client';
import DonutChart, { DonutSegment } from '../components/DonutChart';
import HandicapTrendChart from '../components/HandicapTrendChart';
import { colors, fontSize, spacing, shadows } from '../theme';

const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';

const ORANGE     = '#E09050';
const TILE_BG    = '#f7f5f1';
const BIRDIE_BAR = '#2d5a1b';
const PAR_BAR    = '#5a7a42';
const BOGEY_BAR  = '#d4845a';
const GREEN_V    = '#3d6b1f';
const RED_V      = '#c0392b';
const PAGE_BG    = '#edeae4';
const CARD_R     = 20;
const CARD_GAP   = 12;

// ── Types ─────────────────────────────────────────────────────────────────────

type MemberStats = {
  id: string; email: string;
  first_name: string | null; last_name: string | null;
  handicap: number | null; created_at: string;
  rounds_played: number;
  avg_stableford: number | null; best_stableford: number | null;
  best_score: number | null; avg_score: number | null; avg_vs_par: number | null;
  unique_courses: number | null;
  last_played_at: string | null; last_score: number | null; last_stableford: number | null;
  rounds_this_year: number | null; rounds_last_year: number | null;
  total_eagles_plus: number; total_birdies: number; total_pars: number;
  total_bogeys: number; total_double_plus: number; total_holes: number;
  points_per_hole: number | null;
  club_avg_handicap: number | null;
};

type Round = {
  id: string; played_at: string; course_name: string; score: number; stableford: number;
  slope_rating?: number | null; course_rating?: number | null;
};

type HoleStat = {
  hole_number: number; times_played: number;
  avg_vs_par: number; avg_points: number; best_vs_par: number;
};

type ParStat = {
  par: number;
  eagles_plus: number; birdies: number; pars: number; bogeys: number; double_plus: number;
  total: number;
  avg_vs_par: number;
};

type HoleBreakdown = {
  eagles_plus: number; birdies: number; pars: number;
  bogeys: number; double_plus: number; total: number;
};

type VsClubStats = {
  club_name: string | null;
  player_avg_score: number | null;
  player_gir_pct: number | null;
  player_fairways_pct: number | null;
  club_avg_score: number | null;
  club_gir_pct: number | null;
  club_fairways_pct: number | null;
};

type Props = { route: { params: { userId: string; name?: string } }; navigation: any };

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(f: string | null, l: string | null, e: string) {
  return [f, l].filter(Boolean).join(' ') || e;
}
function personInitials(f: string | null, l: string | null, e: string) {
  return [f?.[0], l?.[0]].filter(Boolean).join('').toUpperCase() || e[0].toUpperCase();
}
function fmtDate(s: string) {
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtMember(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
function mean(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── HoleDonut ─────────────────────────────────────────────────────────────────

function HoleDonut({ breakdown }: { breakdown: HoleBreakdown }) {
  const { eagles_plus, birdies, pars, bogeys, double_plus, total } = breakdown;
  if (!total) return null;
  const segs: DonutSegment[] = [
    { label: 'Eagle+',  count: eagles_plus, color: colors.gold },
    { label: 'Birdie',  count: birdies,     color: colors.primaryLight },
    { label: 'Par',     count: pars,        color: colors.textSecondary },
    { label: 'Bogey',   count: bogeys,      color: ORANGE },
    { label: 'Double+', count: double_plus, color: colors.danger },
  ];
  const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
      <DonutChart segments={segs} size={108} strokeWidth={22} centerText={String(total)} centerSub="holes" />
      <View style={{ flex: 1 }}>
        {segs.filter(s => s.count > 0).map(s => (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: s.color }} />
            <Text style={{ fontSize: 12, color: '#666', flex: 1 }}>{s.label}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: s.color }}>{pct(s.count)}</Text>
            <Text style={{ fontSize: 11, color: '#ccc', width: 28, textAlign: 'right' }}>{s.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── HoleBarChart ──────────────────────────────────────────────────────────────

function HoleBarChart({ breakdown }: { breakdown: HoleBreakdown }) {
  const { eagles_plus, birdies, pars, bogeys, double_plus, total } = breakdown;
  if (!total) return null;
  const rows = [
    { label: 'Birdie+', count: eagles_plus + birdies, color: BIRDIE_BAR },
    { label: 'Par',     count: pars,                  color: PAR_BAR },
    { label: 'Bogey',   count: bogeys,                color: BOGEY_BAR },
    { label: 'Double+', count: double_plus,            color: RED_V },
  ];
  return (
    <View style={{ marginTop: 16 }}>
      {rows.map(row => {
        const pct = total > 0 ? (row.count / total) * 100 : 0;
        return (
          <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 9 }}>
            <Text style={{ width: 52, textAlign: 'right', fontSize: 11, color: '#888', marginRight: 8 }}>{row.label}</Text>
            <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: '#f0ede8' }}>
              <View style={{ width: `${pct}%` as any, height: 7, borderRadius: 4, backgroundColor: row.color }} />
            </View>
            <Text style={{ width: 38, textAlign: 'right', fontSize: 11, fontWeight: '700', color: row.color, marginLeft: 6 }}>
              {pct.toFixed(0)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── ScoreTile ─────────────────────────────────────────────────────────────────

function ScoreTile({ label, value, accent, sub, wide }: {
  label: string; value: string | number | null | undefined;
  accent?: boolean; sub?: string; wide?: boolean;
}) {
  return (
    <View style={[
      styles.scoreTile,
      accent ? styles.scoreTileAccent : styles.scoreTileNeutral,
      wide   ? styles.scoreTileWide   : null,
    ]}>
      <Text style={styles.scoreTileLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.scoreTileValue, accent ? { color: GREEN_V } : null]}>
        {value != null ? String(value) : '—'}
      </Text>
      {sub ? <Text style={styles.scoreTileSub}>{sub}</Text> : null}
    </View>
  );
}

// ── ActTile ───────────────────────────────────────────────────────────────────

function ActTile({ label, value, accent, muted }: {
  label: string; value: number | string; accent?: boolean; muted?: boolean;
}) {
  return (
    <View style={[styles.actTile, accent ? styles.actTileAccent : styles.scoreTileNeutral]}>
      <Text style={[styles.actTileValue, muted ? { color: '#ccc' } : accent ? { color: GREEN_V } : null]}>
        {value != null ? String(value) : '—'}
      </Text>
      <Text style={styles.actTileLabel}>{label}</Text>
    </View>
  );
}

// ── Score by Par Type card ────────────────────────────────────────────────────

function ScoreByParCard({ parStats, roundsPlayed }: { parStats: ParStat[]; roundsPlayed: number }) {
  const byPar = parStats.slice().sort((a, b) => a.par - b.par).filter(ps => ps.total > 0);
  if (byPar.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Score by Par Type</Text>
        <Text style={styles.emptyText}>No round data yet</Text>
      </View>
    );
  }

  const totals = byPar.reduce((acc, ps) => ({
    birdiePlus: acc.birdiePlus + ps.eagles_plus + ps.birdies,
    pars:       acc.pars + ps.pars,
    bogeyPlus:  acc.bogeyPlus + ps.bogeys + ps.double_plus,
    total:      acc.total + ps.total,
  }), { birdiePlus: 0, pars: 0, bogeyPlus: 0, total: 0 });

  const legend = [
    { label: 'Birdie or better', color: GREEN_V, pct: Math.round((totals.birdiePlus / totals.total) * 100) },
    { label: 'Par',              color: ORANGE,  pct: Math.round((totals.pars       / totals.total) * 100) },
    { label: 'Bogey or worse',   color: RED_V,   pct: Math.round((totals.bogeyPlus  / totals.total) * 100) },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Score by Par Type</Text>
      <Text style={styles.cardSub}>{roundsPlayed} round{roundsPlayed !== 1 ? 's' : ''}</Text>

      <View style={styles.sbpRow}>
        {byPar.map(ps => {
          const birdiePlus = ps.eagles_plus + ps.birdies;
          const bogeyPlus  = ps.bogeys + ps.double_plus;
          // Prefer the server's precise average; if it didn't come back, derive it
          // from the bucket counts we already have (treats eagle+ as -2, double+ as +2).
          const avgVsPar = ps.avg_vs_par != null
            ? ps.avg_vs_par
            : (ps.eagles_plus * -2 + ps.birdies * -1 + ps.bogeys * 1 + ps.double_plus * 2) / (ps.total || 1);
          const avgScore = ps.par + avgVsPar;
          const segs: DonutSegment[] = [
            { label: 'Birdie+', count: birdiePlus, color: GREEN_V },
            { label: 'Par',     count: ps.pars,     color: ORANGE },
            { label: 'Bogey+',  count: bogeyPlus,   color: RED_V },
          ];
          return (
            <View key={ps.par} style={styles.sbpCol}>
              <DonutChart
                segments={segs}
                size={104}
                strokeWidth={11}
                centerText={avgScore.toFixed(1)}
                centerSub="avg score"
              />
              <Text style={styles.sbpParLabel}>PAR {ps.par}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.thinDivider} />

      <View style={{ gap: 12 }}>
        {legend.map(l => (
          <View key={l.label} style={styles.sbpLegendRow}>
            <View style={styles.sbpLegendLeft}>
              <View style={[styles.sbpLegendDot, { backgroundColor: l.color }]} />
              <Text style={styles.sbpLegendLabel}>{l.label}</Text>
            </View>
            <Text style={[styles.sbpLegendPct, { color: l.color }]}>{l.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type ShotStats = {
  avg_putts_per_round:  number | null;
  gir_pct:             number | null;
  fairways_pct:        number | null;
  putts_per_gir:       number | null;
  putts_holes_tracked: number;
  gir_holes_tracked:   number;
  fairway_holes_tracked: number;
};

// ── Accuracy card ─────────────────────────────────────────────────────────────

const RING_SIZE  = 120;
const RING_CX    = 60;
const RING_CY    = 60;
const RING_R     = 48;
const RING_SW    = 9;
const RING_CIRC  = 2 * Math.PI * RING_R;
const RING_MAX   = RING_CIRC * 0.82;
const RING_BLUE  = '#3B82F6';

const MIN_TRACKED_HOLES = 9;

function AccuracyRing({ pct }: { pct: number }) {
  const offset = RING_MAX * (1 - pct / 100);
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      {/* background track */}
      <Circle
        cx={RING_CX} cy={RING_CY} r={RING_R}
        fill="none"
        stroke={colors.surfaceMuted}
        strokeWidth={RING_SW + 2}
      />
      {/* foreground arc — same dash technique as the live-scoring wheel */}
      <Circle
        cx={RING_CX} cy={RING_CY} r={RING_R}
        fill="none"
        stroke={RING_BLUE}
        strokeWidth={RING_SW}
        strokeLinecap="round"
        strokeDasharray={`${RING_MAX} ${RING_CIRC}`}
        strokeDashoffset={offset}
        transform={`rotate(-90, ${RING_CX}, ${RING_CY})`}
      />
    </Svg>
  );
}

function AccuracyCard({ shotStats }: { shotStats: ShotStats | null }) {
  const meters = [
    {
      label: 'Fairways Hit',
      pct:     shotStats?.fairways_pct ?? null,
      tracked: shotStats?.fairway_holes_tracked ?? 0,
    },
    {
      label: 'GIR',
      pct:     shotStats?.gir_pct ?? null,
      tracked: shotStats?.gir_holes_tracked ?? 0,
    },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Accuracy</Text>

      <View style={styles.accuracyRow}>
        {meters.map(({ label, pct, tracked }) => {
          const hasData = pct != null && tracked >= MIN_TRACKED_HOLES;
          return (
            <View key={label} style={styles.accuracyMeter}>
              {/* ring + centred percentage overlay */}
              <View style={styles.ringWrap}>
                <AccuracyRing pct={hasData ? pct! : 0} />
                <View style={styles.ringCenter} pointerEvents="none">
                  <Text style={styles.ringPct}>{hasData ? `${Math.round(pct!)}%` : '—'}</Text>
                </View>
              </View>
              <Text style={styles.ringLabel}>{label}</Text>
              <Text style={styles.ringSub}>
                {tracked > 0 ? `${tracked} hole${tracked !== 1 ? 's' : ''} tracked` : 'Not tracked yet'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Putting card ──────────────────────────────────────────────────────────────

function PuttingCard({ shotStats }: { shotStats: ShotStats | null }) {
  const tracked     = shotStats?.putts_holes_tracked ?? 0;
  const avgPerRound = shotStats?.avg_putts_per_round ?? null;
  const hasData     = avgPerRound != null && tracked >= MIN_TRACKED_HOLES;
  const perHole     = hasData ? avgPerRound! / 18 : null;

  const tiles = [
    { label: 'Putts / Round', value: hasData ? avgPerRound!.toFixed(1) : '—' },
    { label: 'Putts / Hole',  value: perHole != null ? perHole.toFixed(2) : '—' },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Putting</Text>

      <View style={styles.puttGrid}>
        {tiles.map(({ label, value }) => (
          <View key={label} style={styles.puttTile}>
            <Text style={styles.puttTileVal}>{value}</Text>
            <Text style={styles.puttTileLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.cardSub}>
        {tracked > 0
          ? `Based on ${tracked} hole${tracked !== 1 ? 's' : ''} with putts tracked`
          : 'Track putts during scoring to unlock putting stats'}
      </Text>
    </View>
  );
}

// ── Recent Rounds card ────────────────────────────────────────────────────────

type RRRow = { id: string; course: string; date: string; stableford: number; gross: number; vspar: number | null };

function RecentRoundsCard({ rows, navigation }: { rows: RRRow[]; navigation: any }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.rrHeader}>
        <Text style={styles.cardTitle}>Recent Rounds</Text>
        <Text style={styles.rrCount}>{rows.length} rounds</Text>
      </View>

      {rows.map((r, i) => {
        const badgeBg  = r.stableford >= 36 ? 'rgba(61,107,31,0.10)' : r.stableford <= 28 ? 'rgba(192,57,43,0.08)' : TILE_BG;
        const badgeClr = r.stableford >= 36 ? GREEN_V : r.stableford <= 28 ? RED_V : '#888';
        const parClr   = r.vspar == null ? '#bbb' : r.vspar < 0 ? GREEN_V : r.vspar === 0 ? '#888' : RED_V;
        const parLabel = r.vspar == null ? '—' : r.vspar === 0 ? 'E' : r.vspar > 0 ? `+${r.vspar}` : String(r.vspar);

        return (
          <TouchableOpacity
            key={r.id}
            style={[styles.rrRow, i > 0 && styles.rrRowDivider]}
            onPress={() => navigation.navigate('RoundDetail', { roundId: r.id })}
            activeOpacity={0.7}
          >
            <View style={[styles.rrBadge, { backgroundColor: badgeBg }]}>
              <Text style={[styles.rrBadgeVal, { color: badgeClr }]}>{r.gross}</Text>
              <Text style={[styles.rrBadgeSub, { color: badgeClr }]}>gross</Text>
            </View>
            <View style={styles.rrMeta}>
              <Text style={styles.rrCourse} numberOfLines={1}>{r.course}</Text>
              <Text style={styles.rrDetail}>{r.date} · {r.stableford} pts</Text>
            </View>
            <Text style={[styles.rrVsPar, { color: parClr }]}>{parLabel}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Vs Club card ──────────────────────────────────────────────────────────────

const GOLD = '#C4A35A';

function VsClubCard({ vsClub }: { vsClub: VsClubStats | null }) {
  if (!vsClub || !vsClub.club_name) return null;

  const rows = [
    {
      label: 'Avg Score', player: vsClub.player_avg_score, club: vsClub.club_avg_score,
      min: 60, max: 120, unit: '', lowerBetter: true,
    },
    {
      label: 'GIR %', player: vsClub.player_gir_pct, club: vsClub.club_gir_pct,
      min: 0, max: 100, unit: '%', lowerBetter: false,
    },
    {
      label: 'Fairways %', player: vsClub.player_fairways_pct, club: vsClub.club_fairways_pct,
      min: 0, max: 100, unit: '%', lowerBetter: false,
    },
  ].filter((r): r is typeof r & { player: number; club: number } => r.player != null && r.club != null);

  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>vs {vsClub.club_name}</Text>

      {rows.map(({ label, player, club, min, max, unit, lowerBetter }, i) => {
        const range     = max - min || 1;
        const playerPct = Math.min(100, Math.max(0,
          lowerBetter ? ((max - player) / range) * 100 : ((player - min) / range) * 100
        ));
        const clubPct   = Math.min(100, Math.max(0,
          lowerBetter ? ((max - club) / range) * 100   : ((club   - min) / range) * 100
        ));
        const ahead     = lowerBetter ? player < club : player > club;
        const barColor  = ahead ? GREEN_V : RED_V;

        return (
          <View key={label} style={[styles.vsRow, i > 0 && styles.vsRowSpacing]}>
            {/* label row */}
            <View style={styles.vsLabelRow}>
              <Text style={styles.vsLabel}>{label}</Text>
              <Text style={[styles.vsPlayerVal, { color: barColor }]}>
                {player}{unit}
              </Text>
              <Text style={styles.vsClubAvgVal}>
                {' '}vs {club}{unit}
              </Text>
            </View>

            {/* bar + gold tick */}
            <View style={styles.vsBarWrap}>
              {/* filled track */}
              <View style={styles.vsTrack}>
                <View style={[styles.vsFill, {
                  width: `${playerPct}%` as any,
                  backgroundColor: barColor,
                }]} />
              </View>
              {/* gold tick mark for club average — sits above/below the track */}
              <View style={[styles.vsTickMark, { left: `${clubPct}%` as any }]} />
            </View>
          </View>
        );
      })}

      {/* legend */}
      <View style={styles.vsLegend}>
        <View style={styles.vsLegendItem}>
          <View style={[styles.vsLegendSwatch, { backgroundColor: GREEN_V }]} />
          <Text style={styles.vsLegendText}>You</Text>
        </View>
        <View style={styles.vsLegendItem}>
          <View style={[styles.vsLegendTick, { backgroundColor: GOLD }]} />
          <Text style={styles.vsLegendText}>Club avg</Text>
        </View>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MemberProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const insets     = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const chartWidth = screenW - 32 - 36;

  const [stats,     setStats]     = useState<MemberStats | null>(null);
  const [rounds,    setRounds]    = useState<Round[]>([]);
  const [holeStats, setHoleStats] = useState<HoleStat[]>([]);
  const [parStats,  setParStats]  = useState<ParStat[]>([]);
  const [shotStats, setShotStats] = useState<ShotStats | null>(null);
  const [vsClub,    setVsClub]    = useState<VsClubStats | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [filter,    setFilter]    = useState<'last5' | 'last20' | 'season' | 'allTime'>('last5');
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!stats) setLoading(true);
    const requestId = ++requestIdRef.current;
    const qs = filter === 'last5'  ? '?limit=5'
      : filter === 'last20' ? '?limit=20'
      : filter === 'season' ? '?season=current'
      : '';
    Promise.allSettled([
      client.get<MemberStats>(`/api/users/${userId}${qs}`),
      client.get<Round[]>(`/api/users/${userId}/rounds${qs}`),
      client.get<HoleStat[]>(`/api/users/${userId}/hole-stats`),
      client.get<ParStat[]>(`/api/users/${userId}/par-stats${qs}`),
      client.get<ShotStats>(`/api/users/${userId}/shot-stats${qs}`),
      client.get<VsClubStats>(`/api/users/${userId}/vs-club${qs}`),
    ]).then(([s, r, h, p, ss, vc]) => {
      // Ignore results from a filter/user switch that's since been superseded —
      // otherwise a slow "All Time" response can land after a fast "Last 5" one
      // and silently overwrite it with the wrong data.
      if (requestIdRef.current !== requestId) return;
      if (s.status === 'fulfilled') setStats(s.value.data);
      else setError('Could not load player profile');
      if (r.status === 'fulfilled') setRounds(r.value.data);
      if (h.status === 'fulfilled') setHoleStats(h.value.data);
      if (p.status === 'fulfilled') setParStats(p.value.data);
      if (ss.status === 'fulfilled') setShotStats(ss.value.data);
      if (vc.status === 'fulfilled') setVsClub(vc.value.data);
      setLoading(false);
    });
  }, [userId, filter]);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={GREEN_V} /></View>;
  }
  if (error || !stats) {
    return <View style={styles.centered}><Text style={styles.errorText}>{error || 'Player not found'}</Text></View>;
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const hcp = stats.handicap != null ? Number(stats.handicap) : null;

  // Hero trend pill — based on stableford direction (higher = better)
  const heroTrend = (() => {
    if (rounds.length < 4) return 'stable' as const;
    const sorted = [...rounds].sort((a, b) => a.played_at.localeCompare(b.played_at));
    const half   = Math.floor(sorted.length / 2);
    const early  = mean(sorted.slice(0, half).map(r => r.stableford));
    const recent = mean(sorted.slice(-half).map(r => r.stableford));
    const delta  = recent - early;
    return delta > 1 ? 'improving' as const : delta < -1 ? 'declining' as const : 'stable' as const;
  })();
  const trendPill = {
    improving: { icon: 'trending-up'    as const, color: '#6fcf5a', label: 'Improving' },
    declining: { icon: 'trending-down'  as const, color: RED_V,     label: 'Declining' },
    stable:    { icon: 'remove-outline' as const, color: '#aaa',    label: 'Stable'    },
  }[heroTrend];

  // Recent rounds rows
  const recentRoundsRows: RRRow[] = rounds.slice(0, 5).map(r => ({
    id:         r.id,
    course:     r.course_name,
    date:       fmtDate(r.played_at),
    stableford: r.stableford,
    gross:      r.score,
    vspar:      r.course_rating != null ? r.score - Math.round(r.course_rating) : null,
  }));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >

        {/* ── Hero Card ────────────────────────────────────────────────── */}
        <LinearGradient
          colors={[G_DARK, G_MID, G_LIGHT]}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.heroCard}
        >
          {/* decorative glows */}
          <View style={styles.heroGlow} pointerEvents="none" />
          <View style={styles.heroRing} pointerEvents="none" />

          {/* label */}
          <Text style={styles.heroLabel}>HANDICAP INDEX</Text>

          {/* big number + trend pill */}
          <View style={styles.heroTopRow}>
            <Text style={styles.heroHcp}>{hcp != null ? hcp.toFixed(1) : '—'}</Text>
            <View style={[styles.heroPill, { backgroundColor: `${trendPill.color}22`, borderColor: `${trendPill.color}44` }]}>
              <Ionicons name={trendPill.icon} size={12} color={trendPill.color} />
              <Text style={[styles.heroPillText, { color: trendPill.color }]}>{trendPill.label}</Text>
            </View>
          </View>

          {/* divider */}
          <View style={styles.heroDivider} />

          {/* 3-column stat row */}
          <View style={styles.heroStatRow}>
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>{stats.rounds_played}</Text>
              <Text style={styles.heroStatLabel}>Rounds</Text>
            </View>
            <View style={styles.heroStatSep} />
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>
                {stats.avg_score != null ? Number(stats.avg_score).toFixed(1) : '—'}
              </Text>
              <Text style={styles.heroStatLabel}>Avg Score</Text>
            </View>
            <View style={styles.heroStatSep} />
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>{stats.best_score ?? '—'}</Text>
              <Text style={styles.heroStatLabel}>Best Round</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── Filter pill row ──────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          {([
            { key: 'last5',   label: 'Last 5' },
            { key: 'last20',  label: 'Last 20' },
            { key: 'season',  label: `${new Date().getFullYear()} Season` },
            { key: 'allTime', label: 'All Time' },
          ] as const).map(({ key, label }) => {
            const active = filter === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setFilter(key)}
                activeOpacity={0.7}
                style={[styles.pill, active && styles.pillActive]}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Score by Par Type card ───────────────────────────────────── */}
        <ScoreByParCard parStats={parStats} roundsPlayed={stats.rounds_played} />

        {/* ── Handicap Trend card ──────────────────────────────────────── */}
        <HandicapTrendChart rounds={rounds} width={chartWidth} />

        {/* ── Accuracy card ────────────────────────────────────────────── */}
        <AccuracyCard shotStats={shotStats} />

        {/* ── Putting card ─────────────────────────────────────────────── */}
        <PuttingCard shotStats={shotStats} />

        {/* ── Recent Rounds card ───────────────────────────────────────── */}
        <RecentRoundsCard rows={recentRoundsRows} navigation={navigation} />

        {/* ── Vs Club card ─────────────────────────────────────────────── */}
        <VsClubCard vsClub={vsClub} />


      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: PAGE_BG },
  content:   { paddingHorizontal: spacing.md, paddingTop: 0, gap: CARD_GAP },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAGE_BG },
  errorText: { fontSize: fontSize.base, color: RED_V },

  // ── Hero card ─────────────────────────────────────────────────────────────
  heroCard: {
    marginHorizontal: -spacing.md,
    marginTop: 0,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(255,255,255,0.05)',
    top: -80, right: -60,
  },
  heroRing: {
    position: 'absolute',
    bottom: -40, left: -40,
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 36, borderColor: 'rgba(255,255,255,0.04)',
  },
  heroLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.4,
    textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)',
    marginBottom: 6,
  },
  heroTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  heroHcp: {
    fontSize: 68, fontWeight: '800', color: '#fff',
    letterSpacing: -3, lineHeight: 74,
  },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(111,207,90,0.18)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(111,207,90,0.3)',
    marginTop: 6,
  },
  heroPillText: { fontSize: 11, fontWeight: '700', color: '#6fcf5a' },
  heroDivider: {
    height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 20,
  },
  heroStatRow:   { flexDirection: 'row', alignItems: 'center' },
  heroStatCol:   { flex: 1, alignItems: 'center' },
  heroStatSep:   { width: 0.5, height: 32, backgroundColor: 'rgba(255,255,255,0.15)' },
  heroStatVal:   { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  heroStatLabel: { fontSize: 10, fontWeight: '500', color: 'rgba(255,255,255,0.45)', marginTop: 4 },

  // ── Cards ─────────────────────────────────────────────────────────────────
  card:       { backgroundColor: colors.surface, borderRadius: CARD_R, padding: 18, ...shadows.card },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardTitle:  { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardCount:  { fontSize: 12, color: '#bbb' },
  cardSub:    { fontSize: 11, color: '#bbb', marginBottom: 14, marginTop: -8 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: '#bbb', paddingVertical: 14 },
  thinDivider:  { height: 0.5, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 16 },
  emptyText:    { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },

  // ── Stat strip ────────────────────────────────────────────────────────────
  statStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: CARD_R,
    paddingVertical: 16,
    ...shadows.card,
  },
  statCol:   { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  statDiv:   { width: 0.5, backgroundColor: '#e0ddd8', marginVertical: 4 },
  statVal:   { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontWeight: '500', color: '#aaa', marginTop: 5 },

  // ── HCP compare ───────────────────────────────────────────────────────────
  hcpCompare:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hcpCompareCol:    { alignItems: 'center', minWidth: 52 },
  hcpCompareValue:  { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  hcpCompareLabel:  { fontSize: 10, color: colors.textSecondary, fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  hcpCompareBar:    { flex: 1, alignItems: 'center', gap: 6 },
  hcpBarTrack:      { width: '100%', height: 6, backgroundColor: colors.surfaceMuted, borderRadius: 3, position: 'relative' },
  hcpBarMarker:     { position: 'absolute', top: -3, width: 2, height: 12, backgroundColor: colors.border, borderRadius: 1 },
  hcpBarDot:        { position: 'absolute', top: -4, width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: colors.surface },
  hcpDiffLabel:     { fontSize: fontSize.xs, fontWeight: '700' },

  // ── Round rows ────────────────────────────────────────────────────────────
  roundRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  roundRowTop:    { borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  roundBadge:     { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  roundBadgeBest: { borderWidth: 0.5, borderColor: 'rgba(61,107,31,0.2)' },
  roundBadgeVal:  { fontSize: 16, fontWeight: '800', lineHeight: 18 },
  roundBadgeLbl:  { fontSize: 8, fontWeight: '600', textTransform: 'uppercase', opacity: 0.7 },
  roundCourse:    { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 3 },
  roundMeta:      { fontSize: 11, color: '#bbb' },
  roundGross:     { fontSize: 13, fontWeight: '600', color: '#888' },
  roundGrossLbl:  { fontSize: 10, color: '#bbb' },

  // ── Score tiles ───────────────────────────────────────────────────────────
  tileGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scoreTile:        { flex: 1, minWidth: '45%', borderRadius: 14, padding: 14, borderWidth: 0.5 },
  scoreTileNeutral: { backgroundColor: TILE_BG, borderColor: 'rgba(0,0,0,0.05)' },
  scoreTileAccent:  { backgroundColor: 'rgba(61,107,31,0.06)', borderColor: 'rgba(61,107,31,0.15)' },
  scoreTileWide:    { minWidth: '100%' },
  scoreTileLabel:   { fontSize: 10, fontWeight: '600', color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  scoreTileValue:   { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  scoreTileSub:     { fontSize: 10, color: '#bbb', marginTop: 2 },

  // ── Activity tiles ────────────────────────────────────────────────────────
  actFeatured:     { borderRadius: 14, padding: 16, marginBottom: 2 },
  actFeaturedLbl:  { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  actFeaturedDate: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  actFeaturedSub:  { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  actTile:         { flex: 1, minWidth: '45%', borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)' },
  actTileAccent:   { backgroundColor: 'rgba(61,107,31,0.06)', borderColor: 'rgba(61,107,31,0.15)' },
  actTileValue:    { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  actTileLabel:    { fontSize: 10, fontWeight: '500', color: '#aaa', marginTop: 5 },

  // ── Insight bar ───────────────────────────────────────────────────────────
  insightBar:   { backgroundColor: 'rgba(61,107,31,0.07)', borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(61,107,31,0.14)', padding: 11, paddingHorizontal: 14, marginTop: 16 },
  insightTitle: { fontSize: 12, fontWeight: '700', color: GREEN_V },
  insightSub:   { fontSize: 11, color: '#5a8a3a', marginTop: 3 },

  // ── Score by Par Type card ─────────────────────────────────────────────────
  sbpRow:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  sbpCol:          { alignItems: 'center', gap: 10 },
  sbpParLabel:     { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  sbpLegendRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sbpLegendLeft:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sbpLegendDot:    { width: 9, height: 9, borderRadius: 5 },
  sbpLegendLabel:  { fontSize: 12.5, color: colors.textSecondary },
  sbpLegendPct:    { fontSize: 12.5, fontWeight: '700' },

  // ── Accuracy card ─────────────────────────────────────────────────────────
  accuracyRow:   { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  accuracyMeter: { alignItems: 'center', gap: 6 },
  ringWrap: {
    width: RING_SIZE, height: RING_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
  },
  ringPct:   { fontSize: 26, fontWeight: '800', color: RING_BLUE, letterSpacing: -0.5 },
  ringLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  ringSub:   { fontSize: 11, color: '#bbb' },

  // ── Putting card ──────────────────────────────────────────────────────────
  puttGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  puttTile: {
    width: '47%',
    backgroundColor: TILE_BG,
    borderRadius: 14,
    padding: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  puttTileVal:   { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5, marginBottom: 4 },
  puttTileLabel: { fontSize: 10, fontWeight: '600', color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.5 },

  // ── Recent Rounds card ────────────────────────────────────────────────────
  rrHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  rrCount:      { fontSize: 12, color: '#bbb' },
  rrRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rrRowDivider: { borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  rrBadge: {
    width: 48, height: 48, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rrBadgeVal:  { fontSize: 17, fontWeight: '800', lineHeight: 20 },
  rrBadgeSub:  { fontSize: 8,  fontWeight: '600', textTransform: 'uppercase', opacity: 0.7 },
  rrMeta:      { flex: 1 },
  rrCourse:    { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 3 },
  rrDetail:    { fontSize: 11, color: '#bbb' },
  rrVsPar:     { fontSize: 15, fontWeight: '700', minWidth: 32, textAlign: 'right' },

  // ── Vs Club card ──────────────────────────────────────────────────────────
  vsRow:        { },
  vsRowSpacing: { marginTop: 20 },
  vsLabelRow:   { flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 },
  vsLabel:      { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  vsPlayerVal:  { fontSize: 14, fontWeight: '800', letterSpacing: -0.3 },
  vsClubAvgVal: { fontSize: 12, color: '#bbb' },
  vsBarWrap: {
    height: 20,
    position: 'relative',
    justifyContent: 'center',
  },
  vsTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.07)',
    overflow: 'hidden',
  },
  vsFill: {
    height: '100%',
    borderRadius: 4,
  },
  vsTickMark: {
    position: 'absolute',
    width: 3,
    height: 20,
    borderRadius: 2,
    backgroundColor: GOLD,
    marginLeft: -1.5,
    top: 0,
  },
  vsLegend:      { flexDirection: 'row', gap: 16, marginTop: 18, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.07)' },
  vsLegendItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vsLegendSwatch: { width: 12, height: 6, borderRadius: 3 },
  vsLegendTick:  { width: 3, height: 12, borderRadius: 2 },
  vsLegendText:  { fontSize: 11, color: '#aaa' },

  // ── Filter pills ──────────────────────────────────────────────────────────
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 }, android: { elevation: 1 } }),
  },
  pillActive: {
    backgroundColor: GREEN_V,
    borderColor: GREEN_V,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: '#fff',
  },
});
