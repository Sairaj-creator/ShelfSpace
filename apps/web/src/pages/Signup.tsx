import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch, setAccessToken } from '../lib/api';

export function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await apiFetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, orgName }),
      });

      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        navigate('/dashboard');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Signup failed');
      }
    } catch (err) {
      setError('An error occurred');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg-paper)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: '1.75rem', color: 'var(--accent-ledger)', marginBottom: '0.25rem' }}>SHELFSPACE</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Create Store Organization
          </p>
        </div>
        
        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Organization Name</label>
            <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '1.25rem' }}>Sign Up</button>
        </form>
        
        <p style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--accent-ledger)', fontWeight: 600 }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
