import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// ── Helpers ───────────────────────────────────────────────────────────────────

function partsFromIso(iso: string): { d: string; m: string; y: string } {
  if (!iso) {
    const now = new Date();
    return { d: String(now.getDate()), m: String(now.getMonth() + 1), y: String(now.getFullYear()) };
  }
  const [year, mon, day] = iso.split('-').map(s => String(parseInt(s)));
  return { d: day, m: mon, y: year };
}

function isoFromParts(d: string, m: string, y: string): string {
  const day  = Math.max(1, Math.min(31, parseInt(d) || 1));
  const mon  = Math.max(1, Math.min(12, parseInt(m) || 1));
  const year = parseInt(y) || new Date().getFullYear();
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fmtDisplay(iso: string): string {
  if (!iso) return 'Select date';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  label?: string;
  value: string;        // YYYY-MM-DD
  onChange: (v: string) => void;
  style?: object;
};

export default function DatePickerField({ label, value, onChange, style }: Props) {
  const [visible, setVisible] = useState(false);
  const [d, setD] = useState('');
  const [m, setM] = useState('');
  const [y, setY] = useState('');

  function open() {
    const parts = partsFromIso(value);
    setD(parts.d); setM(parts.m); setY(parts.y);
    setVisible(true);
  }

  function confirm() {
    onChange(isoFromParts(d, m, y));
    setVisible(false);
  }

  const preview = d && m && y ? fmtDisplay(isoFromParts(d, m, y)) : '';

  return (
    <View style={style}>
      {label ? <Text style={s.label}>{label}</Text> : null}

      <TouchableOpacity style={s.trigger} onPress={open} activeOpacity={0.7}>
        <Text style={value ? s.triggerText : s.placeholder}>{fmtDisplay(value)}</Text>
        <Ionicons name="calendar-outline" size={16} color="#aaa" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setVisible(false)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            <Text style={s.title}>Select Date</Text>

            <View style={s.row}>
              <View style={s.col}>
                <Text style={s.colLabel}>Day</Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  value={d}
                  onChangeText={setD}
                  maxLength={2}
                  placeholder="DD"
                  placeholderTextColor="#bbb"
                  selectTextOnFocus
                />
              </View>
              <View style={s.col}>
                <Text style={s.colLabel}>Month</Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  value={m}
                  onChangeText={setM}
                  maxLength={2}
                  placeholder="MM"
                  placeholderTextColor="#bbb"
                  selectTextOnFocus
                />
              </View>
              <View style={[s.col, { flex: 1.5 }]}>
                <Text style={s.colLabel}>Year</Text>
                <TextInput
                  style={s.numInput}
                  keyboardType="number-pad"
                  value={y}
                  onChangeText={setY}
                  maxLength={4}
                  placeholder="YYYY"
                  placeholderTextColor="#bbb"
                  selectTextOnFocus
                />
              </View>
            </View>

            {preview ? (
              <Text style={s.preview}>{preview}</Text>
            ) : null}

            <View style={s.actions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setVisible(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
                <Text style={s.confirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const GREEN = colors.primary;

const s = StyleSheet.create({
  label:       { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  trigger:     { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  triggerText: { fontSize: 15, color: '#111' },
  placeholder: { fontSize: 15, color: '#aaa' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet:   { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 },
  title:   { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 20, textAlign: 'center' },

  row:     { flexDirection: 'row', gap: 10, marginBottom: 16 },
  col:     { flex: 1 },
  colLabel:{ fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, textAlign: 'center' },
  numInput:{
    borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 12, fontSize: 20,
    color: '#111', backgroundColor: '#fafafa', textAlign: 'center', fontWeight: '600',
  },

  preview: { textAlign: 'center', fontSize: 14, color: GREEN, fontWeight: '600', marginBottom: 20 },

  actions:    { flexDirection: 'row', gap: 10 },
  cancelBtn:  { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#555', fontWeight: '500' },
  confirmBtn: { flex: 2, backgroundColor: GREEN, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmText:{ fontSize: 15, color: '#fff', fontWeight: '600' },
});
