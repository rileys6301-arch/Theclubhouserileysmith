import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import Logo from '../components/Logo';

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function InviteButton({ club }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/club/join?code=${club.code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${club.name} on The Circuit`,
          text: `Use code ${club.code} to join my club.`,
          url,
        });
      } catch { /* user cancelled share sheet */ }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 12 }} onClick={handleShare}>
      {copied ? <><CheckIcon /> Link copied!</> : <><ShareIcon /> Share invite link</>}
    </button>
  );
}

export default function CreateClub() {
  const [name,    setName]    = useState('');
  const [created, setCreated] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const { createClub } = useClub();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Club name is required'); return; }
    setSaving(true);
    try {
      const club = await createClub(name.trim());
      setCreated(club);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="auth-page gate-page">
        <div className="auth-card">
          <Logo className="auth-logo" />
          <h1 className="auth-heading">Club created!</h1>
          <p className="auth-subheading">
            Share the code or invite link with your members.
          </p>
          <div className="club-code-box">{created.code}</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, textAlign: 'center' }}>
            Members enter this code on the Join screen — or use the link below.
          </p>
          <InviteButton club={created} />
          <button
            className="btn btn-primary"
            style={{ marginTop: 0 }}
            onClick={() => navigate('/', { replace: true })}
          >
            Go to my club
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page gate-page">
      <div className="auth-card">
        <Logo className="auth-logo" />

        <button className="back-link-btn" style={{ marginBottom: 20 }} onClick={() => navigate('/profile')}>
          ← Back
        </button>

        <h1 className="auth-heading">Create a Club</h1>
        <p className="auth-subheading">
          Give your club a name. You'll get a code to share with members.
        </p>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label className="form-label">Club Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Pebble Beach Hackers"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Club'}
          </button>
        </form>
      </div>
    </div>
  );
}
