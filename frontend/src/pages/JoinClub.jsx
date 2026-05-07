import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import Logo from '../components/Logo';

export default function JoinClub() {
  const [searchParams]         = useSearchParams();
  const [code,   setCode]      = useState(() => searchParams.get('code') || '');
  const [saving, setSaving]    = useState(false);
  const [error,  setError]     = useState('');
  const { joinClub } = useClub();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) { setError('Please enter a valid club code'); return; }
    setSaving(true);
    try {
      await joinClub(trimmed);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page gate-page">
      <div className="auth-card">
        <Logo className="auth-logo" />

        <button className="back-link-btn" style={{ marginBottom: 20 }} onClick={() => navigate('/profile')}>
          ← Back
        </button>

        <h1 className="auth-heading">Join a Club</h1>
        <p className="auth-subheading">
          Enter the code your club captain shared with you.
        </p>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label className="form-label">Club Code</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. ABC123"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={12}
              autoFocus
              required
              style={{ letterSpacing: '0.12em', fontWeight: 600 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Joining…' : 'Join Club'}
          </button>
        </form>
      </div>
    </div>
  );
}
