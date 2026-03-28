import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const CreateGroupModal = ({ onClose, onSuccess }) => {
  const { getContacts, createGroup, searchUsers } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [emailInput, setEmailInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  React.useEffect(() => {
    const loadContacts = async () => {
      const data = await getContacts();
      const validContacts = (data || []).filter(c => c.name || c.email);
      setContacts(validContacts);
      setLoading(false);
    };
    loadContacts();
  }, []);

  const handleAddByEmail = async () => {
    if (!emailInput.trim()) return;
    setIsSearching(true);
    setSearchError('');
    
    try {
      const results = await searchUsers(emailInput.trim());
      if (results && results.length > 0) {
        const foundUser = results[0];
        const uid = foundUser.firebaseUID || foundUser.uid || foundUser.id;
        
        if (uid) {
          setContacts(prev => {
            if (!prev.find(c => (c.uid || c.id) === uid)) {
              return [foundUser, ...prev];
            }
            return prev;
          });
          
          if (!selectedMembers.includes(uid)) {
            setSelectedMembers(prev => [...prev, uid]);
          }
          
          setEmailInput('');
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

  const toggleMember = (uid) => {
    setSelectedMembers(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!groupName.trim() || selectedMembers.length === 0) return;

    setSubmitting(true);
    const group = await createGroup(groupName, selectedMembers);
    if (group) {
      onSuccess(group);
      onClose();
    }
    setSubmitting(false);
  };

  return (
    <div className="modal-overlay">
      <div className="auth-card" style={{ maxWidth: '500px' }}>
        <h2>Create New Group</h2>
        <p>Give your group a name and add members.</p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Group Name</label>
            <input 
              type="text" 
              placeholder="Enter group name" 
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Or Add by Email</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                placeholder="user@example.com" 
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setSearchError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddByEmail();
                  }
                }}
              />
              <button 
                type="button" 
                onClick={handleAddByEmail}
                disabled={isSearching || !emailInput.trim()}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                {isSearching ? '...' : 'Add'}
              </button>
            </div>
            {searchError && <div style={{ color: '#ff6b6b', fontSize: '13px', marginTop: '6px' }}>{searchError}</div>}
          </div>

          <div className="form-group" style={{ marginBottom: '0' }}>
            <label>Select Members ({selectedMembers.length} selected)</label>
          </div>
          
          <div className="members-list" style={{ 
            maxHeight: '200px', 
            overflowY: 'auto', 
            background: 'var(--search-bg)', 
            borderRadius: '4px',
            marginBottom: '24px',
            border: '1px solid var(--border)'
          }}>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>Loading contacts...</div>
            ) : contacts.map(contact => (
              <div 
                key={contact.uid || contact.id} 
                className="member-item" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '10px 16px', 
                  gap: '12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)'
                }}
                onClick={() => toggleMember(contact.uid || contact.id)}
              >
                <input 
                  type="checkbox" 
                  checked={selectedMembers.includes(contact.uid || contact.id)}
                  readOnly
                />
                <img 
                  src={contact.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${contact.email}`} 
                  alt="" 
                  style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '500' }}>{contact.name || contact.email}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{contact.email}</div>
                </div>
              </div>
            ))}
            {!loading && contacts.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No contacts found to add.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
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
              disabled={submitting || !groupName.trim() || selectedMembers.length === 0}
              style={{ flex: 2 }}
            >
              {submitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGroupModal;
