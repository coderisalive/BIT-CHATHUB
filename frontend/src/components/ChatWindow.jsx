import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../config/firebaseConfig';
import { ref, onValue } from 'firebase/database';

const ChatWindow = ({ chat }) => {
  const { user, sendMessage, getChatId, socket, getMessages, getGroupMessages } = useAuth();
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const isGroup = chat?.isGroup;

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
      if (!isGroup && (data.senderEmail === chat.email || data.senderUid === chat.id)) {
        addLiveMessage(data);
      }
    };

    const handleReceiveGroup = (data) => {
      if (isGroup && data.groupId === chat.id) {
        addLiveMessage(data);
      }
    };

    const addLiveMessage = (data) => {
      const newMessage = {
        id: data.id || `live-${Date.now()}`,
        text: data.text,
        senderId: data.senderId || data.senderUid,
        senderName: data.senderName,
        timestamp: data.timestamp,
        time: new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
      };
      
      setMessages(prev => {
        const exists = prev.some(m => (m.id === newMessage.id) || (m.text === newMessage.text && Math.abs(m.timestamp - newMessage.timestamp) < 2000 && m.senderId === newMessage.senderId));
        if (exists) return prev;
        return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
      });
    };

    socket.on('receive_message', handleReceivePrivate);
    socket.on('receive_group_message', handleReceiveGroup);
    
    return () => {
      socket.off('receive_message', handleReceivePrivate);
      socket.off('receive_group_message', handleReceiveGroup);
    };
  }, [socket, chat, isGroup]);

  const handleSend = async () => {
    if (!msg.trim() || !socket) return;

    const timestamp = Date.now();
    
    if (isGroup) {
      socket.emit('send_group_message', {
        groupId: chat.id,
        text: msg,
        senderUid: user.firebaseUID,
        senderName: user.name
      });
    } else {
      socket.emit('send_message', {
        to: chat.email.toLowerCase(),
        text: msg,
        senderEmail: user.email.toLowerCase(),
        senderName: user.name,
        senderUid: user.firebaseUID,
        targetUid: chat.uid || chat.id,
        targetName: chat.name,
        timestamp
      });
    }

    // Immediate UI Update for Sender
    setMessages(prev => [...prev, {
      id: `temp-${Date.now()}`,
      text: msg,
      senderId: user.firebaseUID,
      senderName: user.name,
      timestamp,
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
    }]);
    
    setMsg('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="header-left">
          <img src={chat.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.name || 'Chat'}`} alt={chat.name} className="header-avatar" />
          <div className="header-info">
            <span className="header-name">{chat.name}</span>
            <span className="header-status">online</span>
          </div>
        </div>
        <div className="header-right">
          <button className="icon-btn">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          </button>
          <button className="icon-btn">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
        </div>
      </div>

      <div className="message-area">
        {loading ? (
          <div className="loading-container">
            <span className="loading-text">Loading messages...</span>
          </div>
        ) : (
          <div className="message-list">
            {messages.map(m => (
              <div key={m.id} className={`message-wrapper ${m.senderId === user.firebaseUID ? 'sent' : 'received'}`}>
                <div className="message-bubble">
                  {isGroup && m.senderId !== user.firebaseUID && (
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#53bdeb', marginBottom: '4px' }}>
                      {m.senderName}
                    </div>
                  )}
                  <p>{m.text}</p>
                  <div className="message-status">
                    <span className="message-time">{m.time}</span>
                    {m.senderId === user.firebaseUID && (
                      <span className="read-receipt">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="#53bdeb"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM1 12l1.41-1.41L7.4 15.58 6 17 1 12z"/></svg>
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
        <button className="icon-btn">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        </button>
        <div className="msg-input-wrapper">
          <input 
            type="text" 
            placeholder="Type a message" 
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyPress={handleKeyPress}
          />
        </div>
        {msg ? (
          <button className="icon-btn send-btn" onClick={handleSend}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--accent)"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        ) : (
          <button className="icon-btn">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatWindow;
