import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../config/firebaseConfig';
import GroupInfoModal from './GroupInfoModal';
import AddMemberModal from './AddMemberModal';
import ChatInfoModal from './ChatInfoModal';

const ChatWindow = ({ chat, onBack }) => {
  const { user, getChatId, socket, getMessages, getGroupMessages, clearChatMessages, clearGroupMessages, deleteMessage } = useAuth();
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeMsgId, setActiveMsgId] = useState(null);

  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const dropdownRef = useRef(null);
  const msgDropdownRef = useRef(null);

  const isGroup = chat?.isGroup;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (msgDropdownRef.current && !msgDropdownRef.current.contains(event.target)) {
        setActiveMsgId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. Load Initial History
  React.useEffect(() => {
    if (!user || !chat) return;

    const loadHistory = async () => {
      setLoading(true);
      let history = [];

      if (isGroup) {
        history = await getGroupMessages(chat.id);
        if (socket) socket.emit('join_group', chat.id);
      } else {
        const chatId = getChatId(user.firebaseUID, chat.uid || chat.id);
        history = await getMessages(chatId);
      }

      const formattedHistory = history.map(m => ({
        ...m,
        time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase() : 'just now'
      }));

      setMessages(formattedHistory);
      setLoading(false);
    };

    loadHistory();
  }, [user, chat, getMessages, getGroupMessages, getChatId, isGroup, socket]);

  // 2. Live Relay (Socket.io)
  React.useEffect(() => {
    if (!socket || !chat) return;

    const handleReceivePrivate = (data) => {
      console.log("[Socket] Received Private:", data);
      const incomingEmail = data.senderEmail?.toLowerCase();
      const currentChatEmail = chat.email?.toLowerCase();
      const incomingUid = data.senderUid || data.senderId;
      const currentChatId = chat.uid || chat.id;

      if (!isGroup && (incomingEmail === currentChatEmail || incomingUid === currentChatId)) {
        addLiveMessage(data);
      }
    };

    const handleReceiveGroup = (data) => {
      console.log("[Socket] Received Group:", data);
      if (isGroup && String(data.groupId) === String(chat.id)) {
        addLiveMessage(data);
      }
    };

    const addLiveMessage = (data) => {
      console.log("[Socket] Processing live message:", data);
      const newMessage = {
        id: data.id || `live-${Date.now()}`,
        text: data.text,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        senderId: data.senderId || data.senderUid,
        senderName: data.senderName,
        timestamp: data.timestamp || Date.now(),
        time: new Date(data.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
      };

      setMessages(prev => {
        // More robust duplicate detection (checking both text and imageUrl)
        const exists = prev.some(m => 
          (m.id === newMessage.id) || 
          (m.text === newMessage.text && 
           m.imageUrl === newMessage.imageUrl && 
           Math.abs(m.timestamp - newMessage.timestamp) < 2000 && 
           m.senderId === newMessage.senderId)
        );
        if (exists) {
          console.log("[Socket] Duplicate detected, skipping.");
          return prev;
        }
        return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
      });
    };

    const handleMessageSuccess = (data) => {
      console.log("[Socket] Persistence success:", data);
      setMessages(prev => prev.map(m => 
        m.id === data.tempId ? { ...m, id: data.realId } : m
      ));
    };

    const handleMessageDeleted = (data) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId));
    };

    socket.on('receive_message', handleReceivePrivate);
    socket.on('receive_group_message', handleReceiveGroup);
    socket.on('message_persistence_success', handleMessageSuccess);
    socket.on('message_deleted', handleMessageDeleted);

    return () => {
      socket.off('receive_message', handleReceivePrivate);
      socket.off('receive_group_message', handleReceiveGroup);
      socket.off('message_persistence_success', handleMessageSuccess);
      socket.off('message_deleted', handleMessageDeleted);
    };
  }, [socket, chat, isGroup]);

  const handleSend = async (imageOverrideUrl = null, audioOverrideUrl = null) => {
    if ((!msg.trim() && !imageOverrideUrl && !audioOverrideUrl) || !socket) return;

    const timestamp = Date.now();
    const tempId = `temp-${timestamp}`;
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

    const payload = {
      tempId,
      text: msg,
      imageUrl: imageOverrideUrl,
      audioUrl: audioOverrideUrl,
      senderEmail: user.email.toLowerCase(),
      senderName: user.name,
      senderUid: user.firebaseUID,
      timestamp
    };

    if (isGroup) {
      socket.emit('send_group_message', {
        groupId: chat.id,
        ...payload
      });
    } else {
      socket.emit('send_message', {
        to: chat.email.toLowerCase(),
        targetUid: chat.uid || chat.id,
        targetName: chat.name,
        ...payload
      });
    }

    // Immediate UI Update for Sender
    setMessages(prev => [...prev, {
      id: tempId,
      text: msg,
      imageUrl: imageOverrideUrl,
      audioUrl: audioOverrideUrl,
      senderId: user.firebaseUID,
      senderName: user.name,
      timestamp,
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
    }]);

    setMsg('');
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (e.g., 5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large. Max 5MB allowed.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const idToken = await auth.currentUser.getIdToken();
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
      
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`
        },
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        handleSend(data.url);
      } else {
        alert("Upload failed: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Voice Recording Logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Please allow microphone access to record voice notes.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null; // Prevent upload
      mediaRecorderRef.current.stop();
      const stream = mediaRecorderRef.current.stream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setIsRecording(false);
      clearInterval(timerRef.current);
      setRecordingTime(0);
    }
  };

  const uploadAudio = async (blob) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', blob, `voice_note_${Date.now()}.webm`);

    try {
      const idToken = await auth.currentUser.getIdToken();
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
      
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`
        },
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        handleSend(null, data.url);
      } else {
        alert("Audio upload failed.");
      }
    } catch (error) {
      console.error("Audio upload error:", error);
    } finally {
      setIsUploading(false);
      setRecordingTime(0);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDeleteForMe = async (messageId) => {
    const chatId = isGroup ? chat.id : getChatId(user.firebaseUID, chat.uid || chat.id);
    const success = await deleteMessage(chatId, messageId, 'local', isGroup);
    if (success) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
    setActiveMsgId(null);
  };

  const handleDeleteForEveryone = async (messageId) => {
    const chatId = isGroup ? chat.id : getChatId(user.firebaseUID, chat.uid || chat.id);
    const success = await deleteMessage(chatId, messageId, 'global', isGroup);
    if (success) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
    setActiveMsgId(null);
  };

  const handleClearChat = async () => {
    if (window.confirm("Are you sure you want to clear this chat? This only clears it for you.")) {
      let success = false;
      if (isGroup) {
        success = await clearGroupMessages(chat.id);
      } else {
        const chatId = getChatId(user.firebaseUID, chat.uid || chat.id);
        success = await clearChatMessages(chatId);
      }
      if (success) {
        setMessages([]);
      }
      setShowDropdown(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const displayedMessages = messages.filter(m =>
    !searchQuery.trim() || m.text?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="header-left">
          <button className="icon-btn mobile-back-btn" onClick={onBack} title="Back">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
          </button>
          <img
            src={chat.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.name || 'Chat'}`}
            alt={chat.name}
            className="header-avatar"
            style={{ cursor: 'pointer' }}
            onClick={() => isGroup ? setShowGroupInfo(true) : setShowChatInfo(true)}
            title="View Info"
          />
          <div className="header-info" onClick={() => isGroup ? setShowGroupInfo(true) : setShowChatInfo(true)} style={{ cursor: 'pointer' }}>
            <span className="header-name">{chat.name}</span>
            <span className="header-status">online</span>
          </div>
        </div>
        <div className="header-right" style={{ position: 'relative' }}>
          <button className={`icon-btn ${showSearch ? 'active' : ''}`} onClick={() => setShowSearch(!showSearch)} title="Search Messages">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </button>

          <div ref={dropdownRef} style={{ display: 'inline-block' }}>
            <button className="icon-btn" onClick={() => setShowDropdown(!showDropdown)} title="Menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
            </button>
            {showDropdown && (
              <div style={{ position: 'absolute', top: '100%', right: '0', background: 'var(--bg)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 100, minWidth: '160px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                <button style={{ width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'white', cursor: 'pointer', fontSize: '14px' }} onClick={() => { setShowSearch(!showSearch); setShowDropdown(false); }}>Search</button>
                {isGroup && (
                  <>
                    <button style={{ width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'white', cursor: 'pointer', fontSize: '14px' }} onClick={() => { setShowAddMember(true); setShowDropdown(false); }}>Add Member</button>
                    <button style={{ width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'white', cursor: 'pointer', fontSize: '14px' }} onClick={() => { setShowGroupInfo(true); setShowDropdown(false); }}>Group Info</button>
                  </>
                )}
                {!isGroup && (
                  <button style={{ width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'white', cursor: 'pointer', fontSize: '14px' }} onClick={() => { setShowChatInfo(true); setShowDropdown(false); }}>Chat Info</button>
                )}
                <button style={{ width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '14px' }} onClick={handleClearChat}>Clear Chat</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearch && (
        <div style={{ padding: '10px 20px', background: 'var(--search-bg)', borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', background: 'var(--bg)', color: 'white', border: '1px solid var(--border)' }}
            autoFocus
          />
        </div>
      )}

      <div className="message-area">
        {loading ? (
          <div className="loading-container">
            <span className="loading-text">Loading messages...</span>
          </div>
        ) : (
          <div className="message-list">
            {displayedMessages.map(m => (
              <div key={m.id} className={`message-wrapper ${m.senderId === user.firebaseUID ? 'sent' : 'received'}`}>
                <div className="message-bubble">
                  {isGroup && m.senderId !== user.firebaseUID && (
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#53bdeb', marginBottom: '4px' }}>
                      {m.senderName}
                    </div>
                  )}

                  <button
                    className="message-dropdown-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMsgId(activeMsgId === m.id ? null : m.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
                  </button>

                  {activeMsgId === m.id && (
                    <div className="message-options-menu" ref={msgDropdownRef}>
                      <button onClick={() => handleDeleteForMe(m.id)}>Delete for me</button>
                      {m.senderId === user.firebaseUID && (
                        <button className="delete-btn" onClick={() => handleDeleteForEveryone(m.id)}>Delete for everyone</button>
                      )}
                    </div>
                  )}

                  {m.imageUrl && (
                    <div className="message-image-container" style={{ marginBottom: '8px' }}>
                      <img 
                        src={m.imageUrl} 
                        alt="Shared" 
                        style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', display: 'block' }} 
                        onClick={() => window.open(m.imageUrl, '_blank')}
                      />
                    </div>
                  )}

                  {m.audioUrl && (
                    <div className="message-audio-container" style={{ marginBottom: '8px' }}>
                      <audio src={m.audioUrl} controls style={{ maxWidth: '240px', height: '36px' }} />
                    </div>
                  )}
                  {m.text && <p>{m.text}</p>}
                  <div className="message-status">
                    <span className="message-time">{m.time}</span>
                    {m.senderId === user.firebaseUID && (
                      <span className="read-receipt">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="#53bdeb"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM1 12l1.41-1.41L7.4 15.58 6 17 1 12z" /></svg>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <div className="empty-chat-msg">No messages here yet. Say hi! 👋</div>
            )}
          </div>
        )}
      </div>

      <div className="input-area">
        <input 
          type="file" 
          ref={fileInputRef} 
          hidden 
          accept="image/*" 
          onChange={handleFileChange} 
        />
        <button className="icon-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
          {isUploading ? (
            <div className="upload-spinner" style={{ width: '20px', height: '20px', border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          )}
        </button>
        <div className="msg-input-wrapper">
          {isRecording ? (
            <div className="recording-indicator">
              <div className="pulse-dot"></div>
              <span>Recording {formatTime(recordingTime)}</span>
            </div>
          ) : (
            <input
              type="text"
              placeholder="Type a message"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyPress={handleKeyPress}
            />
          )}
        </div>
        
        {isRecording ? (
          <div className="rec-actions" style={{ display: 'flex', gap: '8px' }}>
            <button className="icon-btn cancel-btn" onClick={cancelRecording} title="Cancel">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="#ff6b6b"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
            </button>
            <button className="icon-btn stop-btn" onClick={stopRecording} title="Send voice note">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--accent)"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </div>
        ) : (
          msg ? (
            <button className="icon-btn send-btn" onClick={() => handleSend()}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--accent)"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          ) : (
            <button className="icon-btn mic-btn" onClick={startRecording}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" /><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" /></svg>
            </button>
          )
        )}
      </div>
      {showGroupInfo && <GroupInfoModal group={chat} onClose={() => setShowGroupInfo(false)} />}
      {showChatInfo && <ChatInfoModal chat={chat} onClose={() => setShowChatInfo(false)} />}
      {showAddMember && <AddMemberModal group={chat} onClose={() => setShowAddMember(false)} onSuccess={() => setShowAddMember(false)} />}
    </div>
  );
};

export default ChatWindow;
