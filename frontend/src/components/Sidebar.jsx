import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';

import { firestore } from '../config/firebaseConfig';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import CreateGroupModal from './CreateGroupModal';

const Sidebar = ({ onChatSelect, selectedChatId }) => {
  const { user, logout, updateProfile, uploadProfilePicture, searchUsers, getContacts, addContact, removeContact, createGroup, getGroups, changePassword, resetUnread } = useAuth();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(user?.name || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [allChats, setAllChats] = useState([]);
  const [profileModalChat, setProfileModalChat] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwords, setPasswords] = useState({ old: '', new: '', confirm: '' });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const fileInputRef = React.useRef(null);

  // Load persistent contacts + Groups with Real-time Listener + Socket Fallback
  React.useEffect(() => {
    if (!user) return;

    const uid = user.uid || user.firebaseUID;
    
    const loadFromApi = async () => {
      console.log('[Sidebar] Re-fetching data via API...');
      try {
        const [contacts, groups] = await Promise.all([getContacts(), getGroups()]);
        const allMap = new Map();

        (contacts || []).forEach(c => {
          const id = c.uid || c.id;
          allMap.set(id, { 
            ...c, 
            id,
            avatar: c.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.email || c.id}`
          });
        });

        (groups || []).forEach(g => {
          const id = g.id;
          allMap.set(id, { 
            ...g, 
            id, 
            isGroup: true,
            avatar: g.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${g.name || g.id}`
          });
        });

        const all = Array.from(allMap.values())
          .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        
        setAllChats(all);
      } catch (err) {
        console.error('[Sidebar] Error:', err);
      }
    };

    // 1. Listen for Contacts in Firestore
    const contactsQuery = query(collection(firestore, 'users', uid, 'contacts'));
    const unsubscribeContacts = onSnapshot(contactsQuery, () => {
      loadFromApi();
    });

    // 2. Listen for User Profile / Groups (Simplified)
    const handleProfileUpdate = (data) => {
      setAllChats(prev => prev.map(chat => {
        if (chat.uid === data.uid || chat.id === data.uid) {
          return { ...chat, name: data.name || chat.name, avatar: data.avatar || chat.avatar };
        }
        return chat;
      }));
    };

    if (window.socket) {
      window.socket.on('contacts_updated', loadFromApi);
      window.socket.on('groups_updated', loadFromApi);
      window.socket.on('profile_updated', handleProfileUpdate);
    }

    loadFromApi();

    return () => {
      unsubscribeContacts();
      if (window.socket) {
        window.socket.off('contacts_updated', loadFromApi);
        window.socket.off('groups_updated', loadFromApi);
        window.socket.off('profile_updated', handleProfileUpdate);
      }
    };
  }, [user]);

  const filteredChats = (allChats || []).filter(chat => {
    if (!chat) return false;
    const nameStr = chat.name || chat.id || 'Unknown';
    const emailStr = chat.email || '';
    const matchesSearch = nameStr.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (!chat.isGroup && emailStr.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (activeFilter === 'Unread') return matchesSearch && chat.unread > 0;
    if (activeFilter === 'Favourites') return matchesSearch && chat.favourite;
    return matchesSearch;
  });

  const handleUpdateName = async () => {
    const success = await updateProfile(newName);
    if (success) {
      setIsEditingName(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("Image is too large. Max 2MB allowed.");
      return;
    }

    setIsUploadingAvatar(true);
    const result = await uploadProfilePicture(file);
    if (result && result.url) {
      const success = await updateProfile(null, result.url, result.fileId);
      if (!success) {
        alert("Failed to update profile picture in database.");
      }
    } else {
      alert("Failed to upload image.");
    }
    setIsUploadingAvatar(false);
  };
  
  const handlePasswordChange = async () => {
    const { old, new: nBody, confirm } = passwords;
    if (!old || !nBody || !confirm) {
      toast.error('All fields are required');
      return;
    }
    if (nBody !== confirm) {
      toast.error('New passwords do not match');
      return;
    }
    if (nBody.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }

    setIsChangingPassword(true);
    const result = await changePassword(old, nBody, confirm);
    
    if (result.success) {
      toast.success('Password updated successfully!');
      setPasswords({ old: '', new: '', confirm: '' });
      setShowChangePassword(false);
    } else {
      toast.error(result.message);
    }
    setIsChangingPassword(false);
  };

  const handleUserSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const results = await searchUsers(searchQuery);
    setSearchResults(results);
    setIsSearching(false);
  };

  const startChat = async (newUser) => {
    // 1. Resolve a reliable UID (from search result or existing chat)
    const contactUid = newUser.firebaseUID || newUser.uid || newUser.id;
    
    if (!contactUid) {
      console.error('[Sidebar] Cannot start chat: Missing UID in object:', newUser);
      return;
    }

    // 2. See if they are already in our reactive 'allChats' list
    const existingChat = allChats.find(c => {
      const idMatch = (c.id === contactUid) || (c.uid === contactUid) || (c.firebaseUID === contactUid);
      const emailMatch = c.email && newUser.email && (c.email.toLowerCase() === newUser.email.toLowerCase());
      return idMatch || emailMatch;
    });
    
    if (!existingChat) {
      // Prepare the permanent record
      const newChatObj = {
        uid: contactUid,
        firebaseUID: contactUid,
        name: newUser.name || newUser.email,
        email: newUser.email,
        avatar: newUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${newUser.name || newUser.email}`,
        lastMessage: 'Say hi! 👋',
        lastMessageTime: Date.now(),
        unread: 0,
        favourite: false
      };
      
      // 3. Persist to backend. 
      // We also do an optimistic update so the user sees them instantly
      setAllChats(prev => [newChatObj, ...prev]);
      
      try {
        await addContact(newChatObj);
        onChatSelect({ ...newChatObj, id: contactUid });
      } catch (err) {
        console.error('[Sidebar] Failed to persist new contact:', err);
      }
    } else {
      // Just select the existing one
      onChatSelect(existingChat);
    }
    
    // UI Cleanup
    setShowNewChat(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveContact = async (e, chatUid) => {
    e.stopPropagation(); // Prevent selecting the chat when clicking remove
    if (window.confirm('Remove this contact?')) {
      await removeContact(chatUid);
      // The onValue listener will automatically update allChats
    }
  };

  if (showProfile) {
    return (
      <div className="sidebar profile-sidebar">
        <div className="profile-header">
          <button className="icon-btn" onClick={() => setShowProfile(false)}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
          </button>
          <h2>Profile</h2>
        </div>

        <div className="profile-content">
          <div className="profile-picture-container" onClick={() => fileInputRef.current?.click()}>
            <img src={user?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.name || 'User'}`} alt="Avatar" />
            <div className="avatar-overlay">
              {isUploadingAvatar ? (
                <div className="upload-spinner-small"></div>
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/><circle cx="18" cy="18" r="3" fill="var(--accent)"/><path d="M18 16v4m-2-2h4" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
              )}
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              hidden 
              accept="image/*" 
              onChange={handleAvatarChange} 
            />
          </div>

          <div className="profile-info-section">
            <label>Your Name</label>
            <div className="info-val">
              {isEditingName ? (
                <div className="edit-name-wrapper">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                  <button className="icon-btn" onClick={handleUpdateName}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                  </button>
                </div>
              ) : (
                <>
                  <span>{user?.name || 'User'}</span>
                  <button className="icon-btn" onClick={() => { setIsEditingName(true); setNewName(user?.name || ''); }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                  </button>
                </>
              )}
            </div>
            <p className="info-desc">This is not your username or pin. This name will be visible to your BIT CHATHUB contacts.</p>
          </div>

          <div className="profile-info-section">
            <label>Email / Account</label>
            <div className="info-val">
              <span>{user?.email || 'No email provided'}</span>
            </div>
          </div>

          <div className="profile-info-section">
            <div className="password-toggle-header" onClick={() => setShowChangePassword(!showChangePassword)}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: showChangePassword ? 'var(--accent)' : 'inherit' }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
                Change Password
              </label>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ transform: showChangePassword ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}><path d="M7 10l5 5 5-5z"/></svg>
            </div>
            
            {showChangePassword && (
              <div className="password-change-form">
                <div className="pw-input-group">
                  <input
                    type="password"
                    placeholder="Old Password"
                    value={passwords.old}
                    onChange={(e) => setPasswords({...passwords, old: e.target.value})}
                  />
                </div>
                <div className="pw-input-group">
                  <input
                    type="password"
                    placeholder="New Password"
                    value={passwords.new}
                    onChange={(e) => setPasswords({...passwords, new: e.target.value})}
                  />
                </div>
                <div className="pw-input-group">
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords({...passwords, confirm: e.target.value})}
                  />
                </div>
                <button 
                  className="update-pw-btn" 
                  disabled={isChangingPassword}
                  onClick={handlePasswordChange}
                >
                  {isChangingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            )}
          </div>

          <div className="profile-actions">
            <button className="logout-btn" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showNewChat) {
    return (
      <div className="sidebar profile-sidebar">
        <div className="profile-header">
          <button className="icon-btn" onClick={() => { setShowNewChat(false); setSearchResults([]); setSearchQuery(''); }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
          </button>
          <h2>New Chat</h2>
        </div>

        <div className="search-container" style={{ padding: '20px' }}>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search by email or phone"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleUserSearch()}
            />
            <button className="icon-btn" onClick={handleUserSearch}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="rgba(255,255,255,0.5)"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            </button>
          </div>
        </div>

        <div className="chat-list">
          {isSearching ? (
            <div className="no-chats-msg">Searching...</div>
          ) : searchResults.length > 0 ? (
            searchResults.map(u => (
              <div key={u.firebaseUID} className="chat-item" onClick={() => startChat(u)}>
                <div className="avatar">
                  <img src={u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name || 'User'}`} alt={u.name} />
                </div>
                <div className="chat-info">
                  <span className="chat-name">{u.name}</span>
                  <p className="latest-msg">{u.email}</p>
                </div>
              </div>
            ))
          ) : searchQuery ? (
            <div className="no-chats-msg">No user found with that email/phone.</div>
          ) : (
            <div className="no-chats-msg">Enter an email or phone number to find someone.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="header-top">
          <h1>Chats</h1>
          <div className="header-actions">
            <button className="icon-btn" title="Profile" onClick={() => setShowProfile(true)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            </button>
            <button className="icon-btn" title="New Group" onClick={() => setShowCreateGroup(true)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 2.02 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            </button>
            <button className="icon-btn" title="New Chat" onClick={() => setShowNewChat(true)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
            </button>
            <button className="icon-btn" title="Settings">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
            </button>
          </div>
        </div>

        <div className="search-container">
          <div className="search-bar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="rgba(255,255,255,0.5)"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            <input
              type="text"
              placeholder="Search or start a new chat"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="filter-chips">
          {['All', 'Unread', 'Favourites'].map(filter => (
            <button
              key={filter}
              className={`chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter === 'Unread' ? `Unread` : filter}
            </button>
          ))}
          <button className="chip-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
          </button>
        </div>
      </div>

      <div className="chat-list">
        {filteredChats.map(chat => (
          <div
            key={chat.id}
            className={`chat-item ${selectedChatId === chat.id ? 'active' : ''}`}
            onClick={() => {
              onChatSelect(chat);
              // Reset unread count in DB via authenticated helper
              if (chat.unread > 0) {
                resetUnread(chat.uid || chat.id);
              }
            }}
          >
            <div className="avatar" onClick={(e) => {
              e.stopPropagation();
              setProfileModalChat(chat);
            }} style={{ cursor: 'pointer' }} title="View Profile">
              <img src={chat.avatar} alt={chat.name} />
            </div>
            <div className="chat-info">
              <div className="chat-info-top">
                <span className="chat-name">{chat.name}</span>
                <span className="chat-time">
                  {chat.lastMessageTime ? new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'just now'}
                </span>
              </div>
              <div className="chat-info-bottom">
                <p className="latest-msg">{chat.lastMessage || 'Say hi! 👋'}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
                  {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                  <button 
                    className="remove-btn" 
                    title="Remove Contact"
                    onClick={(e) => handleRemoveContact(e, chat.uid || chat.id)}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {filteredChats.length === 0 && (
          <div className="no-chats-msg">No chats found.</div>
        )}
      </div>

      <div className="sidebar-footer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="rgba(255,255,255,0.4)"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" /></svg>
        <span>Your personal messages are end-to-end encrypted</span>
      </div>
      {showCreateGroup && (
        <CreateGroupModal 
          onClose={() => setShowCreateGroup(false)} 
          onSuccess={(group) => {
            onChatSelect(group);
            setShowCreateGroup(false);
          }}
        />
      )}

      {profileModalChat && (
        <div className="modal-overlay" onClick={() => setProfileModalChat(null)}>
          <div className="auth-card" style={{ maxWidth: '350px', textAlign: 'center', padding: '30px', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setProfileModalChat(null)} style={{ position: 'absolute', top: '15px', right: '15px' }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
            <img 
              src={profileModalChat.avatar} 
              alt={profileModalChat.name} 
              style={{ width: '120px', height: '120px', borderRadius: '50%', marginBottom: '16px', border: '3px solid var(--accent)' }}
            />
            <h2 style={{ marginBottom: '8px', wordBreak: 'break-word' }}>{profileModalChat.name}</h2>
            {profileModalChat.email && (
              <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '15px', wordBreak: 'break-word' }}>
                ✉️ {profileModalChat.email}
              </p>
            )}
            {profileModalChat.isGroup && (
              <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '15px' }}>
                👥 Group Chat
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
