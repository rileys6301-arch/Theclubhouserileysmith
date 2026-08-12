import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DatePickerField from '../components/DatePickerField';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateCompetition'>;
  route: { params: { clubId?: number; clubName?: string } };
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Group = { id: number; name: string; scoring: string; scoring_n: number };

type ClubMember = {
  id: string; first_name: string | null; last_name: string | null;
  email: string; handicap: number | null;
};

type GuestRow = { key: string; name: string; handicap: string };

type PairEntry = {
  player_id: string; player_first: string | null; player_last: string | null;
  player_email: string; scorer_id: string | null;
};

type CourseResult = {
  id: string;
  club_name: string;
  location: { city: string; country: string };
};

type Tee = {
  colour: string;
  name: string;
  slopeRating: number | null;
  courseRating: number | null;
  parTotal: number | null;
  holes: { number: number; par: number; si: number }[];
};

type Format = {
  value: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  desc: string;
  team: boolean;
};

// ── Format definitions ────────────────────────────────────────────────────────

const FORMATS: Format[] = [
  { value: 'stableford', label: 'Stableford',  icon: 'star-outline',    desc: 'Points per hole adjusted for handicap. Higher score wins.', team: false },
  { value: 'stroke',     label: 'Stroke Play',  icon: 'golf-outline',    desc: 'Count every shot. Fewest total strokes wins.',               team: false },
  { value: 'net_stroke', label: 'Net Stroke',   icon: 'ribbon-outline',  desc: 'Gross strokes minus your handicap. Levels the field.',       team: false },
  { value: 'match_play', label: 'Match Play',   icon: 'flash-outline',   desc: 'Win holes, not strokes. First to win more than half of 18.', team: false },
  { value: 'scramble',   label: 'Scramble',     icon: 'people-outline',  desc: 'Team picks the best shot each time. All play from there.',   team: true  },
  { value: 'best_ball',  label: 'Best Ball',    icon: 'trophy-outline',  desc: 'Each player plays their own ball. Best score per hole counts.', team: true },
  { value: 'skins',      label: 'Skins',        icon: 'flame-outline',   desc: 'Win a hole outright to take the skin. Ties carry over.',     team: false },
];

const TEAM_SIZES = [2, 3, 4];

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreateCompetitionScreen({ navigation, route }: Props) {
  const { clubId, clubName } = route.params;
  const insets = useSafeAreaInsets();

  const [step,     setStep]     = useState<'format' | 'details' | 'players' | 'pairing'>('format');
  const [format,   setFormat]   = useState('stableford');
  const [teamSize, setTeamSize] = useState(2);

  const [name,        setName]        = useState('');
  const [date,        setDate]        = useState(isoFromDate(new Date()));
  const [description, setDescription] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [joinCode,    setJoinCode]    = useState<string | null>(null);

  // Course search
  const [courseQuery,    setCourseQuery]    = useState('');
  const [courseResults,  setCourseResults]  = useState<CourseResult[]>([]);
  const [courseSearching,setCourseSearching]= useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseResult | null>(null);
  const [tees,           setTees]           = useState<Tee[]>([]);
  const [selectedTeeIdx, setSelectedTeeIdx] = useState(0);
  const [loadingTees,    setLoadingTees]    = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group assignment
  const [groups,       setGroups]       = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);

  // Players step — populated once the competition exists
  const [createdCompId,  setCreatedCompId]  = useState<number | null>(null);
  const [members,        setMembers]        = useState<ClubMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMembers,setSelectedMembers]= useState<Record<string, string>>({}); // userId -> handicap input
  const [guests,         setGuests]         = useState<GuestRow[]>([]);
  const [addingPlayers,  setAddingPlayers]  = useState(false);
  const [playersError,   setPlayersError]   = useState('');
  const [pendingJoinCode,setPendingJoinCode]= useState<string | null>(null);

  // Pairing step — scoring partners, assigned by the creator (non-best-ball formats)
  const [pairEntries,    setPairEntries]    = useState<PairEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [pairs,          setPairs]          = useState<Record<string, string>>({}); // playerId -> scorerId
  const [selectedForPair,setSelectedForPair]= useState<string | null>(null);
  const [savingPairs,    setSavingPairs]    = useState(false);
  const [pairsError,     setPairsError]     = useState('');

  // Best ball: teams instead of pairs — a team's best stableford per hole is what
  // counts, and any teammate can enter scores for any other, so grouping replaces
  // the pairwise marker relationship entirely for this format.
  const [teamGroups,   setTeamGroups]   = useState<string[][]>([]);
  const [teamBuilder,  setTeamBuilder]  = useState<string[]>([]);

  const selectedFormat = FORMATS.find(f => f.value === format)!;
  const isTeam         = selectedFormat.team;
  const selectedTee    = tees[selectedTeeIdx] ?? null;

  // ── Groups fetch when entering details step ──────────────────────────────

  useEffect(() => {
    if (step === 'details' && clubId) {
      client.get<Group[]>('/api/groups', { params: { club_id: clubId } })
        .then(r => setGroups(Array.isArray(r.data) ? r.data : []))
        .catch(() => {});
    }
  }, [step, clubId]);

  // ── Course search ──────────────────────────────────────────────────────────

  function onCourseQueryChange(text: string) {
    setCourseQuery(text);
    setSelectedCourse(null);
    setTees([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setCourseResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setCourseSearching(true);
      try {
        const { data } = await client.get<{ courses: CourseResult[] }>('/api/courses/search', { params: { q: text } });
        setCourseResults(data.courses ?? []);
      } finally { setCourseSearching(false); }
    }, 300);
  }

  async function selectCourse(c: CourseResult) {
    setSelectedCourse(c);
    setCourseQuery(c.club_name);
    setCourseResults([]);
    setLoadingTees(true);
    try {
      const { data } = await client.get<{ tees: Tee[] }>(`/api/courses/detail/${c.id}`);
      setTees(data.tees ?? []);
      setSelectedTeeIdx(0);
    } catch {
      setTees([]);
    } finally {
      setLoadingTees(false);
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async function handleCreate() {
    setError('');
    if (!name.trim())        { setError('Competition name is required'); return; }
    if (!courseQuery.trim()) { setError('Course is required — search and select a course'); return; }
    setSaving(true);
    try {
      const { data } = await client.post('/api/competitions', {
        name:        name.trim(),
        description: description.trim() || null,
        date,
        courseName:  courseQuery.trim(),
        teeName:     selectedTee?.colour || null,
        holeData:    selectedTee?.holes  || null,
        clubId,
        format,
        teamSize:    isTeam ? teamSize : 1,
        groupId:     selectedGroup ?? undefined,
      });
      setCreatedCompId(data.id);
      setPendingJoinCode(data.join_code ?? null);
      setStep('players');
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not create competition');
    } finally {
      setSaving(false);
    }
  }

  // ── Players step ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (step === 'players' && clubId) {
      setLoadingMembers(true);
      client.get<ClubMember[]>(`/api/clubs/${clubId}/members`)
        .then(r => setMembers(Array.isArray(r.data) ? r.data : []))
        .catch(() => {})
        .finally(() => setLoadingMembers(false));
    }
  }, [step, clubId]);

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

  function finishAfterCreate(code: string | null) {
    if (!clubId && code) {
      setJoinCode(code);
    } else {
      navigation.goBack();
    }
  }

  async function handleAddPlayers() {
    if (!createdCompId) return;
    setPlayersError('');

    const players = [
      ...Object.entries(selectedMembers).map(([userId, handicap]) => ({
        userId, handicap: handicap.trim() || null,
      })),
      ...guests.filter(g => g.name.trim()).map(g => ({
        guestName: g.name.trim(), handicap: g.handicap.trim() || null,
      })),
    ];

    if (!players.length) {
      setStep('pairing');
      return;
    }

    setAddingPlayers(true);
    try {
      await client.post(`/api/competitions/${createdCompId}/entries`, { players });
      setStep('pairing');
    } catch (e: any) {
      setPlayersError(e.response?.data?.error ?? 'Could not add players');
    } finally {
      setAddingPlayers(false);
    }
  }

  // ── Pairing step ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (step === 'pairing' && createdCompId) {
      setLoadingEntries(true);
      client.get(`/api/competitions/${createdCompId}`)
        .then(r => {
          const entries: PairEntry[] = r.data.entries ?? [];
          setPairEntries(entries);
          const init: Record<string, string> = {};
          for (const e of entries) if (e.scorer_id) init[e.player_id] = e.scorer_id;
          setPairs(init);
        })
        .catch(() => {})
        .finally(() => setLoadingEntries(false));
    }
  }, [step, createdCompId]);

  function tapPlayerForPairing(id: string) {
    if (pairs[id]) return; // already paired — use the unpair button instead
    if (selectedForPair === id) { setSelectedForPair(null); return; }
    if (selectedForPair) {
      const a = selectedForPair;
      setPairs(prev => ({ ...prev, [a]: id, [id]: a }));
      setSelectedForPair(null);
    } else {
      setSelectedForPair(id);
    }
  }

  function unpair(id: string) {
    const partner = pairs[id];
    setPairs(prev => {
      const n = { ...prev };
      delete n[id];
      if (partner) delete n[partner];
      return n;
    });
  }

  // Best ball: build a team of up to teamSize players, one group at a time.
  function tapPlayerForTeam(id: string) {
    if (teamGroups.some(g => g.includes(id))) return; // already on a finalised team
    setTeamBuilder(prev =>
      prev.includes(id) ? prev.filter(p => p !== id)
      : prev.length < teamSize ? [...prev, id]
      : prev
    );
  }

  function confirmTeam() {
    if (teamBuilder.length < 2) return;
    setTeamGroups(prev => [...prev, teamBuilder]);
    setTeamBuilder([]);
  }

  function disbandTeam(index: number) {
    setTeamGroups(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSavePairs() {
    if (!createdCompId) return;
    setPairsError('');

    if (format === 'best_ball') {
      if (!teamGroups.length) {
        finishAfterCreate(pendingJoinCode);
        return;
      }
      setSavingPairs(true);
      try {
        await client.post(`/api/competitions/${createdCompId}/teams`, { teams: teamGroups });
        finishAfterCreate(pendingJoinCode);
      } catch (e: any) {
        setPairsError(e.response?.data?.error ?? 'Could not save teams');
      } finally {
        setSavingPairs(false);
      }
      return;
    }

    const pairsPayload = Object.entries(pairs).map(([playerId, scorerId]) => ({ playerId, scorerId }));
    if (!pairsPayload.length) {
      finishAfterCreate(pendingJoinCode);
      return;
    }

    setSavingPairs(true);
    try {
      await client.patch(`/api/competitions/${createdCompId}/pairs`, { pairs: pairsPayload });
      finishAfterCreate(pendingJoinCode);
    } catch (e: any) {
      setPairsError(e.response?.data?.error ?? 'Could not save pairings');
    } finally {
      setSavingPairs(false);
    }
  }

  const canCreate = name.trim().length > 0 && courseQuery.trim().length > 0;

  if (joinCode) {
    return (
      <View style={styles.codeScreen}>
        <View style={styles.codeCard}>
          <Ionicons name="trophy" size={44} color={colors.primary} style={{ marginBottom: 16 }} />
          <Text style={styles.codeTitle}>Tournament Created!</Text>
          <Text style={styles.codeSub}>Share this code so friends can join</Text>
          <View style={styles.codeBadge}>
            <Text style={styles.codeText}>{joinCode}</Text>
          </View>
          <TouchableOpacity
            style={styles.codeShareBtn}
            onPress={() => Share.share({ message: `Join my golf tournament on The Clubhouse! Use code: ${joinCode}` })}
            activeOpacity={0.8}
          >
            <Ionicons name="share-outline" size={18} color={colors.textInverse} />
            <Text style={styles.codeShareBtnText}>Share Code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.codeDoneBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Text style={styles.codeDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Competition</Text>
          <View style={{ width: 24 }} />
        </View>

        <Text style={styles.clubLabel}>{clubName}</Text>

        {/* ── Step 1: Format picker ── */}
        {step === 'format' && (
          <>
            <Text style={styles.stepTitle}>Choose a format</Text>
            <Text style={styles.stepSub}>This sets how the competition is played and scored.</Text>

            <View style={styles.formatGrid}>
              {FORMATS.map(f => {
                const active = format === f.value;
                return (
                  <TouchableOpacity
                    key={f.value}
                    style={[styles.formatCard, active && styles.formatCardActive]}
                    onPress={() => setFormat(f.value)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.formatIconWrap, active && styles.formatIconWrapActive]}>
                      <Ionicons name={f.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
                    </View>
                    <View style={styles.formatCardText}>
                      <View style={styles.formatLabelRow}>
                        <Text style={[styles.formatLabel, active && styles.formatLabelActive]}>{f.label}</Text>
                        {f.team && (
                          <View style={styles.teamPill}>
                            <Text style={styles.teamPillText}>Team</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.formatDesc, active && styles.formatDescActive]} numberOfLines={2}>
                        {f.desc}
                      </Text>
                    </View>
                    {active && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ flexShrink: 0 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {isTeam && (
              <View style={styles.teamSizeCard}>
                <Text style={styles.teamSizeLabel}>Team size</Text>
                <View style={styles.teamSizeRow}>
                  {TEAM_SIZES.map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.teamSizeBtn, teamSize === n && styles.teamSizeBtnActive]}
                      onPress={() => setTeamSize(n)}
                    >
                      <Text style={[styles.teamSizeBtnText, teamSize === n && styles.teamSizeBtnTextActive]}>
                        {n} players
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.nextBtn} onPress={() => setStep('details')} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>Next — Details</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.textInverse} />
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2: Details ── */}
        {step === 'details' && (
          <>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep('format')}>
              <Ionicons name="arrow-back" size={16} color={colors.primary} />
              <Text style={styles.backBtnText}>Back to format</Text>
            </TouchableOpacity>

            <View style={styles.formatSummary}>
              <View style={styles.formatIconWrapActive}>
                <Ionicons name={selectedFormat.icon} size={18} color={colors.primary} />
              </View>
              <Text style={styles.formatSummaryLabel}>{selectedFormat.label}</Text>
              {isTeam && <Text style={styles.formatSummaryTeam}>{teamSize}-player teams</Text>}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.fieldLabel}>Competition Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Club Championship 2026"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
            />

            <DatePickerField
              label="Date"
              value={date}
              onChange={setDate}
              style={{ marginTop: 14, marginBottom: 2 }}
            />

            {/* ── Course search ── */}
            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Course</Text>
            <View style={styles.courseSearchRow}>
              <TextInput
                style={[styles.fieldInput, { flex: 1, marginBottom: 0 }]}
                value={courseQuery}
                onChangeText={onCourseQueryChange}
                placeholder="Search for a golf course…"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {courseSearching && (
                <ActivityIndicator size="small" color={colors.primary} style={styles.searchSpinner} />
              )}
            </View>

            {/* Course results dropdown */}
            {courseResults.length > 0 && !selectedCourse && (
              <View style={styles.courseDropdown}>
                {courseResults.map((c, i) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.courseRow, i < courseResults.length - 1 && styles.courseRowBorder]}
                    onPress={() => selectCourse(c)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="golf-outline" size={15} color={colors.textSecondary} style={{ flexShrink: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.courseRowName} numberOfLines={1}>{c.club_name}</Text>
                      <Text style={styles.courseRowLoc}>{c.location.city}, {c.location.country}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.border} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Manual entry trigger */}
            {courseResults.length === 0 && !courseSearching && !selectedCourse && courseQuery.trim().length >= 2 && (
              <TouchableOpacity
                style={styles.manualEntryBtn}
                onPress={() => navigation.navigate('ManualCourse', {
                  onSave: (courseResult, savedTees) => {
                    setSelectedCourse(courseResult);
                    setCourseQuery(courseResult.club_name);
                    setCourseResults([]);
                    setTees(savedTees);
                    setSelectedTeeIdx(0);
                  },
                })}
                activeOpacity={0.75}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                <Text style={styles.manualEntryText}>Can't find it? Add course manually</Text>
              </TouchableOpacity>
            )}

            {/* Loading tees spinner */}
            {loadingTees && (
              <View style={styles.teeLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.teeLoadingText}>Loading tee data…</Text>
              </View>
            )}

            {/* Tee picker */}
            {selectedCourse && tees.length > 0 && !loadingTees && (
              <View style={styles.teePicker}>
                <Text style={styles.teePickerLabel}>Select Tee</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teeRow}>
                  {tees.map((t, i) => {
                    const active = selectedTeeIdx === i;
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[styles.teeChip, active && styles.teeChipActive]}
                        onPress={() => setSelectedTeeIdx(i)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.teeChipText, active && styles.teeChipTextActive]}>
                          {t.colour || t.name}
                        </Text>
                        {t.parTotal != null && (
                          <Text style={[styles.teeChipSub, active && styles.teeChipSubActive]}>
                            Par {t.parTotal}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {selectedTee && (
                  <View style={styles.teeInfoRow}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
                    <Text style={styles.teeInfoText}>
                      {selectedTee.colour} tee · {selectedTee.holes.length} holes loaded
                      {selectedTee.slopeRating != null ? ` · Slope ${selectedTee.slopeRating}` : ''}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {selectedCourse && tees.length === 0 && !loadingTees && (
              <Text style={styles.noTeeText}>Course selected — hole-by-hole data not available</Text>
            )}

            {/* ── Group assignment ── */}
            {groups.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                  Add to Group <Text style={styles.optionalTag}>(optional)</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.groupNoneChip, selectedGroup === null && styles.groupNoneChipActive]}
                  onPress={() => setSelectedGroup(null)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.groupNoneText, selectedGroup === null && styles.groupNoneTextActive]}>
                    No group
                  </Text>
                </TouchableOpacity>
                {groups.map(g => {
                  const active = selectedGroup === g.id;
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.groupChip, active && styles.groupChipActive]}
                      onPress={() => setSelectedGroup(active ? null : g.id)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="layers-outline" size={15} color={active ? colors.primary : colors.textSecondary} />
                      <Text style={[styles.groupChipText, active && styles.groupChipTextActive]} numberOfLines={1}>
                        {g.name}
                      </Text>
                      {active && <Ionicons name="checkmark-circle" size={16} color={colors.primary} style={{ marginLeft: 'auto' as any }} />}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
              Description <Text style={styles.optionalTag}>(optional)</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Format details, prizes, starting times…"
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.nextBtn, !canCreate && styles.nextBtnDisabled]}
              onPress={handleCreate}
              disabled={saving || !canCreate}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <>
                    <Text style={styles.nextBtnText}>Next — Add Players</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverse} />
                  </>}
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 3: Players ── */}
        {step === 'players' && (
          <>
            <Text style={styles.stepTitle}>Add players</Text>
            <Text style={styles.stepSub}>
              Optional — add club members and set a tournament handicap for each. Anyone you don't
              add can still join later with a code or from the club.
            </Text>

            {playersError ? <Text style={styles.errorText}>{playersError}</Text> : null}

            {clubId && (
              <>
                <Text style={styles.fieldLabel}>Club Members</Text>
                {loadingMembers ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.sm }} />
                ) : members.length === 0 ? (
                  <Text style={styles.noTeeText}>No other club members found</Text>
                ) : (
                  <View style={styles.memberList}>
                    {members.map(m => {
                      const selected = m.id in selectedMembers;
                      return (
                        <View key={m.id} style={[styles.memberRow, selected && styles.memberRowActive]}>
                          <TouchableOpacity
                            style={styles.memberRowMain}
                            onPress={() => toggleMember(m.id)}
                            activeOpacity={0.75}
                          >
                            <Ionicons
                              name={selected ? 'checkbox' : 'square-outline'}
                              size={20}
                              color={selected ? colors.primary : colors.textSecondary}
                            />
                            <Text style={styles.memberName} numberOfLines={1}>
                              {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}
                            </Text>
                          </TouchableOpacity>
                          {selected && (
                            <TextInput
                              style={styles.memberHcpInput}
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
              </>
            )}

            <View style={styles.guestHeaderRow}>
              <Text style={[styles.fieldLabel, { marginTop: clubId ? 14 : 0 }]}>
                Guests <Text style={styles.optionalTag}>(no account needed)</Text>
              </Text>
              <TouchableOpacity onPress={addGuestRow} style={styles.addGuestBtn} activeOpacity={0.75}>
                <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                <Text style={styles.manualEntryText}>Add guest</Text>
              </TouchableOpacity>
            </View>

            {guests.map(g => (
              <View key={g.key} style={styles.guestRow}>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, marginBottom: 0 }]}
                  value={g.name}
                  onChangeText={v => updateGuestRow(g.key, { name: v })}
                  placeholder="Guest name"
                  placeholderTextColor={colors.textSecondary}
                />
                <TextInput
                  style={styles.memberHcpInput}
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
              style={styles.nextBtn}
              onPress={handleAddPlayers}
              disabled={addingPlayers}
              activeOpacity={0.85}
            >
              {addingPlayers
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <>
                    <Text style={styles.nextBtnText}>Next — Pairing</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverse} />
                  </>}
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 4: Pairing / Teams ── */}
        {step === 'pairing' && format === 'best_ball' && (
          <>
            <Text style={styles.stepTitle}>Form teams</Text>
            <Text style={styles.stepSub}>
              Optional — group {teamSize === 2 ? 'pairs' : `up to ${teamSize} players`} into a
              team. Each hole, the team's best stableford score counts. Anyone left off a team
              can pick a teammate once they start scoring.
            </Text>

            {pairsError ? <Text style={styles.errorText}>{pairsError}</Text> : null}

            {loadingEntries ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : pairEntries.length === 0 ? (
              <Text style={styles.noTeeText}>No players entered yet</Text>
            ) : (
              <>
                {teamGroups.map((group, i) => (
                  <View key={i} style={[styles.memberRow, styles.memberRowActive, { marginBottom: 6 }]}>
                    <View style={styles.memberRowMain}>
                      <Ionicons name="people" size={20} color={colors.primary} />
                      <Text style={styles.memberName} numberOfLines={1}>
                        {group.map(id => {
                          const p = pairEntries.find(e => e.player_id === id);
                          return p ? ([p.player_first, p.player_last].filter(Boolean).join(' ') || p.player_email) : '?';
                        }).join(' & ')}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => disbandTeam(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}

                <View style={styles.memberList}>
                  {pairEntries.filter(e => !teamGroups.some(g => g.includes(e.player_id))).map(e => {
                    const selected = teamBuilder.includes(e.player_id);
                    return (
                      <TouchableOpacity
                        key={e.player_id}
                        style={[styles.memberRow, selected && styles.memberRowActive]}
                        onPress={() => tapPlayerForTeam(e.player_id)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.memberRowMain}>
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={selected ? colors.primary : colors.textSecondary}
                          />
                          <Text style={styles.memberName} numberOfLines={1}>
                            {[e.player_first, e.player_last].filter(Boolean).join(' ') || e.player_email}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {teamBuilder.length > 0 && (
                  <TouchableOpacity
                    style={[styles.addGuestBtn, { marginTop: spacing.sm, marginBottom: spacing.sm }]}
                    onPress={confirmTeam}
                    disabled={teamBuilder.length < 2}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
                    <Text style={styles.manualEntryText}>
                      {teamBuilder.length < 2 ? 'Select at least 2 to form a team' : `Form team of ${teamBuilder.length}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleSavePairs}
              disabled={savingPairs}
              activeOpacity={0.85}
            >
              {savingPairs
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <>
                    <Text style={styles.nextBtnText}>
                      {teamGroups.length > 0 ? 'Save Teams & Finish' : 'Finish'}
                    </Text>
                    <Ionicons name="checkmark" size={18} color={colors.textInverse} />
                  </>}
            </TouchableOpacity>
          </>
        )}

        {step === 'pairing' && format !== 'best_ball' && (
          <>
            <Text style={styles.stepTitle}>Assign scoring partners</Text>
            <Text style={styles.stepSub}>
              Optional — pair players up so each one has a marker to verify their score.
              Tap two players to pair them. Anyone left unpaired can pick their own partner
              once they start scoring.
            </Text>

            {pairsError ? <Text style={styles.errorText}>{pairsError}</Text> : null}

            {loadingEntries ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : pairEntries.length === 0 ? (
              <Text style={styles.noTeeText}>No players entered yet</Text>
            ) : (
              <View style={styles.memberList}>
                {pairEntries.map(e => {
                  const paired = pairs[e.player_id];
                  const partner = paired ? pairEntries.find(p => p.player_id === paired) : null;
                  const selected = selectedForPair === e.player_id;
                  return (
                    <TouchableOpacity
                      key={e.player_id}
                      style={[styles.memberRow, (selected || paired) && styles.memberRowActive]}
                      onPress={() => tapPlayerForPairing(e.player_id)}
                      activeOpacity={0.75}
                      disabled={!!paired}
                    >
                      <View style={styles.memberRowMain}>
                        <Ionicons
                          name={paired ? 'people' : selected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={paired || selected ? colors.primary : colors.textSecondary}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName} numberOfLines={1}>
                            {[e.player_first, e.player_last].filter(Boolean).join(' ') || e.player_email}
                          </Text>
                          {partner && (
                            <Text style={styles.pairedWithText} numberOfLines={1}>
                              Paired with {[partner.player_first, partner.player_last].filter(Boolean).join(' ') || partner.player_email}
                            </Text>
                          )}
                        </View>
                      </View>
                      {paired && (
                        <TouchableOpacity onPress={() => unpair(e.player_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleSavePairs}
              disabled={savingPairs}
              activeOpacity={0.85}
            >
              {savingPairs
                ? <ActivityIndicator color={colors.textInverse} size="small" />
                : <>
                    <Text style={styles.nextBtnText}>
                      {Object.keys(pairs).length > 0 ? 'Save Pairings & Finish' : 'Finish'}
                    </Text>
                    <Ionicons name="checkmark" size={18} color={colors.textInverse} />
                  </>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.xs, paddingTop: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  clubLabel:   { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },

  stepTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  stepSub:   { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  formatGrid: { gap: 10, marginBottom: spacing.md },
  formatCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: colors.border,
  },
  formatCardActive:     { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  formatIconWrap:       { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  formatIconWrapActive: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary + '20', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  formatCardText:       { flex: 1 },
  formatLabelRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  formatLabel:          { fontSize: fontSize.base, fontWeight: '700', color: colors.textSecondary },
  formatLabelActive:    { color: colors.primary },
  formatDesc:           { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  formatDescActive:     { color: colors.textPrimary },
  teamPill:     { backgroundColor: colors.secondary + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  teamPillText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.secondary },

  teamSizeCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: spacing.md, borderWidth: 1.5, borderColor: colors.primary,
  },
  teamSizeLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 10 },
  teamSizeRow:   { flexDirection: 'row', gap: spacing.sm },
  teamSizeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceMuted, alignItems: 'center',
  },
  teamSizeBtnActive:     { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  teamSizeBtnText:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  teamSizeBtnTextActive: { color: colors.primary },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnText:     { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.md },

  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  backBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },

  formatSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 12,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.primary + '26',
  },
  formatSummaryLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.primary, flex: 1 },
  formatSummaryTeam:  { fontSize: fontSize.xs, color: colors.textSecondary },

  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },

  fieldLabel: {
    fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
  },
  optionalTag: { fontWeight: '400', color: colors.textSecondary, textTransform: 'none', letterSpacing: 0 },
  fieldInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: fontSize.base,
    color: colors.textPrimary, backgroundColor: colors.surface, marginBottom: 2,
  },
  textArea: { height: 90, paddingTop: 12 },

  // Course search
  courseSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  searchSpinner:   { flexShrink: 0 },

  courseDropdown: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadows.card,
  },
  courseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  courseRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  courseRowName:   { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  courseRowLoc:    { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  teeLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.sm },
  teeLoadingText: { fontSize: fontSize.xs, color: colors.textSecondary },

  teePicker: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    padding: 12,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  teePickerLabel: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },
  teeRow: { gap: 8, paddingRight: 4 },
  teeChip: {
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  teeChipActive:    { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  teeChipText:      { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  teeChipTextActive:{ color: colors.primary },
  teeChipSub:       { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  teeChipSubActive: { color: colors.primary },

  teeInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  teeInfoText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '500', flex: 1 },

  noTeeText: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
  manualEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 2, marginTop: 4,
  },
  manualEntryText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },

  codeScreen: {
    flex: 1, backgroundColor: colors.background,
    justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  codeCard: {
    backgroundColor: colors.surface, borderRadius: 24, padding: 32,
    alignItems: 'center', width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 6,
  },
  codeTitle:    { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 },
  codeSub:      { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: 28 },
  codeBadge: {
    backgroundColor: colors.primary + '12', borderRadius: 16,
    borderWidth: 2, borderColor: colors.primary,
    paddingHorizontal: 36, paddingVertical: 18, marginBottom: 28,
  },
  codeText: {
    fontSize: 38, fontWeight: '900', color: colors.primary,
    letterSpacing: 8, textAlign: 'center',
  },
  codeShareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 28, marginBottom: 14, width: '100%', justifyContent: 'center',
  },
  codeShareBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.base },
  codeDoneBtn: {
    paddingVertical: 10, width: '100%', alignItems: 'center',
  },
  codeDoneBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.base },

  groupNoneChip: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    marginBottom: spacing.xs, backgroundColor: colors.surface,
  },
  groupNoneChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  groupNoneText:       { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500' },
  groupNoneTextActive: { color: colors.primary, fontWeight: '600' },
  groupChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    marginBottom: spacing.xs, backgroundColor: colors.surface,
  },
  groupChipActive:    { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  groupChipText:      { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500', flex: 1 },
  groupChipTextActive:{ color: colors.primary, fontWeight: '600' },

  // Players step
  memberList: { gap: 6, marginBottom: spacing.sm },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4, backgroundColor: colors.surface,
  },
  memberRowActive:  { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  memberRowMain:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  memberName:       { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500', flex: 1 },
  memberHcpInput: {
    width: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6, fontSize: fontSize.sm,
    color: colors.textPrimary, backgroundColor: colors.surfaceMuted, textAlign: 'center',
  },
  guestHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addGuestBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  guestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs,
  },

  // Pairing step
  pairedWithText: { fontSize: fontSize.xs, color: colors.primary, marginTop: 1 },
});
