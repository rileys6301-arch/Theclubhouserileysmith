import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, RefreshControl,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DatePickerField from '../components/DatePickerField';
import { useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';
import { useDrawer } from '../context/DrawerContext';
import ScorecardModal from '../components/ScorecardModal';

// Same gradient as ProfileScreen hero
const G_DARK  = '#2a4a18';
const G_MID   = '#3d6b1f';
const G_LIGHT = '#4e8a27';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClubRound = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number; course_handicap: number | null; is_nine_hole: boolean;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type Season ={ id: number; name: string; start_date: string; end_date: string };

type LBEntry = {
  id: string; first_name: string | null; last_name: string | null;
  email: string; handicap: number | null;
  rounds_played: number; score_value: number; scores_counted?: number; rank: number;
};

type LeaderboardData = {
  season: { id: number | null; name: string; start_date: string; end_date: string };
  format: { type: string; n: number; label: string };
  entries: LBEntry[];
};

type Rule = {
  id: number; title: string | null; body: string; position: number; created_at: string;
};

type StatPlayer = {
  first_name: string | null; last_name: string | null; email: string;
};

type Comp = {
  id: number;
  name: string;
  format: string;
  team_size: number;
  date: string;
  course_name: string;
  status: 'upcoming' | 'active' | 'completed';
  entry_count: number;
  entered: boolean;
};

type CompLBRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  handicap: number | null;
  total_stableford: number;
  total_strokes: number;
  net_strokes: number;
  holes_played: number;
  hole_scores: ScoreHole[];
};

type ScoreHole = { hole_number: number; score: number; stableford_points: number };

const FORMAT_LABELS: Record<string, string> = {
  stableford: 'Stableford',
  stroke:     'Stroke Play',
  net_stroke: 'Net Stroke',
  match_play: 'Match Play',
  scramble:   'Scramble',
  best_ball:  'Best Ball',
  skins:      'Skins',
};

const COMP_STATUS_COLOR: Record<string, string> = {
  upcoming:  colors.secondary,
  active:    colors.primary,
  completed: colors.textSecondary,
};

type Props = {
  navigation: any;
  route: { params: { clubId: number; clubName: string; role: string; code: string; userId: string } };
};

const FORMAT_OPTIONS = [
  { value: 'total_points',  label: 'Total Points',  desc: 'Sum of all stableford scores' },
  { value: 'best_n_scores', label: 'Best N Scores',  desc: "Sum of player's top N scores" },
  { value: 'average',       label: 'Average',        desc: 'Average stableford per round' },
  { value: 'best_score',    label: 'Best Score',     desc: 'Single highest score' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function personName(first: string | null, last: string | null, email: string) {
  return [first, last].filter(Boolean).join(' ') || email;
}
function personInitials(first: string | null, last: string | null) {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatSeasonRange(start: string, end: string) {
  const fmt = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(new Date(start))} – ${fmt(new Date(end))}`;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
function scoreDisplay(entry: LBEntry, format: string) {
  return format === 'average' ? Number(entry.score_value).toFixed(1) : String(Number(entry.score_value));
}
function scoreColHeader(format: LeaderboardData['format']) {
  if (format.type === 'total_points')  return 'Total Pts';
  if (format.type === 'best_n_scores') return `Best ${format.n}`;
  if (format.type === 'average')       return 'Average';
  return 'Best';
}

const AVATAR_PALETTE = [
  '#2D4A2D', '#3b6ea8', '#7b4a9e', '#2980b9',
  '#8B6914', '#16a085', '#c0392b', '#d35400',
];
function avatarBg(id: string): string {
  const sum = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function compScoreValue(row: CompLBRow, format: string): string {
  if (format === 'stroke') return String(row.total_strokes);
  if (format === 'net_stroke') return String(row.net_strokes);
  return String(row.total_stableford);
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClubScreen({ navigation, route }: Props) {
  const { clubId, role, code, userId } = route.params;
  const insets  = useSafeAreaInsets();
  const isOwner = role === 'owner';
  const isAdminOrOwner = role === 'owner' || role === 'admin';
  const { openDrawer } = useDrawer();


  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Club Activity
  const [clubRounds, setClubRounds] = useState<ClubRound[]>([]);
  const [scorecardRoundId, setScorecardRoundId] = useState<string | null>(null);

  // Leaderboard
  const [leaderboard,  setLeaderboard]  = useState<LeaderboardData | null>(null);
  const [seasons,      setSeasons]      = useState<Season[]>([]);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [lbLoading,    setLbLoading]    = useState(false);
  const [lbShowAll,    setLbShowAll]    = useState(false);
  const [showSettings,   setShowSettings]   = useState(false);
  const [settingsFormat, setSettingsFormat] = useState('total_points');
  const [settingsN,      setSettingsN]      = useState('8');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError,  setSettingsError]  = useState('');
  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newStart, setNewStart] = useState(isoFromDate(new Date()));
  const [newEnd,   setNewEnd]   = useState(isoFromDate(new Date()));
  const [seasonSaving, setSeasonSaving] = useState(false);
  const [seasonError,  setSeasonError]  = useState('');

  // Competitions
  const [competitions,     setCompetitions]     = useState<Comp[]>([]);
  const [deletingCompId,   setDeletingCompId]   = useState<number | null>(null);
  const [compLeaderboards, setCompLeaderboards] = useState<Record<number, { format: string; rows: CompLBRow[] }>>({});
  const [scorecardModal,   setScorecardModal]   = useState<{ competitionId: number; player: CompLBRow; format: string } | null>(null);
  const [scorecardHoles,   setScorecardHoles]   = useState<ScoreHole[]>([]);
  const [scorecardLoading, setScorecardLoading] = useState(false);

  // Section collapse state — all start collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    activity:    true,
    leaderboard: true,
    tournaments: true,
    rules:       true,
  });
  function toggleSection(key: string) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // Rules
  const [rules,        setRules]        = useState<Rule[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleTitle,    setRuleTitle]    = useState('');
  const [ruleBody,     setRuleBody]     = useState('');
  const [ruleError,    setRuleError]    = useState('');
  const [ruleSaving,   setRuleSaving]   = useState(false);
  const [editingId,    setEditingId]    = useState<number | null>(null);
  const [editTitle,    setEditTitle]    = useState('');
  const [editBody,     setEditBody]     = useState('');
  const [editSaving,   setEditSaving]   = useState(false);
  const [editError,    setEditError]    = useState('');

  // ── Fetching ──────────────────────────────────────────────────────────────

  const fetchLeaderboard = useCallback(async (seasonId: number | null) => {
    setLbLoading(true);
    setLbShowAll(false);
    try {
      const url = `/api/clubs/${clubId}/leaderboard${seasonId != null ? `?season_id=${seasonId}` : ''}`;
      const { data } = await client.get<LeaderboardData>(url);
      if (data?.format) {
        setLeaderboard(data);
        setSettingsFormat(data.format.type);
        setSettingsN(String(data.format.n));
      }
    } catch { /* keep stale */ } finally { setLbLoading(false); }
  }, [clubId]);

  const fetchAll = useCallback(async () => {
    try {
      const [clubRoundsRes, seasonsRes, lbRes, rulesRes, compsRes] = await Promise.all([
        client.get<ClubRound[]>(`/api/rounds/club-recent?club_id=${clubId}`).catch(() => ({ data: [] as ClubRound[] })),
        client.get<Season[]>(`/api/clubs/${clubId}/seasons`).catch(() => ({ data: [] as Season[] })),
        client.get<LeaderboardData>(`/api/clubs/${clubId}/leaderboard`).catch(() => ({ data: null })),
        client.get<Rule[]>(`/api/clubs/${clubId}/rules`).catch(() => ({ data: [] as Rule[] })),
        client.get<Comp[]>(`/api/competitions?club_id=${clubId}`).catch(() => ({ data: [] as Comp[] })),
      ]);
      setClubRounds(Array.isArray(clubRoundsRes.data) ? clubRoundsRes.data : []);
      setSeasons(Array.isArray(seasonsRes.data) ? seasonsRes.data : []);
      setRules(Array.isArray(rulesRes.data) ? rulesRes.data : []);
      const fetchedComps = Array.isArray(compsRes.data) ? compsRes.data : [];
      setCompetitions(fetchedComps);
      const lbComps = fetchedComps.filter(c => c.status === 'active' || c.status === 'completed');
      if (lbComps.length) {
        const lbResults = await Promise.allSettled(
          lbComps.map(c => client.get<{ format: string; rows: CompLBRow[] }>(`/api/competitions/${c.id}/leaderboard`))
        );
        const lbMap: Record<number, { format: string; rows: CompLBRow[] }> = {};
        lbComps.forEach((c, i) => {
          const r = lbResults[i];
          if (r.status === 'fulfilled') lbMap[c.id] = r.value.data;
        });
        setCompLeaderboards(lbMap);
      }
      if (lbRes.data?.format) {
        setLeaderboard(lbRes.data as LeaderboardData);
        setSettingsFormat(lbRes.data.format.type);
        setSettingsN(String(lbRes.data.format.n));
      }
    } catch { /* stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  const [clubYear, setClubYear] = useState<string>('');

  useEffect(() => {
    client.get<{ created_at: string }>(`/api/clubs/${clubId}`)
      .then(r => {
        if (r.data?.created_at) setClubYear(new Date(r.data.created_at).getFullYear().toString());
      })
      .catch(() => {});
  }, [clubId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  function onRefresh() { setRefreshing(true); fetchAll(); }

  // ── Standings actions ─────────────────────────────────────────────────────

  function selectSeason(id: number | null) {
    setActiveSeason(id);
    fetchLeaderboard(id);
  }

  async function saveSettings() {
    setSettingsError('');
    setSettingsSaving(true);
    try {
      await client.patch(`/api/clubs/${clubId}/settings`, {
        leaderboardFormat: settingsFormat,
        leaderboardN: settingsFormat === 'best_n_scores' ? parseInt(settingsN) || 8 : undefined,
      });
      await fetchLeaderboard(activeSeason);
      setShowSettings(false);
    } catch (e: any) {
      setSettingsError(e.response?.data?.error ?? 'Could not save settings');
    } finally { setSettingsSaving(false); }
  }

  async function createSeason() {
    setSeasonError('');
    if (!newName.trim()) { setSeasonError('Name is required'); return; }
    if (!newStart || !newEnd) { setSeasonError('Please select start and end dates'); return; }
    setSeasonSaving(true);
    try {
      const { data } = await client.post<Season>(`/api/clubs/${clubId}/seasons`, {
        name: newName.trim(), startDate: newStart, endDate: newEnd,
      });
      setSeasons(prev => [data, ...prev]);
      setNewName(''); setNewStart(isoFromDate(new Date())); setNewEnd(isoFromDate(new Date()));
      setShowSeasonForm(false);
      selectSeason(data.id);
    } catch (e: any) {
      setSeasonError(e.response?.data?.error ?? 'Could not create season');
    } finally { setSeasonSaving(false); }
  }

  async function deleteSeason(id: number) {
    Alert.alert('Delete Season', 'Remove this season?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/clubs/${clubId}/seasons/${id}`);
          setSeasons(prev => prev.filter(s => s.id !== id));
          if (activeSeason === id) selectSeason(null);
        } catch { Alert.alert('Error', 'Could not delete season'); }
      }},
    ]);
  }

  function openPlayerScorecard(competitionId: number, player: CompLBRow, format: string) {
    setScorecardModal({ competitionId, player, format });
    setScorecardHoles(player.hole_scores ?? []);
  }

  async function deleteCompetition(id: number, name: string) {
    Alert.alert(
      'Delete Tournament',
      `Delete "${name}"? All entries and scores will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingCompId(id);
          try {
            await client.delete(`/api/competitions/${id}`);
            setCompetitions(prev => prev.filter(c => c.id !== id));
          } catch { Alert.alert('Error', 'Could not delete tournament'); }
          finally { setDeletingCompId(null); }
        }},
      ]
    );
  }

  // ── Rules actions ─────────────────────────────────────────────────────────

  async function addRule() {
    setRuleError('');
    if (!ruleBody.trim()) { setRuleError('Rule text is required'); return; }
    setRuleSaving(true);
    try {
      const { data } = await client.post<Rule>(`/api/clubs/${clubId}/rules`, {
        title: ruleTitle.trim() || undefined,
        body:  ruleBody.trim(),
      });
      setRules(prev => [...prev, data]);
      setRuleTitle(''); setRuleBody(''); setShowRuleForm(false);
    } catch (e: any) {
      setRuleError(e.response?.data?.error ?? 'Could not add rule');
    } finally { setRuleSaving(false); }
  }

  function startEdit(rule: Rule) {
    setEditingId(rule.id);
    setEditTitle(rule.title ?? '');
    setEditBody(rule.body);
    setEditError('');
  }

  async function saveEdit(id: number) {
    setEditError('');
    if (!editBody.trim()) { setEditError('Rule text is required'); return; }
    setEditSaving(true);
    try {
      const { data } = await client.patch<Rule>(`/api/clubs/${clubId}/rules/${id}`, {
        title: editTitle.trim() || null,
        body:  editBody.trim(),
      });
      setRules(prev => prev.map(r => r.id === id ? data : r));
      setEditingId(null);
    } catch (e: any) {
      setEditError(e.response?.data?.error ?? 'Could not save changes');
    } finally { setEditSaving(false); }
  }

  function confirmDeleteRule(id: number) {
    Alert.alert('Delete Rule', 'Remove this rule from the club?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/clubs/${clubId}/rules/${id}`);
          setRules(prev => prev.filter(r => r.id !== id));
          if (editingId === id) setEditingId(null);
        } catch { Alert.alert('Error', 'Could not delete rule'); }
      }},
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }


  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Club Hero ── */}
        <View style={styles.heroCard}>
          <LinearGradient
            colors={[G_DARK, G_MID, G_LIGHT]}
            locations={[0, 0.6, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.heroGradient}
          >
            {/* Decorative glow circle */}
            <View style={styles.heroDecorGlow} pointerEvents="none" />
            {/* Decorative ring */}
            <View style={styles.heroDecorRing} pointerEvents="none" />

            {/* Hamburger — top of card */}
            <TouchableOpacity
              style={styles.heroHamburger}
              activeOpacity={0.7}
              onPress={openDrawer}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="menu" size={22} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>

            {/* Name + code pill side by side */}
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.heroClubName} numberOfLines={2}>{route.params.clubName}</Text>
                {clubYear ? <Text style={styles.heroEst}>EST. {clubYear}</Text> : null}
              </View>
              <TouchableOpacity
                style={styles.heroCodePill}
                activeOpacity={0.8}
                onPress={() => Alert.alert('Invite Code', `Share this code to invite players:\n\n${code}`, [{ text: 'Done' }])}
              >
                <Ionicons name="male-outline" size={13} color="rgba(255,255,255,0.9)" style={{ marginRight: 5 }} />
                <Text style={styles.heroCodeText}>{code}</Text>
              </TouchableOpacity>
            </View>

            {/* Stats strip separator */}
            <View style={styles.heroStatsSep} />

            {/* Stats */}
            <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>{leaderboard?.entries.length ?? 0}</Text>
              <Text style={styles.heroStatLabel}>Members</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>
                {(leaderboard?.entries ?? []).reduce((s, e) => s + (e.rounds_played || 0), 0)}
              </Text>
              <Text style={styles.heroStatLabel}>Rounds</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>{rules.length}</Text>
              <Text style={styles.heroStatLabel}>Rules</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal} numberOfLines={1}>
                {leaderboard?.season?.name ?? String(new Date().getFullYear())}
              </Text>
              <Text style={styles.heroStatLabel}>Season</Text>
            </View>
          </View>
          </LinearGradient>
        </View>

        {/* ── Club Activity card ── */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.sectionCardHeader} onPress={() => toggleSection('activity')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="golf-outline" size={15} color={colors.primary} />
              <Text style={styles.sectionCardTitleText}>Club Activity</Text>
              {!collapsed.activity && <Text style={styles.activitySubLabel}>Last 7 days</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {!collapsed.activity && (
                <TouchableOpacity onPress={() => navigation.navigate('ClubActivity', { clubId, clubName: route.params.clubName, userId })}>
                  <Text style={styles.sectionCardViewAll}>View all ›</Text>
                </TouchableOpacity>
              )}
              <Ionicons name={collapsed.activity ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
          {!collapsed.activity && (
            clubRounds.length === 0 ? (
              <View style={styles.sectionCardEmpty}>
                <Ionicons name="golf-outline" size={32} color="#ccc" />
                <Text style={styles.sectionCardEmptyText}>No rounds played in the last 7 days</Text>
              </View>
            ) : (
              <>
                {clubRounds.slice(0, 3).map((r, i) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.activityRow, i === 0 && { borderTopWidth: 0 }]}
                    activeOpacity={0.75}
                    onPress={() => setScorecardRoundId(r.id)}
                  >
                    <View style={[styles.activityAvatar, { backgroundColor: avatarBg(r.user_id) }]}>
                      <Text style={styles.activityAvatarText}>
                        {personInitials(r.first_name, r.last_name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.activityName} numberOfLines={1}>{personName(r.first_name, r.last_name, r.email)}</Text>
                      <Text style={styles.activityCourse} numberOfLines={1}>
                        {r.course_name}{r.is_nine_hole ? ' · 9 holes' : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
                      <Text style={styles.activityPts}>{r.stableford}</Text>
                      <Text style={styles.activityWhen}>{timeAgo(r.played_at)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.border} />
                  </TouchableOpacity>
                ))}
                {clubRounds.length > 3 && (
                  <TouchableOpacity
                    style={styles.sectionCardViewAllRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('ClubActivity', { clubId, clubName: route.params.clubName, userId })}
                  >
                    <Text style={styles.sectionCardViewAllText}>View all {clubRounds.length} rounds</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </>
            )
          )}
        </View>

        {/* ── Leaderboard card ── */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={[styles.sectionCardHeader, { alignItems: 'flex-start' }]} onPress={() => toggleSection('leaderboard')} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              {!collapsed.leaderboard && (
                <Text style={styles.lbSeasonLabel}>
                  {leaderboard ? `SEASON · ${leaderboard.season.name.toUpperCase()}` : 'SEASON'}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Ionicons name="trophy-outline" size={15} color={colors.primary} />
                <Text style={styles.lbCardTitle}>Leaderboard</Text>
                {isOwner && !collapsed.leaderboard && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation?.(); setShowSettings(v => !v); setSettingsError(''); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showSettings ? 'close-circle-outline' : 'settings-outline'}
                      size={16} color="#bbb"
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {!collapsed.leaderboard && (
                <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); navigation.navigate('Members', { clubId, clubName: route.params.clubName }); }}>
                  <Text style={styles.sectionCardViewAll}>View all ›</Text>
                </TouchableOpacity>
              )}
              <Ionicons name={collapsed.leaderboard ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

        {!collapsed.leaderboard && <>

        {showSettings && (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsHeading}>Leaderboard Format</Text>
            {settingsError ? <Text style={styles.formError}>{settingsError}</Text> : null}
            <View style={styles.formatGrid}>
              {FORMAT_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value}
                  style={[styles.formatBtn, settingsFormat === opt.value && styles.formatBtnActive]}
                  onPress={() => setSettingsFormat(opt.value)} activeOpacity={0.8}>
                  <Text style={[styles.formatBtnLabel, settingsFormat === opt.value && styles.formatBtnLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.formatBtnDesc, settingsFormat === opt.value && styles.formatBtnDescActive]}>
                    {opt.desc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {settingsFormat === 'best_n_scores' && (
              <View style={styles.nRow}>
                <Text style={styles.nLabel}>Scores to count</Text>
                <View style={styles.nStepper}>
                  <TouchableOpacity style={styles.nStepBtn}
                    onPress={() => setSettingsN(v => String(Math.max(1, parseInt(v || '1') - 1)))}>
                    <Ionicons name="remove" size={18} color={colors.primary} />
                  </TouchableOpacity>
                  <TextInput style={styles.nInput} value={settingsN} onChangeText={setSettingsN}
                    keyboardType="number-pad" maxLength={2} />
                  <TouchableOpacity style={styles.nStepBtn}
                    onPress={() => setSettingsN(v => String(Math.min(50, parseInt(v || '0') + 1)))}>
                    <Ionicons name="add" size={18} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <TouchableOpacity style={styles.submitBtn} onPress={saveSettings} disabled={settingsSaving}>
              {settingsSaving ? <ActivityIndicator color="#fff" size="small" />
                              : <Text style={styles.submitBtnText}>Save Settings</Text>}
            </TouchableOpacity>
            <View style={styles.settingsDivider} />
            <View style={styles.seasonMgmtRow}>
              <Text style={styles.settingsHeading}>Manage Seasons</Text>
              <TouchableOpacity style={styles.actionBtn}
                onPress={() => { setShowSeasonForm(v => !v); setSeasonError(''); }}>
                <Ionicons name={showSeasonForm ? 'close' : 'add'} size={15} color={colors.primary} />
                <Text style={styles.actionBtnText}>{showSeasonForm ? 'Cancel' : 'New'}</Text>
              </TouchableOpacity>
            </View>
            {showSeasonForm && (
              <View style={{ gap: 10 }}>
                {seasonError ? <Text style={styles.formError}>{seasonError}</Text> : null}
                <TextInput style={styles.fieldInput} value={newName} onChangeText={setNewName}
                  placeholder="Season name (e.g. Summer 2026)" />
                <View style={styles.dateRow}>
                  <DatePickerField label="Start date" value={newStart} onChange={setNewStart} style={{ flex: 1 }} />
                  <DatePickerField label="End date"   value={newEnd}   onChange={setNewEnd}   style={{ flex: 1 }} />
                </View>
                <TouchableOpacity style={[styles.submitBtn, { marginTop: 0 }]}
                  onPress={createSeason} disabled={seasonSaving}>
                  {seasonSaving ? <ActivityIndicator color="#fff" size="small" />
                                : <Text style={styles.submitBtnText}>Create Season</Text>}
                </TouchableOpacity>
              </View>
            )}
            {seasons.map(s => (
              <View key={s.id} style={styles.seasonRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.seasonName}>{s.name}</Text>
                  <Text style={styles.seasonDates}>{formatSeasonRange(s.start_date, s.end_date)}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteSeason(s.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="trash-outline" size={16} color="#c0392b" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

          <View style={styles.lbTabRow}>
            <TouchableOpacity
              style={[styles.lbTab, activeSeason == null && styles.lbTabActive]}
              onPress={() => selectSeason(null)}
            >
              <Text style={[styles.lbTabText, activeSeason == null && styles.lbTabTextActive]}>Current</Text>
            </TouchableOpacity>
            {seasons.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.lbTab, activeSeason === s.id && styles.lbTabActive]}
                onPress={() => selectSeason(s.id)}
              >
                <Text style={[styles.lbTabText, activeSeason === s.id && styles.lbTabTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

        {lbLoading ? (
          <View style={styles.lbLoading}><ActivityIndicator size="small" color={colors.primary} /></View>
        ) : !leaderboard ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : leaderboard.entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No rounds played yet this season</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.xs }}>

            {/* ── Podium — top 3 side by side ─────────────────────────── */}
            {(() => {
              const top3 = leaderboard.entries.slice(0, 3);
              if (!top3.length) return null;
              const RANK_COLOR: Record<1|2|3, string> = {
                1: colors.gold, 2: colors.silver, 3: colors.bronze,
              };
              const RANK_FLOOR_H: Record<1|2|3, number>    = { 1: 48, 2: 36, 3: 28 };
              const RANK_AVATAR_S: Record<1|2|3, number>   = { 1: 54, 2: 44, 3: 44 };
              const RANK_SCORE_FS: Record<1|2|3, number>   = { 1: 34, 2: 26, 3: 26 };
              const RANK_MIN_H: Record<1|2|3, number>      = { 1: 168, 2: 144, 3: 144 };
              const RANK_CARD_BG: Record<1|2|3, string>    = { 1: '#f7f4ef', 2: colors.surface, 3: colors.surface };
              const RANK_ICON: Record<1|2|3, keyof typeof Ionicons.glyphMap> = {
                1: 'trophy', 2: 'medal-outline', 3: 'ribbon-outline',
              };
              const slots: Array<{ rank: 1|2|3 }> = [
                { rank: 2 }, { rank: 1 }, { rank: 3 },
              ];
              return (
                <View style={styles.podiumStage}>
                  {slots.map(({ rank }) => {
                    const entry = top3.find(e => e.rank === rank);
                    if (!entry) return <View key={rank} style={{ flex: 1 }} />;
                    const isMe = entry.id === userId;
                    const rc   = RANK_COLOR[rank];
                    const avS  = RANK_AVATAR_S[rank];
                    return (
                      <TouchableOpacity
                        key={rank}
                        style={[styles.podiumCard, { backgroundColor: RANK_CARD_BG[rank] }, isMe && { borderWidth: 2, borderColor: rc + '55' }]}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('MemberProfile', { userId: entry.id, name: personName(entry.first_name, entry.last_name, entry.email) })}
                      >
                        <View style={[styles.podiumCardBody, { minHeight: RANK_MIN_H[rank] }]}>
                          <View style={[styles.podiumCardAvatar, { backgroundColor: rc, width: avS, height: avS }]}>
                            <Text style={[styles.podiumCardAvatarText, { fontSize: rank === 1 ? 18 : 15 }]}>
                              {personInitials(entry.first_name, entry.last_name)}
                            </Text>
                          </View>
                          <Text style={styles.podiumCardName} numberOfLines={1}>
                            {personName(entry.first_name, entry.last_name, entry.email)}
                          </Text>
                          {isMe && <Text style={[styles.podiumCardYou, { color: rc }]}>(You)</Text>}
                          <Text style={[styles.podiumCardScore, { color: rc, fontSize: RANK_SCORE_FS[rank], lineHeight: RANK_SCORE_FS[rank] + 6 }]}>
                            {entry.rounds_played > 0 ? scoreDisplay(entry, leaderboard.format.type) : '—'}
                          </Text>
                          <Text style={styles.podiumCardScoreLabel}>
                            {scoreColHeader(leaderboard.format).toLowerCase()}
                          </Text>
                          {entry.handicap != null && (
                            <Text style={styles.podiumCardHcp}>
                              HCP {Number(entry.handicap).toFixed(1)}
                            </Text>
                          )}
                        </View>
                        <View style={[styles.podiumFloor, { backgroundColor: rc, height: RANK_FLOOR_H[rank] }]}>
                          <Ionicons name={RANK_ICON[rank]} size={rank === 1 ? 15 : 12} color="#fff" />
                          <Text style={styles.podiumFloorRank}>#{rank}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}

            {/* Plain rows — 4th place and below, capped at 5 total unless expanded */}
            {(() => {
              const rows = lbShowAll ? leaderboard.entries.slice(3) : leaderboard.entries.slice(3, 5);
              if (!rows.length) return null;
              return (
                <View style={styles.plainRowsContainer}>
                  {rows.map((entry, i) => {
                    const isMe = entry.id === userId;
                    return (
                      <TouchableOpacity
                        key={entry.id}
                        style={[styles.plainRow, i === 0 && { borderTopWidth: 0 }, isMe && styles.plainRowMe]}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate('MemberProfile', { userId: entry.id, name: personName(entry.first_name, entry.last_name, entry.email) })}
                      >
                        <Text style={styles.plainPosText}>{entry.rank}</Text>
                        <View style={[styles.plainAvatar, { backgroundColor: avatarBg(entry.id) }]}>
                          <Text style={styles.plainAvatarText}>
                            {personInitials(entry.first_name, entry.last_name)}
                          </Text>
                        </View>
                        <View style={styles.plainInfo}>
                          <Text style={styles.plainName} numberOfLines={1}>
                            {personName(entry.first_name, entry.last_name, entry.email)}{isMe ? ' (You)' : ''}
                          </Text>
                          {entry.handicap != null && (
                            <Text style={styles.plainHcp}>HCP {Number(entry.handicap).toFixed(1)}</Text>
                          )}
                        </View>
                        <Text style={styles.plainScore}>
                          {entry.rounds_played > 0 ? scoreDisplay(entry, leaderboard.format.type) : '—'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}

            {/* View All / Show Less toggle */}
            {leaderboard.entries.length > 5 && (
              <TouchableOpacity style={styles.lbViewAllBtn} onPress={() => setLbShowAll(v => !v)} activeOpacity={0.7}>
                <Text style={styles.lbViewAllTxt}>
                  {lbShowAll ? 'Show less' : `View all ${leaderboard.entries.length} players`}
                </Text>
                <Ionicons name={lbShowAll ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
              </TouchableOpacity>
            )}

          </View>
        )}
        </>}{/* end !collapsed.leaderboard */}
        </View>{/* end leaderboard card */}

        {/* ── Hall of Fame / Hall of Shame ─────────────────────────────── */}
        <TouchableOpacity
          style={styles.hallCard}
          activeOpacity={0.82}
          onPress={() => navigation.navigate('Hall', { clubId, clubName: route.params.clubName })}
        >
          <View style={styles.hallIconRow}>
            <View style={[styles.hallIcon, { backgroundColor: colors.gold + '22' }]}>
              <Ionicons name="trophy" size={20} color={colors.gold} />
            </View>
            <View style={[styles.hallIcon, { backgroundColor: colors.danger + '18' }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            </View>
          </View>
          <View style={styles.hallLeft}>
            <Text style={styles.hallTitle}>Hall of Fame & Shame</Text>
            <Text style={styles.hallSub}>Records, birdies, eagles, worst holes & more</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* ── Tournaments ───────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.sectionCardHeader} onPress={() => toggleSection('tournaments')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="ribbon-outline" size={15} color={colors.primary} />
              <Text style={styles.sectionCardTitleText}>Tournaments</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {!collapsed.tournaments && isOwner && (
                <TouchableOpacity
                  style={styles.tournCreatePill}
                  activeOpacity={0.8}
                  onPress={(e) => { e.stopPropagation?.(); navigation.navigate('CreateCompetition', { clubId, clubName: route.params.clubName }); }}
                >
                  <Text style={styles.tournCreatePillText}>+ Create</Text>
                </TouchableOpacity>
              )}
              {!collapsed.tournaments && (
                <TouchableOpacity
                  style={styles.tournViewAllPill}
                  activeOpacity={0.7}
                  onPress={(e) => { e.stopPropagation?.(); navigation.navigate('AllTournaments'); }}
                >
                  <Text style={styles.tournViewAllPillText}>View all →</Text>
                </TouchableOpacity>
              )}
              <Ionicons name={collapsed.tournaments ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {!collapsed.tournaments && (competitions.filter(c => c.status !== 'completed').length === 0 ? (
            <View style={styles.sectionCardEmpty}>
              <Ionicons name="trophy-outline" size={32} color="#ccc" />
              <Text style={styles.sectionCardEmptyText}>
                {competitions.some(c => c.status === 'completed')
                  ? 'No active tournaments — tap View all to see results'
                  : isOwner ? 'No tournaments yet — tap Create to add one' : 'No tournaments scheduled'}
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm }}>
            {competitions.filter(c => c.status !== 'completed').map(c => {
            const statusLabel = c.status === 'active' ? '● Live' : c.status === 'completed' ? 'Completed' : 'Upcoming';
            const statusColor = COMP_STATUS_COLOR[c.status] ?? colors.textSecondary;
            const [y, m, d]   = c.date.split('-').map(Number);
            const dateFmt     = new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
            const isDeleting  = deletingCompId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={styles.compCard}
                activeOpacity={0.75}
                onPress={() => navigation.navigate('Competition', { competitionId: c.id, userId })}
              >
                <View style={styles.compCardTop}>
                  <Text style={styles.compName} numberOfLines={1}>{c.name}</Text>
                  <View style={[styles.compStatusBadge, { backgroundColor: statusColor + '18' }]}>
                    <Text style={[styles.compStatusText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </View>
                <Text style={styles.compMeta}>{dateFmt} · {c.course_name}</Text>
                <View style={styles.compCardBottom}>
                  <View style={styles.compFormatPill}>
                    <Text style={styles.compFormatText}>{FORMAT_LABELS[c.format] ?? c.format}</Text>
                    {c.team_size > 1 && <Text style={styles.compTeamTag}> · {c.team_size}P teams</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 }}>
                    <Text style={styles.compEntries}>
                      {c.entry_count} player{c.entry_count !== 1 ? 's' : ''}
                      {c.entered ? ' · Entered' : ''}
                    </Text>
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation?.(); deleteCompetition(c.id, c.name); }}
                      disabled={isDeleting}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {isDeleting
                        ? <ActivityIndicator size="small" color={colors.danger} />
                        : <Ionicons name="trash-outline" size={16} color={colors.danger} />
                      }
                    </TouchableOpacity>
                  </View>
                </View>
                {(() => {
                  const lb = compLeaderboards[c.id];
                  if (!lb?.rows?.length) return null;
                  const topRows = lb.rows.slice(0, 4);
                  const scoreLabel = c.format === 'stroke' ? 'Str' : c.format === 'net_stroke' ? 'Net' : 'Pts';
                  const RANK_COLORS: Record<number, string> = {
                    0: colors.gold, 1: colors.silver, 2: colors.bronze,
                  };
                  return (
                    <View style={styles.compLBSection}>
                      <View style={styles.compLBSectionHeader}>
                        <Ionicons name="list-outline" size={11} color={colors.textSecondary} />
                        <Text style={styles.compLBSectionTitle}>LEADERBOARD</Text>
                        <Text style={styles.compLBSectionScore}>{scoreLabel}</Text>
                      </View>
                      <View style={styles.compLBCards}>
                        {topRows.map((row, idx) => {
                          const rankColor = RANK_COLORS[idx] ?? colors.textSecondary;
                          const thruText  = row.holes_played > 0 ? `Thru ${row.holes_played}` : 'Not started';
                          return (
                            <TouchableOpacity
                              key={row.id}
                              style={styles.compLBCard}
                              activeOpacity={0.72}
                              onPress={() => openPlayerScorecard(c.id, row, lb.format)}
                            >
                              <View style={[styles.compLBRankBadge, { backgroundColor: rankColor + '22' }]}>
                                <Text style={[styles.compLBRankText, { color: rankColor }]}>#{idx + 1}</Text>
                              </View>
                              <View style={styles.compLBAvatar}>
                                <Text style={styles.compLBInitials}>
                                  {personInitials(row.first_name, row.last_name)}
                                </Text>
                              </View>
                              <View style={styles.compLBInfo}>
                                <Text style={styles.compLBPlayerName} numberOfLines={1}>
                                  {personName(row.first_name, row.last_name, row.email)}
                                  {row.id === userId ? ' (You)' : ''}
                                </Text>
                                {row.handicap != null && (
                                  <Text style={styles.compLBMeta}>HCP {Number(row.handicap).toFixed(1)}</Text>
                                )}
                              </View>
                              <View style={styles.compLBScoreWrap}>
                                <Text style={[styles.compLBScore, idx < 3 && { color: rankColor }]}>
                                  {compScoreValue(row, lb.format)}
                                </Text>
                                <Text style={styles.compLBScoreLabel}>
                                  {scoreLabel}{row.holes_played > 0 ? ` · Thru ${row.holes_played}` : ''}
                                </Text>
                              </View>
                              <Ionicons name="chevron-forward" size={14} color={colors.border} />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()}
              </TouchableOpacity>
            );
            })}
            </View>
          ))}
        </View>{/* end tournaments card */}

        {/* ── Club Rules ────────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.sectionCardHeader} onPress={() => toggleSection('rules')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="book-outline" size={15} color={colors.primary} />
              <Text style={styles.sectionCardTitleText}>Club Rules</Text>
              {rules.length > 0 && <Text style={styles.sectionCount}>{rules.length}</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {!collapsed.rules && isOwner && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  activeOpacity={0.8}
                  onPress={(e) => { e.stopPropagation?.(); setShowRuleForm(v => !v); setRuleError(''); }}
                >
                  <Ionicons name={showRuleForm ? 'close' : 'add'} size={15} color={colors.primary} />
                  <Text style={styles.actionBtnText}>{showRuleForm ? 'Cancel' : 'Add Rule'}</Text>
                </TouchableOpacity>
              )}
              <Ionicons name={collapsed.rules ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {!collapsed.rules && showRuleForm && (
            <View style={styles.ruleFormInCard}>
              {ruleError ? <Text style={styles.formError}>{ruleError}</Text> : null}
              <Text style={styles.fieldLabel}>
                Title <Text style={styles.optionalTag}>(optional)</Text>
              </Text>
              <TextInput style={styles.fieldInput} value={ruleTitle} onChangeText={setRuleTitle}
                placeholder="e.g. Dress Code, Pace of Play" maxLength={200} />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Rule</Text>
              <TextInput style={[styles.fieldInput, styles.textArea]} value={ruleBody}
                onChangeText={setRuleBody} placeholder="Describe the rule..."
                multiline numberOfLines={4} textAlignVertical="top" />
              <TouchableOpacity style={styles.submitBtn} onPress={addRule} disabled={ruleSaving}>
                {ruleSaving ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.submitBtnText}>Add Rule</Text>}
              </TouchableOpacity>
            </View>
          )}

          {!collapsed.rules && rules.length === 0 && !showRuleForm ? (
            <View style={styles.sectionCardEmpty}>
              <Ionicons name="book-outline" size={32} color="#ccc" />
              <Text style={styles.sectionCardEmptyText}>
                {isOwner ? 'No rules yet — tap Add Rule to get started' : 'No rules have been set'}
              </Text>
            </View>
          ) : !collapsed.rules ? (
            rules.map((rule, i) => (
              <View key={rule.id} style={[styles.ruleRowInCard, i === 0 && { borderTopWidth: 0 }]}>
                {editingId === rule.id ? (
                  <View style={styles.ruleFormInCard}>
                    {editError ? <Text style={styles.formError}>{editError}</Text> : null}
                    <Text style={styles.fieldLabel}>Title <Text style={styles.optionalTag}>(optional)</Text></Text>
                    <TextInput style={styles.fieldInput} value={editTitle} onChangeText={setEditTitle}
                      placeholder="e.g. Dress Code" maxLength={200} />
                    <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Rule</Text>
                    <TextInput style={[styles.fieldInput, styles.textArea]} value={editBody}
                      onChangeText={setEditBody} multiline numberOfLines={4} textAlignVertical="top" />
                    <View style={styles.editActions}>
                      <TouchableOpacity style={styles.cancelEditBtn}
                        onPress={() => setEditingId(null)} disabled={editSaving}>
                        <Text style={styles.cancelEditText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveEditBtn}
                        onPress={() => saveEdit(rule.id)} disabled={editSaving}>
                        {editSaving ? <ActivityIndicator color="#fff" size="small" />
                                    : <Text style={styles.saveEditText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.ruleRowInner}>
                    <View style={styles.ruleNumberBadge}>
                      <Text style={styles.ruleNumber}>{i + 1}</Text>
                    </View>
                    <View style={styles.ruleContent}>
                      {rule.title ? <Text style={styles.ruleTitle}>{rule.title}</Text> : null}
                      <Text style={styles.ruleBody}>{rule.body}</Text>
                      {isOwner && (
                        <View style={styles.ruleActions}>
                          <TouchableOpacity style={styles.ruleActionBtn} onPress={() => startEdit(rule)}>
                            <Ionicons name="pencil-outline" size={14} color={colors.primary} />
                            <Text style={styles.ruleActionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.ruleActionBtn} onPress={() => confirmDeleteRule(rule.id)}>
                            <Ionicons name="trash-outline" size={14} color="#c0392b" />
                            <Text style={[styles.ruleActionText, { color: colors.danger }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            ))
          ) : null}
        </View>{/* end club rules card */}

      </ScrollView>

      {/* ── Club Activity round scorecard ────────────────────────────── */}
      {scorecardRoundId != null && (
        <ScorecardModal roundId={scorecardRoundId} onClose={() => setScorecardRoundId(null)} />
      )}

      {/* ── Player scorecard modal ────────────────────────────────────── */}
      <Modal
        visible={scorecardModal != null}
        transparent
        animationType="slide"
        onRequestClose={() => setScorecardModal(null)}
      >
        <View style={styles.scOverlay}>
          <View style={styles.scSheet}>
            <View style={styles.scHandle} />

            <View style={styles.scHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.scName}>
                  {scorecardModal
                    ? personName(scorecardModal.player.first_name, scorecardModal.player.last_name, scorecardModal.player.email)
                    : ''}
                </Text>
                <Text style={styles.scSub}>
                  {scorecardModal ? (FORMAT_LABELS[scorecardModal.format] ?? scorecardModal.format) : ''}
                  {scorecardModal && scorecardModal.player.holes_played > 0
                    ? ` · Thru ${scorecardModal.player.holes_played}`
                    : ''}
                  {scorecardModal?.player.handicap != null
                    ? ` · HCP ${Number(scorecardModal.player.handicap).toFixed(1)}`
                    : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setScorecardModal(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {scorecardLoading ? (
              <View style={styles.scLoadingWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : scorecardHoles.length === 0 ? (
              <View style={styles.scEmptyWrap}>
                <Ionicons name="golf-outline" size={40} color="#ddd" />
                <Text style={styles.scEmptyText}>No holes scored yet</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {/* Table header */}
                <View style={styles.scTableHead}>
                  <Text style={[styles.scColHole, styles.scHeadText]}>HOLE</Text>
                  <Text style={[styles.scColScore, styles.scHeadText]}>SCORE</Text>
                  {scorecardModal?.format === 'stableford' && (
                    <Text style={[styles.scColPts, styles.scHeadText]}>PTS</Text>
                  )}
                </View>
                {scorecardHoles.map(h => (
                  <View key={h.hole_number} style={styles.scTableRow}>
                    <Text style={[styles.scColHole, styles.scHoleNum]}>{h.hole_number}</Text>
                    <Text style={[styles.scColScore, styles.scHoleScore]}>{h.score}</Text>
                    {scorecardModal?.format === 'stableford' && (
                      <Text style={[styles.scColPts, styles.scHolePts]}>{h.stableford_points}</Text>
                    )}
                  </View>
                ))}
                {/* Totals */}
                <View style={styles.scTotalsRow}>
                  <Text style={[styles.scColHole, styles.scTotalLabel]}>TOTAL</Text>
                  <Text style={[styles.scColScore, styles.scTotalVal]}>
                    {scorecardHoles.reduce((s, h) => s + h.score, 0)}
                  </Text>
                  {scorecardModal?.format === 'stableford' && (
                    <Text style={[styles.scColPts, styles.scTotalVal]}>
                      {scorecardHoles.reduce((s, h) => s + h.stableford_points, 0)}
                    </Text>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#f7f5f1' },
  content:  { padding: spacing.md, gap: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f7f5f1' },

  headerCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg,
    alignItems: 'center', marginBottom: spacing.lg, ...shadows.card,
  },
  headerIconWrap: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.primary + '12',
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm,
  },
  headerBadges:   { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  countBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceMuted, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  countText:      { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  ownerBadge:     { backgroundColor: colors.primary + '12', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  ownerBadgeText: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  codePill:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  codeLabel:      { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, marginRight: 8 },
  codeValue:      { fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: 2 },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  sectionCount: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, backgroundColor: colors.surfaceMuted, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  actionBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  formCard:    { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: 12, ...shadows.card },
  formError:   { color: colors.danger, fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel:  { fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  optionalTag: { fontWeight: '400', color: colors.border, textTransform: 'none', letterSpacing: 0 },
  fieldInput:  { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.textPrimary, backgroundColor: colors.surfaceMuted },
  dateTrigger:           { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateTriggerText:       { fontSize: 14, color: colors.textPrimary },
  dateTriggerPlaceholder:{ fontSize: 14, color: colors.textSecondary },
  textArea:    { height: 100, paddingTop: 11 },
  submitBtn:   { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  submitBtnText: { color: colors.textInverse, fontWeight: '600', fontSize: 15 },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg + 4, alignItems: 'center' },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },



  settingsCard:    { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: 12, ...shadows.card, gap: 12 },
  settingsHeading: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  formatGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formatBtn:       { flex: 1, minWidth: '45%', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: 12 },
  formatBtnActive:      { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  formatBtnLabel:       { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 3 },
  formatBtnLabelActive: { color: colors.primary },
  formatBtnDesc:        { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
  formatBtnDescActive:  { color: colors.primaryLight },
  nRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nLabel:   { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  nStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nStepBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  nInput:   { width: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 10, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.textPrimary, paddingVertical: 6 },
  settingsDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  seasonMgmtRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateRow:         { flexDirection: 'row', gap: 10 },
  seasonRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  seasonName:  { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  seasonDates: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  seasonChipsRow:       { marginBottom: 12, flexDirection: 'row' },
  seasonChip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, marginRight: 8, backgroundColor: colors.surfaceMuted },
  seasonChipActive:     { backgroundColor: colors.primary },
  seasonChipText:       { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  seasonChipTextActive: { color: colors.textInverse },

  lbCard:            { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadows.card },
  lbSeasonHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceMuted },
  lbSeasonName:      { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  lbSeasonDates:     { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  lbFormatBadge:     { backgroundColor: colors.primary + '12', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  lbFormatBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  lbHeaderRow:       { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: colors.border },
  lbHeaderText:      { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8 },
  lbRow:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12 },
  lbRowBorder:       { borderBottomWidth: 1, borderBottomColor: colors.border },
  lbMyRow:           { backgroundColor: colors.primary + '12' },
  lbCell:            { justifyContent: 'center' },
  lbRankCell:        { width: 32, alignItems: 'center' },
  lbNameCell:        { flex: 1, marginHorizontal: 4 },
  lbNumCell:         { width: 52, alignItems: 'center' },
  lbRankText:        { fontSize: 14, fontWeight: '700', color: colors.border },
  lbAvatar:          { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  lbAvatarMe:        { backgroundColor: colors.primary },
  lbAvatarText:      { color: colors.textInverse, fontSize: 12, fontWeight: '700' },
  lbPlayerName:      { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  lbMyText:          { color: colors.primary },
  lbHcp:             { fontSize: 11, color: colors.textSecondary },
  lbNumText:         { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  lbScoreText:       { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  lbLoading:         { paddingVertical: 20, alignItems: 'center' },
  lbEmpty:           { paddingVertical: 20, alignItems: 'center' },

  rosterCard:           { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadows.card },
  memberRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  memberRowBorder:      { borderBottomWidth: 1, borderBottomColor: colors.border },
  memberRank:           { fontSize: 13, fontWeight: '700', color: colors.border, width: 20, textAlign: 'center' },
  memberAvatar:         { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  memberAvatarOwner:    { backgroundColor: colors.primary },
  memberAvatarText:     { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  memberInfo:           { flex: 1 },
  memberNameRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName:           { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  memberOwnerBadge:     { backgroundColor: colors.primary + '12', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  memberOwnerBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  memberMeta:           { fontSize: 12, color: colors.textSecondary },
  memberHcp:            { alignItems: 'center' },
  memberHcpValue:       { fontSize: 18, fontWeight: '800', color: colors.primary },
  memberHcpLabel:       { fontSize: 10, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

  compCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  compCardTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xs },
  compName:       { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  compMeta:       { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  compStatusBadge:{ borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, flexShrink: 0 },
  compStatusText: { fontSize: fontSize.xs, fontWeight: '700' },
  compCardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compFormatPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  compFormatText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  compTeamTag:    { fontSize: fontSize.xs, color: colors.textSecondary },
  compEntries:    { fontSize: fontSize.sm, color: colors.textSecondary },

  // ── Tournament pill buttons ───────────────────────────────────────────────
  tournCreatePill: {
    backgroundColor: G_DARK,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  tournCreatePillText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#fff',
  },
  tournViewAllPill: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: 'transparent',
  },
  tournViewAllPillText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },

  // ── Rules inside sectionCard ──────────────────────────────────────────────
  ruleRowInCard: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  ruleRowInner: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  ruleFormInCard: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: 0,
  },
  ruleNumberBadge:{ width: 28, height: 28, borderRadius: 14, backgroundColor: G_DARK, justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1 },
  ruleNumber:     { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  ruleContent:    { flex: 1 },
  ruleTitle:      { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  ruleBody:       { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
  ruleActions:    { flexDirection: 'row', gap: 16, marginTop: 12 },
  ruleActionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ruleActionText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  editActions:    { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelEditBtn:  { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  cancelEditText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  saveEditBtn:    { flex: 2, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  saveEditText:   { fontSize: 14, fontWeight: '600', color: colors.textInverse },

  // ── Inline competition leaderboard ───────────────────────────────────────────
  compLBSection: {
    marginTop: spacing.sm + 2,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  compLBSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.sm,
  },
  compLBSectionTitle: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.1,
  },
  compLBSectionScore: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  compLBCards: {
    gap: spacing.xs,
  },
  compLBCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  compLBRankBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  compLBRankText: {
    fontSize: 11,
    fontWeight: '800',
  },
  compLBAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  compLBInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  compLBInfo: {
    flex: 1,
  },
  compLBPlayerName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  compLBMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  compLBScoreWrap: {
    alignItems: 'flex-end',
    marginRight: 2,
  },
  compLBScore: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  compLBScoreLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Scorecard modal ───────────────────────────────────────────────────────────
  scOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  scSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg + 16,
    maxHeight: '78%',
  },
  scHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  scHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  scName: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 3,
  },
  scSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  scLoadingWrap: {
    paddingVertical: 52,
    alignItems: 'center',
  },
  scEmptyWrap: {
    paddingVertical: 44,
    alignItems: 'center',
    gap: spacing.sm,
  },
  scEmptyText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  scTableHead: {
    flexDirection: 'row',
    paddingVertical: spacing.xs + 1,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    marginBottom: 2,
  },
  scTableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '55',
  },
  scTotalsRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  scHeadText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  scColHole:  { width: 56 },
  scColScore: { flex: 1 },
  scColPts:   { width: 60, textAlign: 'right' },
  scHoleNum: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scHoleScore: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  scHolePts: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'right',
  },
  scTotalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    alignSelf: 'center',
  },
  scTotalVal: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  onOffBtns:      { flexDirection: 'row', borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden' },
  onOffBtn:       { paddingHorizontal: 16, paddingVertical: 8 },
  onOffBtnActive: { backgroundColor: colors.primary },
  onOffBtnText:   { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  onOffBtnTextActive: { color: colors.textInverse },

  hallCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, ...shadows.card,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.07)',
  },
  hallIconRow: { flexDirection: 'row', gap: spacing.sm, flexShrink: 0 },
  hallIcon:    { width: 40, height: 40, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  hallLeft:    { flex: 1 },
  hallTitle:   { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  hallSub:     { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },

  // ── Unified section cards ─────────────────────────────────────────────────
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.07)',
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 14,
    borderRadius: 14,
  },
  sectionCardTitleText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  sectionCardViewAll: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  sectionCardEmpty: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  sectionCardEmptyText: {
    fontSize: 13,
    color: '#ccc',
    textAlign: 'center',
  },
  sectionCardViewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  sectionCardViewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // ── Club Activity rows ────────────────────────────────────────────────────
  activitySubLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.07)',
  },
  activityAvatar: {
    width: 40, height: 40,
    borderRadius: radius.full,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  activityAvatarText: { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },
  activityName:   { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  activityCourse: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  activityPts:    { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  activityWhen:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  // ── Leaderboard card header ───────────────────────────────────────────────
  lbCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  lbTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  lbTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f5f2ed',
  },
  lbTabActive: {
    backgroundColor: colors.primary,
  },
  lbTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  lbTabTextActive: {
    color: colors.textInverse,
  },

  // ── Club Hero ────────────────────────────────────────────────────────────
  heroCard: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.card,
  },
  heroGradient: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  heroDecorGlow: {
    position: 'absolute',
    width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -80, left: -40,
  },
  heroDecorRing: {
    position: 'absolute',
    bottom: -20, right: -20,
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 24, borderColor: 'rgba(255,255,255,0.04)',
  },
  heroHamburger: {
    alignSelf: 'flex-start',
    padding: 4,
    marginBottom: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroClubName: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.textInverse,
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  heroEst: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '600',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  heroCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.50)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  heroCodeText: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.textInverse,
    letterSpacing: 1.4,
  },
  heroStatsSep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: -spacing.md,
    marginTop: spacing.md,
    marginBottom: 0,
  },
  heroStats: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
  },
  heroStatVal: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  heroStatLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 3,
    textAlign: 'center',
  },

  // ── Legacy header (kept for safe reference) ──────────────────────────────
  header: {
    flexDirection: 'column',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerHamburger: {
    alignSelf: 'flex-start',
    padding: 4,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  clubName: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 28,
  },
  clubEst: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: '500',
    marginTop: spacing.xs,
    letterSpacing: 0.4,
  },
  headerCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  headerCodeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textInverse,
    letterSpacing: 1.2,
  },

  // ── New leaderboard section header ────────────────────────────────────────
  lbSectionHeader: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  lbSeasonLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  lbTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lbTitleText: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  lbViewAll: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },

  // ── Podium — top 3 vertical cards side by side ───────────────────────────
  podiumStage: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },

  podiumCard: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  podiumCardBody: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.xs,
    width: '100%',
    justifyContent: 'center',
  },

  // Solid podium floor (bottom of card)
  podiumFloor: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  podiumFloorRank: {
    fontSize: 12, fontWeight: '800', color: colors.textInverse,
  },

  // Avatar — solid rank-colour fill
  podiumCardAvatar: {
    width: 44, height: 44, borderRadius: radius.full,
    justifyContent: 'center', alignItems: 'center',
  },
  podiumCardAvatarText: { fontSize: fontSize.base, fontWeight: '700', color: '#fff' },

  // Text
  podiumCardName: {
    fontSize: 11, fontWeight: '700', color: colors.textPrimary,
    textAlign: 'center', lineHeight: 15,
    paddingHorizontal: 4,
  },
  podiumCardYou: {
    fontSize: 10, fontWeight: '700', textAlign: 'center',
  },
  podiumCardScore: {
    fontWeight: '800', textAlign: 'center',
  },
  podiumCardScoreLabel: {
    fontSize: 10, fontWeight: '500', color: colors.textSecondary, textAlign: 'center',
  },
  podiumCardHcp: {
    fontSize: 10, color: colors.textSecondary, textAlign: 'center',
  },

  // ── Plain rows (4th+) ─────────────────────────────────────────────────────
  plainRowsContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  plainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.07)',
  },
  plainRowMe: { backgroundColor: '#f5f2eb' },

  plainPosText: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textSecondary,
    width: 20,
    textAlign: 'center',
  },

  plainAvatar: {
    width: 40, height: 40,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  plainAvatarText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#fff',
  },

  plainInfo:  { flex: 1 },
  plainName:  { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  plainHcp:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  plainScore: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },

  lbViewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 14, marginTop: 4 },
  lbViewAllTxt: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },

});
