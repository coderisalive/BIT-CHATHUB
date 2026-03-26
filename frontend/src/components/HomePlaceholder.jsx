import React from 'react';

const HomePlaceholder = () => {
  return (
    <div className="home-placeholder">
      <div className="placeholder-content">
        <div className="brand-logo">
           <img src="/logo.png" alt="BIT CHAT" width="120" height="120" style={{ borderRadius: '24px', opacity: 0.8 }} />
        </div>
        <h1>BIT CHAT for Windows</h1>
        <p>Connect securely with your team. Experience the next generation of messaging.</p>
      </div>
      
      <div className="encryption-footer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="rgba(255,255,255,0.4)"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
        <span>Your messages are end-to-end encrypted with BIT CHAT SECURE</span>
      </div>
    </div>
  );
};

export default HomePlaceholder;
