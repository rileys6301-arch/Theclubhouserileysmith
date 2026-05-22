// Expo Push Notification delivery + club token helpers

async function sendPushNotifications(tokens, title, body) {
  if (!tokens?.length) return;
  for (let i = 0; i < tokens.length; i += 100) {
    const messages = tokens.slice(i, i + 100).map(to => ({
      to, sound: 'default', title, body,
    }));
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
    } catch (err) {
      console.error('Push send error:', err);
    }
  }
}

async function getClubTokens(pool, clubId, excludeUserId) {
  if (!clubId) return [];
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT u.push_token
      FROM users u
      JOIN club_memberships cm ON cm.user_id = u.id
      WHERE cm.club_id = $1
        AND u.push_token IS NOT NULL
        AND u.id != $2
    `, [clubId, excludeUserId]);
    return rows.map(r => r.push_token);
  } catch { return []; }
}

export { sendPushNotifications, getClubTokens };
