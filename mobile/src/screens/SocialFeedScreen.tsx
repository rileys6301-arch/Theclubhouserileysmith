import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, RefreshControl,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';
import { useDrawer } from '../context/DrawerContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type Reaction  = { count: number; reacted: boolean };
type Reactions = Record<string, Reaction>;

type Comment = {
  id: string; body: string; created_at: string;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type FeedRound = {
  id: number; played_at: string; course_name: string;
  score: number; stableford: number; round_type: string;
  photo_data: string | null; created_at: string;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
  comment_count: number;
  reactions: Reactions;
};

type Props = {
  navigation: any;
  route: { params: { clubId: number; clubName: string; userId: string } };
};

const EMOJIS = ['👍', '❤️', '🔥', '😮'] as const;

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
function scoreColor(stableford: number) {
  if (stableford >= 36) return colors.primary;
  if (stableford <= 28) return colors.danger;
  return '#E09050';
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SocialFeedScreen({ navigation, route }: Props) {
  const { clubId, clubName, userId } = route.params;
  const insets = useSafeAreaInsets();
  const { openDrawer, hasDrawer } = useDrawer();

  const [feed,       setFeed]       = useState<FeedRound[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Expanded comments per round
  const [expanded,      setExpanded]      = useState<Record<number, boolean>>({});
  const [comments,      setComments]      = useState<Record<number, Comment[]>>({});
  const [commentLoading,setCommentLoading]= useState<Record<number, boolean>>({});

  // Comment input per round
  const [commentInput,  setCommentInput]  = useState<Record<number, string>>({});
  const [commentSaving, setCommentSaving] = useState<Record<number, boolean>>({});

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchFeed = useCallback(async () => {
    try {
      const { data } = await client.get<FeedRound[]>(`/api/social/feed?club_id=${clubId}`);
      setFeed(Array.isArray(data) ? data : []);
    } catch { /* stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);
  function onRefresh() { setRefreshing(true); fetchFeed(); }

  async function loadComments(roundId: number) {
    if (comments[roundId]) return;
    setCommentLoading(prev => ({ ...prev, [roundId]: true }));
    try {
      const { data } = await client.get<Comment[]>(`/api/rounds/${roundId}/comments`);
      setComments(prev => ({ ...prev, [roundId]: data }));
    } catch { /* ignore */ } finally {
      setCommentLoading(prev => ({ ...prev, [roundId]: false }));
    }
  }

  function toggleExpand(roundId: number) {
    const next = !expanded[roundId];
    setExpanded(prev => ({ ...prev, [roundId]: next }));
    if (next) loadComments(roundId);
  }

  // ── Reactions ─────────────────────────────────────────────────────────────

  async function toggleReaction(roundId: number, emoji: string) {
    try {
      const { data } = await client.post<{ action: 'added' | 'removed' }>(
        `/api/rounds/${roundId}/reactions`, { emoji }
      );
      const delta = data.action === 'added' ? 1 : -1;
      setFeed(prev => prev.map(r => {
        if (r.id !== roundId) return r;
        const existing = r.reactions[emoji] ?? { count: 0, reacted: false };
        return {
          ...r,
          reactions: {
            ...r.reactions,
            [emoji]: { count: Math.max(0, existing.count + delta), reacted: data.action === 'added' },
          },
        };
      }));
    } catch { /* ignore */ }
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async function postComment(roundId: number) {
    const body = (commentInput[roundId] ?? '').trim();
    if (!body) return;
    setCommentSaving(prev => ({ ...prev, [roundId]: true }));
    try {
      const { data } = await client.post<Comment>(`/api/rounds/${roundId}/comments`, { body });
      setComments(prev => ({ ...prev, [roundId]: [...(prev[roundId] ?? []), data] }));
      setFeed(prev => prev.map(r => r.id === roundId ? { ...r, comment_count: r.comment_count + 1 } : r));
      setCommentInput(prev => ({ ...prev, [roundId]: '' }));
    } catch { Alert.alert('Error', 'Could not post comment'); }
    finally { setCommentSaving(prev => ({ ...prev, [roundId]: false })); }
  }

  function confirmDeleteComment(roundId: number, commentId: string) {
    Alert.alert('Delete Comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/rounds/${roundId}/comments/${commentId}`);
          setComments(prev => ({ ...prev, [roundId]: (prev[roundId] ?? []).filter(c => c.id !== commentId) }));
          setFeed(prev => prev.map(r => r.id === roundId ? { ...r, comment_count: Math.max(0, r.comment_count - 1) } : r));
        } catch { Alert.alert('Error', 'Could not delete comment'); }
      }},
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.root}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
          {hasDrawer ? (
            <TouchableOpacity
              style={s.backBtn}
              onPress={openDrawer}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="menu" size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>
          )}
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Social Feed</Text>
            <Text style={s.headerSub}>{clubName}</Text>
          </View>
          <View style={{ width: 64 }} />
        </View>

        {/* ── Feed ── */}
        {feed.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="golf-outline" size={40} color="#ddd" style={{ marginBottom: 10 }} />
            <Text style={s.emptyText}>No rounds submitted yet</Text>
            <Text style={s.emptySubText}>When club members submit rounds they'll appear here</Text>
          </View>
        ) : (
          feed.map(round => {
            const isExpanded = !!expanded[round.id];
            const roundComments = comments[round.id] ?? [];
            const isLoadingComments = !!commentLoading[round.id];
            const sc = scoreColor(round.stableford);
            const isMe = round.user_id === userId;

            return (
              <View key={round.id} style={s.roundCard}>
                {/* Author row */}
                <View style={s.authorRow}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('MemberProfile', {
                      userId: round.user_id,
                      name: personName(round.first_name, round.last_name, round.email),
                    })}
                    activeOpacity={0.7}
                    style={s.authorPressable}
                  >
                    <View style={[s.avatar, isMe && s.avatarMe]}>
                      <Text style={s.avatarText}>{personInitials(round.first_name, round.last_name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.authorName}>
                        {personName(round.first_name, round.last_name, round.email)}
                        {isMe ? ' (You)' : ''}
                      </Text>
                      <Text style={s.authorDate}>{formatDate(round.played_at)}</Text>
                    </View>
                  </TouchableOpacity>
                  {round.round_type === 'scoring' && (
                    <View style={s.scoringBadge}>
                      <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                      <Text style={s.scoringBadgeText}>Scoring</Text>
                    </View>
                  )}
                </View>

                {/* Course + scores */}
                <TouchableOpacity
                  onPress={() => navigation.navigate('RoundDetail', { roundId: String(round.id) })}
                  activeOpacity={0.75}
                  style={s.courseRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.courseName} numberOfLines={1}>{round.course_name}</Text>
                  </View>
                  <View style={s.scoreChips}>
                    <View style={[s.scoreChip, { borderColor: sc + '55' }]}>
                      <Text style={[s.scoreChipPts, { color: sc }]}>{round.stableford}</Text>
                      <Text style={s.scoreChipLabel}>pts</Text>
                    </View>
                    <View style={s.scoreChipGross}>
                      <Text style={s.scoreChipGrossVal}>{round.score}</Text>
                      <Text style={s.scoreChipLabel}>gross</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.border} style={{ marginLeft: 4 }} />
                </TouchableOpacity>

                {/* Photo */}
                {round.photo_data ? (
                  <Image
                    source={{ uri: round.photo_data }}
                    style={s.roundPhoto}
                    resizeMode="cover"
                  />
                ) : null}

                {/* Reaction bar */}
                <View style={s.reactionBar}>
                  {EMOJIS.map(emoji => {
                    const r = round.reactions[emoji];
                    const reacted = r?.reacted ?? false;
                    const count   = r?.count   ?? 0;
                    return (
                      <TouchableOpacity
                        key={emoji}
                        style={[s.reactionBtn, reacted && s.reactionBtnActive]}
                        onPress={() => toggleReaction(round.id, emoji)}
                        activeOpacity={0.7}
                      >
                        <Text style={s.reactionEmoji}>{emoji}</Text>
                        {count > 0 && (
                          <Text style={[s.reactionCount, reacted && s.reactionCountActive]}>
                            {count}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Comments toggle */}
                <TouchableOpacity
                  style={s.commentsToggle}
                  onPress={() => toggleExpand(round.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isExpanded ? 'chatbubble' : 'chatbubble-outline'}
                    size={14}
                    color={isExpanded ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[s.commentsToggleText, isExpanded && { color: colors.primary }]}>
                    {round.comment_count > 0
                      ? `${round.comment_count} comment${round.comment_count !== 1 ? 's' : ''}`
                      : 'Comment'}
                  </Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>

                {/* Comments section */}
                {isExpanded && (
                  <View style={s.commentsSection}>
                    {isLoadingComments ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 12 }} />
                    ) : (
                      <>
                        {roundComments.length === 0 && (
                          <Text style={s.noCommentsText}>No comments yet — be the first!</Text>
                        )}
                        {roundComments.map(c => (
                          <View key={c.id} style={s.commentRow}>
                            <View style={s.commentAvatar}>
                              <Text style={s.commentAvatarText}>
                                {personInitials(c.first_name, c.last_name)}
                              </Text>
                            </View>
                            <View style={s.commentBody}>
                              <View style={s.commentTopRow}>
                                <Text style={s.commentAuthor}>
                                  {personName(c.first_name, c.last_name, c.email)}
                                </Text>
                                <Text style={s.commentDate}>{formatDate(c.created_at)}</Text>
                                {c.user_id === userId && (
                                  <TouchableOpacity
                                    onPress={() => confirmDeleteComment(round.id, c.id)}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    style={{ marginLeft: 'auto' }}
                                  >
                                    <Ionicons name="close-circle-outline" size={14} color="#ccc" />
                                  </TouchableOpacity>
                                )}
                              </View>
                              <Text style={s.commentText}>{c.body}</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}

                    {/* Comment input */}
                    <View style={s.commentInputRow}>
                      <TextInput
                        style={s.commentInput}
                        value={commentInput[round.id] ?? ''}
                        onChangeText={v => setCommentInput(prev => ({ ...prev, [round.id]: v }))}
                        placeholder="Add a comment..."
                        placeholderTextColor="#bbb"
                        multiline
                        maxLength={500}
                      />
                      <TouchableOpacity
                        style={[
                          s.commentSendBtn,
                          !(commentInput[round.id]?.trim()) && s.commentSendBtnDisabled,
                        ]}
                        onPress={() => postComment(round.id)}
                        disabled={commentSaving[round.id] || !commentInput[round.id]?.trim()}
                        activeOpacity={0.8}
                      >
                        {commentSaving[round.id]
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Ionicons name="send" size={16} color="#fff" />
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.background },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 2, width: 64 },
  backText:     { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  headerSub:    { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  emptyCard:    { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', marginTop: spacing.md },
  emptyText:    { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptySubText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  // Round card
  roundCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadows.card,
  },

  authorRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  authorPressable:{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar:         { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarMe:       { backgroundColor: colors.primary + '22' },
  avatarText:     { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  authorName:     { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  authorDate:     { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  scoringBadge:     { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.primary + '12', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  scoringBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },

  courseRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.sm + 2 },
  courseName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },

  scoreChips:      { flexDirection: 'row', gap: spacing.sm, flexShrink: 0 },
  scoreChip:       { alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4, minWidth: 44, backgroundColor: colors.surface },
  scoreChipPts:    { fontSize: fontSize.md, fontWeight: '800', lineHeight: 22 },
  scoreChipGross:  { alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4, minWidth: 40 },
  scoreChipGrossVal:{ fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary, lineHeight: 22 },
  scoreChipLabel:  { fontSize: 9, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },

  roundPhoto: { width: '100%', height: 220, borderRadius: radius.md, marginBottom: spacing.sm, backgroundColor: colors.surfaceMuted },

  reactionBar:          { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.sm },
  reactionBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.background },
  reactionBtnActive:    { borderColor: colors.primary + '66', backgroundColor: colors.primary + '10' },
  reactionEmoji:        { fontSize: 16 },
  reactionCount:        { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  reactionCountActive:  { color: colors.primary },

  commentsToggle:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: spacing.xs },
  commentsToggleText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, flex: 1 },

  commentsSection: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
  noCommentsText:  { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.sm },

  commentRow:        { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  commentAvatar:     { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1 },
  commentAvatarText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  commentBody:       { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.sm },
  commentTopRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 3 },
  commentAuthor:     { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  commentDate:       { fontSize: 11, color: colors.textSecondary },
  commentText:       { fontSize: 13, color: '#444', lineHeight: 18 },

  commentInputRow:        { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.xs },
  commentInput:           { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, fontSize: 14, color: '#111', backgroundColor: '#fafafa', maxHeight: 100 },
  commentSendBtn:         { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  commentSendBtnDisabled: { backgroundColor: colors.border },
});
