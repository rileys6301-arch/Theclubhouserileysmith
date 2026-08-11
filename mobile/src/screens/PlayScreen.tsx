import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize } from '../theme';

// Placeholder — this screen is never actually displayed.
// The Play tab intercepts tabPress and opens the LogRound modal instead.
export default function PlayScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Opening round logger…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: fontSize.base, color: colors.textSecondary },
});
