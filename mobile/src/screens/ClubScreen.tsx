import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, RefreshControl,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DatePickerField from '../components/DatePickerField';
import { useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Notice = {
  id: number; title: string; body: string; created_at: string;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type Member = {
  id: string; first_name: string | null; last_name: string | null;
  email: string; handicap: number | null; role: string;
  joined_at: string; rounds_played: number;
};

type Season = { id: number; name: string; start_date: string; end_date: string };

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
function scoreDisplay(entry: LBEntry, format: string) {
  return format === 'average' ? Number(entry.score_value).toFixed(1) : String(Number(entry.score_value));
}
function scoreColHeader(format: LeaderboardData['format']) {
  if (format.type === 'total_points')  return 'Total Pts';
  if (format.type === 'best_n_scores') return `Best ${format.n}`;
  if (format.type === 'average')       return 'Average';
  return 'Best';
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClubScreen({ navigation, route }: Props) {
  const { clubId, role, code, userId } = route.params;
  const insets  = useSafeAreaInsets();
  const isOwner = role === 'owner';
  const isAdminOrOwner = role === 'owner' || role === 'admin';

  useEffect(() => {
    if (!isAdminOrOwner) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('ClubAdmin', {
            clubId, clubName: route.params.clubName, role, userId,
          })}
          style={{ paddingRight: 4 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="settings-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, isAdminOrOwner, clubId, role, userId]);

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Feed
  const [notices,   setNotices]   = useState<Notice[]>([]);
  const [showForm,  setShowForm]  = useState(false);
  const [nTitle,    setNTitle]    = useState('');
  const [nBody,     setNBody]     = useState('');
  const [nError,    setNError]    = useState('');
  const [nSaving,   setNSaving]   = useState(false);

  // Leaderboard
  const [leaderboard,  setLeaderboard]  = useState<LeaderboardData | null>(null);
  const [seasons,      setSeasons]      = useState<Season[]>([]);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [lbLoading,    setLbLoading]    = useState(false);
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

  // Roster
  const [members, setMembers] = useState<Member[]>([]);

  // Competitions
  const [competitions,   setCompetitions]   = useState<Comp[]>([]);
  const [deletingCompId, setDeletingCompId] = useState<number | null>(null);

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
      const [noticesRes, membersRes, seasonsRes, lbRes, rulesRes, compsRes] = await Promise.all([
        client.get<Notice[]>(`/api/notices?club_id=${clubId}`).catch(() => ({ data: [] as Notice[] })),
        client.get<Member[]>(`/api/clubs/${clubId}/members`).catch(() => ({ data: [] as Member[] })),
        client.get<Season[]>(`/api/clubs/${clubId}/seasons`).catch(() => ({ data: [] as Season[] })),
        client.get<LeaderboardData>(`/api/clubs/${clubId}/leaderboard`).catch(() => ({ data: null })),
        client.get<Rule[]>(`/api/clubs/${clubId}/rules`).catch(() => ({ data: [] as Rule[] })),
        client.get<Comp[]>(`/api/competitions?club_id=${clubId}`).catch(() => ({ data: [] as Comp[] })),
      ]);
      setNotices(Array.isArray(noticesRes.data) ? noticesRes.data : []);
      setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      setSeasons(Array.isArray(seasonsRes.data) ? seasonsRes.data : []);
      setRules(Array.isArray(rulesRes.data) ? rulesRes.data : []);
      setCompetitions(Array.isArray(compsRes.data) ? compsRes.data : []);
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

  // ── Notice actions ────────────────────────────────────────────────────────

  async function postNotice() {
    setNError('');
    if (!nTitle.trim()) { setNError('Title is required'); return; }
    if (!nBody.trim())  { setNError('Message is required'); return; }
    setNSaving(true);
    try {
      const { data } = await client.post<Notice>('/api/notices', {
        title: nTitle.trim(), body: nBody.trim(), clubId,
      });
      setNotices(prev => [data, ...prev]);
      setNTitle(''); setNBody(''); setShowForm(false);
    } catch (e: any) {
      setNError(e.response?.data?.error ?? 'Could not post notice');
    } finally { setNSaving(false); }
  }

  function confirmDeleteNotice(id: number) {
    Alert.alert('Delete Notice', 'Remove this notice from the board?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/notices/${id}`);
          setNotices(prev => prev.filter(n => n.id !== id));
        } catch { Alert.alert('Error', 'Could not delete notice'); }
      }},
    ]);
  }

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

  const roster = [...members].sort((a, b) => {
    if (a.handicap == null && b.handicap == null) return 0;
    if (a.handicap == null) return 1;
    if (b.handicap == null) return -1;
    return Number(a.handicap) - Number(b.handicap);
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Club header ── */}
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.clubName} numberOfLines={1}>{route.params.clubName}</Text>
            {clubYear ? <Text style={styles.clubEst}>EST. {clubYear}</Text> : null}
          </View>
          <TouchableOpacity
            style={styles.headerCodePill}
            activeOpacity={0.8}
            onPress={() => Alert.alert('Invite Code', `Share this code to invite players:\n\n${code}`, [{ text: 'Done' }])}
          >
            <Ionicons name="key-outline" size={11} color={colors.textInverse} style={{ marginRight: spacing.xs - 2 }} />
            <Text style={styles.headerCodeText}>{code}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Notice board ─────────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLeft}>
            <Ionicons name="megaphone-outline" size={15} color={colors.primary} />
            <Text style={styles.sectionTitle}>Notice Board</Text>
            {notices.length > 0 && <Text style={styles.sectionCount}>{notices.length}</Text>}
          </View>
          {isOwner && (
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.8}
              onPress={() => { setShowForm(v => !v); setNError(''); }}>
              <Ionicons name={showForm ? 'close' : 'add'} size={15} color={colors.primary} />
              <Text style={styles.actionBtnText}>{showForm ? 'Cancel' : 'Post'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {showForm && (
          <View style={styles.formCard}>
            {nError ? <Text style={styles.formError}>{nError}</Text> : null}
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput style={styles.fieldInput} value={nTitle} onChangeText={setNTitle}
              placeholder="e.g. Weekend competition" maxLength={200} />
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Message</Text>
            <TextInput style={[styles.fieldInput, styles.textArea]} value={nBody}
              onChangeText={setNBody} placeholder="Write your announcement here..."
              multiline numberOfLines={4} textAlignVertical="top" />
            <TouchableOpacity style={styles.submitBtn} onPress={postNotice} disabled={nSaving}>
              {nSaving ? <ActivityIndicator color="#fff" size="small" />
                       : <Text style={styles.submitBtnText}>Post Notice</Text>}
            </TouchableOpacity>
          </View>
        )}

        {notices.length === 0 && !showForm ? (
          <View style={styles.emptyCard}>
            <Ionicons name="megaphone-outline" size={32} color="#ddd" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>
              {isOwner ? 'No notices yet — tap Post to add one' : 'No notices yet'}
            </Text>
          </View>
        ) : (
          notices.map(n => (
            <View key={n.id} style={styles.noticeCard}>
              <View style={styles.noticeHeader}>
                <Text style={styles.noticeTitle}>{n.title}</Text>
                {isOwner && (
                  <TouchableOpacity onPress={() => confirmDeleteNotice(n.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={16} color="#c0392b" />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.noticeBody}>{n.body}</Text>
              <View style={styles.noticeMeta}>
                <Ionicons name="person-outline" size={11} color="#aaa" />
                <Text style={styles.noticeMetaText}>{personName(n.first_name, n.last_name, n.email)}</Text>
                <Text style={styles.noticeDot}>·</Text>
                <Text style={styles.noticeMetaText}>{formatDate(n.created_at)}</Text>
              </View>
            </View>
          ))
        )}

        {/* ── Season leaderboard ── */}
        <View style={styles.lbSectionHeader}>
          <Text style={styles.lbSeasonLabel}>
            {leaderboard ? `SEASON · ${leaderboard.season.name.toUpperCase()}` : 'SEASON'}
          </Text>
          <View style={styles.lbTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={styles.lbTitleText}>Leaderboard</Text>
              {isOwner && (
                <TouchableOpacity
                  onPress={() => { setShowSettings(v => !v); setSettingsError(''); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showSettings ? 'close-circle-outline' : 'settings-outline'}
                    size={18} color={colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.lbViewAll}>View all →</Text>
          </View>
        </View>

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

        {seasons.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonChipsRow}>
            <TouchableOpacity
              style={[styles.seasonChip, activeSeason == null && styles.seasonChipActive]}
              onPress={() => selectSeason(null)}>
              <Text style={[styles.seasonChipText, activeSeason == null && styles.seasonChipTextActive]}>Current</Text>
            </TouchableOpacity>
            {seasons.map(s => (
              <TouchableOpacity key={s.id}
                style={[styles.seasonChip, activeSeason === s.id && styles.seasonChipActive]}
                onPress={() => selectSeason(s.id)}>
                <Text style={[styles.seasonChipText, activeSeason === s.id && styles.seasonChipTextActive]}>
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

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
              // Render order: 2nd left · 1st centre · 3rd right
              const slots: Array<{ rank: 1|2|3; marginTop: number }> = [
                { rank: 2, marginTop: 20 },
                { rank: 1, marginTop: 0  },
                { rank: 3, marginTop: 35 },
              ];
              return (
                <View style={styles.podiumStage}>
                  {slots.map(({ rank, marginTop }) => {
                    const entry = top3.find(e => e.rank === rank);
                    if (!entry) return <View key={rank} style={{ flex: 1 }} />;
                    const isMe   = entry.id === userId;
                    const isLight = rank === 2; // cream card — needs dark text
                    return (
                      <View
                        key={rank}
                        style={[
                          styles.podiumCard,
                          rank === 1 ? styles.podiumCard1
                            : rank === 2 ? styles.podiumCard2
                            : styles.podiumCard3,
                          { marginTop },
                          isMe && styles.podiumCardMe,
                        ]}
                      >
                        {/* Position badge */}
                        <View style={[
                          styles.podiumBadge,
                          rank === 1 ? styles.podiumBadge1
                            : rank === 2 ? styles.podiumBadge2
                            : styles.podiumBadge3,
                        ]}>
                          <Text style={styles.podiumBadgeText}>{rank}</Text>
                        </View>

                        {/* Avatar */}
                        <View style={[styles.podiumCardAvatar, isLight && styles.podiumCardAvatarLight]}>
                          <Text style={[styles.podiumCardAvatarText, isLight && styles.podiumCardAvatarTextDark]}>
                            {personInitials(entry.first_name, entry.last_name)}
                          </Text>
                        </View>

                        {/* Name */}
                        <Text style={[styles.podiumCardName, isLight && styles.podiumCardTextDark]} numberOfLines={2}>
                          {personName(entry.first_name, entry.last_name, entry.email)}
                          {isMe ? '\n(You)' : ''}
                        </Text>

                        {/* Score */}
                        <Text style={[styles.podiumCardScore, isLight && styles.podiumCardTextDark]}>
                          {entry.rounds_played > 0 ? scoreDisplay(entry, leaderboard.format.type) : '—'}
                        </Text>

                        {/* HCP pushed to bottom */}
                        <View style={{ flex: 1 }} />
                        {entry.handicap != null && (
                          <Text style={[styles.podiumCardHcp, isLight && styles.podiumCardHcpDark]}>
                            HCP {Number(entry.handicap).toFixed(1)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })()}

            {/* Plain rows — 4th place and below */}
            {leaderboard.entries.slice(3).map(entry => {
              const isMe = entry.id === userId;
              return (
                <View key={entry.id} style={[styles.plainRow, isMe && styles.plainRowMe]}>
                  <View style={styles.plainPosBadge}>
                    <Text style={styles.plainPosText}>{entry.rank}</Text>
                  </View>
                  <View style={styles.plainAvatar}>
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
                </View>
              );
            })}

          </View>
        )}

        {/* ── Hall of Fame / Hall of Shame ─────────────────────────────── */}
        <TouchableOpacity
          style={styles.hallCard}
          activeOpacity={0.82}
          onPress={() => navigation.navigate('Hall', { clubId, clubName: route.params.clubName })}
        >
          <View style={styles.hallLeft}>
            <View style={styles.hallIconRow}>
              <View style={[styles.hallIcon, { backgroundColor: colors.gold + '22' }]}>
                <Ionicons name="trophy" size={20} color={colors.gold} />
              </View>
              <View style={[styles.hallIcon, { backgroundColor: colors.danger + '18' }]}>
                <Ionicons name="skull-outline" size={20} color={colors.danger} />
              </View>
            </View>
            <Text style={styles.hallTitle}>Hall of Fame & Shame</Text>
            <Text style={styles.hallSub}>Records, birdies, eagles, worst holes & more</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* ── Club roster ──────────────────────────────────────────────── */}
        <View style={[styles.sectionRow, { marginTop: 28 }]}>
          <View style={styles.sectionLeft}>
            <Ionicons name="people-outline" size={15} color={colors.primary} />
            <Text style={styles.sectionTitle}>Club Roster</Text>
            <Text style={styles.sectionCount}>{roster.length}</Text>
          </View>
        </View>

        <View style={styles.rosterCard}>
          {roster.map((m, i) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberRow, i < roster.length - 1 && styles.memberRowBorder]}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('MemberProfile', {
                userId: m.id,
                name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email,
              })}
            >
              <Text style={styles.memberRank}>{i + 1}</Text>
              <View style={[styles.memberAvatar, m.role === 'owner' && styles.memberAvatarOwner]}>
                <Text style={styles.memberAvatarText}>{personInitials(m.first_name, m.last_name)}</Text>
              </View>
              <View style={styles.memberInfo}>
                <View style={styles.memberNameRow}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {personName(m.first_name, m.last_name, m.email)}
                  </Text>
                  {m.role === 'owner' && (
                    <View style={styles.memberOwnerBadge}>
                      <Text style={styles.memberOwnerBadgeText}>Owner</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.memberMeta}>
                  {m.rounds_played} round{m.rounds_played !== 1 ? 's' : ''} played
                </Text>
              </View>
              <View style={styles.memberHcp}>
                <Text style={styles.memberHcpValue}>
                  {m.handicap != null ? Number(m.handicap).toFixed(1) : '—'}
                </Text>
                <Text style={styles.memberHcpLabel}>HCP</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tournaments ───────────────────────────────────────────────── */}
        <View style={styles.tournSectionHeader}>
          <Text style={styles.lbSeasonLabel}>TOURNAMENTS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {isOwner && (
              <TouchableOpacity
                style={styles.tournCreateBtn}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('CreateCompetition', {
                  clubId, clubName: route.params.clubName,
                })}
              >
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={styles.tournCreateText}>Create</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate('AllTournaments')}
            >
              <Text style={styles.lbViewAll}>View all →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {competitions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="trophy-outline" size={32} color="#ddd" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>
              {isOwner ? 'No tournaments yet — tap Create to add one' : 'No tournaments scheduled'}
            </Text>
          </View>
        ) : (
          competitions.map(c => {
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
              </TouchableOpacity>
            );
          })
        )}

        {/* ── Club rules ───────────────────────────────────────────────── */}
        <View style={[styles.sectionRow, { marginTop: 28 }]}>
          <View style={styles.sectionLeft}>
            <Ionicons name="book-outline" size={15} color={colors.primary} />
            <Text style={styles.sectionTitle}>Club Rules</Text>
            {rules.length > 0 && <Text style={styles.sectionCount}>{rules.length}</Text>}
          </View>
          {isOwner && (
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.8}
              onPress={() => { setShowRuleForm(v => !v); setRuleError(''); }}>
              <Ionicons name={showRuleForm ? 'close' : 'add'} size={15} color={colors.primary} />
              <Text style={styles.actionBtnText}>{showRuleForm ? 'Cancel' : 'Add Rule'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {showRuleForm && (
          <View style={styles.formCard}>
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

        {rules.length === 0 && !showRuleForm ? (
          <View style={styles.emptyCard}>
            <Ionicons name="book-outline" size={32} color="#ddd" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>
              {isOwner ? 'No rules yet — tap Add Rule to get started' : 'No rules have been set'}
            </Text>
          </View>
        ) : (
          rules.map((rule, i) => (
            <View key={rule.id}>
              {editingId === rule.id ? (
                <View style={[styles.ruleEditCard, i < rules.length - 1 && { marginBottom: 10 }]}>
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
                <View style={[styles.ruleCard, i < rules.length - 1 && { marginBottom: 10 }]}>
                  <View style={styles.ruleNumberCol}>
                    <View style={styles.ruleNumberBadge}>
                      <Text style={styles.ruleNumber}>{i + 1}</Text>
                    </View>
                    {i < rules.length - 1 && <View style={styles.ruleLine} />}
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
                          <Text style={[styles.ruleActionText, { color: '#c0392b' }]}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          ))
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.background },
  content:  { padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  headerCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
  },
  headerIconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary + '12',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  headerBadges:   { flexDirection: 'row', gap: 8, marginBottom: 16 },
  countBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f3f4f6', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  countText:      { fontSize: 12, color: '#555', fontWeight: '500' },
  ownerBadge:     { backgroundColor: colors.primary + '12', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  ownerBadgeText: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  codePill:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#e5e5e5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  codeLabel:      { fontSize: 10, fontWeight: '700', color: '#aaa', letterSpacing: 1, marginRight: 8 },
  codeValue:      { fontSize: 18, fontWeight: '800', color: '#111', letterSpacing: 2 },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  sectionCount: { fontSize: 12, fontWeight: '600', color: '#aaa', backgroundColor: '#f3f4f6', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  actionBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  formCard:    { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  formError:   { color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel:  { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  optionalTag: { fontWeight: '400', color: '#bbb', textTransform: 'none', letterSpacing: 0 },
  fieldInput:  { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#111', backgroundColor: '#fafafa' },
  dateTrigger:           { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#fafafa', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateTriggerText:       { fontSize: 14, color: '#111' },
  dateTriggerPlaceholder:{ fontSize: 14, color: '#bbb' },
  textArea:    { height: 100, paddingTop: 11 },
  submitBtn:   { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  submitBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg + 4, alignItems: 'center' },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  noticeCard:     { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  noticeHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  noticeTitle:    { fontSize: 15, fontWeight: '700', color: '#111', flex: 1, marginRight: 12 },
  noticeBody:     { fontSize: 14, color: '#444', lineHeight: 20, marginBottom: 10 },
  noticeMeta:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noticeMetaText: { fontSize: 12, color: '#aaa' },
  noticeDot:      { fontSize: 12, color: '#ccc' },

  settingsCard:    { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, gap: 12 },
  settingsHeading: { fontSize: 13, fontWeight: '700', color: '#111' },
  formatGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formatBtn:       { flex: 1, minWidth: '45%', borderWidth: 1.5, borderColor: '#e5e5e5', borderRadius: 12, padding: 12 },
  formatBtnActive:      { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  formatBtnLabel:       { fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 3 },
  formatBtnLabelActive: { color: colors.primary },
  formatBtnDesc:        { fontSize: 11, color: '#aaa', lineHeight: 15 },
  formatBtnDescActive:  { color: '#4ade80' },
  nRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nLabel:   { fontSize: 14, color: '#111', fontWeight: '500' },
  nStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nStepBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  nInput:   { width: 52, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#111', paddingVertical: 6 },
  settingsDivider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 4 },
  seasonMgmtRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateRow:         { flexDirection: 'row', gap: 10 },
  seasonRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  seasonName:  { fontSize: 14, fontWeight: '600', color: '#111' },
  seasonDates: { fontSize: 12, color: '#aaa', marginTop: 1 },

  seasonChipsRow:       { marginBottom: 12, flexDirection: 'row' },
  seasonChip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8, backgroundColor: '#f3f4f6' },
  seasonChipActive:     { backgroundColor: colors.primary },
  seasonChipText:       { fontSize: 13, fontWeight: '600', color: '#555' },
  seasonChipTextActive: { color: '#fff' },

  lbCard:            { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  lbSeasonHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', backgroundColor: '#fafafa' },
  lbSeasonName:      { fontSize: 15, fontWeight: '700', color: '#111' },
  lbSeasonDates:     { fontSize: 11, color: '#aaa', marginTop: 2 },
  lbFormatBadge:     { backgroundColor: colors.primary + '12', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  lbFormatBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  lbHeaderRow:       { backgroundColor: '#f8f8f8', borderBottomWidth: 1.5, borderBottomColor: '#ececec' },
  lbHeaderText:      { fontSize: 10, fontWeight: '700', color: '#aaa', letterSpacing: 0.8 },
  lbRow:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12 },
  lbRowBorder:       { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  lbMyRow:           { backgroundColor: colors.primary + '12' },
  lbCell:            { justifyContent: 'center' },
  lbRankCell:        { width: 32, alignItems: 'center' },
  lbNameCell:        { flex: 1, marginHorizontal: 4 },
  lbNumCell:         { width: 52, alignItems: 'center' },
  lbRankText:        { fontSize: 14, fontWeight: '700', color: '#ccc' },
  lbAvatar:          { width: 34, height: 34, borderRadius: 17, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  lbAvatarMe:        { backgroundColor: colors.primary },
  lbAvatarText:      { color: '#fff', fontSize: 12, fontWeight: '700' },
  lbPlayerName:      { fontSize: 14, fontWeight: '600', color: '#111' },
  lbMyText:          { color: colors.primary },
  lbHcp:             { fontSize: 11, color: '#aaa' },
  lbNumText:         { fontSize: 14, fontWeight: '600', color: '#111' },
  lbScoreText:       { fontSize: 16, fontWeight: '800', color: '#111' },
  lbLoading:         { paddingVertical: 20, alignItems: 'center' },
  lbEmpty:           { paddingVertical: 20, alignItems: 'center' },

  rosterCard:           { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  memberRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  memberRowBorder:      { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  memberRank:           { fontSize: 13, fontWeight: '700', color: '#ccc', width: 20, textAlign: 'center' },
  memberAvatar:         { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  memberAvatarOwner:    { backgroundColor: colors.primary },
  memberAvatarText:     { color: '#fff', fontSize: 14, fontWeight: '700' },
  memberInfo:           { flex: 1 },
  memberNameRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName:           { fontSize: 15, fontWeight: '600', color: '#111', flexShrink: 1 },
  memberOwnerBadge:     { backgroundColor: colors.primary + '12', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  memberOwnerBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  memberMeta:           { fontSize: 12, color: '#aaa' },
  memberHcp:            { alignItems: 'center' },
  memberHcpValue:       { fontSize: 18, fontWeight: '800', color: colors.primary },
  memberHcpLabel:       { fontSize: 10, color: '#aaa', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

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

  // ── Tournaments section header ─────────────────────────────────────────────
  tournSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  tournCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs - 1,
  },
  tournCreateText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },

  ruleCard:       { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, overflow: 'hidden' },
  ruleNumberCol:  { width: 48, alignItems: 'center', paddingTop: 18 },
  ruleNumberBadge:{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  ruleNumber:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  ruleLine:       { width: 2, flex: 1, backgroundColor: '#f0f0f0', marginTop: 6, marginBottom: -16 },
  ruleContent:    { flex: 1, padding: 16, paddingLeft: 4 },
  ruleTitle:      { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 4 },
  ruleBody:       { fontSize: 14, color: '#444', lineHeight: 21 },
  ruleActions:    { flexDirection: 'row', gap: 16, marginTop: 12 },
  ruleActionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ruleActionText: { fontSize: 12, fontWeight: '600', color: colors.primary },

  ruleEditCard:   { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: colors.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  editActions:    { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelEditBtn:  { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  cancelEditText: { fontSize: 14, fontWeight: '500', color: '#555' },
  saveEditBtn:    { flex: 2, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  saveEditText:   { fontSize: 14, fontWeight: '600', color: '#fff' },

  onOffBtns:      { flexDirection: 'row', borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e5e5', overflow: 'hidden' },
  onOffBtn:       { paddingHorizontal: 16, paddingVertical: 8 },
  onOffBtnActive: { backgroundColor: colors.primary },
  onOffBtnText:   { fontSize: 13, fontWeight: '700', color: '#aaa' },
  onOffBtnTextActive: { color: '#fff' },

  hallCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, marginTop: 20, ...shadows.card,
    borderWidth: 1, borderColor: colors.border,
  },
  hallLeft:    { flex: 1 },
  hallIconRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  hallIcon:    { width: 38, height: 38, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  hallTitle:   { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  hallSub:     { fontSize: fontSize.xs, color: colors.textSecondary },

  // ── New header ────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
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
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },

  podiumCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 5,
    ...shadows.card,
  },
  podiumCard1: { backgroundColor: colors.primary,   minHeight: 160 },
  podiumCard2: { backgroundColor: colors.surface,   minHeight: 140, borderWidth: 1.5, borderColor: colors.border },
  podiumCard3: { backgroundColor: colors.secondary, minHeight: 125 },
  podiumCardMe:{ borderWidth: 2, borderColor: 'rgba(255,255,255,0.45)' },

  // Position badge
  podiumBadge: {
    width: 26, height: 26, borderRadius: radius.full,
    justifyContent: 'center', alignItems: 'center',
  },
  podiumBadge1:    { backgroundColor: colors.gold },
  podiumBadge2:    { backgroundColor: colors.silver },
  podiumBadge3:    { backgroundColor: colors.bronze },
  podiumBadgeText: { fontSize: fontSize.xs, fontWeight: '800', color: colors.textInverse },

  // Avatar
  podiumCardAvatar: {
    width: 38, height: 38, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center', alignItems: 'center',
  },
  podiumCardAvatarLight:    { backgroundColor: colors.surfaceMuted },
  podiumCardAvatarText:     { fontSize: fontSize.sm, fontWeight: '700', color: colors.textInverse },
  podiumCardAvatarTextDark: { color: colors.textPrimary },

  // Text — default white (for green/brown cards), dark overrides for cream card
  podiumCardName: {
    fontSize: 11, fontWeight: '700', color: colors.textInverse,
    textAlign: 'center', lineHeight: 15,
  },
  podiumCardScore: {
    fontSize: fontSize.lg, fontWeight: '800', color: colors.textInverse, textAlign: 'center',
  },
  podiumCardHcp: {
    fontSize: 10, color: 'rgba(255,255,255,0.65)', textAlign: 'center',
  },
  podiumCardTextDark: { color: colors.textPrimary },
  podiumCardHcpDark:  { color: colors.textSecondary },

  // ── Plain rows (4th+) ─────────────────────────────────────────────────────
  plainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
    ...shadows.card,
  },
  plainRowMe: { backgroundColor: colors.surfaceMuted },

  plainPosBadge: {
    width: 28, height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  plainPosText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  plainAvatar: {
    width: 36, height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  plainAvatarText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  plainInfo:  { flex: 1 },
  plainName:  { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  plainHcp:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  plainScore: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },

});
