import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import client from '../api/client';
import ScorecardModal from '../components/ScorecardModal';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

const ORANGE = '#E09050';

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
};

type Round = {
  id: string; played_at: string; course_name: string; score: number; stableford: number;
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

type Props = { route: { params: { userId: string; name?: string } } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(f: string | null, l: string | null, e: string) {
  return [f, l].filter(Boolean).join(' ') || e;
}
function personInitials(f: string | null, l: string | null, e: string) {
  return [f?.[0], l?.[0]].filter(Boolean).join('').toUpperCase() || e[0].toUpperCase();
}
function fmtDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
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

  const H = 90;
  const PAD = 10;
  const innerW = chartW - PAD * 2;
  const innerH = H - PAD * 2;

  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const range = maxV - minV || 1;

  const pts = data.map((v, i) => ({
    x: PAD + (i / (data.length - 1)) * innerW,
    y: PAD + ((maxV - v) / range) * innerH,
  }));

  const STROKE = 2.5;
  const DOT_R  = 3.5;

  return (
    <View style={{ height: H, width: chartW, position: 'relative' }}>
      {[0, 0.5, 1].map(frac => (
        <View key={frac} style={{
          position: 'absolute',
          left: PAD, top: PAD + frac * innerH, width: innerW, height: 1,
          backgroundColor: 'rgba(0,0,0,0.06)',
        }} />
      ))}

      {pts.slice(0, -1).map((p1, i) => {
        const p2 = pts[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View key={i} style={{
            position: 'absolute',
            left: (p1.x + p2.x) / 2 - len / 2,
            top:  (p1.y + p2.y) / 2 - STROKE / 2,
            width: len, height: STROKE,
            backgroundColor: color,
            borderRadius: STROKE / 2,
            transform: [{ rotate: `${angle}deg` }],
          }} />
        );
      })}

      {pts.map((p, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: p.x - DOT_R, top: p.y - DOT_R,
          width: DOT_R * 2, height: DOT_R * 2,
          borderRadius: DOT_R,
          backgroundColor: color,
        }} />
      ))}

      <Text style={{ position: 'absolute', left: PAD, top: pts[0].y - 18, fontSize: fontSize.xs, color, fontWeight: '700' }}>
        {data[0].toFixed(1)}
      </Text>
      <Text style={{ position: 'absolute', right: PAD, top: pts[pts.length - 1].y - 18, fontSize: fontSize.xs, color, fontWeight: '700' }}>
        {data[data.length - 1].toFixed(1)}
      </Text>
    </View>
  );
}

// ── Handicap trend ────────────────────────────────────────────────────────────

function HcpTrend({ rounds, chartWidth }: { rounds: Round[]; chartWidth: number }) {
  if (rounds.length < 3) return null;

  const chronological = [...rounds]
    .sort((a, b) => a.played_at.localeCompare(b.played_at))
    .slice(-20);
  const diffs = chronological.map(r => parseFloat(((r.score - 72) * 0.96).toFixed(1)));

  const half      = Math.max(1, Math.floor(diffs.length / 2));
  const earlyAvg  = mean(diffs.slice(0, half));
  const recentAvg = mean(diffs.slice(diffs.length - half));
  const delta     = recentAvg - earlyAvg;
  const dir       = delta < -0.5 ? 'improving' : delta > 0.5 ? 'declining' : 'stable';
  const cfg = {
    improving: { label: 'Improving', symbol: '↓', color: colors.primary,       bg: colors.primary + '14' },
    declining: { label: 'Declining', symbol: '↑', color: colors.danger,        bg: colors.danger  + '14' },
    stable:    { label: 'Stable',    symbol: '→', color: colors.textSecondary, bg: colors.border  + '80' },
  }[dir];

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={[styles.trendBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.trendBadgeSymbol, { color: cfg.color }]}>{cfg.symbol}</Text>
          <Text style={[styles.trendBadgeLabel,  { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.trendNote}>simplified differential · last {diffs.length} rounds</Text>
      </View>

      <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: spacing.xs }}>
        <LineChart data={diffs} color={cfg.color} width={chartWidth - 8} />
      </View>

      <View style={styles.chartAxis}>
        <Text style={styles.axisLabel}>Older</Text>
        <Text style={styles.axisLabel}>lower = better HCP</Text>
        <Text style={styles.axisLabel}>Recent</Text>
      </View>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeroBubble({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.heroBubble}>
      <Text style={[styles.heroValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function StatTile({ label, value, accent, sub }: {
  label: string; value: string | number | null | undefined; accent?: string; sub?: string;
}) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileLabel}>{label}</Text>
      <Text style={[styles.statTileValue, accent ? { color: accent } : null]}>
        {value != null ? String(value) : '—'}
      </Text>
      {sub ? <Text style={styles.statTileSub}>{sub}</Text> : null}
    </View>
  );
}

function InfoRow({ label, value, sub }: {
  label: string; value: string | number | null | undefined; sub?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoRight}>
        <Text style={styles.infoValue}>{value != null ? String(value) : '—'}</Text>
        {sub ? <Text style={styles.infoSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function SectionHead({ children }: { children: string }) {
  return <Text style={styles.sectionHead}>{children}</Text>;
}

function HoleBar({ member }: { member: MemberStats }) {
  const { total_eagles_plus, total_birdies, total_pars, total_bogeys, total_double_plus, total_holes } = member;
  if (!total_holes) return null;

  const all = [
    { label: 'Eagle+',  count: total_eagles_plus, color: colors.gold },
    { label: 'Birdie',  count: total_birdies,     color: colors.primaryLight },
    { label: 'Par',     count: total_pars,         color: colors.textSecondary },
    { label: 'Bogey',   count: total_bogeys,       color: ORANGE },
    { label: 'Double+', count: total_double_plus,  color: colors.danger },
  ];
  const pct = (n: number) => ((n / total_holes) * 100).toFixed(1);

  return (
    <View>
      <View style={styles.holeBar}>
        {all.filter(t => t.count > 0).map(t => (
          <View key={t.label} style={{ flex: t.count, backgroundColor: t.color }} />
        ))}
      </View>
      <View style={styles.holeLegend}>
        {all.map(t => (
          <View key={t.label} style={styles.holeLegendItem}>
            <View style={[styles.holeDot, { backgroundColor: t.color }]} />
            <Text style={styles.holeLegendText}>
              <Text style={{ fontWeight: '700' }}>{t.label}</Text>
              {' '}{t.count}
              <Text style={{ color: colors.border }}> {pct(t.count)}%</Text>
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.holeSub}>{total_holes.toLocaleString()} holes recorded</Text>
    </View>
  );
}

// ── Par breakdown ─────────────────────────────────────────────────────────────

const PAR_COLORS = {
  eagles_plus: colors.gold,
  birdies:     colors.primaryLight,
  pars:        colors.textSecondary,
  bogeys:      ORANGE,
  double_plus: colors.danger,
};

function ParBreakdownRow({ stat }: { stat: ParStat }) {
  const { par, eagles_plus, birdies, pars, bogeys, double_plus, total } = stat;
  if (!total) return null;

  const segments = [
    { key: 'Eagle+',  count: eagles_plus, color: PAR_COLORS.eagles_plus },
    { key: 'Birdie',  count: birdies,     color: PAR_COLORS.birdies },
    { key: 'Par',     count: pars,         color: PAR_COLORS.pars },
    { key: 'Bogey',   count: bogeys,       color: PAR_COLORS.bogeys },
    { key: 'Double+', count: double_plus,  color: PAR_COLORS.double_plus },
  ].filter(s => s.count > 0);

  const pctStr = (n: number) => `${((n / total) * 100).toFixed(0)}%`;

  return (
    <View style={styles.parRow}>
      <View style={styles.parRowHeader}>
        <Text style={styles.parRowLabel}>Par {par}</Text>
        <Text style={styles.parRowTotal}>{total} holes</Text>
      </View>
      <View style={styles.holeBar}>
        {segments.map(s => (
          <View key={s.key} style={{ flex: s.count, backgroundColor: s.color }} />
        ))}
      </View>
      <View style={styles.holeLegend}>
        {segments.map(s => (
          <View key={s.key} style={styles.holeLegendItem}>
            <View style={[styles.holeDot, { backgroundColor: s.color }]} />
            <Text style={styles.holeLegendText}>
              <Text style={{ fontWeight: '700' }}>{pctStr(s.count)}</Text>
              {' '}{s.key}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ParBreakdown({ stats }: { stats: ParStat[] }) {
  if (!stats.length) return null;

  const bestPar = [...stats].sort((a, b) => {
    const scoreA = (a.eagles_plus + a.birdies) / a.total;
    const scoreB = (b.eagles_plus + b.birdies) / b.total;
    return scoreB - scoreA;
  })[0];

  return (
    <View>
      {stats.map(s => <ParBreakdownRow key={s.par} stat={s} />)}
      {bestPar && (
        <Text style={styles.parBestNote}>
          Best on Par {bestPar.par}s — {(((bestPar.eagles_plus + bestPar.birdies) / bestPar.total) * 100).toFixed(0)}% birdies or better
        </Text>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MemberProfileScreen({ route }: Props) {
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
  const [scorecardId, setScorecardId] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      client.get<MemberStats>(`/api/users/${userId}`),
      client.get<Round[]>(`/api/users/${userId}/rounds`),
      client.get<HoleStat[]>(`/api/users/${userId}/hole-stats`),
      client.get<ParStat[]>(`/api/users/${userId}/par-stats`),
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
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (error || !stats) {
    return <View style={styles.centered}><Text style={styles.errorText}>{error || 'Player not found'}</Text></View>;
  }

  const hcp          = stats.handicap != null ? Number(stats.handicap) : null;
  const avgNetScore  = stats.avg_score != null && hcp != null ? (Number(stats.avg_score) - hcp).toFixed(1) : null;
  const bestNetScore = stats.best_score != null && hcp != null ? (stats.best_score - hcp).toFixed(1) : null;
  const avgVsParFmt  = stats.avg_vs_par != null
    ? (stats.avg_vs_par > 0 ? `+${Number(stats.avg_vs_par).toFixed(1)}` : Number(stats.avg_vs_par).toFixed(1))
    : null;

  const recentAvg = (() => {
    const last5 = rounds.slice(0, 5).map(r => r.stableford);
    return last5.length >= 3 ? mean(last5).toFixed(1) : null;
  })();

  const bestHole  = holeStats.length ? holeStats.reduce((b, h) => h.avg_points > b.avg_points ? h : b) : null;
  const worstHole = holeStats.length ? holeStats.reduce((w, h) => h.avg_points < w.avg_points ? h : w) : null;

  const yr = new Date().getFullYear();

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      {/* ── Identity ── */}
      <View style={styles.card}>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {personInitials(stats.first_name, stats.last_name, stats.email)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.identityName}>
              {personName(stats.first_name, stats.last_name, stats.email)}
            </Text>
            <Text style={styles.identityEmail}>{stats.email}</Text>
            <Text style={styles.memberSince}>Member since {fmtMember(stats.created_at)}</Text>
          </View>
          {hcp != null && (
            <View style={styles.hcpBadge}>
              <Text style={styles.hcpBadgeValue}>{hcp.toFixed(1)}</Text>
              <Text style={styles.hcpBadgeLabel}>HCP</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Hero numbers ── */}
      {stats.rounds_played > 0 && (
        <View style={styles.heroRow}>
          <HeroBubble label="Rounds" value={String(stats.rounds_played)} />
          <View style={styles.heroDivider} />
          <HeroBubble
            label="Avg Pts"
            value={stats.avg_stableford != null ? Number(stats.avg_stableford).toFixed(1) : '—'}
            accent={colors.primary}
          />
          <View style={styles.heroDivider} />
          <HeroBubble
            label="Best Score"
            value={stats.best_score != null ? String(stats.best_score) : '—'}
          />
        </View>
      )}

      {/* ── Scoring ── */}
      {stats.rounds_played > 0 && (
        <View style={styles.card}>
          <SectionHead>Scoring</SectionHead>
          <View style={styles.tileGrid}>
            <StatTile label="Avg Gross"   value={stats.avg_score != null ? Number(stats.avg_score).toFixed(1) : null} />
            <StatTile label="Avg Net"     value={avgNetScore}  sub="est." />
            <StatTile label="Best Gross"  value={stats.best_score} accent={colors.primary} />
            <StatTile label="Best Net"    value={bestNetScore} sub="est." />
            <StatTile
              label="Avg vs Par"
              value={avgVsParFmt}
              accent={stats.avg_vs_par != null && stats.avg_vs_par < 0 ? colors.primary : undefined}
            />
            <StatTile label="Points/Hole"
              value={stats.points_per_hole != null ? Number(stats.points_per_hole).toFixed(2) : null}
            />
          </View>

          <View style={styles.divider} />
          <SectionHead>Stableford</SectionHead>
          <View style={styles.tileGrid}>
            <StatTile label="Avg / Round"
              value={stats.avg_stableford != null ? Number(stats.avg_stableford).toFixed(1) : null}
              accent={colors.primary}
            />
            <StatTile label="Best Round" value={stats.best_stableford} accent={colors.primary} />
            {recentAvg && <StatTile label="Recent Form" value={recentAvg} sub="last 5 rounds" />}
          </View>
        </View>
      )}

      {/* ── Activity ── */}
      {stats.rounds_played > 0 && (
        <View style={styles.card}>
          <SectionHead>Activity</SectionHead>
          <InfoRow label="Total Rounds"     value={stats.rounds_played} />
          <InfoRow label={`Rounds ${yr}`}   value={stats.rounds_this_year ?? 0} />
          <InfoRow label={`Rounds ${yr-1}`} value={stats.rounds_last_year ?? 0} />
          <InfoRow label="Courses Played"   value={stats.unique_courses ?? 0} />
          {stats.last_played_at && (
            <InfoRow
              label="Last Round"
              value={fmtDate(stats.last_played_at)}
              sub={stats.last_score != null ? `${stats.last_score} gross · ${stats.last_stableford} pts` : undefined}
            />
          )}
        </View>
      )}

      {/* ── Hole Performance ── */}
      {stats.total_holes > 0 && (
        <View style={styles.card}>
          <SectionHead>Hole Performance</SectionHead>
          <HoleBar member={stats} />
          {(bestHole || worstHole) && (
            <View style={styles.holeHighlights}>
              {bestHole && (
                <View style={[styles.holeHighlight, { backgroundColor: colors.primary + '0A', borderColor: colors.primary + '33' }]}>
                  <Text style={[styles.holeTag, { color: colors.primary }]}>Best Hole</Text>
                  <Text style={[styles.holeNum, { color: colors.primary }]}>#{bestHole.hole_number}</Text>
                  <Text style={styles.holeMeta}>
                    {Number(bestHole.avg_points).toFixed(2)} avg pts{'\n'}
                    {bestHole.avg_vs_par >= 0 ? '+' : ''}{Number(bestHole.avg_vs_par).toFixed(2)} vs par
                  </Text>
                </View>
              )}
              {worstHole && worstHole.hole_number !== bestHole?.hole_number && (
                <View style={[styles.holeHighlight, { backgroundColor: colors.danger + '0A', borderColor: colors.danger + '26' }]}>
                  <Text style={[styles.holeTag, { color: colors.danger }]}>Toughest</Text>
                  <Text style={[styles.holeNum, { color: colors.danger }]}>#{worstHole.hole_number}</Text>
                  <Text style={styles.holeMeta}>
                    {Number(worstHole.avg_points).toFixed(2)} avg pts{'\n'}
                    {worstHole.avg_vs_par >= 0 ? '+' : ''}{Number(worstHole.avg_vs_par).toFixed(2)} vs par
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── Par Breakdown ── */}
      {parStats.length > 0 && (
        <View style={styles.card}>
          <SectionHead>Scoring by Par Type</SectionHead>
          <ParBreakdown stats={parStats} />
        </View>
      )}

      {/* ── Handicap Trend ── */}
      {rounds.length >= 3 && (
        <View style={styles.card}>
          <SectionHead>Handicap Trend</SectionHead>
          <HcpTrend rounds={rounds} chartWidth={chartWidth} />
        </View>
      )}

      {/* ── Round History ── */}
      <View style={styles.card}>
        <SectionHead>Round History</SectionHead>
        {rounds.length === 0 ? (
          <Text style={styles.emptyText}>No rounds logged yet</Text>
        ) : (
          <>
            <View style={styles.tableHead}>
              <Text style={[styles.tableCell, styles.colDate, styles.tableHeadText]}>Date</Text>
              <Text style={[styles.tableCell, styles.colCourse, styles.tableHeadText]}>Course</Text>
              <Text style={[styles.tableCell, styles.colNum, styles.tableHeadText]}>Grs</Text>
              <Text style={[styles.tableCell, styles.colNum, styles.tableHeadText]}>Pts</Text>
            </View>
            {rounds.map((r, i) => {
              const pts = r.stableford;
              const ptsTxtColor = pts >= 36 ? colors.primary : pts <= 28 ? colors.danger : colors.textPrimary;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.tableRow, i < rounds.length - 1 && styles.tableRowBorder]}
                  onPress={() => setScorecardId(r.id)}
                  activeOpacity={0.65}
                >
                  <Text style={[styles.tableCell, styles.colDate]}>{fmtDate(r.played_at)}</Text>
                  <Text style={[styles.tableCell, styles.colCourse]} numberOfLines={1}>{r.course_name}</Text>
                  <Text style={[styles.tableCell, styles.colNum, styles.numText]}>{r.score}</Text>
                  <Text style={[styles.tableCell, styles.colNum, styles.numText, { color: ptsTxtColor }]}>{pts}</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </View>

    </ScrollView>
    {scorecardId != null && (
      <ScorecardModal roundId={scorecardId} onClose={() => setScorecardId(null)} />
    )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, gap: spacing.sm },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  errorText: { fontSize: fontSize.base, color: colors.danger },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18,
    ...shadows.card,
  },

  identityRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar:        { width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:    { color: colors.textInverse, fontSize: fontSize.xl, fontWeight: '800' },
  identityName:  { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  identityEmail: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  memberSince:   { fontSize: fontSize.xs, color: colors.textSecondary },
  hcpBadge:      { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: colors.primary + '26' },
  hcpBadgeValue: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary, lineHeight: 26 },
  hcpBadgeLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.8 },

  heroRow:    { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18, ...shadows.card },
  heroBubble: { flex: 1, alignItems: 'center' },
  heroValue:  { fontSize: fontSize.xxl, fontWeight: '900', color: colors.textPrimary, lineHeight: 32 },
  heroLabel:  { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },
  heroDivider:{ width: 1, backgroundColor: colors.border, marginHorizontal: spacing.xs },

  sectionHead: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textSecondary, marginBottom: 14 },
  divider:     { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  tileGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile:      { flex: 1, minWidth: '45%', backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 14 },
  statTileLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginBottom: 5 },
  statTileValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  statTileSub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  infoRight: { alignItems: 'flex-end' },
  infoValue: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  infoSub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  holeBar:       { height: 12, borderRadius: radius.sm, overflow: 'hidden', flexDirection: 'row', marginBottom: spacing.md },
  holeLegend:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, rowGap: 7 },
  holeLegendItem:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  holeDot:       { width: 9, height: 9, borderRadius: 2 },
  holeLegendText:{ fontSize: fontSize.xs, color: colors.textPrimary },
  holeSub:       { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 10 },

  holeHighlights: { flexDirection: 'row', gap: 10, marginTop: 18 },
  holeHighlight:  { flex: 1, borderRadius: 14, padding: 14, borderWidth: 1 },
  holeTag:        { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  holeNum:        { fontSize: fontSize.xxl, fontWeight: '900', marginBottom: spacing.xs },
  holeMeta:       { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },

  trendBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  trendBadgeSymbol: { fontSize: fontSize.lg, fontWeight: '700' },
  trendBadgeLabel:  { fontSize: fontSize.sm, fontWeight: '700' },
  trendNote:        { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  chartAxis:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisLabel:        { fontSize: fontSize.xs, color: colors.textSecondary },

  tableHead:     { flexDirection: 'row', paddingBottom: 10, borderBottomWidth: 1.5, borderBottomColor: colors.border, marginBottom: 2 },
  tableHeadText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  tableRowBorder:{ borderBottomWidth: 1, borderBottomColor: colors.border },
  tableCell:     { fontSize: fontSize.sm },
  colDate:       { width: 86, color: colors.textSecondary },
  colCourse:     { flex: 1, color: colors.textPrimary, paddingRight: 6 },
  colNum:        { width: 38, textAlign: 'right' },
  numText:       { fontWeight: '700', color: colors.textPrimary },

  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },

  parRow:       { marginBottom: spacing.md },
  parRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  parRowLabel:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  parRowTotal:  { fontSize: fontSize.xs, color: colors.textSecondary },
  parBestNote:  { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
});
