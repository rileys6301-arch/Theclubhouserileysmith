import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import DonutChart, { DonutSegment } from '../components/DonutChart';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';

const ORANGE     = '#E09050';
const TILE_BG    = '#f7f5f1';
const BIRDIE_BAR = '#2d5a1b';
const PAR_BAR    = '#5a7a42';
const BOGEY_BAR  = '#d4845a';
const DBL_BAR    = '#c0392b';
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
};

type HoleBreakdown = {
  eagles_plus: number; birdies: number; pars: number;
  bogeys: number; double_plus: number; total: number;
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

// ── Line chart ────────────────────────────────────────────────────────────────

function LineChart({ data, color, width: chartW }: { data: number[]; color: string; width: number }) {
  if (data.length < 2) return null;
  const H = 90; const PAD = 10;
  const innerW = chartW - PAD * 2; const innerH = H - PAD * 2;
  const minV = Math.min(...data); const maxV = Math.max(...data);
  const range = maxV - minV || 1;
  const pts = data.map((v, i) => ({
    x: PAD + (i / (data.length - 1)) * innerW,
    y: PAD + ((maxV - v) / range) * innerH,
  }));
  const STROKE = 2.5; const DOT_R = 3.5;
  return (
    <View style={{ height: H, width: chartW, position: 'relative' }}>
      {[0, 0.5, 1].map(frac => (
        <View key={frac} style={{ position: 'absolute', left: PAD, top: PAD + frac * innerH, width: innerW, height: 1, backgroundColor: 'rgba(0,0,0,0.06)' }} />
      ))}
      {pts.slice(0, -1).map((p1, i) => {
        const p2 = pts[i + 1];
        const dx = p2.x - p1.x; const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View key={i} style={{ position: 'absolute', left: (p1.x + p2.x) / 2 - len / 2, top: (p1.y + p2.y) / 2 - STROKE / 2, width: len, height: STROKE, backgroundColor: color, borderRadius: STROKE / 2, transform: [{ rotate: `${angle}deg` }] }} />
        );
      })}
      {pts.map((pt, i) => (
        <View key={i} style={{ position: 'absolute', left: pt.x - DOT_R, top: pt.y - DOT_R, width: DOT_R * 2, height: DOT_R * 2, borderRadius: DOT_R, backgroundColor: color }} />
      ))}
      <Text style={{ position: 'absolute', left: PAD, top: pts[0].y - 18, fontSize: fontSize.xs, color, fontWeight: '700' }}>{data[0].toFixed(1)}</Text>
      <Text style={{ position: 'absolute', right: PAD, top: pts[pts.length - 1].y - 18, fontSize: fontSize.xs, color, fontWeight: '700' }}>{data[data.length - 1].toFixed(1)}</Text>
    </View>
  );
}

// ── Handicap trend ────────────────────────────────────────────────────────────

function HcpTrend({ rounds, chartWidth }: { rounds: Round[]; chartWidth: number }) {
  if (rounds.length < 3) return null;
  const chronological = [...rounds].sort((a, b) => a.played_at.localeCompare(b.played_at)).slice(-20);
  const diffs = chronological.map(r => parseFloat(((r.score - 72) * 0.96).toFixed(1)));
  const half = Math.max(1, Math.floor(diffs.length / 2));
  const earlyAvg = mean(diffs.slice(0, half));
  const recentAvg = mean(diffs.slice(diffs.length - half));
  const delta = recentAvg - earlyAvg;
  const dir = delta < -0.5 ? 'improving' : delta > 0.5 ? 'declining' : 'stable';
  const cfg = {
    improving: { label: 'Improving', icon: 'trending-down'  as const, color: GREEN_V,              bg: 'rgba(61,107,31,0.10)' },
    declining: { label: 'Declining', icon: 'trending-up'    as const, color: RED_V,                bg: 'rgba(192,57,43,0.10)' },
    stable:    { label: 'Stable',    icon: 'remove-outline' as const, color: colors.textSecondary,  bg: colors.border + '80' },
  }[dir];
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: cfg.bg }}>
          <Ionicons name={cfg.icon} size={13} color={cfg.color} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: cfg.color }}>{cfg.label}</Text>
        </View>
        <Text style={{ fontSize: fontSize.xs, color: '#bbb', flex: 1 }}>simplified differential · last {diffs.length} rounds</Text>
      </View>
      <View style={{ backgroundColor: TILE_BG, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: spacing.xs }}>
        <LineChart data={diffs} color={cfg.color} width={chartWidth - 8} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ fontSize: 10, color: '#ccc', fontWeight: '500' }}>Older</Text>
        <Text style={{ fontSize: 10, color: '#ccc', fontWeight: '500' }}>lower = better HCP</Text>
        <Text style={{ fontSize: 10, color: '#ccc', fontWeight: '500' }}>Recent</Text>
      </View>
    </View>
  );
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

// ── StackedParRow ─────────────────────────────────────────────────────────────

function StackedParRow({ stat }: { stat: ParStat }) {
  const { par, eagles_plus, birdies, pars, bogeys, double_plus, total } = stat;
  if (!total) return null;
  const segs = [
    { label: 'Birdie+', count: eagles_plus + birdies, color: BIRDIE_BAR },
    { label: 'Par',     count: pars,                  color: PAR_BAR },
    { label: 'Bogey',   count: bogeys,                color: BOGEY_BAR },
    { label: 'Dbl+',   count: double_plus,            color: DBL_BAR },
  ].filter(s => s.count > 0);
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textPrimary }}>Par {par}</Text>
        <Text style={{ fontSize: 11, color: '#bbb' }}>{total} holes</Text>
      </View>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: '#f0ede8' }}>
        {segs.map(seg => (
          <View key={seg.label} style={{ width: `${(seg.count / total) * 100}%` as any, backgroundColor: seg.color }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
        {segs.map(seg => (
          <View key={seg.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: seg.color }} />
            <Text style={{ fontSize: 10, fontWeight: '600', color: seg.color }}>{seg.label}</Text>
          </View>
        ))}
      </View>
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
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  useEffect(() => {
    Promise.allSettled([
      client.get<MemberStats>(`/api/users/${userId}`),
      client.get<Round[]>(`/api/users/${userId}/rounds`),
      client.get<HoleStat[]>(`/api/users/${userId}/hole-stats`),
      client.get<ParStat[]>(`/api/users/${userId}/par-stats?limit=5`),
    ]).then(([s, r, h, p]) => {
      if (s.status === 'fulfilled') setStats(s.value.data);
      else setError('Could not load player profile');
      if (r.status === 'fulfilled') setRounds(r.value.data);
      if (h.status === 'fulfilled') setHoleStats(h.value.data);
      if (p.status === 'fulfilled') setParStats(p.value.data);
      setLoading(false);
    });
  }, [userId]);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={GREEN_V} /></View>;
  }
  if (error || !stats) {
    return <View style={styles.centered}><Text style={styles.errorText}>{error || 'Player not found'}</Text></View>;
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const hcp          = stats.handicap != null ? Number(stats.handicap) : null;
  const clubAvg      = stats.club_avg_handicap != null ? Number(stats.club_avg_handicap) : null;
  const hcpDiff      = hcp != null && clubAvg != null ? hcp - clubAvg : null;
  const avgNetScore  = stats.avg_score != null && hcp != null ? (Number(stats.avg_score) - hcp).toFixed(1) : null;
  const bestNetScore = stats.best_score != null && hcp != null ? (stats.best_score - hcp).toFixed(1) : null;
  const avgVsParFmt  = stats.avg_vs_par != null
    ? (stats.avg_vs_par > 0 ? `+${Number(stats.avg_vs_par).toFixed(1)}` : Number(stats.avg_vs_par).toFixed(1))
    : null;
  const recentAvg = (() => {
    const last5 = rounds.slice(0, 5).map(r => r.stableford);
    return last5.length >= 3 ? mean(last5).toFixed(1) : null;
  })();
  const last10Avg = (() => {
    const last10 = rounds.slice(0, 10);
    return last10.length > 0
      ? (last10.reduce((s, r) => s + r.stableford, 0) / last10.length).toFixed(1)
      : null;
  })();
  const bestRoundId = rounds.length > 0
    ? rounds.reduce((best, r) => r.stableford > best.stableford ? r : best, rounds[0]).id
    : null;
  const yr = new Date().getFullYear();

  const breakdown: HoleBreakdown | null = parStats.length > 0 ? {
    eagles_plus: parStats.reduce((s, ps) => s + ps.eagles_plus, 0),
    birdies:     parStats.reduce((s, ps) => s + ps.birdies, 0),
    pars:        parStats.reduce((s, ps) => s + ps.pars, 0),
    bogeys:      parStats.reduce((s, ps) => s + ps.bogeys, 0),
    double_plus: parStats.reduce((s, ps) => s + ps.double_plus, 0),
    total:       parStats.reduce((s, ps) => s + ps.total, 0),
  } : null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >

        {/* ── Gradient Hero ────────────────────────────────────────────── */}
        <LinearGradient
          colors={[G_DARK, G_MID, G_LIGHT]}
          locations={[0, 0.6, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.memberHero}
        >
          <View style={styles.memberHeroGlow} pointerEvents="none" />
          <View style={styles.memberHeroRing} pointerEvents="none" />

          <View style={styles.memberHeroAvatar}>
            <Text style={styles.memberHeroAvatarText}>
              {personInitials(stats.first_name, stats.last_name, stats.email)}
            </Text>
          </View>

          <Text style={styles.memberHeroName}>
            {personName(stats.first_name, stats.last_name, stats.email)}
          </Text>
          <Text style={styles.memberHeroEmail}>{stats.email}</Text>
          <Text style={styles.memberHeroSince}>Member since {fmtMember(stats.created_at)}</Text>

          <View style={styles.memberHeroSepRow}>
            <View style={styles.memberHeroSepLine} />
            <View style={styles.memberHeroSepDot} />
            <View style={styles.memberHeroSepLine} />
          </View>

          <Text style={styles.memberHeroHcp}>{hcp != null ? hcp.toFixed(1) : '—'}</Text>
          <Text style={styles.memberHeroHcpLabel}>Handicap Index</Text>
        </LinearGradient>

        {/* ── Club HCP comparison ──────────────────────────────────────── */}
        {hcp != null && clubAvg != null && (
          <View style={styles.card}>
            <View style={styles.hcpCompare}>
              <View style={styles.hcpCompareCol}>
                <Text style={styles.hcpCompareValue}>{hcp.toFixed(1)}</Text>
                <Text style={styles.hcpCompareLabel}>Player HCP</Text>
              </View>
              <View style={styles.hcpCompareBar}>
                <View style={styles.hcpBarTrack}>
                  {(() => {
                    const lo = Math.min(hcp, clubAvg) * 0.8;
                    const hi = Math.max(hcp, clubAvg) * 1.2 || 1;
                    const playerPct = Math.min(100, Math.max(0, ((hcp - lo) / (hi - lo)) * 100));
                    const avgPct    = Math.min(100, Math.max(0, ((clubAvg - lo) / (hi - lo)) * 100));
                    const color = hcpDiff! < 0 ? GREEN_V : hcpDiff! > 0 ? RED_V : colors.textSecondary;
                    return (
                      <>
                        <View style={[styles.hcpBarMarker, { left: `${avgPct}%` as any }]} />
                        <View style={[styles.hcpBarDot, { left: `${playerPct}%` as any, backgroundColor: color }]} />
                      </>
                    );
                  })()}
                </View>
                <Text style={[
                  styles.hcpDiffLabel,
                  { color: hcpDiff! < 0 ? GREEN_V : hcpDiff! > 0 ? RED_V : colors.textSecondary },
                ]}>
                  {hcpDiff === 0
                    ? 'At club average'
                    : hcpDiff! < 0
                      ? `${Math.abs(hcpDiff!).toFixed(1)} below avg`
                      : `${hcpDiff!.toFixed(1)} above avg`}
                </Text>
              </View>
              <View style={styles.hcpCompareCol}>
                <Text style={styles.hcpCompareValue}>{clubAvg.toFixed(1)}</Text>
                <Text style={styles.hcpCompareLabel}>Club Avg</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── Stat strip ───────────────────────────────────────────────── */}
        {stats.rounds_played > 0 && (
          <View style={styles.statStrip}>
            <View style={styles.statCol}>
              <Text style={[styles.statVal, { color: GREEN_V }]}>{last10Avg ?? '—'}</Text>
              <Text style={styles.statLabel}>Avg Last 10</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statCol}>
              <Text style={styles.statVal}>{stats.best_score ?? '—'}</Text>
              <Text style={styles.statLabel}>Best Gross</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statCol}>
              <Text style={[styles.statVal, { color: GREEN_V }]}>{stats.best_stableford ?? '—'}</Text>
              <Text style={styles.statLabel}>Best Pts</Text>
            </View>
          </View>
        )}

        {/* ── Round History ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Round History</Text>
            {rounds.length > 0 && <Text style={styles.cardCount}>{rounds.length} rounds</Text>}
          </View>
          {rounds.length === 0 ? (
            <Text style={styles.emptyText}>No rounds logged yet</Text>
          ) : (
            rounds.map((r, i) => {
              const pts      = r.stableford;
              const isBest   = r.id === bestRoundId;
              const badgeBg  = pts >= 36 ? 'rgba(61,107,31,0.10)' : pts <= 28 ? 'rgba(192,57,43,0.08)' : TILE_BG;
              const badgeClr = pts >= 36 ? GREEN_V : pts <= 28 ? RED_V : '#888';
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.roundRow, i > 0 && styles.roundRowTop]}
                  onPress={() => navigation.navigate('RoundDetail', { roundId: r.id })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.roundBadge, { backgroundColor: badgeBg }, isBest && styles.roundBadgeBest]}>
                    <Text style={[styles.roundBadgeVal, { color: badgeClr }]}>{pts}</Text>
                    <Text style={[styles.roundBadgeLbl, { color: badgeClr }]}>pts</Text>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <Text style={styles.roundCourse} numberOfLines={1}>{r.course_name}</Text>
                    <Text style={styles.roundMeta}>{fmtDate(r.played_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
                    <Text style={styles.roundGross}>{r.score}</Text>
                    <Text style={styles.roundGrossLbl}>gross</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#ddd" />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Handicap Trend ────────────────────────────────────────────── */}
        {rounds.length >= 3 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Handicap Trend</Text>
            <HcpTrend rounds={rounds} chartWidth={chartWidth} />
          </View>
        )}

        {/* ── Scoring Stats ─────────────────────────────────────────────── */}
        {stats.rounds_played > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Scoring</Text>
            <View style={styles.tileGrid}>
              <ScoreTile label="Avg Gross"  value={stats.avg_score != null ? Number(stats.avg_score).toFixed(1) : null} />
              <ScoreTile label="Avg Net"    value={avgNetScore} sub="est." />
              <ScoreTile label="Best Gross" value={stats.best_score} accent />
              <ScoreTile label="Best Net"   value={bestNetScore} sub="est." accent />
              <ScoreTile label="Avg vs Par" value={avgVsParFmt} accent={stats.avg_vs_par != null && stats.avg_vs_par < 0} />
              <ScoreTile label="Pts / Hole" value={stats.points_per_hole != null ? Number(stats.points_per_hole).toFixed(2) : null} accent />
            </View>
            <View style={styles.thinDivider} />
            <Text style={styles.sectionLabel}>Stableford</Text>
            <View style={styles.tileGrid}>
              <ScoreTile label="Avg / Round" value={stats.avg_stableford != null ? Number(stats.avg_stableford).toFixed(1) : null} accent />
              <ScoreTile label="Best Round"  value={stats.best_stableford} accent />
              {recentAvg && <ScoreTile label="Recent Form" value={recentAvg} sub="last 5 rounds" accent wide />}
            </View>
          </View>
        )}

        {/* ── Hole Performance ──────────────────────────────────────────── */}
        {breakdown && breakdown.total > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hole Performance</Text>
            <Text style={styles.cardSub}>Last 5 rounds</Text>
            <HoleDonut breakdown={breakdown} />
            <View style={styles.thinDivider} />
            <HoleBarChart breakdown={breakdown} />
            {(() => {
              const birdieRate = ((breakdown.eagles_plus + breakdown.birdies) / breakdown.total * 100);
              const bogeyAvoid = ((1 - (breakdown.bogeys + breakdown.double_plus) / breakdown.total) * 100);
              const showBirdie = birdieRate >= 20;
              return (
                <View style={styles.insightBar}>
                  <Text style={styles.insightTitle}>
                    {showBirdie ? `${birdieRate.toFixed(0)}% birdie conversion` : `${bogeyAvoid.toFixed(0)}% bogey avoidance`}
                  </Text>
                  <Text style={styles.insightSub}>
                    {showBirdie ? 'Strong scoring above par' : 'Percentage of holes finishing par or better'}
                  </Text>
                </View>
              );
            })()}
          </View>
        )}

        {/* ── Scoring by Par Type ───────────────────────────────────────── */}
        {parStats.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scoring by Par Type</Text>
            <Text style={styles.cardSub}>Last 5 rounds</Text>
            {parStats.map(stat => <StackedParRow key={stat.par} stat={stat} />)}
          </View>
        )}

        {/* ── Activity ──────────────────────────────────────────────────── */}
        {stats.rounds_played > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activity</Text>

            {stats.last_played_at && (
              <LinearGradient
                colors={[G_DARK, G_MID]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.actFeatured}
              >
                <Text style={styles.actFeaturedLbl}>Last Round</Text>
                <Text style={styles.actFeaturedDate}>{fmtDate(stats.last_played_at)}</Text>
                {stats.last_score != null && (
                  <Text style={styles.actFeaturedSub}>
                    {stats.last_score} strokes · {stats.last_stableford} pts
                  </Text>
                )}
              </LinearGradient>
            )}

            <View style={[styles.tileGrid, { marginTop: 8 }]}>
              <ActTile label="Total Rounds"   value={stats.rounds_played} />
              <ActTile label="Courses Played" value={stats.unique_courses ?? 0} accent />
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>By Year</Text>
            <View style={styles.tileGrid}>
              <ActTile label={String(yr)}   value={stats.rounds_this_year ?? 0} />
              <ActTile label={String(yr-1)} value={stats.rounds_last_year ?? 0} />
            </View>
          </View>
        )}

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

  // ── Gradient hero ─────────────────────────────────────────────────────────
  memberHero: {
    marginHorizontal: -spacing.md,
    marginTop: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  memberHeroGlow: {
    position: 'absolute',
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -60, alignSelf: 'center',
  },
  memberHeroRing: {
    position: 'absolute',
    bottom: -30, right: -30,
    width: 160, height: 160, borderRadius: 80,
    borderWidth: 30, borderColor: 'rgba(255,255,255,0.04)',
  },
  memberHeroAvatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
  },
  memberHeroAvatarText:  { fontSize: 26, fontWeight: '700', color: '#fff' },
  memberHeroName:        { fontSize: 21, fontWeight: '700', color: '#fff', letterSpacing: -0.3, marginBottom: 3 },
  memberHeroEmail:       { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 2 },
  memberHeroSince:       { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  memberHeroSepRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginVertical: 20,
  },
  memberHeroSepLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  memberHeroSepDot:  { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 8 },
  memberHeroHcp: {
    fontSize: 64, fontWeight: '800', color: '#fff',
    letterSpacing: -2, lineHeight: 70,
  },
  memberHeroHcpLabel: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2,
    textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 6,
  },

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
});
