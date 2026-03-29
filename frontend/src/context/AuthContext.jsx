import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile
} from 'firebase/auth';
import { ref, set, push, onValue } from 'firebase/database';
import { auth, db } from '../config/firebaseConfig';
import axios from 'axios';
import { io } from 'socket.io-client';

const AuthContext = createContext();
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (user && user.email) {
      const newSocket = io(SOCKET_URL);
      newSocket.on('connect', () => {
        console.log('[Socket] Connected to server');
        newSocket.emit('join', user.email.toLowerCase());
      });
      setSocket(newSocket);
      return () => newSocket.close();
    } else {
      setSocket(null);
    }
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Sync with backend to get full user profile from Firestore
        try {
          const token = await firebaseUser.getIdToken();
          console.log("[Auth] Syncing with backend. Firebase User Email:", firebaseUser.email);
          const { data } = await axios.post(`${API_URL}/auth/sync`, {}, {
            headers: { Authorization: `Bearer ${token}` }
          });
          console.log("[Auth] Backend Response Data:", data);

          if (data.isMock) {
            console.log("[Auth] Limited Mode detected. Preserving Firebase identity.");
            const combined = { ...firebaseUser, ...data, email: firebaseUser.email, name: data.name || firebaseUser.displayName };
            setUser(combined);
          } else {
            setUser({ ...firebaseUser, ...data });
          }
        } catch (error) {
          console.error("User sync failed:", error);
          setUser(firebaseUser); // Fallback to basic firebase user
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [API_URL]);

  const signup = async (email, password, name) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    return userCredential.user;
  };

  const login = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const updateProfileInDB = async (newName) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.put(`${API_URL}/users/profile`,
        { name: newName },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      setUser(prev => ({ ...prev, name: res.data.name }));
      return true;
    } catch (error) {
      console.error('Update profile error:', error);
      return false;
    }
  };

  const getMessages = async (chatId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await axios.get(`${API_URL.replace('/api/auth', '').replace('/api', '')}/api/messages/${chatId}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return response.data;
    } catch (error) {
      console.error('Fetch messages error:', error);
      return [];
    }
  };

  const searchUsers = async (query) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get(`${API_URL}/users/search?query=${query}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  };

  const getContacts = async () => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get(`${API_URL}/users/contacts`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Fetch contacts error:', error);
      return [];
    }
  };

  const addContact = async (contact) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await axios.post(`${API_URL}/users/contacts`, { contact }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return true;
    } catch (error) {
      console.error('Add contact error:', error);
      return false;
    }
  };

  const removeContact = async (contactUid) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await axios.delete(`${API_URL}/users/contacts/${contactUid}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return true;
    } catch (error) {
      console.error('Remove contact error:', error);
      return false;
    }
  };

  const createGroup = async (name, members) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.post(`${API_URL}/groups`, { name, members }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data.group;
    } catch (error) {
      console.error('Create group error:', error);
      return null;
    }
  };

  const getGroups = async () => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get(`${API_URL}/groups`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Fetch groups error:', error);
      return [];
    }
  };

  const getGroupMessages = async (groupId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get(`${API_URL}/groups/${groupId}/messages`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Fetch group messages error:', error);
      return [];
    }
  };

  const getGroupMembers = async (groupId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get(`${API_URL}/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Fetch group members error:', error);
      return [];
    }
  };

  const addGroupMember = async (groupId, newMemberUid) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.post(`${API_URL}/groups/${groupId}/members`, { newMemberUid }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return res.data;
    } catch (error) {
      console.error('Add group member error:', error);
      return null;
    }
  };

  const clearChatMessages = async (chatId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await axios.delete(`${API_URL}/messages/${chatId}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return true;
    } catch (error) {
      console.error('Clear chat error:', error);
      return false;
    }
  };

  const clearGroupMessages = async (groupId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await axios.delete(`${API_URL}/groups/${groupId}/messages`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return true;
    } catch (error) {
      console.error('Clear group messages error:', error);
      return false;
    }
  };

  const deleteMessage = async (chatId, messageId, type, isGroup) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const endpoint = isGroup
        ? `${API_URL}/groups/${chatId}/messages/${messageId}/${type}`
        : `${API_URL}/messages/${chatId}/${messageId}/${type}`;

      await axios.delete(endpoint, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return true;
    } catch (error) {
      console.error(`Delete message ${type} error:`, error);
      return false;
    }
  };

  const getChatId = (uid1, uid2) => {
    return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
  };

  const sendMessage = async (targetUid, text) => {
    // We no longer write to Firebase from the frontend to avoid permission issues.
    // The backend will handle the database write once it receives the socket event.
    return true;
  };

  const logout = () => {
    return signOut(auth);
  };

  const value = {
    user,
    signup,
    login,
    logout,
    updateProfile: updateProfileInDB,
    searchUsers,
    getContacts,
    addContact,
    removeContact,
    createGroup,
    getGroups,
    getGroupMessages,
    getGroupMembers,
    addGroupMember,
    clearChatMessages,
    clearGroupMessages,
    deleteMessage,
    getMessages,
    sendMessage,
    getChatId,
    socket,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
