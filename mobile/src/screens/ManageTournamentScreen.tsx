import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ManageTournament'>;
  route: { params: { competitionId: number } };
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Entry = {
  id: number; player_id: string; scorer_id: string | null; team_id: number | null;
  player_first: string | null; player_last: string | null; player_email: string;
  handicap: number | null; is_guest: boolean;
};

type CompDetail = {
  id: number; club_id: number | null; format: string; status: string; team_size: number;
  entries: Entry[];
};

type ClubMember = {
  id: string; first_name: string | null; last_name: string | null;
  email: string; handicap: number | null;
};

type GuestRow = { key: string; name: string; handicap: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryName(e: Entry) {
  return [e.player_first, e.player_last].filter(Boolean).join(' ') || e.player_email;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ManageTournamentScreen({ navigation, route }: Props) {
  const { competitionId } = route.params;
  const insets = useSafeAreaInsets();

  const [comp,    setComp]    = useState<CompDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Add players
  const [members,        setMembers]        = useState<ClubMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMembers,setSelectedMembers]= useState<Record<string, string>>({}); // userId -> handicap input
  const [guests,         setGuests]         = useState<GuestRow[]>([]);
  const [addingPlayers,  setAddingPlayers]  = useState(false);
  const [addError,       setAddError]       = useState('');

  // Existing entries
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [hcpInput,       setHcpInput]       = useState('');
  const [busyEntryId,    setBusyEntryId]    = useState<number | null>(null);

  // Pairing (non-best-ball) / teams (best-ball)
  const [selectedForPair, setSelectedForPair] = useState<string | null>(null);
  const [teamBuilder,     setTeamBuilder]     = useState<string[]>([]);
  const [savingPairing,   setSavingPairing]   = useState(false);
  const [pairingError,    setPairingError]    = useState('');

  const fetchComp = useCallback(async () => {
    try {
      const { data } = await client.get<CompDetail>(`/api/competitions/${competitionId}`);
      setComp(data);
    } catch {
      setError('Could not load tournament');
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => { fetchComp(); }, [fetchComp]);

  useEffect(() => {
    if (comp?.club_id) {
      setLoadingMembers(true);
      client.get<ClubMember[]>(`/api/clubs/${comp.club_id}/members`)
        .then(r => setMembers(Array.isArray(r.data) ? r.data : []))
        .catch(() => {})
        .finally(() => setLoadingMembers(false));
    }
  }, [comp?.club_id]);

  const isBestBall = comp?.format === 'best_ball';
  const enteredIds = new Set((comp?.entries ?? []).map(e => e.player_id));
  const availableMembers = members.filter(m => !enteredIds.has(m.id));

  // ── Add players ──────────────────────────────────────────────────────────

  function toggleMember(id: string) {
    setSelectedMembers(prev => {
      const n = { ...prev };
      if (id in n) delete n[id]; else n[id] = '';
      return n;
    });
  }

  function addGuestRow() {
    setGuests(prev => [...prev, { key: `${Date.now()}-${prev.length}`, name: '', handicap: '' }]);
  }
  function updateGuestRow(key: string, patch: Partial<GuestRow>) {
    setGuests(prev => prev.map(g => g.key === key ? { ...g, ...patch } : g));
  }
  function removeGuestRow(key: string) {
    setGuests(prev => prev.filter(g => g.key !== key));
  }

  async function handleAddPlayers() {
    if (!comp) return;
    setAddError('');
    const players = [
      ...Object.entries(selectedMembers).map(([userId, handicap]) => ({
        userId, handicap: handicap.trim() || null,
      })),
      ...guests.filter(g => g.name.trim()).map(g => ({
        guestName: g.name.trim(), handicap: g.handicap.trim() || null,
      })),
    ];
    if (!players.length) return;

    setAddingPlayers(true);
    try {
      await client.post(`/api/competitions/${comp.id}/entries`, { players });
      setSelectedMembers({});
      setGuests([]);
      await fetchComp();
    } catch (e: any) {
      setAddError(e.response?.data?.error ?? 'Could not add players');
    } finally {
      setAddingPlayers(false);
    }
  }

  // ── Existing entries: edit handicap / remove ────────────────────────────────

  function startEditHcp(entry: Entry) {
    setEditingEntryId(entry.id);
    setHcpInput(entry.handicap != null ? String(entry.handicap) : '');
  }

  async function saveHcp(entry: Entry) {
    setBusyEntryId(entry.id);
    try {
      await client.patch(`/api/competitions/${competitionId}/entries/${entry.id}`, {
        handicap: hcpInput.trim() || null,
      });
      setEditingEntryId(null);
      await fetchComp();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not update handicap');
    } finally {
      setBusyEntryId(null);
    }
  }

  function confirmRemove(entry: Entry) {
    Alert.alert(
      'Remove player?',
      `${entryName(entry)} will be taken out of the tournament.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeEntry(entry) },
      ]
    );
  }

  async function removeEntry(entry: Entry) {
    setBusyEntryId(entry.id);
    try {
      await client.delete(`/api/competitions/${competitionId}/entries/${entry.id}`);
      await fetchComp();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error ?? 'Could not remove player');
    } finally {
      setBusyEntryId(null);
    }
  }

  // ── Pairing (non-best-ball): tap two to pair, immediate save ───────────────

  async function tapPlayerForPairing(entry: Entry) {
    if (entry.scorer_id) return; // already paired — use the unpair button
    if (selectedForPair === entry.player_id) { setSelectedForPair(null); return; }
    if (!selectedForPair) { setSelectedForPair(entry.player_id); return; }

    const a = selectedForPair;
    const b = entry.player_id;
    setSelectedForPair(null);
    setPairingError('');
    setSavingPairing(true);
    try {
      await client.patch(`/api/competitions/${competitionId}/pairs`, {
        pairs: [{ playerId: a, scorerId: b }, { playerId: b, scorerId: a }],
      });
      await fetchComp();
    } catch (e: any) {
      setPairingError(e.response?.data?.error ?? 'Could not save pairing');
    } finally {
      setSavingPairing(false);
    }
  }

  async function unpair(entry: Entry) {
    if (!comp) return;
    const partnerId = entry.scorer_id;
    setPairingError('');
    setSavingPairing(true);
    try {
      const pairs = [{ playerId: entry.player_id, scorerId: null }];
      if (partnerId) pairs.push({ playerId: partnerId, scorerId: null });
      await client.patch(`/api/competitions/${competitionId}/pairs`, { pairs });
      await fetchComp();
    } catch (e: any) {
      setPairingError(e.response?.data?.error ?? 'Could not update pairing');
    } finally {
      setSavingPairing(false);
    }
  }

  // ── Teams (best-ball): build a group, immediate save ────────────────────────

  function tapPlayerForTeam(entry: Entry) {
    if (entry.team_id != null) return; // already on a team — disband it instead
    setTeamBuilder(prev =>
      prev.includes(entry.player_id) ? prev.filter(p => p !== entry.player_id)
      : comp && prev.length < comp.team_size ? [...prev, entry.player_id]
      : prev
    );
  }

  async function confirmTeam() {
    if (!comp || teamBuilder.length < 2) return;
    setPairingError('');
    setSavingPairing(true);
    try {
      await client.post(`/api/competitions/${comp.id}/teams`, { teams: [teamBuilder] });
      setTeamBuilder([]);
      await fetchComp();
    } catch (e: any) {
      setPairingError(e.response?.data?.error ?? 'Could not form team');
    } finally {
      setSavingPairing(false);
    }
  }

  async function disbandTeam(teamId: number) {
    if (!comp) return;
    const members = comp.entries.filter(e => e.team_id === teamId);
    setPairingError('');
    setSavingPairing(true);
    try {
      await Promise.all(members.map(m =>
        client.patch(`/api/competitions/${competitionId}/entries/${m.id}`, { removeFromTeam: true })
      ));
      await fetchComp();
    } catch (e: any) {
      setPairingError(e.response?.data?.error ?? 'Could not disband team');
    } finally {
      setSavingPairing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (error || !comp) {
    return <View style={s.centered}><Text style={s.errorText}>{error || 'Not found'}</Text></View>;
  }
  if (comp.status !== 'upcoming') {
    return (
      <View style={s.centered}>
        <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} style={{ marginBottom: spacing.sm }} />
        <Text style={s.lockedText}>
          This tournament has already started, so players and pairings can no longer be edited here.
        </Text>
      </View>
    );
  }

  const teamGroups = new Map<number, Entry[]>();
  for (const e of comp.entries) {
    if (e.team_id != null) {
      if (!teamGroups.has(e.team_id)) teamGroups.set(e.team_id, []);
      teamGroups.get(e.team_id)!.push(e);
    }
  }
  const unteamedEntries = comp.entries.filter(e => e.team_id == null);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.root}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Current players ── */}
        <Text style={s.sectionTitle}>Entered Players ({comp.entries.length})</Text>
        <View style={s.card}>
          {comp.entries.length === 0 ? (
            <Text style={s.emptyText}>No players entered yet</Text>
          ) : comp.entries.map((e, i) => (
            <View key={e.id} style={[s.entryRow, i < comp.entries.length - 1 && s.entryRowBorder]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.entryName} numberOfLines={1}>{entryName(e)}</Text>
                  {e.is_guest && (
                    <View style={s.guestPill}><Text style={s.guestPillText}>Guest</Text></View>
                  )}
                </View>
                {editingEntryId === e.id ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <TextInput
                      style={s.hcpInput}
                      value={hcpInput}
                      onChangeText={setHcpInput}
                      placeholder="Hcp"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numbers-and-punctuation"
                      autoFocus
                    />
                    <TouchableOpacity onPress={() => saveHcp(e)} disabled={busyEntryId === e.id}>
                      {busyEntryId === e.id
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingEntryId(null)}>
                      <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => startEditHcp(e)} activeOpacity={0.6}>
                    <Text style={s.entryHcp}>
                      HCP {e.handicap != null ? Number(e.handicap).toFixed(1) : '— (tap to set)'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                onPress={() => confirmRemove(e)}
                disabled={busyEntryId === e.id}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {busyEntryId === e.id && editingEntryId !== e.id
                  ? <ActivityIndicator size="small" color={colors.danger} />
                  : <Ionicons name="trash-outline" size={18} color={colors.danger} />}
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* ── Add players ── */}
        <Text style={s.sectionTitle}>Add Players</Text>
        <View style={s.card}>
          {addError ? <Text style={[s.errorText, { padding: spacing.md, paddingBottom: 0 }]}>{addError}</Text> : null}

          {comp.club_id && (
            <View style={{ padding: spacing.md, paddingBottom: 0 }}>
              {loadingMembers ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.sm }} />
              ) : availableMembers.length === 0 ? (
                <Text style={s.emptyText}>No other club members available</Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {availableMembers.map(m => {
                    const selected = m.id in selectedMembers;
                    return (
                      <View key={m.id} style={[s.memberRow, selected && s.memberRowActive]}>
                        <TouchableOpacity
                          style={s.memberRowMain}
                          onPress={() => toggleMember(m.id)}
                          activeOpacity={0.75}
                        >
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={selected ? colors.primary : colors.textSecondary}
                          />
                          <Text style={s.memberName} numberOfLines={1}>
                            {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}
                          </Text>
                        </TouchableOpacity>
                        {selected && (
                          <TextInput
                            style={s.hcpInput}
                            value={selectedMembers[m.id]}
                            onChangeText={v => setSelectedMembers(prev => ({ ...prev, [m.id]: v }))}
                            placeholder={m.handicap != null ? String(m.handicap) : 'Hcp'}
                            placeholderTextColor={colors.textSecondary}
                            keyboardType="numbers-and-punctuation"
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={s.guestHeaderRow}>
            <Text style={s.fieldLabel}>Guests <Text style={s.optionalTag}>(no account needed)</Text></Text>
            <TouchableOpacity onPress={addGuestRow} style={s.addGuestBtn} activeOpacity={0.75}>
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={s.addGuestBtnText}>Add guest</Text>
            </TouchableOpacity>
          </View>

          {guests.map(g => (
            <View key={g.key} style={s.guestRow}>
              <TextInput
                style={[s.fieldInput, { flex: 1, marginBottom: 0 }]}
                value={g.name}
                onChangeText={v => updateGuestRow(g.key, { name: v })}
                placeholder="Guest name"
                placeholderTextColor={colors.textSecondary}
              />
              <TextInput
                style={s.hcpInput}
                value={g.handicap}
                onChangeText={v => updateGuestRow(g.key, { handicap: v })}
                placeholder="Hcp"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity onPress={() => removeGuestRow(g.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={[s.addBtn, (Object.keys(selectedMembers).length + guests.filter(g => g.name.trim()).length === 0) && s.addBtnDisabled]}
            onPress={handleAddPlayers}
            disabled={addingPlayers || Object.keys(selectedMembers).length + guests.filter(g => g.name.trim()).length === 0}
            activeOpacity={0.85}
          >
            {addingPlayers
              ? <ActivityIndicator color={colors.textInverse} size="small" />
              : <>
                  <Ionicons name="person-add-outline" size={16} color={colors.textInverse} />
                  <Text style={s.addBtnText}>Add to Tournament</Text>
                </>}
          </TouchableOpacity>
        </View>

        {/* ── Pairings / Teams ── */}
        <Text style={s.sectionTitle}>{isBestBall ? 'Teams' : 'Scoring Partners'}</Text>
        <View style={s.card}>
          {pairingError ? <Text style={[s.errorText, { padding: spacing.md, paddingBottom: 0 }]}>{pairingError}</Text> : null}
          {savingPairing && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: spacing.sm }} />}

          {comp.entries.length === 0 ? (
            <Text style={[s.emptyText, { padding: spacing.md }]}>Add players first</Text>
          ) : isBestBall ? (
            <View style={{ padding: spacing.md, gap: 6 }}>
              {[...teamGroups.entries()].map(([teamId, teamMembers]) => (
                <View key={teamId} style={[s.memberRow, s.memberRowActive]}>
                  <View style={s.memberRowMain}>
                    <Ionicons name="people" size={20} color={colors.primary} />
                    <Text style={s.memberName} numberOfLines={1}>
                      {teamMembers.map(entryName).join(' & ')}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => disbandTeam(teamId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}

              {unteamedEntries.map(e => {
                const selected = teamBuilder.includes(e.player_id);
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={[s.memberRow, selected && s.memberRowActive]}
                    onPress={() => tapPlayerForTeam(e)}
                    activeOpacity={0.75}
                  >
                    <View style={s.memberRowMain}>
                      <Ionicons
                        name={selected ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={selected ? colors.primary : colors.textSecondary}
                      />
                      <Text style={s.memberName} numberOfLines={1}>{entryName(e)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {teamBuilder.length > 0 && (
                <TouchableOpacity
                  style={[s.addGuestBtn, { marginTop: spacing.xs }]}
                  onPress={confirmTeam}
                  disabled={teamBuilder.length < 2 || savingPairing}
                  activeOpacity={0.75}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
                  <Text style={s.addGuestBtnText}>
                    {teamBuilder.length < 2 ? 'Select at least 2 to form a team' : `Form team of ${teamBuilder.length}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={{ padding: spacing.md, gap: 6 }}>
              {comp.entries.map(e => {
                const partner = e.scorer_id ? comp.entries.find(p => p.player_id === e.scorer_id) : null;
                const selected = selectedForPair === e.player_id;
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={[s.memberRow, (selected || e.scorer_id) && s.memberRowActive]}
                    onPress={() => tapPlayerForPairing(e)}
                    activeOpacity={0.75}
                    disabled={!!e.scorer_id}
                  >
                    <View style={s.memberRowMain}>
                      <Ionicons
                        name={e.scorer_id ? 'people' : selected ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={e.scorer_id || selected ? colors.primary : colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={s.memberName} numberOfLines={1}>{entryName(e)}</Text>
                        {partner && (
                          <Text style={s.pairedWithText} numberOfLines={1}>Paired with {entryName(partner)}</Text>
                        )}
                      </View>
                    </View>
                    {e.scorer_id && (
                      <TouchableOpacity onPress={() => unpair(e)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: spacing.lg },
  errorText:  { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  lockedText: { color: colors.textSecondary, fontSize: fontSize.base, textAlign: 'center', lineHeight: 22 },
  emptyText:  { color: colors.textSecondary, fontSize: fontSize.sm, padding: spacing.md, textAlign: 'center' },

  sectionTitle: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: spacing.sm,
  },
  entryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  entryName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  entryHcp:  { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  guestPill: { backgroundColor: colors.secondary + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  guestPillText: { fontSize: 10, fontWeight: '700', color: colors.secondary },

  fieldLabel:  { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  optionalTag: { fontWeight: '400', color: colors.textSecondary, textTransform: 'none', letterSpacing: 0 },
  fieldInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: fontSize.base,
    color: colors.textPrimary, backgroundColor: colors.surface,
  },

  memberList:    { gap: 6 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4, backgroundColor: colors.surface,
  },
  memberRowActive: { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  memberRowMain:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  memberName:      { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500', flex: 1 },
  pairedWithText:  { fontSize: fontSize.xs, color: colors.primary, marginTop: 1 },

  hcpInput: {
    width: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6, fontSize: fontSize.sm,
    color: colors.textPrimary, backgroundColor: colors.background, textAlign: 'center',
  },

  guestHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.md, paddingBottom: spacing.xs,
  },
  addGuestBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addGuestBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  guestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, marginBottom: spacing.xs,
  },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: 12, margin: spacing.md, marginTop: spacing.sm,
    borderRadius: radius.md,
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.sm },
});
