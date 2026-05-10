import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DatePickerField from '../components/DatePickerField';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';

const GREEN = '#1a7f3c';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateCompetition'>;
  route: { params: { clubId: number; clubName: string } };
};

// ── Format definitions ────────────────────────────────────────────────────────

type Format = {
  value: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  desc: string;
  team: boolean;
};

const FORMATS: Format[] = [
  {
    value: 'stableford',
    label: 'Stableford',
    icon: 'star-outline',
    desc: 'Points per hole adjusted for handicap. Higher score wins.',
    team: false,
  },
  {
    value: 'stroke',
    label: 'Stroke Play',
    icon: 'golf-outline',
    desc: 'Count every shot. Fewest total strokes wins.',
    team: false,
  },
  {
    value: 'net_stroke',
    label: 'Net Stroke',
    icon: 'ribbon-outline',
    desc: 'Gross strokes minus your handicap. Levels the field.',
    team: false,
  },
  {
    value: 'match_play',
    label: 'Match Play',
    icon: 'flash-outline',
    desc: 'Win holes, not strokes. First to win more than half of 18.',
    team: false,
  },
  {
    value: 'scramble',
    label: 'Scramble',
    icon: 'people-outline',
    desc: 'Team picks the best shot each time. All play from there.',
    team: true,
  },
  {
    value: 'best_ball',
    label: 'Best Ball',
    icon: 'trophy-outline',
    desc: 'Each player plays their own ball. Best score per hole counts.',
    team: true,
  },
  {
    value: 'skins',
    label: 'Skins',
    icon: 'flame-outline',
    desc: 'Win a hole outright to take the skin. Ties carry over.',
    team: false,
  },
];

const TEAM_SIZES = [2, 3, 4];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDisplay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreateCompetitionScreen({ navigation, route }: Props) {
  const { clubId, clubName } = route.params;
  const insets = useSafeAreaInsets();

  const [step,     setStep]     = useState<'format' | 'details'>('format');
  const [format,   setFormat]   = useState('stableford');
  const [teamSize, setTeamSize] = useState(2);

  // Details
  const [name,        setName]        = useState('');
  const [date,        setDate]        = useState(isoFromDate(new Date()));
  const [course,      setCourse]      = useState('');
  const [description, setDescription] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const selectedFormat = FORMATS.find(f => f.value === format)!;
  const isTeam = selectedFormat.team;

  async function handleCreate() {
    setError('');
    if (!name.trim()) { setError('Competition name is required'); return; }
    if (!course.trim()) { setError('Course name is required'); return; }
    setSaving(true);
    try {
      const { data } = await client.post('/api/competitions', {
        name:        name.trim(),
        description: description.trim() || null,
        date,
        courseName:  course.trim(),
        clubId,
        format,
        teamSize: isTeam ? teamSize : 1,
      });
      navigation.goBack();
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not create competition');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#111" />
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
                      <Ionicons name={f.icon} size={22} color={active ? GREEN : '#888'} />
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
                      <Ionicons name="checkmark-circle" size={20} color={GREEN} style={{ flexShrink: 0 }} />
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
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2: Details ── */}
        {step === 'details' && (
          <>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep('format')}>
              <Ionicons name="arrow-back" size={16} color={GREEN} />
              <Text style={styles.backBtnText}>Back to format</Text>
            </TouchableOpacity>

            {/* Selected format summary */}
            <View style={styles.formatSummary}>
              <View style={styles.formatIconWrapActive}>
                <Ionicons name={selectedFormat.icon} size={18} color={GREEN} />
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
              autoCapitalize="words"
            />

            <DatePickerField
              label="Date"
              value={date}
              onChange={setDate}
              style={{ marginTop: 14, marginBottom: 2 }}
            />

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Course</Text>
            <TextInput
              style={styles.fieldInput}
              value={course}
              onChangeText={setCourse}
              placeholder="e.g. Royal Melbourne Golf Club"
              autoCapitalize="words"
            />

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
              Description <Text style={styles.optionalTag}>(optional)</Text>
            </Text>
            <TextInput
              style={[styles.fieldInput, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Format details, prizes, starting times…"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.nextBtn, (!name.trim() || !course.trim()) && styles.nextBtnDisabled]}
              onPress={handleCreate}
              disabled={saving || !name.trim() || !course.trim()}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Text style={styles.nextBtnText}>Create Competition</Text>
                    <Ionicons name="checkmark" size={18} color="#fff" />
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
  root:    { flex: 1, backgroundColor: '#f5f5f7' },
  content: { padding: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4, paddingTop: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  clubLabel:   { fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 20 },

  stepTitle: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 6 },
  stepSub:   { fontSize: 14, color: '#888', marginBottom: 20, lineHeight: 20 },

  // Format cards
  formatGrid: { gap: 10, marginBottom: 16 },
  formatCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: '#e5e5e5',
  },
  formatCardActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  formatIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  formatIconWrapActive: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(26,127,60,0.12)', justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  formatCardText:  { flex: 1 },
  formatLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  formatLabel:     { fontSize: 15, fontWeight: '700', color: '#333' },
  formatLabelActive: { color: GREEN },
  formatDesc:      { fontSize: 12, color: '#aaa', lineHeight: 17 },
  formatDescActive: { color: '#555' },
  teamPill: {
    backgroundColor: '#e0f2fe', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  teamPillText: { fontSize: 10, fontWeight: '700', color: '#0369a1' },

  // Team size
  teamSizeCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 16, borderWidth: 1.5, borderColor: GREEN,
  },
  teamSizeLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 10 },
  teamSizeRow:   { flexDirection: 'row', gap: 8 },
  teamSizeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e5e5e5', backgroundColor: '#fafafa', alignItems: 'center',
  },
  teamSizeBtnActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  teamSizeBtnText:   { fontSize: 13, fontWeight: '600', color: '#888' },
  teamSizeBtnTextActive: { color: GREEN },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, marginTop: 8,
  },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Details step
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16,
  },
  backBtnText: { fontSize: 14, fontWeight: '600', color: GREEN },

  formatSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12,
    marginBottom: 20, borderWidth: 1, borderColor: 'rgba(26,127,60,0.15)',
  },
  formatSummaryLabel: { fontSize: 15, fontWeight: '700', color: GREEN, flex: 1 },
  formatSummaryTeam:  { fontSize: 12, color: '#888' },

  errorText: { color: '#c0392b', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  fieldLabel: {
    fontSize: 11, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
  },
  optionalTag: { fontWeight: '400', color: '#bbb', textTransform: 'none', letterSpacing: 0 },
  fieldInput: {
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    color: '#111', backgroundColor: '#fff', marginBottom: 2,
  },
  textArea: { height: 90, paddingTop: 12 },
  dateTrigger: {
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2,
  },
  dateTriggerText: { fontSize: 15, color: '#111' },
});
