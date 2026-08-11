import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import client from '../api/client';
import { RootStackParamList } from '../../App';
import { colors, fontSize, spacing, radius } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ManualCourseResult = {
  id: string;
  club_name: string;
  location: { city: string; country: string };
};

export type ManualCourseTee = {
  colour: string;
  name: string;
  slopeRating: number | null;
  courseRating: number | null;
  parTotal: number | null;
  holes: { number: number; par: number; si: number }[];
};

type HoleData = { number: number; par: number; si: number };

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ManualCourse'>;
  route: { params: {
    onSave: (course: ManualCourseResult, tees: ManualCourseTee[]) => void;
  }};
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultHoles(): HoleData[] {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, si: i + 1 }));
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ManualCourseEntryScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();

  const [name,         setName]         = useState('');
  const [city,         setCity]         = useState('');
  const [slopeRating,  setSlopeRating]  = useState('');
  const [courseRating, setCourseRating] = useState('');
  const [holes,        setHoles]        = useState<HoleData[]>(defaultHoles());
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  function setPar(idx: number, par: number) {
    setHoles(prev => prev.map((h, i) => i === idx ? { ...h, par } : h));
  }

  function setSI(idx: number, text: string) {
    const n = parseInt(text, 10);
    setHoles(prev => prev.map((h, i) => {
      if (i !== idx) return h;
      return { ...h, si: isNaN(n) ? 0 : n };
    }));
  }

  function validate(): string | null {
    if (!name.trim()) return 'Course name is required';
    const siVals = holes.map(h => h.si);
    if (siVals.some(s => s < 1 || s > 18)) return 'All stroke indexes must be between 1 and 18';
    if (new Set(siVals).size !== 18)        return 'Each stroke index must be unique (1–18)';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);
    try {
      const parTotal = holes.reduce((s, h) => s + h.par, 0);
      const { data } = await client.post('/api/courses/custom', {
        name:         name.trim(),
        city:         city.trim() || null,
        country:      'Australia',
        slopeRating:  slopeRating  ? parseFloat(slopeRating)  : null,
        courseRating: courseRating ? parseFloat(courseRating) : null,
        parTotal,
        holes: holes.map(h => ({ number: h.number, par: h.par, si: h.si })),
      });

      const tees: ManualCourseTee[] = [{
        colour:       'Standard',
        name:         'Standard',
        slopeRating:  slopeRating  ? parseFloat(slopeRating)  : null,
        courseRating: courseRating ? parseFloat(courseRating) : null,
        parTotal,
        holes: holes.map(h => ({ number: h.number, par: h.par, si: h.si })),
      }];

      route.params.onSave(
        { id: data.id, club_name: data.club_name, location: data.location },
        tees
      );
      navigation.goBack();
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Could not save course');
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top }]}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Course</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving || !canSave}>
            {saving
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.headerSave, !canSave && styles.headerSaveDisabled]}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* ── Course info ── */}
          <Text style={styles.sectionLabel}>Course Details</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Course Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Royal Melbourne Golf Club"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              autoFocus
            />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>City / State</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Melbourne, VIC"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
            />

            <View style={styles.ratingRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Slope Rating</Text>
                <TextInput
                  style={styles.input}
                  value={slopeRating}
                  onChangeText={setSlopeRating}
                  placeholder="e.g. 126"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Course Rating</Text>
                <TextInput
                  style={styles.input}
                  value={courseRating}
                  onChangeText={setCourseRating}
                  placeholder="e.g. 73.2"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>

          {/* ── Hole data ── */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Hole Data</Text>
          <Text style={styles.sectionHint}>
            Set the par and stroke index (difficulty ranking) for each hole.
          </Text>
          <View style={styles.card}>
            <View style={styles.holeHeaderRow}>
              <Text style={[styles.holeHeaderCell, styles.colHole]}>#</Text>
              <Text style={[styles.holeHeaderCell, styles.colPar]}>Par</Text>
              <Text style={[styles.holeHeaderCell, styles.colSI]}>Stroke Index</Text>
            </View>
            {holes.map((hole, i) => (
              <View key={i} style={[styles.holeRow, i < 17 && styles.holeRowBorder]}>
                <Text style={[styles.holeNum, styles.colHole]}>{hole.number}</Text>

                <View style={[styles.parGroup, styles.colPar]}>
                  {[3, 4, 5].map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.parBtn, hole.par === p && styles.parBtnActive]}
                      onPress={() => setPar(i, p)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.parBtnText, hole.par === p && styles.parBtnTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  style={[styles.siInput, styles.colSI, hole.si < 1 || hole.si > 18 ? styles.siInputError : null]}
                  value={hole.si > 0 ? String(hole.si) : ''}
                  onChangeText={text => setSI(i, text)}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                />
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !canSave}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={colors.textInverse} size="small" />
              : <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.textInverse} />
                  <Text style={styles.saveBtnText}>Save & Use This Course</Text>
                </>
            }
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const COL_HOLE = 28;
const COL_SI   = 72;

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle:        { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  headerSave:         { fontSize: fontSize.base, fontWeight: '700', color: colors.primary },
  headerSaveDisabled: { opacity: 0.35 },

  content:      { padding: spacing.md },
  errorText:    { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },
  sectionLabel: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1.0, marginBottom: spacing.xs,
  },
  sectionHint:  { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 17 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  fieldLabel: {
    fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.base,
    color: colors.textPrimary, backgroundColor: colors.background,
  },
  ratingRow: { flexDirection: 'row' },

  // Hole grid
  holeHeaderRow: {
    flexDirection: 'row', alignItems: 'center', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 2,
  },
  holeHeaderCell: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  holeRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  holeRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border + '50' },
  holeNum:       { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },

  colHole: { width: COL_HOLE },
  colPar:  { flex: 1 },
  colSI:   { width: COL_SI, textAlign: 'center' },

  parGroup:        { flexDirection: 'row', gap: 5 },
  parBtn: {
    flex: 1, paddingVertical: 5, alignItems: 'center',
    borderRadius: 6, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.background,
  },
  parBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primary },
  parBtnText:       { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  parBtnTextActive: { color: colors.textInverse },

  siInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 8,
    paddingVertical: 5, fontSize: fontSize.sm, fontWeight: '700',
    color: colors.textPrimary, backgroundColor: colors.background,
    textAlign: 'center',
  },
  siInputError: { borderColor: colors.danger },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14,
    marginTop: spacing.md,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText:     { color: colors.textInverse, fontWeight: '700', fontSize: fontSize.md },
});
