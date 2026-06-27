import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ClubAdmin'>;
  route: { params: { clubId: number; clubName: string; role: string; userId: string } };
};

type Member = {
  id: string; first_name: string | null; last_name: string | null;
  email: string; handicap: number | null; role: string;
  rounds_played: number;
};

type AdminRound = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number | null;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type AdminHole = {
  hole_number: number; par: number; stroke_index: number;
  score: number; stableford_points: number;
};

type ClubSettings = {
  include_tournaments: boolean;
  include_scoring: boolean;
  include_social: boolean;
};

type Tab = 'members' | 'rounds' | 'settings';

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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClubAdminScreen({ navigation, route }: Props) {
  const { clubId, role } = route.params;
  const insets  = useSafeAreaInsets();
  const isOwner = role === 'owner';

  const [tab, setTab] = useState<Tab>('members');

  const [members,        setMembers]        = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [editingHcpId,   setEditingHcpId]  = useState<string | null>(null);
  const [hcpInput,       setHcpInput]      = useState('');
  const [hcpSaving,      setHcpSaving]     = useState(false);

  const [rounds,        setRounds]       = useState<AdminRound[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(true);
  const [deletingId,    setDeletingId]   = useState<string | null>(null);

  const [editingRoundId,   setEditingRoundId]   = useState<string | null>(null);
  const [editHoles,        setEditHoles]        = useState<AdminHole[]>([]);
  const [editScores,       setEditScores]       = useState<Record<number, number>>({});
  const [editHolesLoading, setEditHolesLoading] = useState(false);
  const [editSaving,       setEditSaving]       = useState(false);

  const [incTournaments, setIncTournaments] = useState(true);
  const [incScoring,     setIncScoring]     = useState(true);
  const [incSocial,      setIncSocial]      = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError,  setSettingsError]  = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [clubName,     setClubName]     = useState(route.params.clubName);
  const [nameInput,    setNameInput]    = useState(route.params.clubName);
  const [nameSaving,   setNameSaving]   = useState(false);
  const [nameError,    setNameError]    = useState('');
  const [nameSuccess,  setNameSuccess]  = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const { data } = await client.get<Member[]>(`/api/clubs/${clubId}/members`);
      setMembers(Array.isArray(data) ? data : []);
    } catch { /* stale */ } finally { setMembersLoading(false); }
  }, [clubId]);

  const fetchRounds = useCallback(async () => {
    try {
      const { data } = await client.get<AdminRound[]>(`/api/clubs/${clubId}/admin/rounds`);
      setRounds(Array.isArray(data) ? data : []);
    } catch { /* stale */ } finally { setRoundsLoading(false); }
  }, [clubId]);

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await client.get<ClubSettings>(`/api/clubs/${clubId}`);
      setIncTournaments(data.include_tournaments ?? true);
      setIncScoring(data.include_scoring ?? true);
      setIncSocial(data.include_social ?? true);
    } catch { /* stale */ } finally { setSettingsLoaded(true); }
  }, [clubId]);

  useEffect(() => {
    fetchMembers();
    fetchRounds();
    fetchSettings();
  }, [fetchMembers, fetchRounds, fetchSettings]);

  function onRefresh() {
    setRefreshing(true);
    Promise.all([fetchMembers(), fetchRounds(), fetchSettings()])
      .finally(() => setRefreshing(false));
  }

  function startEditHcp(member: Member) {
    setEditingHcpId(member.id);
    setHcpInput(member.handicap != null ? String(Number(member.handicap).toFixed(1)) : '');
  }

  async function saveHandicap(memberId: string) {
    setHcpSaving(true);
    try {
      const h = hcpInput === '' ? null : parseFloat(hcpInput);
      const { data } = await client.patch(
        `/api/clubs/${clubId}/admin/members/${memberId}/handicap`,
        { handicap: h }
      );
      setMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, handicap: data.handicap } : m
      ));
      setEditingHcpId(null);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not save handicap');
    } finally { setHcpSaving(false); }
  }

  function toggleRole(member: Member) {
    if (member.role === 'owner') return;
    const newRole = member.role === 'admin' ? 'member' : 'admin';
    const label   = newRole === 'admin' ? 'Make Admin' : 'Remove Admin';
    Alert.alert(
      label,
      `${label} for ${personName(member.first_name, member.last_name, member.email)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: label, onPress: async () => {
          try {
            await client.patch(`/api/clubs/${clubId}/members/${member.id}/role`, { role: newRole });
            setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
          } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error ?? 'Could not update role');
          }
        }},
      ]
    );
  }

  function confirmDeleteRound(round: AdminRound) {
    const who = personName(round.first_name, round.last_name, round.email);
    Alert.alert(
      'Delete Round',
      `Delete ${who}'s round at ${round.course_name} on ${formatDate(round.played_at)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingId(round.id);
          try {
            await client.delete(`/api/clubs/${clubId}/admin/rounds/${round.id}`);
            setRounds(prev => prev.filter(r => r.id !== round.id));
          } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error ?? 'Could not delete round');
          } finally { setDeletingId(null); }
        }},
      ]
    );
  }

  async function openScorecardEditor(round: AdminRound) {
    if (editingRoundId === round.id) { setEditingRoundId(null); return; }
    setEditingRoundId(round.id);
    setEditHoles([]);
    setEditScores({});
    setEditHolesLoading(true);
    try {
      const { data } = await client.get<{ courseHandicap: number; holes: AdminHole[] }>(
        `/api/clubs/${clubId}/admin/rounds/${round.id}/holes`
      );
      setEditHoles(data.holes);
      setEditScores(Object.fromEntries(data.holes.map(h => [h.hole_number, h.score])));
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not load scorecard');
      setEditingRoundId(null);
    } finally { setEditHolesLoading(false); }
  }

  async function saveScorecardEdits(round: AdminRound) {
    setEditSaving(true);
    try {
      const holes = Object.entries(editScores).map(([n, score]) => ({
        holeNumber: parseInt(n), score,
      }));
      const { data } = await client.patch(
        `/api/clubs/${clubId}/admin/rounds/${round.id}/holes`,
        { holes }
      );
      setRounds(prev => prev.map(r =>
        r.id === round.id ? { ...r, score: data.score, stableford: data.stableford } : r
      ));
      setEditingRoundId(null);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not save scorecard');
    } finally { setEditSaving(false); }
  }

  async function saveSettings() {
    setSettingsError('');
    setSettingsSaving(true);
    try {
      await client.patch(`/api/clubs/${clubId}/settings`, {
        includeTournaments: incTournaments,
        includeScoring:     incScoring,
        includeSocial:      incSocial,
      });
    } catch (e: any) {
      setSettingsError(e.response?.data?.error ?? 'Could not save settings');
    } finally { setSettingsSaving(false); }
  }

  async function renameClub() {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError('Club name cannot be empty'); return; }
    if (trimmed === clubName) { setNameError('Name is unchanged'); return; }
    setNameError('');
    setNameSuccess(false);
    setNameSaving(true);
    try {
      const { data } = await client.patch(`/api/clubs/${clubId}/name`, { name: trimmed });
      setClubName(data.name);
      setNameInput(data.name);
      setNameSuccess(true);
      navigation.setOptions({ title: data.name });
    } catch (e: any) {
      setNameError(e.response?.data?.error ?? 'Could not rename club');
    } finally { setNameSaving(false); }
  }

  function confirmDeleteClub() {
    Alert.alert(
      'Delete Club',
      `Permanently delete "${route.params.clubName}"?\n\nAll members, seasons, rules, and competitions will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Club', style: 'destructive', onPress: async () => {
          try {
            await client.delete(`/api/clubs/${clubId}`);
            navigation.popToTop();
          } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error ?? 'Could not delete club');
          }
        }},
      ]
    );
  }

  const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'members',  label: 'Members',  icon: 'people-outline' },
    { key: 'rounds',   label: 'Rounds',   icon: 'document-text-outline' },
    ...(isOwner ? [{ key: 'settings' as Tab, label: 'Settings', icon: 'settings-outline' as keyof typeof Ionicons.glyphMap }] : []),
  ];

  return (
    <View style={styles.root}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
          >
            <Ionicons name={t.icon} size={16} color={tab === t.key ? colors.primary : colors.textSecondary} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── MEMBERS ── */}
        {tab === 'members' && (
          membersLoading ? (
            <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
          ) : members.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No members found</Text>
            </View>
          ) : (
            members.map((m, i) => (
              <TouchableOpacity key={m.id} style={[styles.memberCard, i > 0 && { marginTop: spacing.sm }]} activeOpacity={0.85} onPress={() => navigation.navigate('MemberProfile', { userId: m.id, name: personName(m.first_name, m.last_name, m.email) })}>
                <View style={styles.memberTop}>
                  <View style={[styles.avatar, m.role === 'owner' && styles.avatarOwner]}>
                    <Text style={styles.avatarText}>{personInitials(m.first_name, m.last_name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {personName(m.first_name, m.last_name, m.email)}
                      </Text>
                      {m.role !== 'member' && (
                        <View style={[styles.roleBadge, m.role === 'owner' && styles.roleBadgeOwner]}>
                          <Text style={[styles.roleText, m.role === 'owner' && styles.roleTextOwner]}>
                            {m.role === 'owner' ? 'Owner' : 'Admin'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.memberSub}>{m.rounds_played} rounds</Text>
                  </View>
                  <View style={styles.hcpBadge}>
                    <Text style={styles.hcpValue}>
                      {m.handicap != null ? Number(m.handicap).toFixed(1) : '—'}
                    </Text>
                    <Text style={styles.hcpLabel}>HCP</Text>
                  </View>
                </View>

                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={styles.memberActionBtn}
                    onPress={() => startEditHcp(m)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="pencil-outline" size={14} color={colors.primary} />
                    <Text style={styles.memberActionText}>Edit HCP</Text>
                  </TouchableOpacity>

                  {isOwner && m.role !== 'owner' && (
                    <TouchableOpacity
                      style={[styles.memberActionBtn, m.role === 'admin' && styles.memberActionBtnRed]}
                      onPress={() => toggleRole(m)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={m.role === 'admin' ? 'shield-outline' : 'shield-checkmark-outline'}
                        size={14}
                        color={m.role === 'admin' ? colors.danger : colors.primary}
                      />
                      <Text style={[styles.memberActionText, m.role === 'admin' && { color: colors.danger }]}>
                        {m.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {editingHcpId === m.id && (
                  <View style={styles.hcpEditor}>
                    <TextInput
                      style={styles.hcpInput}
                      value={hcpInput}
                      onChangeText={setHcpInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 18.4"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={styles.hcpSaveBtn}
                      onPress={() => saveHandicap(m.id)}
                      disabled={hcpSaving}
                    >
                      {hcpSaving
                        ? <ActivityIndicator color={colors.textInverse} size="small" />
                        : <Text style={styles.hcpSaveBtnText}>Save</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.hcpCancelBtn}
                      onPress={() => setEditingHcpId(null)}
                      disabled={hcpSaving}
                    >
                      <Text style={styles.hcpCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )
        )}

        {/* ── ROUNDS ── */}
        {tab === 'rounds' && (
          roundsLoading ? (
            <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
          ) : rounds.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="document-text-outline" size={36} color={colors.border} style={{ marginBottom: spacing.sm }} />
              <Text style={styles.emptyText}>No rounds to show</Text>
            </View>
          ) : (
            rounds.map((r, i) => {
              const isEditing = editingRoundId === r.id;
              return (
              <View key={r.id} style={[styles.roundCard, i > 0 && { marginTop: spacing.sm }]}>
                <View style={styles.roundTop}>
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('MemberProfile', { userId: r.user_id, name: personName(r.first_name, r.last_name, r.email) })}>
                      <Text style={styles.roundPlayer} numberOfLines={1}>
                        {personName(r.first_name, r.last_name, r.email)}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.roundCourse} numberOfLines={1}>{r.course_name}</Text>
                    <Text style={styles.roundDate}>{formatDate(r.played_at)}</Text>
                  </View>
                  <View style={styles.roundScores}>
                    <View style={styles.roundScore}>
                      <Text style={styles.roundScoreVal}>{r.score}</Text>
                      <Text style={styles.roundScoreLbl}>Strokes</Text>
                    </View>
                    <View style={styles.roundDivider} />
                    <View style={styles.roundScore}>
                      <Text style={[styles.roundScoreVal, { color: colors.primary }]}>
                        {r.stableford ?? '—'}
                      </Text>
                      <Text style={styles.roundScoreLbl}>Pts</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.roundActions}>
                  <TouchableOpacity
                    style={[styles.roundActionBtn, isEditing && styles.roundActionBtnActive]}
                    onPress={() => openScorecardEditor(r)}
                    disabled={editHolesLoading && isEditing}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="create-outline" size={14} color={isEditing ? colors.textInverse : colors.primary} />
                    <Text style={[styles.roundActionText, isEditing && { color: colors.textInverse }]}>
                      {isEditing ? 'Close' : 'Edit Scorecard'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.roundDeleteBtn}
                    onPress={() => confirmDeleteRound(r)}
                    disabled={deletingId === r.id}
                    activeOpacity={0.8}
                  >
                    {deletingId === r.id
                      ? <ActivityIndicator size="small" color={colors.danger} />
                      : <>
                          <Ionicons name="trash-outline" size={14} color={colors.danger} />
                          <Text style={styles.deleteRoundText}>Delete</Text>
                        </>
                    }
                  </TouchableOpacity>
                </View>

                {/* Inline scorecard editor */}
                {isEditing && (
                  <View style={styles.scorecardEditor}>
                    {editHolesLoading ? (
                      <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
                    ) : editHoles.length === 0 ? (
                      <Text style={styles.noHolesText}>No hole data recorded for this round.</Text>
                    ) : (
                      <>
                        <View style={styles.scorecardHeader}>
                          <Text style={[styles.scCell, styles.scHole]}>Hole</Text>
                          <Text style={[styles.scCell, styles.scPar]}>Par</Text>
                          <Text style={[styles.scCell, styles.scScore]}>Score</Text>
                        </View>
                        {editHoles.map(h => (
                          <View key={h.hole_number} style={styles.scorecardRow}>
                            <Text style={[styles.scCell, styles.scHole, styles.scHoleVal]}>{h.hole_number}</Text>
                            <Text style={[styles.scCell, styles.scPar, styles.scParVal]}>{h.par}</Text>
                            <View style={[styles.scCell, styles.scScore, styles.scAdjRow]}>
                              <TouchableOpacity
                                style={styles.scAdj}
                                onPress={() => setEditScores(prev => ({ ...prev, [h.hole_number]: Math.max(1, (prev[h.hole_number] ?? h.score) - 1) }))}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                              >
                                <Text style={styles.scAdjTxt}>−</Text>
                              </TouchableOpacity>
                              <Text style={styles.scScoreVal}>{editScores[h.hole_number] ?? h.score}</Text>
                              <TouchableOpacity
                                style={styles.scAdj}
                                onPress={() => setEditScores(prev => ({ ...prev, [h.hole_number]: (prev[h.hole_number] ?? h.score) + 1 }))}
                                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                              >
                                <Text style={styles.scAdjTxt}>+</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                        <TouchableOpacity
                          style={[styles.scSaveBtn, editSaving && { opacity: 0.6 }]}
                          onPress={() => saveScorecardEdits(r)}
                          disabled={editSaving}
                          activeOpacity={0.85}
                        >
                          {editSaving
                            ? <ActivityIndicator color={colors.textInverse} size="small" />
                            : <Text style={styles.scSaveBtnText}>Save Scorecard</Text>
                          }
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
              );
            })
          )
        )}

        {/* ── SETTINGS ── */}
        {tab === 'settings' && isOwner && (
          !settingsLoaded ? (
            <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <>
            <View style={[styles.settingsCard, { marginBottom: spacing.md }]}>
              <Text style={styles.settingsHeading}>Club Name</Text>
              <Text style={styles.settingsDesc}>Change the name of your club as it appears to all members.</Text>
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={t => { setNameInput(t); setNameError(''); setNameSuccess(false); }}
                placeholder="Club name"
                placeholderTextColor={colors.textSecondary}
                maxLength={60}
                autoCorrect={false}
              />
              {nameError ? <Text style={styles.formError}>{nameError}</Text> : null}
              {nameSuccess ? <Text style={styles.nameSuccess}>Club renamed successfully</Text> : null}
              <TouchableOpacity
                style={[styles.saveBtn, nameInput.trim() === clubName && styles.saveBtnDisabled]}
                onPress={renameClub}
                disabled={nameSaving || nameInput.trim() === clubName}
                activeOpacity={0.85}
              >
                {nameSaving
                  ? <ActivityIndicator color={colors.textInverse} size="small" />
                  : <Text style={styles.saveBtnText}>Save Name</Text>
                }
              </TouchableOpacity>
            </View>

            <View style={styles.settingsCard}>
              <Text style={styles.settingsHeading}>Season Leaderboard</Text>
              <Text style={styles.settingsDesc}>
                Choose which round types count toward the season standings. You can select multiple.
              </Text>

              {([
                { key: 'tournaments', label: 'Tournaments',    desc: 'Rounds linked to a competition',       val: incTournaments, set: setIncTournaments },
                { key: 'scoring',     label: 'Scoring Rounds', desc: 'Casual rounds with a playing partner', val: incScoring,     set: setIncScoring     },
                { key: 'social',      label: 'Social Rounds',  desc: 'Casual rounds without a partner',      val: incSocial,      set: setIncSocial      },
              ] as const).map(({ key, label, desc, val, set }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.toggleRow, val && styles.toggleRowActive]}
                  onPress={() => set(!val)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, val && styles.toggleLabelActive]}>{label}</Text>
                    <Text style={styles.toggleDesc}>{desc}</Text>
                  </View>
                  <View style={[styles.toggleSwitch, val && styles.toggleSwitchOn]}>
                    <View style={[styles.toggleThumb, val && styles.toggleThumbOn]} />
                  </View>
                </TouchableOpacity>
              ))}

              {settingsError ? <Text style={styles.formError}>{settingsError}</Text> : null}

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={saveSettings}
                disabled={settingsSaving}
                activeOpacity={0.85}
              >
                {settingsSaving
                  ? <ActivityIndicator color={colors.textInverse} size="small" />
                  : <Text style={styles.saveBtnText}>Save Settings</Text>
                }
              </TouchableOpacity>

              <View style={styles.dangerZone}>
                <Text style={styles.dangerZoneTitle}>Danger Zone</Text>
                <TouchableOpacity
                  style={styles.deleteClubBtn}
                  onPress={confirmDeleteClub}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={styles.deleteClubBtnText}>Delete Club</Text>
                </TouchableOpacity>
              </View>
            </View>
            </>
          )
        )}

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: spacing.xxl },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 12,
    borderBottomWidth: 2.5, borderBottomColor: 'transparent',
  },
  tabBtnActive:   { borderBottomColor: colors.primary },
  tabLabel:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  tabLabelActive: { color: colors.primary },

  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: 28,
    alignItems: 'center', marginTop: spacing.sm,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  memberCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
    ...shadows.card,
  },
  memberTop:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 10 },
  avatar:        { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarOwner:   { backgroundColor: colors.primary },
  avatarText:    { color: colors.textInverse, fontSize: fontSize.base, fontWeight: '700' },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName:    { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  memberSub:     { fontSize: fontSize.xs, color: colors.textSecondary },
  roleBadge:       { backgroundColor: colors.surfaceMuted, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  roleBadgeOwner:  { backgroundColor: colors.surfaceMuted },
  roleText:        { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
  roleTextOwner:   { color: colors.primary },
  hcpBadge:   { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  hcpValue:   { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary },
  hcpLabel:   { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  memberActions:    { flexDirection: 'row', gap: spacing.sm },
  memberActionBtn:  { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  memberActionBtnRed: { borderColor: colors.danger },
  memberActionText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },
  hcpEditor:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 10 },
  hcpInput:     { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: fontSize.md, color: colors.textPrimary, backgroundColor: colors.surfaceMuted },
  hcpSaveBtn:   { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 10 },
  hcpSaveBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.sm },
  hcpCancelBtn:  { paddingHorizontal: 12, paddingVertical: 10 },
  hcpCancelText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.sm },

  roundCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
    ...shadows.card,
  },
  roundTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  roundPlayer:   { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  roundCourse:   { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 1 },
  roundDate:     { fontSize: fontSize.xs, color: colors.textSecondary },
  roundScores:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roundScore:    { alignItems: 'center' },
  roundScoreVal: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  roundScoreLbl: { fontSize: fontSize.xs, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  roundDivider:  { width: 1, height: 24, backgroundColor: colors.border },
  roundActions: {
    flexDirection: 'row', gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10,
  },
  roundActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm,
    paddingVertical: 7,
  },
  roundActionBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roundActionText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },
  roundDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  deleteRoundText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger },

  scorecardEditor: {
    marginTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm,
  },
  noHolesText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: 8 },
  scorecardHeader: {
    flexDirection: 'row', paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 2,
  },
  scorecardRow: {
    flexDirection: 'row', paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted,
  },
  scCell:     { alignItems: 'center', justifyContent: 'center' },
  scHole:     { width: 44 },
  scPar:      { width: 44 },
  scScore:    { flex: 1 },
  scHoleVal:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  scParVal:   { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  scAdjRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  scAdj:      { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  scAdjTxt:   { fontSize: fontSize.base, fontWeight: '700', color: colors.primary, lineHeight: 20 },
  scScoreVal: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary, minWidth: 24, textAlign: 'center' },
  scSaveBtn:  { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  scSaveBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.base },

  settingsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    ...shadows.card, gap: spacing.sm,
  },
  nameInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 11,
    fontSize: fontSize.base, color: colors.textPrimary,
    backgroundColor: colors.surfaceMuted,
  },
  nameSuccess:    { color: colors.primary, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' },
  saveBtnDisabled:{ opacity: 0.45 },
  settingsHeading: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  settingsDesc:    { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: -4 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: 14,
  },
  toggleRowActive:   { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  toggleLabel:       { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary, marginBottom: 2 },
  toggleLabelActive: { color: colors.primary },
  toggleDesc:        { fontSize: fontSize.xs, color: colors.textSecondary },
  toggleSwitch:      { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2 },
  toggleSwitchOn:    { backgroundColor: colors.primary },
  toggleThumb:       { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  toggleThumbOn:     { alignSelf: 'flex-end' },
  formError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 13,
    alignItems: 'center', marginTop: spacing.xs,
  },
  saveBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.base },

  dangerZone: {
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: spacing.md, marginTop: spacing.xs, gap: spacing.sm,
  },
  dangerZoneTitle: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.danger,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  deleteClubBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, borderWidth: 1.5, borderColor: colors.danger,
    borderRadius: radius.md, paddingVertical: 12,
  },
  deleteClubBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.danger },
});
