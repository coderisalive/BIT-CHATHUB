import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster, toast } from 'react-hot-toast';
import Login from './components/Login';
import Signup from './components/Signup';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import HomePlaceholder from './components/HomePlaceholder';
import ChatWindow from './components/ChatWindow';
import RecoveryModal from './components/RecoveryModal';

const ChatLayout = () => {
  const [selectedChat, setSelectedChat] = useState(null);
  const { socket, user } = useAuth();

  const handleChatSelect = (chat) => {
    setSelectedChat(chat);
  };

  useEffect(() => {
    if (!socket || !user) return;

    const handlePrivateMsg = (data) => {
      // Suppress if the user is actively viewing this chat
      const isViewingUser = selectedChat && !selectedChat.isGroup && 
        (selectedChat.id === data.senderUid || selectedChat.email === data.senderEmail);
      
      // Suppress if I sent it myself (e.g., from another device)
      const isSenderMe = data.senderUid === (user.firebaseUID || user.uid);

      if (!isViewingUser && !isSenderMe) {
        toast(`New message from ${data.senderName}`, {
          icon: '💬',
          style: {
            borderRadius: '10px',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)'
          },
        });
      }
    };

    const handleGroupMsg = (data) => {
      // Suppress if viewing this group
      const isViewingGroup = selectedChat && selectedChat.isGroup && selectedChat.id === data.groupId;
      const isSenderMe = data.senderUid === (user.firebaseUID || user.uid);

      if (!isViewingGroup && !isSenderMe) {
        toast(`${data.senderName} sent a group message`, {
          icon: '👥',
          style: {
            borderRadius: '10px',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)'
          },
        });
      }
    };

    socket.on('receive_message', handlePrivateMsg);
    socket.on('receive_group_message', handleGroupMsg);

    return () => {
      socket.off('receive_message', handlePrivateMsg);
      socket.off('receive_group_message', handleGroupMsg);
    };
  }, [socket, selectedChat, user]);

  return (
    <div className={`main-layout ${selectedChat ? 'has-selected-chat' : ''}`}>
      <Toaster position="top-right" reverseOrder={false} />
      <RecoveryModal />
      <Sidebar onChatSelect={handleChatSelect} selectedChatId={selectedChat?.id} />
      {selectedChat ? (
        <ChatWindow chat={selectedChat} onBack={() => setSelectedChat(null)} />
      ) : (
        <HomePlaceholder />
      )}
    </div>
  );
};

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <div className="app-container">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <ChatLayout />
                </ProtectedRoute>
              } 
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
