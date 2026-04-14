import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const RecoveryModal = () => {
  const { recoverAccount, recoveryStatus, logout } = useAuth();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);

  if (recoveryStatus !== 'needs_recovery') return null;

  const handleRecover = async (e) => {
    e.preventDefault();
    setError('');
    setIsRecovering(true);
    
    const result = await recoverAccount(passphrase);
    if (!result.success) {
      setError(result.message || 'Invalid passphrase. Please try again.');
    }
    setIsRecovering(false);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)' }}>
      <div className="auth-card" style={{ maxWidth: '450px', border: '1px solid var(--accent)' }}>
        <div style={{ textAlign: 'center', marginBottom: '25px' }}>
          <div style={{ 
            width: '60px', 
            height: '60px', 
            background: 'rgba(138, 43, 226, 0.2)', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            margin: '0 auto 15px auto'
          }}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="var(--accent)"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>
          </div>
          <h2>Identity Recovery</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            You are logging in from a new device. To access your end-to-end encrypted messages, please enter your <strong>Security Recovery Passphrase</strong>.
          </p>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '20px' }}>{error}</div>}

        <form onSubmit={handleRecover}>
          <div className="form-group">
            <label>Recovery Passphrase</label>
            <input 
              type="password" 
              placeholder="Enter your security passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
              autoFocus
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={isRecovering}>
            {isRecovering ? 'Unlocking Identity...' : 'Restore Access'}
          </button>
        </form>

        <div style={{ marginTop: '25px', paddingTop: '20px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '15px' }}>
            If you forgot your passphrase, you can continue, but your previous message history will remain unreadable.
          </p>
          <button 
            onClick={logout}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline' }}
          >
            Log out and try later
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryModal;
