import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../config/firebaseConfig';
import GroupInfoModal from './GroupInfoModal';
import AddMemberModal from './AddMemberModal';
import ChatInfoModal from './ChatInfoModal';
import TicTacToe from './TicTacToe';
import NumberGuess from './NumberGuess';
import { encryptMessage, decryptMessage } from '../utils/crypto';

const ChatWindow = ({ chat, onBack }) => {
  const { 
    user, 
    getChatId, 
    socket, 
    getMessages, 
    getGroupMessages, 
    clearChatMessages, 
    clearGroupMessages, 
    deleteMessage,
    getSharedKeyForUser,
    getGroupKey
  } = useAuth();
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendViewOnce, setSendViewOnce] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(null); // { url, id, isGroup, chatId }

  const [showSearch, setShowSearch] = useState(false);
  const [showGameMenu, setShowGameMenu] = useState(false);
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
  const messagesEndRef = useRef(null);

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

      try {
        if (isGroup) {
          history = await getGroupMessages(chat.id);
          if (socket) socket.emit('join_group', chat.id);
        } else {
          const cid = getChatId(user.firebaseUID, chat.uid || chat.id);
          history = await getMessages(cid);
          if (socket) socket.emit('join_chat_room', cid);

          // Decrypt private messages
          console.log('[E2EE] Decrypting history...');
          const sharedKey = isGroup ? await getGroupKey(chat.id) : await getSharedKeyForUser(chat.uid || chat.id);
          
          history = await Promise.all(history.map(async (m) => {
            if (m.isEncrypted && m.encryptedText && m.iv) {
              if (!sharedKey) {
                return { ...m, text: '🔐 [Encrypted - Key Missing]' };
              }
              try {
                const decrypted = await decryptMessage(m.encryptedText, m.iv, sharedKey);
                return { ...m, text: decrypted };
              } catch (err) {
                console.error(`[E2EE] Failed to decrypt msg ${m.id}:`, err);
                return { ...m, text: '📩 [Decryption Failed]' };
              }
            }
            return m;
          }));
        }

        const formattedHistory = history.map(m => ({
          ...m,
          time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase() : 'just now'
        })).sort((a, b) => a.timestamp - b.timestamp);

        setMessages(formattedHistory);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setLoading(false);
      }
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

    const addLiveMessage = async (data) => {
      console.log("[Socket] Processing live message:", data);
      let decodedText = data.text;

      // Decrypt if necessary
      if (data.isEncrypted && data.encryptedText && data.iv) {
        try {
          const sharedKey = isGroup ? await getGroupKey(chat.id) : await getSharedKeyForUser(chat.uid || chat.id);
          if (sharedKey) {
            decodedText = await decryptMessage(data.encryptedText, data.iv, sharedKey);
          }
        } catch (err) {
          console.error('[E2EE] Live decryption failed:', err);
          decodedText = '📩 [Decryption Failed]';
        }
      }

      const newMessage = {
        id: data.id || `live-${Date.now()}`,
        text: decodedText,
        type: data.type,
        gameId: data.gameId,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        isViewOnce: data.isViewOnce || false,
        isOpened: data.isOpened || false,
        isEncrypted: data.isEncrypted,
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

        // If the current chat is active and the incoming message is from the other person
        if (!isGroup && String(newMessage.senderId) === String(chat.uid || chat.id)) {
          markRead();
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

    const handleMessagesRead = (data) => {
      console.log("[Socket] Messages were read by the recipient.");
      setMessages(prev => prev.map(m => 
        m.senderId === user.firebaseUID ? { ...m, seen: true } : m
      ));
    };

    const handleMessageOpened = (data) => {
      console.log("[Socket] Message opened:", data);
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, isOpened: true, imageUrl: null } : m
      ));
    };

    const handleGameCreated = (data) => {
      console.log("[Socket] Game created:", data);
      const msgData = data.message;
      if (msgData) {
        setMessages(prev => {
          const exists = prev.some(m => m.id === msgData.id);
          if (exists) return prev;
          return [...prev, {
            ...msgData,
            senderId: msgData.senderId || msgData.senderUid,
            time: new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
          }].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    };

    socket.on('receive_message', handleReceivePrivate);
    socket.on('receive_group_message', handleReceiveGroup);
    socket.on('message_persistence_success', handleMessageSuccess);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('game_created', handleGameCreated);
    socket.on('messages_read', handleMessagesRead);
    socket.on('message_opened', handleMessageOpened);

    return () => {
      socket.off('receive_message', handleReceivePrivate);
      socket.off('receive_group_message', handleReceiveGroup);
      socket.off('message_persistence_success', handleMessageSuccess);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('game_created', handleGameCreated);
      socket.off('messages_read', handleMessagesRead);
      socket.off('message_opened', handleMessageOpened);
    };
  }, [socket, chat, isGroup]);

  const handleSend = async (imageOverrideUrl = null, audioOverrideUrl = null) => {
    if ((!msg.trim() && !imageOverrideUrl && !audioOverrideUrl) || !socket) return;

    const timestamp = Date.now();
    const tempId = `temp-${timestamp}`;
    let encryptedPayload = { encryptedText: null, iv: null };

    // E2EE Encryption
    if (msg.trim()) {
      try {
        const sharedKey = isGroup ? await getGroupKey(chat.id) : await getSharedKeyForUser(chat.uid || chat.id);
        if (sharedKey) {
          console.log('[E2EE] Encrypting message...');
          encryptedPayload = await encryptMessage(msg, sharedKey);
        }
      } catch (err) {
        console.error('[E2EE] Encryption failed:', err);
        alert('Security error: Failed to encrypt message.');
        return;
      }
    }

    const payload = {
      tempId,
      text: encryptedPayload.encryptedText ? null : msg, // Clear text only if encrypted
      encryptedText: encryptedPayload.encryptedText,
      iv: encryptedPayload.iv,
      imageUrl: imageOverrideUrl,
      audioUrl: audioOverrideUrl,
      senderEmail: user.email.toLowerCase(),
      senderName: user.name,
      senderUid: user.firebaseUID,
      timestamp,
      isViewOnce: sendViewOnce,
      isOpened: false
    };

    if (isGroup) {
      socket.emit('send_group_message', {
        groupId: chat.id,
        ...payload
      });
    } else {
      socket.emit('send_message', {
        to: chat.email?.toLowerCase() || '',
        targetUid: chat.firebaseUID || chat.uid || chat.id,
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
      isViewOnce: sendViewOnce,
      isOpened: false,
      isEncrypted: !!encryptedPayload.encryptedText,
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
    }]);

    setMsg('');
    setSendViewOnce(false);
  };

  const handleStartGame = (gameType = 'tictactoe') => {
    if (!socket || isGroup) return;
    socket.emit('create_game', {
      to: chat.email.toLowerCase(),
      targetUid: chat.uid || chat.id,
      senderUid: user.firebaseUID,
      senderName: user.name,
      senderEmail: user.email,
      gameType
    });
    setShowGameMenu(false);
  };

  const markRead = () => {
    if (!socket || !chat || isGroup) return;
    const cid = getChatId(user.firebaseUID, chat.uid || chat.id);
    socket.emit('mark_read', {
      chatId: cid,
      senderUid: chat.uid || chat.id, // the messages we are reading are from the other person
      targetUid: user.firebaseUID // the user who read them
    });

    // Update local state immediately so burnMessages can trigger
    setMessages(prev => prev.map(m => 
      m.senderId !== user.firebaseUID ? { ...m, seen: true } : m
    ));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Burn View Once messages on exit or tab switch
  useEffect(() => {
    // Capture values needed for cleanup to ensure they refer to THIS chat session
    const currentChatId = isGroup ? chat?.id : getChatId(user.firebaseUID, chat?.uid || chat?.id);
    const currentMessages = [...messages];

    const burnMessages = () => {
      if (!currentChatId) return;

      currentMessages.forEach(m => {
        // If it's a view-once message, it's been seen by us (as recipient), but not yet opened
        if (m.isViewOnce && !m.isOpened && m.senderId !== user.firebaseUID && m.seen) {
          console.log("[ViewOnce] Burning message:", m.id, "in room:", currentChatId);
          socket.emit('mark_opened', { chatId: currentChatId, messageId: m.id, isGroup });
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        burnMessages();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      burnMessages();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [chat, messages, user.firebaseUID, isGroup, socket, getChatId]);

  // Mark everything as read when chat is opened
  useEffect(() => {
    if (chat && !isGroup) {
      markRead();
    }
  }, [chat, isGroup, socket]);

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
                      {m.isViewOnce ? (
                        m.isOpened ? (
                          <div className="view-once-opened">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            <span>Photo Viewed</span>
                          </div>
                        ) : (
                          <div 
                            className="view-once-placeholder" 
                            onClick={() => {
                              setViewingPhoto({ 
                                url: m.imageUrl, 
                                id: m.id, 
                                isGroup, 
                                chatId: isGroup ? chat.id : getChatId(user.firebaseUID, chat.uid || chat.id) 
                              });
                            }}
                          >
                            <div className="view-once-icon">1</div>
                            <span>View Photo</span>
                          </div>
                        )
                      ) : (
                        <img 
                          src={m.imageUrl} 
                          alt="Shared" 
                          style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', display: 'block' }} 
                          onClick={() => window.open(m.imageUrl, '_blank')}
                        />
                      )}
                    </div>
                  )}

                  {m.audioUrl && (
                    <div className="message-audio-container" style={{ marginBottom: '8px' }}>
                      <audio src={m.audioUrl} controls style={{ maxWidth: '240px', height: '36px' }} />
                    </div>
                  )}
                  {m.text && (
                    <div className="message-text">
                      {m.isViewOnce && m.isOpened ? (
                        <div className="view-once-opened">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                          <span>Message Viewed</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <p>{m.text}</p>
                          {m.isViewOnce && !m.isOpened && (
                            <div className="view-once-indicator" title="View Once Message">1</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {m.type === 'game' && m.text.includes('Tic-Tac-Toe') && (
                    <TicTacToe 
                      gameId={m.gameId} 
                      socket={socket} 
                      currentUserId={user.firebaseUID} 
                    />
                  )}
                  {m.type === 'game' && m.text.includes('secret number') && (
                    <NumberGuess 
                      gameId={m.gameId} 
                      socket={socket} 
                      onGameEnd={() => {}} 
                    />
                  )}
                  <div className="message-status">
                    <span className="message-time">{m.time}</span>
                    {m.senderId === user.firebaseUID && (
                      <span className="read-receipt">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill={m.seen ? "#53bdeb" : "#8696a0"}>
                          <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM1 12l1.41-1.41L7.4 15.58 6 17 1 12z" />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <div className="empty-chat-msg">No messages here yet. Say hi! 👋</div>
            )}
            <div ref={messagesEndRef} />
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
         <div style={{ position: 'relative' }}>
          {!isGroup && (
            <button className={`icon-btn ${showGameMenu ? 'active' : ''}`} onClick={() => setShowGameMenu(!showGameMenu)} title="Play a Game">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
            </button>
          )}

          {showGameMenu && (
            <div className="game-select-menu">
              <button onClick={() => handleStartGame('tictactoe')}>
                <span>🎮</span> Tic-Tac-Toe
              </button>
              <button onClick={() => handleStartGame('numberguess')}>
                <span>🔢</span> Number Guess
              </button>
            </div>
          )}
        </div>

        <button 
          className={`icon-btn view-once-toggle ${sendViewOnce ? 'active' : ''}`} 
          onClick={() => setSendViewOnce(!sendViewOnce)}
          title="Send as View Once"
        >
          <div className="view-once-badge">1</div>
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

      {viewingPhoto && (
        <div className="view-once-modal-overlay">
          <div className="view-once-modal-content">
            <button 
              className="modal-close-btn" 
              onClick={() => {
                // Mark as opened ONLY after viewing/closing
                socket.emit('mark_opened', { 
                  chatId: viewingPhoto.chatId,
                  messageId: viewingPhoto.id,
                  isGroup: viewingPhoto.isGroup 
                });
                
                // Lockdown local state immediately
                setMessages(prev => prev.map(m => 
                  m.id === viewingPhoto.id ? { ...m, isOpened: true, imageUrl: null } : m
                ));
                
                setViewingPhoto(null);
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
            </button>
            <img src={viewingPhoto.url} alt="View Once" className="view-once-full-img" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
