import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const AddMemberModal = ({ group, onClose, onSuccess }) => {
  const { searchUsers, addGroupMember } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchSuccess, setSearchSuccess] = useState('');

  if (!group) return null;

  const handleAddByEmail = async (e) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    setIsSearching(true);
    setSearchError('');
    setSearchSuccess('');
    
    try {
      const results = await searchUsers(emailInput.trim());
      if (results && results.length > 0) {
        const foundUser = results[0];
        const newMemberUid = foundUser.firebaseUID || foundUser.uid || foundUser.id;
        
        if (newMemberUid) {
          const res = await addGroupMember(group.id, newMemberUid);
          if (res) {
            setSearchSuccess(`Successfully added ${foundUser.name || foundUser.email} to the group!`);
            setEmailInput('');
            if (onSuccess) onSuccess(); // Signal the parent to maybe close or refresh
            setTimeout(() => {
              onClose();
            }, 1000);
          } else {
            setSearchError('Failed to add member to the group.');
          }
        }
      } else {
        setSearchError('User not found. They might not be registered.');
      }
    } catch (err) {
      console.error('Email search error:', err);
      setSearchError('Error searching for user.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-card" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <h2>Add Member to Group</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
          Enter the email address of the person you'd like to add to <strong>{group.name}</strong>.
        </p>

        <form onSubmit={handleAddByEmail}>
          <div className="form-group">
            <label>Email Address</label>
            <input 
              type="text" 
              placeholder="user@example.com" 
              value={emailInput}
              onChange={(e) => { setEmailInput(e.target.value); setSearchError(''); setSearchSuccess(''); }}
              required
            />
          </div>
          {searchError && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '15px' }}>{searchError}</div>}
          {searchSuccess && <div style={{ color: '#4caf50', fontSize: '13px', marginBottom: '15px' }}>{searchSuccess}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button 
              type="button" 
              className="btn-secondary" 
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white', border: 'none', padding: '12px', borderRadius: '4px', cursor: 'pointer' }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={isSearching || !emailInput.trim()}
              style={{ flex: 2 }}
            >
              {isSearching ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddMemberModal;
