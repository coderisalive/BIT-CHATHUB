import React from 'react';

const ChatInfoModal = ({ chat, onClose }) => {
  if (!chat) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-card" style={{ maxWidth: '350px', textAlign: 'center', padding: '30px', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button className="icon-btn" onClick={onClose} style={{ position: 'absolute', top: '15px', right: '15px' }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
        <img 
          src={chat.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.name || 'Chat'}`} 
          alt={chat.name} 
          style={{ width: '120px', height: '120px', borderRadius: '50%', marginBottom: '16px', border: '3px solid var(--accent)' }}
        />
        <h2 style={{ marginBottom: '8px', wordBreak: 'break-word' }}>{chat.name}</h2>
        {chat.email && (
          <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '15px', wordBreak: 'break-word' }}>
            ✉️ {chat.email}
          </p>
        )}
        {(chat.uid || chat.id) && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            ID: {chat.uid || chat.id}
          </p>
        )}
      </div>
    </div>
  );
};

export default ChatInfoModal;
