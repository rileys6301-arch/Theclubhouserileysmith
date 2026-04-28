import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppNav from '../components/AppNav';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function playerName(u) {
  if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.email;
}

function playerInitials(u) {
  if (u.first_name || u.last_name) {
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  }
  return u.email[0].toUpperCase();
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function relativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

// ─── Rank badge ───────────────────────────────────────────────────────────────

function RankBadge({ rank }) {
  const styles = {
    1: { background: 'linear-gradient(135deg, #C4A35A, #DDB96E)', color: '#0C1409', fontWeight: 800 },
    2: { background: 'rgba(255,255,255,0.12)',  color: '#EBE7DF', borderColor: 'rgba(255,255,255,0.2)' },
    3: { background: 'linear-gradient(135deg, #8B6914, #A07820)', color: '#fff' },
  };
  const style = styles[rank] ?? {};
  return (
    <span className="lb-rank-badge" style={style}>
      {rank}
    </span>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

function Leaderboard({ rows }) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '24px 0' }}>No rounds played yet.</p>;
  return (
    <div className="rounds-table-wrap" style={{ marginTop: 16 }}>
      <table className="lb-table">
        <thead>
          <tr>
            <th className="lb-rank-col">Rank</th>
            <th>Player</th>
            <th className="num">HCP</th>
            <th className="num">Rounds</th>
            <th className="num">Avg Stableford</th>
            <th className="num">Best Stableford</th>
            <th className="num">Best Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={u.id} className="lb-row" onClick={() => navigate(`/members/${u.id}`)} style={{ cursor: 'pointer' }}>
              <td className="lb-rank-col"><RankBadge rank={i + 1} /></td>
              <td>
                <div className="lb-player-cell">
                  <div className="lb-avatar">{playerInitials(u)}</div>
                  <span>{playerName(u)}</span>
                </div>
              </td>
              <td className="num">{u.handicap != null ? Number(u.handicap).toFixed(1) : '—'}</td>
              <td className="num">{u.rounds_played}</td>
              <td className="num" style={{ fontWeight: 700, color: 'var(--green-mid)' }}>{u.avg_stableford ?? '—'}</td>
              <td className="num">{u.best_stableford ?? '—'}</td>
              <td className="num">{u.best_score ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Birdie tracker ───────────────────────────────────────────────────────────

function BirdieTracker({ rows }) {
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '16px 0' }}>No birdie data yet.</p>;
  return (
    <ul className="birdie-list">
      {rows.map((u, i) => (
        <li key={u.id} className="birdie-row">
          <span className="birdie-rank">{i + 1}</span>
          <div className="lb-player-cell" style={{ flex: 1 }}>
            <div className="lb-avatar" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>{playerInitials(u)}</div>
            <span style={{ fontSize: 14 }}>{playerName(u)}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="birdie-pill">{u.birdies} birdie{u.birdies !== 1 ? 's' : ''}</span>
            {u.eagles_plus > 0 && (
              <span className="birdie-pill" style={{ background: 'rgba(196,163,90,0.12)', color: 'var(--tan)', borderColor: 'rgba(196,163,90,0.22)' }}>
                {u.eagles_plus} eagle{u.eagles_plus !== 1 ? 's' : ''}+
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Best rounds ─────────────────────────────────────────────────────────────

function BestRounds({ rows }) {
  if (!rows.length) return <p className="empty-state-sub" style={{ padding: '16px 0' }}>No rounds yet.</p>;
  return (
    <ol className="best-round-list">
      {rows.map((r, i) => (
        <li key={r.id} className="best-round-row">
          <span className="best-round-rank">{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.first_name || r.last_name ? [r.first_name, r.last_name].filter(Boolean).join(' ') : r.email}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.course_name} · {fmtDate(r.played_at)}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--green-bright)' }}>{r.stableford}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.score} gross</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Notice board ─────────────────────────────────────────────────────────────

function NoticeBoard({ notices: initialNotices }) {
  const { user } = useAuth();
  const [notices,    setNotices]    = useState(initialNotices);
  const [posting,    setPosting]    = useState(false);
  const [title,      setTitle]      = useState('');
  const [body,       setBody]       = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const handlePost = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !body.trim()) { setError('Title and body are required'); return; }
    setSaving(true);
    try {
      const notice = await api.post('/notices', { title: title.trim(), body: body.trim() });
      setNotices(prev => [notice, ...prev]);
      setTitle('');
      setBody('');
      setPosting(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/notices/${id}`);
      setNotices(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="home-section">
      <div className="home-section-header">
        <div>
          <h2 className="home-section-title">Notice Board</h2>
          <span className="home-section-sub">Club announcements and updates</span>
        </div>
        <button
          className="btn btn-add"
          onClick={() => { setPosting(p => !p); setError(''); }}
        >
          {posting ? 'Cancel' : '+ Post Notice'}
        </button>
      </div>

      {posting && (
        <form className="notice-form" onSubmit={handlePost}>
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              type="text"
              placeholder="Notice title…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              className="form-input notice-textarea"
              placeholder="Write your notice here…"
              value={body}
              onChange={e => setBody(e.target.value)}
              required
              rows={4}
            />
          </div>
          <div className="log-form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPosting(false)}>Cancel</button>
            <button type="submit" className="btn btn-save" disabled={saving}>
              {saving ? 'Posting…' : 'Post Notice'}
            </button>
          </div>
        </form>
      )}

      {notices.length === 0 && !posting ? (
        <p className="empty-state-sub" style={{ padding: '24px 0' }}>No notices yet. Be the first to post!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {notices.map(n => (
            <div key={n.id} className="notice-item">
              <div className="notice-item-header">
                <span className="notice-title">{n.title}</span>
                {n.user_id === user?.id && (
                  <button
                    className="btn-delete"
                    onClick={() => handleDelete(n.id)}
                    disabled={deletingId === n.id}
                    aria-label="Delete notice"
                    style={{ marginLeft: 'auto' }}
                  >
                    {deletingId === n.id ? '…' : <DeleteIcon />}
                  </button>
                )}
              </div>
              <p className="notice-body">{n.body}</p>
              <div className="notice-meta">
                <span>{n.first_name || n.last_name ? [n.first_name, n.last_name].filter(Boolean).join(' ') : n.email}</span>
                <span>·</span>
                <span>{relativeTime(n.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [birdies,     setBirdies]     = useState([]);
  const [bestRounds,  setBestRounds]  = useState([]);
  const [notices,     setNotices]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [errors,      setErrors]      = useState({});

  useEffect(() => {
    Promise.allSettled([
      api.get('/social/leaderboard'),
      api.get('/social/birdies'),
      api.get('/social/best-rounds'),
      api.get('/notices'),
    ]).then(([lb, bi, br, no]) => {
      if (lb.status === 'fulfilled') setLeaderboard(lb.value);
      else setErrors(e => ({ ...e, leaderboard: lb.reason?.message }));

      if (bi.status === 'fulfilled') setBirdies(bi.value);
      else setErrors(e => ({ ...e, birdies: bi.reason?.message }));

      if (br.status === 'fulfilled') setBestRounds(br.value);
      else setErrors(e => ({ ...e, bestRounds: br.reason?.message }));

      if (no.status === 'fulfilled') setNotices(no.value);
      else setErrors(e => ({ ...e, notices: no.reason?.message }));

      setLoading(false);
    });
  }, []);

  return (
    <div className="app-layout">
      <AppNav />
      <main className="home-main">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* ── Leaderboard ── */}
            <section className="home-section">
              <div className="home-section-header">
                <div>
                  <h2 className="home-section-title">Leaderboard</h2>
                  <span className="home-section-sub">Ranked by average Stableford</span>
                </div>
              </div>
              {errors.leaderboard
                ? <div className="form-error">{errors.leaderboard}</div>
                : <Leaderboard rows={leaderboard} />
              }
            </section>

            {/* ── 2-col grid ── */}
            <div className="home-grid-2">
              {/* Birdie Tracker */}
              <div className="card" style={{ margin: 0 }}>
                <span className="card-title">Birdie Tracker</span>
                {errors.birdies
                  ? <div className="form-error">{errors.birdies}</div>
                  : <BirdieTracker rows={birdies} />
                }
              </div>

              {/* Best Rounds */}
              <div className="card" style={{ margin: 0 }}>
                <span className="card-title">Best Rounds</span>
                {errors.bestRounds
                  ? <div className="form-error">{errors.bestRounds}</div>
                  : <BestRounds rows={bestRounds} />
                }
              </div>
            </div>

            {/* ── Notice Board ── */}
            {errors.notices
              ? <div className="form-error">{errors.notices}</div>
              : <NoticeBoard notices={notices} />
            }
          </>
        )}
      </main>
    </div>
  );
}
