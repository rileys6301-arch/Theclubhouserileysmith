import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import client from '../api/client';
import { RootStackParamList } from '../../App';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_BG     = '#edeae4';
const G_MID       = '#3d6b1f';
const G_LIGHT     = '#4e8a27';
const GOLD        = '#c9a227';
const GOLD_LIGHT  = '#f0d060';
const GOLD_DARK   = '#7a5a10';
const SHAME_DARK  = '#7f1d1d';
const SHAME_MID   = '#b91c1c';
const CARD_BG     = '#ffffff';
const TEXT_PRI    = '#1c1c1e';
const TEXT_SEC    = '#6b7280';
const BORDER_CLR  = 'rgba(0,0,0,0.08)';
const BLUE        = '#3b82f6';
const PURPLE      = '#7c3aed';
const TEAL        = '#0891b2';
const GREEN_FIR   = '#16a34a';
const ORANGE      = '#f97316';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Hall'>;
  route: RouteProp<RootStackParamList, 'Hall'>;
};

type RoundRecord = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  score: number;
  stableford: number | null;
  score_to_par: number;
  course_par: number;
  played_at: string;
  course_name: string;
};

type CountRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  count: number;
};

type RateRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  value: number;
};

type WorstHole = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  hole_number: number;
  score: number;
  par: number;
  course_name: string;
  over_par: number;
};

type HallData = {
  fame: {
    lowRounds: RoundRecord[];
    bestStableford: RoundRecord | null;
    mostBirdies: CountRecord[];
    mostEagles: CountRecord[];
    holesInOne: CountRecord[];
    bestFIR: RateRecord[];
    bestGIR: RateRecord[];
    fewestPutts: RateRecord[];
  };
  shame: {
    highRounds: RoundRecord[];
    worstHole: WorstHole | null;
    bigNumbers: CountRecord[];
    worstFIR: RateRecord[];
    worstGIR: RateRecord[];
    mostPutts: RateRecord[];
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pName(r: { first_name: string | null; last_name: string | null; email: string }) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
}

function pInitials(r: { first_name: string | null; last_name: string | null; email: string }) {
  return [r.first_name?.[0], r.last_name?.[0]].filter(Boolean).join('').toUpperCase()
    || r.email[0].toUpperCase();
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toParStr(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Av({ rec, color, size = 36 }: {
  rec: { first_name: string | null; last_name: string | null; email: string };
  color: string;
  size?: number;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color + '28',
      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
    }}>
      <Text style={{ fontSize: Math.round(size * 0.38), fontWeight: '700', color }}>
        {pInitials(rec)}
      </Text>
    </View>
  );
}

// Ranked leaderboard card — replaces the old Podium
function LeaderboardCard({ records, color, valueKey, formatter, emptyMsg }: {
  records: RoundRecord[];
  color: string;
  valueKey: keyof RoundRecord;
  formatter: (v: number) => string;
  emptyMsg: string;
}) {
  if (!records.length) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="golf-outline" size={32} color={TEXT_SEC} />
        <Text style={styles.emptyText}>{emptyMsg}</Text>
      </View>
    );
  }
  return (
    <View style={styles.listCard}>
      {records.map((r, i) => {
        const raw = r[valueKey] as number | null;
        const val = raw != null ? formatter(raw) : '—';
        return (
          <View key={i} style={[styles.lbRow, i > 0 && styles.lbRowBorder]}>
            <View style={[styles.rankBadge, { backgroundColor: i === 0 ? color : color + '50' }]}>
              <Text style={styles.rankBadgeText}>#{i + 1}</Text>
            </View>
            <Av rec={r} color={color} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lbName} numberOfLines={1}>{pName(r)}</Text>
              <Text style={styles.lbSub} numberOfLines={1}>
                {r.course_name} · {shortDate(r.played_at)}
              </Text>
            </View>
            <Text style={[styles.lbValue, { color }]}>{val}</Text>
          </View>
        );
      })}
    </View>
  );
}

// 2×2 stat tile grid
function StatGrid({ tiles }: {
  tiles: { label: string; value: string; color: string; sub?: string }[];
}) {
  return (
    <View style={styles.statGrid}>
      {tiles.map((t, i) => (
        <View key={i} style={styles.statTile}>
          <Text style={[styles.statValue, { color: t.color }]}>{t.value}</Text>
          <Text style={styles.statLabel}>{t.label}</Text>
          {t.sub ? <Text style={styles.statSub} numberOfLines={1}>{t.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// Award section — header outside card + rows inside card
function AwardSection({ icon, iconBg, iconColor, title, subtitle, children }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.awardWrap}>
      <View style={styles.awardHeader}>
        <View style={[styles.awardIconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.awardTitle}>{title}</Text>
          <Text style={styles.awardSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.listCard}>{children}</View>
    </View>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return (
    <View style={[styles.lbRow, { justifyContent: 'center', paddingVertical: 16 }]}>
      <Text style={[styles.lbSub, { textAlign: 'center' }]}>{msg}</Text>
    </View>
  );
}

function CountRow({ rec, rank, color, value, unit, onPress }: {
  rec: CountRecord;
  rank: number;
  color: string;
  value: number;
  unit: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.lbRow, rank > 1 && styles.lbRowBorder]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={[styles.rankBadge, { backgroundColor: rank === 1 ? color : color + '50' }]}>
        <Text style={styles.rankBadgeText}>#{rank}</Text>
      </View>
      <Av rec={rec} color={color} size={34} />
      <Text style={[styles.lbName, { flex: 1 }]} numberOfLines={1}>{pName(rec)}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.lbValue, { color }]}>{value}</Text>
        <Text style={styles.lbUnit}>{unit}</Text>
      </View>
    </TouchableOpacity>
  );
}

function RateRow({ rec, rank, color, value, unit, onPress }: {
  rec: RateRecord;
  rank: number;
  color: string;
  value: string;
  unit: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.lbRow, rank > 1 && styles.lbRowBorder]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={[styles.rankBadge, { backgroundColor: rank === 1 ? color : color + '50' }]}>
        <Text style={styles.rankBadgeText}>#{rank}</Text>
      </View>
      <Av rec={rec} color={color} size={34} />
      <Text style={[styles.lbName, { flex: 1 }]} numberOfLines={1}>{pName(rec)}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.lbValue, { color }]}>{value}</Text>
        <Text style={styles.lbUnit}>{unit}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function HallScreen({ navigation, route }: Props) {
  const { clubId } = route.params;
  const insets = useSafeAreaInsets();

  const [tab,     setTab]     = useState<'fame' | 'shame'>('fame');
  const [data,    setData]    = useState<HallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    client.get<HallData>(`/api/clubs/${clubId}/hall`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not load records'))
      .finally(() => setLoading(false));
  }, [clubId]);

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>

      {/* ── Tab Toggle ─────────────────────────────────────────── */}
      <View style={styles.toggleWrap}>
        <TouchableOpacity
          style={styles.toggleBtnOuter}
          onPress={() => setTab('fame')}
          activeOpacity={0.85}
        >
          {tab === 'fame' ? (
            <LinearGradient
              colors={[GOLD_DARK, GOLD, GOLD_LIGHT]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.toggleBtn}
            >
              <Ionicons name="trophy" size={15} color="#fff" />
              <Text style={[styles.toggleText, styles.toggleTextActive]}>Hall of Fame</Text>
            </LinearGradient>
          ) : (
            <View style={styles.toggleBtn}>
              <Ionicons name="trophy" size={15} color={TEXT_SEC} />
              <Text style={styles.toggleText}>Hall of Fame</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleBtnOuter}
          onPress={() => setTab('shame')}
          activeOpacity={0.85}
        >
          {tab === 'shame' ? (
            <LinearGradient
              colors={[SHAME_DARK, SHAME_MID, '#ef4444']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.toggleBtn}
            >
              <Ionicons name="skull-outline" size={15} color="#fff" />
              <Text style={[styles.toggleText, styles.toggleTextActive]}>Hall of Shame</Text>
            </LinearGradient>
          ) : (
            <View style={styles.toggleBtn}>
              <Ionicons name="skull-outline" size={15} color={TEXT_SEC} />
              <Text style={styles.toggleText}>Hall of Shame</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Content ────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={G_MID} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !data ? null : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {/* ═══════════════════ HALL OF FAME ═══════════════════ */}
          {tab === 'fame' && (
            <FameTab data={data} navigation={navigation} />
          )}

          {/* ═══════════════════ HALL OF SHAME ══════════════════ */}
          {tab === 'shame' && (
            <ShameTab data={data} navigation={navigation} />
          )}

        </ScrollView>
      )}
    </View>
  );
}

// ── Fame Tab ───────────────────────────────────────────────────────────────────

function FameTab({ data, navigation }: {
  data: HallData;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Hall'>;
}) {
  const totalBirdies = data.fame.mostBirdies.reduce((s, r) => s + r.count, 0);
  const totalEagles  = data.fame.mostEagles.reduce((s, r) => s + r.count, 0);
  const birdieKing   = data.fame.mostBirdies[0] ?? null;
  const eagleKing    = data.fame.mostEagles[0]  ?? null;

  const bestRound = data.fame.lowRounds[0] ?? null;

  return (
    <>
      {/* Hero — best all-time gross round */}
      {bestRound ? (
        <LinearGradient
          colors={[GOLD_DARK, GOLD, '#f5e07a']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconCircleFame}>
              <Ionicons name="trophy" size={22} color={GOLD_DARK} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.heroLabelFame}>BEST ROUND</Text>
              <Text style={styles.heroSubFame}>Club all-time gross record</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.heroValueFame}>{bestRound.score}</Text>
              <Text style={styles.heroUnitFame}>{toParStr(bestRound.score_to_par)} to par</Text>
            </View>
          </View>
          <View style={styles.heroHolderRow}>
            <Av rec={bestRound} color={GOLD_DARK} size={30} />
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.heroHolderNameFame}>{pName(bestRound)}</Text>
              <Text style={styles.heroHolderSubFame}>
                {bestRound.course_name} · {shortDate(bestRound.played_at)}
              </Text>
            </View>
          </View>
        </LinearGradient>
      ) : null}

      {/* Best Rounds leaderboard */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="podium" size={16} color={GOLD} />
          <Text style={styles.sectionTitle}>Best Rounds</Text>
        </View>
        <Text style={styles.sectionSub}>Lowest scores to par in club history</Text>
        <LeaderboardCard
          records={data.fame.lowRounds}
          color={GOLD}
          valueKey="score_to_par"
          formatter={toParStr}
          emptyMsg="No rounds with hole data yet"
        />
      </View>

      {/* 2×2 Stat tiles */}
      <StatGrid tiles={[
        { label: 'Club Birdies', value: String(totalBirdies), color: BLUE },
        { label: 'Club Eagles',  value: String(totalEagles),  color: GOLD },
        {
          label: 'Birdie King',
          value: birdieKing ? String(birdieKing.count) : '—',
          color: BLUE,
          sub: birdieKing ? pName(birdieKing) : 'No data yet',
        },
        {
          label: 'Eagle King',
          value: eagleKing ? String(eagleKing.count) : '—',
          color: GOLD,
          sub: eagleKing ? pName(eagleKing) : 'No data yet',
        },
      ]} />

      {/* Hole in One Club */}
      <AwardSection
        icon="radio-button-on"
        iconBg={G_LIGHT + '28'}
        iconColor={G_MID}
        title="Hole in One Club"
        subtitle="The rarest achievement in golf"
      >
        {data.fame.holesInOne.length === 0
          ? <EmptyRow msg="No holes-in-one yet — legends in the making" />
          : data.fame.holesInOne.map((r, i) => (
              <CountRow
                key={r.id} rec={r} rank={i + 1} color={G_MID}
                value={r.count} unit="HiO"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* Fairway King */}
      <AwardSection
        icon="git-branch"
        iconBg={GREEN_FIR + '28'}
        iconColor={GREEN_FIR}
        title="Fairway King"
        subtitle="Highest fairway hit rate (par 4 & 5) — min. 9 holes tracked"
      >
        {data.fame.bestFIR.length === 0
          ? <EmptyRow msg="Not enough fairway tracking data yet" />
          : data.fame.bestFIR.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={GREEN_FIR}
                value={`${r.value.toFixed(0)}%`} unit="FIR"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* The Sniper */}
      <AwardSection
        icon="flag"
        iconBg={TEAL + '28'}
        iconColor={TEAL}
        title="The Sniper"
        subtitle="Highest greens in regulation % — min. 9 holes tracked"
      >
        {data.fame.bestGIR.length === 0
          ? <EmptyRow msg="Not enough GIR tracking data yet" />
          : data.fame.bestGIR.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={TEAL}
                value={`${r.value.toFixed(0)}%`} unit="GIR"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* Putting Wizard */}
      <AwardSection
        icon="ellipse"
        iconBg={PURPLE + '28'}
        iconColor={PURPLE}
        title="Putting Wizard"
        subtitle="Fewest putts per round on average — min. 1 full round tracked"
      >
        {data.fame.fewestPutts.length === 0
          ? <EmptyRow msg="Not enough putting data yet" />
          : data.fame.fewestPutts.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={PURPLE}
                value={r.value.toFixed(1)} unit="putts/rnd"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>
    </>
  );
}

// ── Shame Tab ──────────────────────────────────────────────────────────────────

function ShameTab({ data, navigation }: {
  data: HallData;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Hall'>;
}) {
  const totalTriples = data.shame.bigNumbers.reduce((s, r) => s + r.count, 0);
  const tripleKing   = data.shame.bigNumbers[0] ?? null;
  const wh           = data.shame.worstHole;
  const worst        = data.shame.highRounds[0] ?? null;

  return (
    <>
      {/* Hero — worst round */}
      {worst ? (
        <LinearGradient
          colors={[SHAME_DARK, SHAME_MID, '#dc2626']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconCircleShame}>
              <Ionicons name="skull-outline" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.heroLabelShame}>WORST ROUND</Text>
              <Text style={styles.heroSubShame}>Club all-time record</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.heroValueShame}>{toParStr(worst.score_to_par)}</Text>
              <Text style={styles.heroUnitShame}>to par</Text>
            </View>
          </View>
          <View style={styles.heroHolderRow}>
            <Av rec={worst} color="#fff" size={30} />
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.heroHolderNameShame}>{pName(worst)}</Text>
              <Text style={styles.heroHolderSubShame}>
                {worst.course_name} · {shortDate(worst.played_at)}
              </Text>
            </View>
          </View>
        </LinearGradient>
      ) : null}

      {/* Worst Rounds leaderboard */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="podium" size={16} color={SHAME_MID} />
          <Text style={[styles.sectionTitle, { color: SHAME_MID }]}>Worst Rounds</Text>
        </View>
        <Text style={styles.sectionSub}>Highest scores to par in club history</Text>
        <LeaderboardCard
          records={data.shame.highRounds}
          color={SHAME_MID}
          valueKey="score_to_par"
          formatter={toParStr}
          emptyMsg="No rounds with hole data yet"
        />
      </View>

      {/* 2×2 Stat tiles */}
      <StatGrid tiles={[
        { label: 'Total Triples', value: String(totalTriples), color: SHAME_MID },
        {
          label: 'Worst Hole',
          value: wh ? `+${wh.over_par}` : '—',
          color: SHAME_MID,
          sub: wh ? `Hole ${wh.hole_number} · Par ${wh.par}` : undefined,
        },
        {
          label: 'Triple King',
          value: tripleKing ? String(tripleKing.count) : '—',
          color: SHAME_MID,
          sub: tripleKing ? pName(tripleKing) : 'No data yet',
        },
        {
          label: 'Worst Hole Player',
          value: wh ? (wh.first_name || wh.email.split('@')[0]) : '—',
          color: SHAME_MID,
          sub: wh ? wh.course_name : undefined,
        },
      ]} />

      {/* Worst Hole Ever */}
      {wh && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="alert-circle" size={16} color={SHAME_MID} />
            <Text style={[styles.sectionTitle, { color: SHAME_MID }]}>Worst Hole Ever</Text>
          </View>
          <Text style={styles.sectionSub}>The single most painful hole in club history</Text>
          <View style={styles.listCard}>
            <View style={styles.lbRow}>
              <View style={styles.holeBadge}>
                <Text style={styles.holeBadgeNum}>{wh.hole_number}</Text>
                <Text style={styles.holeBadgePar}>Par {wh.par}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbName}>{pName(wh)}</Text>
                <Text style={styles.lbSub}>{wh.course_name}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.lbValue, { color: SHAME_MID }]}>{wh.score}</Text>
                <Text style={styles.lbUnit}>+{wh.over_par} over par</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Triple Bogey Club */}
      <AwardSection
        icon="flame"
        iconBg={SHAME_MID + '28'}
        iconColor={SHAME_MID}
        title="Triple Bogey Club"
        subtitle="Most triple bogeys (or worse) ever recorded"
      >
        {data.shame.bigNumbers.length === 0
          ? <EmptyRow msg="No big numbers recorded — impressive!" />
          : data.shame.bigNumbers.map((r, i) => (
              <CountRow
                key={r.id} rec={r} rank={i + 1} color={SHAME_MID}
                value={r.count} unit="big #s"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* Fairway Dodger */}
      <AwardSection
        icon="git-branch"
        iconBg={ORANGE + '28'}
        iconColor={ORANGE}
        title="Fairway Dodger"
        subtitle="Lowest fairway hit rate (par 4 & 5) — min. 9 holes tracked"
      >
        {data.shame.worstFIR.length === 0
          ? <EmptyRow msg="Not enough fairway tracking data yet" />
          : data.shame.worstFIR.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={ORANGE}
                value={`${r.value.toFixed(0)}%`} unit="FIR"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* Green Avoider */}
      <AwardSection
        icon="flag"
        iconBg={ORANGE + '28'}
        iconColor={ORANGE}
        title="Green Avoider"
        subtitle="Lowest greens in regulation % — min. 9 holes tracked"
      >
        {data.shame.worstGIR.length === 0
          ? <EmptyRow msg="Not enough GIR tracking data yet" />
          : data.shame.worstGIR.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={ORANGE}
                value={`${r.value.toFixed(0)}%`} unit="GIR"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>

      {/* Snake in Your Boot */}
      <AwardSection
        icon="ellipse"
        iconBg={SHAME_MID + '28'}
        iconColor={SHAME_MID}
        title="Snake in Your Boot"
        subtitle="Most putts per round on average — min. 1 full round tracked"
      >
        {data.shame.mostPutts.length === 0
          ? <EmptyRow msg="Not enough putting data yet" />
          : data.shame.mostPutts.map((r, i) => (
              <RateRow
                key={r.id} rec={r} rank={i + 1} color={SHAME_MID}
                value={r.value.toFixed(1)} unit="putts/rnd"
                onPress={() => navigation.navigate('MemberProfile', { userId: r.id, name: pName(r) })}
              />
            ))
        }
      </AwardSection>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const CARD_SHADOW = {
  shadowColor: '#000' as const,
  shadowOffset: { width: 0, height: 2 } as const,
  shadowOpacity: 0.07,
  shadowRadius: 8,
  elevation: 2,
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: PAGE_BG },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText:     { color: SHAME_MID, fontSize: 15, textAlign: 'center', padding: 24 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  // ── Toggle ──────────────────────────────────────────────────────────────
  toggleWrap: {
    flexDirection: 'row',
    margin: 16, marginBottom: 0,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  toggleBtnOuter: { flex: 1, borderRadius: 11, overflow: 'hidden' },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 13, borderRadius: 11,
  },
  toggleText:       { fontSize: 14, fontWeight: '600', color: TEXT_SEC },
  toggleTextActive: { color: '#fff' },

  // ── Hero card ────────────────────────────────────────────────────────────
  heroCard: {
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 7,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },

  // Fame hero
  heroIconCircleFame: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroLabelFame:       { fontSize: 11, fontWeight: '800', color: GOLD_DARK, letterSpacing: 1 },
  heroSubFame:         { fontSize: 12, color: 'rgba(80,50,0,0.55)', marginTop: 2 },
  heroValueFame:       { fontSize: 38, fontWeight: '900', color: GOLD_DARK, lineHeight: 40 },
  heroUnitFame:        { fontSize: 12, color: 'rgba(80,50,0,0.55)', fontWeight: '600' },
  heroHolderNameFame:  { fontSize: 14, fontWeight: '700', color: GOLD_DARK },
  heroHolderSubFame:   { fontSize: 12, color: 'rgba(80,50,0,0.55)', marginTop: 1 },

  // Shame hero
  heroIconCircleShame: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroLabelShame:       { fontSize: 11, fontWeight: '800', color: '#ffcdd2', letterSpacing: 1 },
  heroSubShame:         { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroValueShame:       { fontSize: 38, fontWeight: '900', color: '#fff', lineHeight: 40 },
  heroUnitShame:        { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '600' },
  heroHolderNameShame:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  heroHolderSubShame:   { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 1 },

  heroHolderRow: { flexDirection: 'row', alignItems: 'center' },

  // ── Sections ─────────────────────────────────────────────────────────────
  section:       { marginTop: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: TEXT_PRI },
  sectionSub:    { fontSize: 12, color: TEXT_SEC, marginBottom: 8, lineHeight: 17 },

  // ── Shared list card container ────────────────────────────────────────────
  listCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: BORDER_CLR,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },

  // ── Leaderboard rows ──────────────────────────────────────────────────────
  lbRow:       { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  lbRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  lbName:      { fontSize: 14, fontWeight: '600', color: TEXT_PRI },
  lbSub:       { fontSize: 12, color: TEXT_SEC, marginTop: 1 },
  lbValue:     { fontSize: 18, fontWeight: '800' },
  lbUnit:      { fontSize: 11, color: TEXT_SEC, fontWeight: '500', marginTop: 1 },

  rankBadge: {
    width: 26, height: 26, borderRadius: 13,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  rankBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  // ── Stat 2×2 grid ─────────────────────────────────────────────────────────
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
  },
  statTile: {
    // Two per row with gap
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
    borderWidth: 0.5,
    borderColor: BORDER_CLR,
    ...CARD_SHADOW,
  },
  statValue: { fontSize: 26, fontWeight: '800', lineHeight: 30 },
  statLabel: {
    fontSize: 11, color: TEXT_SEC, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3,
  },
  statSub: { fontSize: 12, color: TEXT_PRI, fontWeight: '500', marginTop: 4 },

  // ── Award section ─────────────────────────────────────────────────────────
  awardWrap:    { marginTop: 20 },
  awardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  awardIconCircle: {
    width: 42, height: 42, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  awardTitle:    { fontSize: 15, fontWeight: '700', color: TEXT_PRI },
  awardSubtitle: { fontSize: 12, color: TEXT_SEC, marginTop: 2, lineHeight: 16 },

  // ── Worst hole badge ──────────────────────────────────────────────────────
  holeBadge: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: SHAME_MID,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  holeBadgeNum: { fontSize: 17, fontWeight: '900', color: '#fff', lineHeight: 20 },
  holeBadgePar: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },

  // ── Empty states ──────────────────────────────────────────────────────────
  emptyCard: {
    backgroundColor: CARD_BG, borderRadius: 16, padding: 28,
    alignItems: 'center', gap: 8,
    borderWidth: 0.5, borderColor: BORDER_CLR,
    ...CARD_SHADOW,
  },
  emptyText: { fontSize: 13, color: TEXT_SEC, textAlign: 'center' },
});
