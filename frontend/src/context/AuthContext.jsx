import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile
} from 'firebase/auth';
import { ref, set, push, onValue } from 'firebase/database';
import { 
  getDoc, 
  doc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { auth, db, firestore } from '../config/firebaseConfig';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  generateIdentityKeys, 
  deriveSharedSecret, 
  generateGroupKey, 
  exportSymmetricKey, 
  importSymmetricKey, 
  encryptMessage, 
  decryptMessage,
  backupPrivateKey,
  recoverPrivateKey,
  hasPrivateKey
} from '../utils/crypto';

const AuthContext = createContext();
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [sharedKeys, setSharedKeys] = useState({}); // Cache for derived AES keys: { recipientUid: CryptoKey }
  const [groupKeys, setGroupKeys] = useState({});   // Cache for Group symmetric keys: { groupId: CryptoKey }
  const [recoveryStatus, setRecoveryStatus] = useState('loading'); // loading, needs_recovery, ready

  useEffect(() => {
    if (user && user.email) {
      const newSocket = io(SOCKET_URL, {
        query: { uid: user.uid || user.firebaseUID }
      });
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

          // --- Phase 3: Recovery Check ---
          const hasPk = await hasPrivateKey();
          if (!hasPk && data.encryptedPrivateKey) {
            console.log('[E2EE] Identity key missing but backup found. Recovery required.');
            setRecoveryStatus('needs_recovery');
          } else {
            setRecoveryStatus('ready');
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

  const signupWithE2EE = async (email, password, name, recoveryPassphrase) => {
    // 1. Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateFirebaseProfile(userCredential.user, { displayName: name });

    // 2. Generate E2EE Identity Keys
    console.log('[E2EE] Generating identity keys for new user...');
    const publicKey = await generateIdentityKeys();

    // 3. Backup Private Key (Phase 3)
    console.log('[E2EE] Creating secure backup of private key...');
    const backupBlob = await backupPrivateKey(recoveryPassphrase);

    // 4. Initial sync with backend to create Firestore record with PublicKey and Backup
    const token = await userCredential.user.getIdToken();
    const { data } = await axios.post(`${API_URL}/auth/sync`, 
      { publicKey, encryptedPrivateKey: backupBlob }, 
      { headers: { Authorization: `Bearer ${token}` } }
    );

    setUser({ ...userCredential.user, ...data });
    setRecoveryStatus('ready');
    return userCredential.user;
  };

  const recoverAccount = async (passphrase) => {
    if (!user?.encryptedPrivateKey) return { success: false, message: 'No backup found on server' };
    
    try {
      console.log('[E2EE] Attempting to recover identity...');
      await recoverPrivateKey(user.encryptedPrivateKey, passphrase);
      setRecoveryStatus('ready');
      return { success: true };
    } catch (err) {
      console.error('[E2EE] Recovery failed:', err);
      return { success: false, message: 'Invalid recovery passphrase' };
    }
  };

  const getSharedKeyForUser = async (recipientUid) => {
    if (sharedKeys[recipientUid]) return sharedKeys[recipientUid];

    try {
      // 1. Fetch recipient's public key from Firestore
      const recipientDoc = await getDoc(doc(firestore, 'users', recipientUid));
      if (!recipientDoc.exists()) throw new Error('Recipient not found');
      
      const recipientPublicKey = recipientDoc.data().publicKey;
      if (!recipientPublicKey) throw new Error('Recipient has not enabled E2EE');

      // 2. Derive shared secret
      console.log(`[E2EE] Deriving shared secret for ${recipientUid}...`);
      const sharedKey = await deriveSharedSecret(recipientPublicKey);

      // 3. Cache and return
      setSharedKeys(prev => ({ ...prev, [recipientUid]: sharedKey }));
      return sharedKey;
    } catch (error) {
      // Don't log full error to console to keep it clean for expected legacy cases
      console.warn(`[E2EE] Could not get shared key for ${recipientUid}: ${error.message}`);
      return null;
    }
  };

  const getGroupKey = async (groupId) => {
    if (groupKeys[groupId]) return groupKeys[groupId];

    try {
      const idToken = await auth.currentUser.getIdToken();
      // 1. Fetch wrapped key from backend
      const res = await axios.get(`${API_URL}/groups/${groupId}/key`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      
      const { wrappedKey, iv, wrapperPublicKey } = res.data;
      if (!wrappedKey || !iv || !wrapperPublicKey) throw new Error('Incomplete E2EE key data');

      // 2. Derive the shared secret with the person who wrapped the key for us
      console.log(`[E2EE] Unwrapping group key for ${groupId}...`);
      const sharedSecret = await deriveSharedSecret(wrapperPublicKey);

      // 3. Unwrap (decrypt) the symmetric key
      const unwrappedBase64 = await decryptMessage({ ciphertext: wrappedKey, iv }, sharedSecret);
      const groupKey = await importSymmetricKey(unwrappedBase64);

      // 4. Cache and return
      setGroupKeys(prev => ({ ...prev, [groupId]: groupKey }));
      return groupKey;
    } catch (error) {
      console.error('[E2EE] Failed to get group key:', error);
      return null;
    }
  };

  const login = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const updateProfileInDB = async (newName, newAvatar = null, newAvatarFileId = null) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const updates = {};
      if (newName) updates.name = newName;
      if (newAvatar) updates.avatar = newAvatar;
      if (newAvatarFileId) updates.avatarFileId = newAvatarFileId;

      const res = await axios.put(`${API_URL}/users/profile`,
        updates,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      
      setUser(prev => ({ 
        ...prev, 
        name: res.data.name || prev.name,
        avatar: res.data.avatar || prev.avatar,
        avatarFileId: res.data.avatarFileId || prev.avatarFileId
      }));

      if (socket) {
        socket.emit('update_profile', { 
          uid: auth.currentUser.uid, 
          name: res.data.name || user?.name, 
          avatar: res.data.avatar || user?.avatar,
          avatarFileId: res.data.avatarFileId || user?.avatarFileId
        });
      }

      return true;
    } catch (error) {
      console.error('Update profile error:', error);
      return false;
    }
  };

  const uploadProfilePicture = async (file) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const formData = new FormData();
      formData.append('image', file);

      const res = await axios.post(`${API_URL}/upload?skipTrack=true`, formData, {
        headers: { 
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (res.data.success) {
        return { url: res.data.url, fileId: res.data.fileId };
      }
      return null;
    } catch (error) {
      console.error('Upload profile picture error:', error);
      return null;
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
      const meUid = auth.currentUser.uid;

      // Ensure I am in the list for wrapping
      if (!members.includes(meUid)) members.push(meUid);

      // --- E2EE Phase ---
      console.log('[E2EE] Initializing group security...');
      const groupKey = await generateGroupKey();
      const groupKeyBase64 = await exportSymmetricKey(groupKey);
      const keyMap = {};

      // Wrap for every initial member
      for (const memberUid of members) {
        try {
          const sharedSecret = await getSharedKeyForUser(memberUid);
          if (sharedSecret) {
            const wrapped = await encryptMessage(groupKeyBase64, sharedSecret);
            keyMap[memberUid] = {
              wrappedKey: wrapped.ciphertext,
              iv: wrapped.iv
            };
          }
        } catch (err) {
          console.warn(`[E2EE] Could not wrap key for member ${memberUid}, they might not have E2EE enabled.`, err);
        }
      }

      const res = await axios.post(`${API_URL}/groups`, { name, members, keyMap }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });

      // Cache the key we just created
      if (res.data.group) {
        setGroupKeys(prev => ({ ...prev, [res.data.group.id]: groupKey }));
      }

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
      
      // --- E2EE Phase ---
      let wrappedKey = null;
      try {
        const groupKey = await getGroupKey(groupId);
        const sharedSecret = await getSharedKeyForUser(newMemberUid);
        
        if (groupKey && sharedSecret) {
          const groupKeyBase64 = await exportSymmetricKey(groupKey);
          const wrapped = await encryptMessage(groupKeyBase64, sharedSecret);
          wrappedKey = {
            wrappedKey: wrapped.ciphertext,
            iv: wrapped.iv
          };
        }
      } catch (err) {
        console.warn('[E2EE] Failed to wrap key for new member:', err);
      }

      const res = await axios.post(`${API_URL}/groups/${groupId}/members`, { newMemberUid, wrappedKey }, {
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

  const resetUnread = async (contactId) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      await axios.post(`${API_URL}/messages/reset-unread`, 
        { contactId },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      return true;
    } catch (error) {
      console.error('Reset unread error:', error);
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

  const changePassword = async (oldPassword, newPassword, confirmPassword) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.put(`${API_URL}/auth/change-password`, 
        { oldPassword, newPassword, confirmPassword },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      return { success: true, message: res.data.message };
    } catch (error) {
      console.error('Change password error:', error);
      return { 
        success: false, 
        message: error.response?.data?.message || 'Failed to update password' 
      };
    }
  };

  const logout = () => {
    return signOut(auth);
  };

  const value = {
    user,
    signup: signupWithE2EE,
    login,
    logout,
    updateProfile: updateProfileInDB,
    uploadProfilePicture,
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
    changePassword,
    getSharedKeyForUser,
    getGroupKey,
    recoverAccount,
    recoveryStatus,
    resetUnread,
    socket,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
