import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [recoveryPassphrase, setRecoveryPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { signupWithE2EE } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (recoveryPassphrase.length < 8) {
      setError('Recovery passphrase must be at least 8 characters.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await signupWithE2EE(email, password, name, recoveryPassphrase);
      navigate('/');
    } catch (err) {
      setError('Failed to create account. ' + err.message);
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Create Account</h2>
        <p>Join our secure chat community</p>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <input 
              type="text" 
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Email Address</label>
            <input 
              type="email" 
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ border: '1px solid rgba(138, 43, 226, 0.3)', padding: '15px', borderRadius: '8px', background: 'rgba(138, 43, 226, 0.05)', marginTop: '20px' }}>
            <label style={{ color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>
              Security Recovery Passphrase
            </label>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: '5px 0 10px 0' }}>
              This password will be used to recover your encrypted chats if you log in from a new device. **Do not lose it.**
            </p>
            <input 
              type="password" 
              placeholder="Min 8 characters"
              value={recoveryPassphrase}
              onChange={(e) => setRecoveryPassphrase(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ marginTop: '20px' }} disabled={loading}>
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>
        
        <div className="auth-footer">
          Already have an account? <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
