import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, RefreshControl,
  KeyboardAvoidingView, Platform, Image, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import client from '../api/client';
import { colors, fontSize, spacing, radius, shadows } from '../theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type Reaction = { count: number; reacted: boolean };
type Reactions = Record<string, Reaction>;

type Comment = {
  id: string; body: string; created_at: string;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type Notice = {
  id: string; title: string; body: string; created_at: string;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
  photo_url: string | null;
  comment_count: number;
  reactions: Reactions;
};

type NoticeDetail = Notice & { photos: { id: string; photo_data: string }[]; comments: Comment[] };

type RecentRound = {
  id: string; played_at: string; course_name: string;
  score: number; stableford: number; course_handicap: number | null; is_nine_hole: boolean;
  user_id: string; first_name: string | null; last_name: string | null; email: string;
};

type Props = {
  navigation: any;
  route: { params: { clubId: number; clubName: string; isOwner: boolean; userId: string } };
};

const EMOJIS = ['👍', '❤️', '😂', '😮'] as const;

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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NoticeBoardScreen({ navigation, route }: Props) {
  const { clubId, clubName, isOwner, userId } = route.params;
  const insets = useSafeAreaInsets();

  const [notices,      setNotices]      = useState<Notice[]>([]);
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  // Expanded comments per notice
  const [expanded,      setExpanded]      = useState<Record<string, boolean>>({});
  const [detailCache,   setDetailCache]   = useState<Record<string, NoticeDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});

  // New comment input per notice
  const [commentInput,  setCommentInput]  = useState<Record<string, string>>({});
  const [commentSaving, setCommentSaving] = useState<Record<string, boolean>>({});

  // Post form modal
  const [showPostModal, setShowPostModal] = useState(false);
  const [nTitle,   setNTitle]   = useState('');
  const [nBody,    setNBody]    = useState('');
  const [nPhoto,   setNPhoto]   = useState<string | null>(null);
  const [nError,   setNError]   = useState('');
  const [nSaving,  setNSaving]  = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchNotices = useCallback(async () => {
    try {
      const [noticesRes, recentRes] = await Promise.all([
        client.get<Notice[]>(`/api/notices?club_id=${clubId}`),
        client.get<RecentRound[]>(`/api/rounds/club-recent?club_id=${clubId}`).catch(() => ({ data: [] })),
      ]);
      setNotices(Array.isArray(noticesRes.data) ? noticesRes.data : []);
      setRecentRounds(Array.isArray(recentRes.data) ? recentRes.data : []);
    } catch { /* keep stale */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clubId]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  function onRefresh() { setRefreshing(true); fetchNotices(); }

  async function loadDetail(noticeId: string) {
    if (detailCache[noticeId]) return;
    setDetailLoading(prev => ({ ...prev, [noticeId]: true }));
    try {
      const { data } = await client.get<NoticeDetail>(`/api/notices/${noticeId}`);
      setDetailCache(prev => ({ ...prev, [noticeId]: data }));
    } catch { /* ignore */ } finally {
      setDetailLoading(prev => ({ ...prev, [noticeId]: false }));
    }
  }

  function toggleExpand(noticeId: string) {
    const next = !expanded[noticeId];
    setExpanded(prev => ({ ...prev, [noticeId]: next }));
    if (next) loadDetail(noticeId);
  }

  // ── Post notice ───────────────────────────────────────────────────────────

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      const asset = result.assets[0];
      setNPhoto(`data:image/jpeg;base64,${asset.base64}`);
    }
  }

  async function postNotice() {
    setNError('');
    if (!nTitle.trim()) { setNError('Title is required'); return; }
    if (!nBody.trim())  { setNError('Message is required'); return; }
    setNSaving(true);
    try {
      const { data } = await client.post<Notice>('/api/notices', {
        title: nTitle.trim(), body: nBody.trim(), clubId,
        photo_data: nPhoto ?? undefined,
      });
      setNotices(prev => [data, ...prev]);
      setNTitle(''); setNBody(''); setNPhoto(null);
      setShowPostModal(false);
    } catch (e: any) {
      setNError(e.response?.data?.error ?? 'Could not post notice');
    } finally { setNSaving(false); }
  }

  function openPostModal() {
    setNTitle(''); setNBody(''); setNPhoto(null); setNError('');
    setShowPostModal(true);
  }

  // ── Delete notice ─────────────────────────────────────────────────────────

  function confirmDeleteNotice(id: string) {
    Alert.alert('Delete Notice', 'Remove this notice from the board?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/notices/${id}`);
          setNotices(prev => prev.filter(n => n.id !== id));
          setDetailCache(prev => { const c = { ...prev }; delete c[id]; return c; });
        } catch { Alert.alert('Error', 'Could not delete notice'); }
      }},
    ]);
  }

  // ── Reactions ─────────────────────────────────────────────────────────────

  async function toggleReaction(noticeId: string, emoji: string) {
    try {
      const { data } = await client.post<{ action: 'added' | 'removed' }>(
        `/api/notices/${noticeId}/reactions`, { emoji }
      );
      const delta = data.action === 'added' ? 1 : -1;
      const updateReactions = (prev: Notice[]) =>
        prev.map(n => {
          if (n.id !== noticeId) return n;
          const existing = n.reactions[emoji] ?? { count: 0, reacted: false };
          return {
            ...n,
            reactions: {
              ...n.reactions,
              [emoji]: {
                count:   Math.max(0, existing.count + delta),
                reacted: data.action === 'added',
              },
            },
          };
        });
      setNotices(updateReactions);
      // also update detail cache if loaded
      setDetailCache(prev => {
        if (!prev[noticeId]) return prev;
        const n = prev[noticeId];
        const existing = n.reactions[emoji] ?? { count: 0, reacted: false };
        return {
          ...prev,
          [noticeId]: {
            ...n,
            reactions: {
              ...n.reactions,
              [emoji]: { count: Math.max(0, existing.count + delta), reacted: data.action === 'added' },
            },
          },
        };
      });
    } catch { /* ignore optimistic failure */ }
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async function postComment(noticeId: string) {
    const body = (commentInput[noticeId] ?? '').trim();
    if (!body) return;
    setCommentSaving(prev => ({ ...prev, [noticeId]: true }));
    try {
      const { data } = await client.post<Comment>(`/api/notices/${noticeId}/comments`, { body });
      setDetailCache(prev => {
        if (!prev[noticeId]) return prev;
        return { ...prev, [noticeId]: { ...prev[noticeId], comments: [...prev[noticeId].comments, data] } };
      });
      setNotices(prev => prev.map(n => n.id === noticeId ? { ...n, comment_count: n.comment_count + 1 } : n));
      setCommentInput(prev => ({ ...prev, [noticeId]: '' }));
    } catch { Alert.alert('Error', 'Could not post comment'); }
    finally { setCommentSaving(prev => ({ ...prev, [noticeId]: false })); }
  }

  function confirmDeleteComment(noticeId: string, commentId: string) {
    Alert.alert('Delete Comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await client.delete(`/api/notices/${noticeId}/comments/${commentId}`);
          setDetailCache(prev => {
            if (!prev[noticeId]) return prev;
            return { ...prev, [noticeId]: { ...prev[noticeId], comments: prev[noticeId].comments.filter(c => c.id !== commentId) } };
          });
          setNotices(prev => prev.map(n => n.id === noticeId ? { ...n, comment_count: Math.max(0, n.comment_count - 1) } : n));
        } catch { Alert.alert('Error', 'Could not delete comment'); }
      }},
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
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
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>

          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Notice Board</Text>
            <Text style={s.headerSub}>{clubName}</Text>
          </View>

          {isOwner ? (
            <TouchableOpacity style={s.postBtn} onPress={openPostModal} activeOpacity={0.8}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={s.postBtnText}>Post</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 64 }} />
          )}
        </View>

        {/* ── Recent Rounds ── */}
        {recentRounds.length > 0 && (
          <View style={s.recentCard}>
            <View style={s.recentHeader}>
              <Ionicons name="golf-outline" size={16} color={colors.primary} />
              <Text style={s.recentTitle}>Recent Rounds</Text>
              <Text style={s.recentSub}>Last 7 days</Text>
            </View>
            {recentRounds.map(r => (
              <View key={r.id} style={s.recentRow}>
                <View style={s.recentAvatar}>
                  <Text style={s.recentAvatarText}>
                    {personInitials(r.first_name, r.last_name)}
                  </Text>
                </View>
                <View style={s.recentInfo}>
                  <Text style={s.recentName}>
                    {personName(r.first_name, r.last_name, r.email)}
                  </Text>
                  <Text style={s.recentCourse} numberOfLines={1}>
                    {r.course_name}{r.is_nine_hole ? ' · 9 holes' : ''}
                  </Text>
                </View>
                <View style={s.recentScores}>
                  <Text style={s.recentPts}>{r.stableford} pts</Text>
                  <Text style={s.recentWhen}>{timeAgo(r.played_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Notices ── */}
        {notices.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="megaphone-outline" size={40} color="#ddd" style={{ marginBottom: 10 }} />
            <Text style={s.emptyText}>
              {isOwner ? 'No notices yet — tap Post to add one' : 'No notices yet'}
            </Text>
          </View>
        ) : (
          notices.map(notice => {
            const isExpanded = !!expanded[notice.id];
            const detail     = detailCache[notice.id];
            const isLoading  = !!detailLoading[notice.id];
            const canDelete  = isOwner || notice.user_id === userId;

            return (
              <View key={notice.id} style={s.noticeCard}>
                {/* Author row */}
                <View style={s.noticeAuthorRow}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>
                      {personInitials(notice.first_name, notice.last_name)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.authorName}>
                      {personName(notice.first_name, notice.last_name, notice.email)}
                    </Text>
                    <Text style={s.authorDate}>{formatDate(notice.created_at)}</Text>
                  </View>
                  {canDelete && (
                    <TouchableOpacity
                      onPress={() => confirmDeleteNotice(notice.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Title + body */}
                <Text style={s.noticeTitle}>{notice.title}</Text>
                <Text style={s.noticeBody}>{notice.body}</Text>

                {/* Photo */}
                {notice.photo_url ? (
                  <Image
                    source={{ uri: notice.photo_url }}
                    style={s.noticePhoto}
                    resizeMode="cover"
                  />
                ) : null}

                {/* Reaction bar */}
                <View style={s.reactionBar}>
                  {EMOJIS.map(emoji => {
                    const r = notice.reactions[emoji];
                    const reacted = r?.reacted ?? false;
                    const count   = r?.count ?? 0;
                    return (
                      <TouchableOpacity
                        key={emoji}
                        style={[s.reactionBtn, reacted && s.reactionBtnActive]}
                        onPress={() => toggleReaction(notice.id, emoji)}
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
                  onPress={() => toggleExpand(notice.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isExpanded ? 'chatbubble' : 'chatbubble-outline'}
                    size={14}
                    color={isExpanded ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[s.commentsToggleText, isExpanded && { color: colors.primary }]}>
                    {notice.comment_count > 0
                      ? `${notice.comment_count} comment${notice.comment_count !== 1 ? 's' : ''}`
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
                    {isLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 12 }} />
                    ) : (
                      <>
                        {detail?.comments.length === 0 && (
                          <Text style={s.noCommentsText}>No comments yet</Text>
                        )}
                        {detail?.comments.map(c => (
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
                                {(c.user_id === userId || isOwner) && (
                                  <TouchableOpacity
                                    onPress={() => confirmDeleteComment(notice.id, c.id)}
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
                        value={commentInput[notice.id] ?? ''}
                        onChangeText={v => setCommentInput(prev => ({ ...prev, [notice.id]: v }))}
                        placeholder="Add a comment..."
                        placeholderTextColor="#bbb"
                        multiline
                        maxLength={500}
                      />
                      <TouchableOpacity
                        style={[s.commentSendBtn, !(commentInput[notice.id]?.trim()) && s.commentSendBtnDisabled]}
                        onPress={() => postComment(notice.id)}
                        disabled={commentSaving[notice.id] || !commentInput[notice.id]?.trim()}
                        activeOpacity={0.8}
                      >
                        {commentSaving[notice.id]
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

      {/* ── Post Notice Modal ── */}
      <Modal
        visible={showPostModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPostModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modalRoot, { paddingTop: insets.top + spacing.md }]}>
            {/* Modal header */}
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setShowPostModal(false)} style={s.modalCancelBtn}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>New Notice</Text>
              <TouchableOpacity
                style={[s.modalPostBtn, nSaving && { opacity: 0.6 }]}
                onPress={postNotice}
                disabled={nSaving}
              >
                {nSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.modalPostText}>Post</Text>
                }
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              <View style={s.modalBody}>
                {nError ? <Text style={s.formError}>{nError}</Text> : null}

                <Text style={s.fieldLabel}>Title</Text>
                <TextInput
                  style={s.fieldInput}
                  value={nTitle}
                  onChangeText={setNTitle}
                  placeholder="e.g. Weekend Competition"
                  maxLength={200}
                />

                <Text style={[s.fieldLabel, { marginTop: 16 }]}>Message</Text>
                <TextInput
                  style={[s.fieldInput, s.textArea]}
                  value={nBody}
                  onChangeText={setNBody}
                  placeholder="Write your announcement here..."
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />

                {/* Photo picker */}
                <TouchableOpacity style={s.photoPickerBtn} onPress={pickPhoto} activeOpacity={0.8}>
                  <Ionicons name="image-outline" size={18} color={colors.primary} />
                  <Text style={s.photoPickerText}>
                    {nPhoto ? 'Change Photo' : 'Add Photo'}
                  </Text>
                </TouchableOpacity>

                {nPhoto ? (
                  <View style={s.photoPreviewWrap}>
                    <Image source={{ uri: nPhoto }} style={s.photoPreview} resizeMode="cover" />
                    <TouchableOpacity
                      style={s.photoRemoveBtn}
                      onPress={() => setNPhoto(null)}
                    >
                      <Ionicons name="close-circle" size={24} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2, width: 64 },
  backText:    { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  headerCenter:{ flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  headerSub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  postBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 1 },
  postBtnText: { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },

  // Empty
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', marginTop: spacing.md },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  // Recent rounds section
  recentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadows.card,
  },
  recentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: spacing.sm + 2,
  },
  recentTitle: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary, flex: 1 },
  recentSub:   { fontSize: fontSize.xs, color: colors.textSecondary },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  recentAvatar:     { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.primary + '18', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  recentAvatarText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  recentInfo:  { flex: 1, minWidth: 0 },
  recentName:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  recentCourse:{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  recentScores:{ alignItems: 'flex-end' },
  recentPts:   { fontSize: fontSize.sm, fontWeight: '800', color: colors.primary },
  recentWhen:  { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  // Notice card
  noticeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadows.card,
  },

  noticeAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar:          { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.primary + '22', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:      { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  authorName:      { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  authorDate:      { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },

  noticeTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  noticeBody:  { fontSize: fontSize.sm, color: '#444', lineHeight: 21, marginBottom: spacing.sm },

  noticePhoto: {
    width: '100%', height: 200,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },

  // Reactions
  reactionBar:          { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.sm },
  reactionBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.background },
  reactionBtnActive:    { borderColor: colors.primary + '66', backgroundColor: colors.primary + '10' },
  reactionEmoji:        { fontSize: 16 },
  reactionCount:        { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  reactionCountActive:  { color: colors.primary },

  // Comments toggle
  commentsToggle:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: spacing.xs },
  commentsToggleText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, flex: 1 },

  // Comments section
  commentsSection: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  noCommentsText: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.sm },

  commentRow:       { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  commentAvatar:    { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1 },
  commentAvatarText:{ fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  commentBody:      { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.sm },
  commentTopRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 3 },
  commentAuthor:    { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  commentDate:      { fontSize: 11, color: colors.textSecondary },
  commentText:      { fontSize: 13, color: '#444', lineHeight: 18 },

  commentInputRow:       { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.xs },
  commentInput:          { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, fontSize: 14, color: '#111', backgroundColor: '#fafafa', maxHeight: 100 },
  commentSendBtn:        { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  commentSendBtnDisabled:{ backgroundColor: colors.border },

  // Post modal
  modalRoot:       { flex: 1, backgroundColor: colors.background },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalCancelBtn:  { paddingVertical: spacing.xs, minWidth: 60 },
  modalCancelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  modalTitle:      { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },
  modalPostBtn:    { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, minWidth: 60, alignItems: 'center' },
  modalPostText:   { fontSize: fontSize.sm, fontWeight: '700', color: '#fff' },
  modalBody:       { padding: spacing.md },

  fieldLabel:  { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  fieldInput:  { borderWidth: 1.5, borderColor: '#e5e5e5', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: '#111', backgroundColor: '#fafafa' },
  textArea:    { height: 120, paddingTop: 12 },
  formError:   { color: colors.danger, fontSize: 13, marginBottom: 10, textAlign: 'center' },

  photoPickerBtn:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, marginTop: 16, justifyContent: 'center' },
  photoPickerText:  { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  photoPreviewWrap: { marginTop: spacing.sm, position: 'relative' },
  photoPreview:     { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  photoRemoveBtn:   { position: 'absolute', top: spacing.xs, right: spacing.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.full },
});
