import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const GroupInfoModal = ({ group, onClose }) => {
  const { getGroupMembers } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!group) return;
    const fetchMembers = async () => {
      setLoading(true);
      const data = await getGroupMembers(group.id);
      setMembers(data || []);
      setLoading(false);
    };
    fetchMembers();
  }, [group, getGroupMembers]);

  if (!group) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-card" style={{ maxWidth: '400px', padding: '0', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '30px', textAlign: 'center', background: 'var(--bg)', position: 'relative' }}>
          <button className="icon-btn" onClick={onClose} style={{ position: 'absolute', top: '15px', right: '15px' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <img 
            src={group.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${group.name || group.id}`} 
            alt={group.name} 
            style={{ width: '100px', height: '100px', borderRadius: '50%', marginBottom: '16px', border: '3px solid var(--accent)' }}
          />
          <h2 style={{ marginBottom: '4px', wordBreak: 'break-word' }}>{group.name}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
        
        <div style={{ padding: '0 20px 20px 20px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--accent)', marginBottom: '10px', marginTop: '10px' }}>Group Members</h3>
          <div className="members-list" style={{ 
            maxHeight: '250px', 
            overflowY: 'auto', 
            background: 'var(--search-bg)', 
            borderRadius: '4px',
            border: '1px solid var(--border)'
          }}>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading members...</div>
            ) : members.map((member) => (
              <div 
                key={member.uid} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '10px 16px', 
                  gap: '12px',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                <img 
                  src={member.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${member.email}`} 
                  alt={member.name} 
                  style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name || member.email}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default GroupInfoModal;
