const { admin, db, firestore, auth, isConfigured } = require('../config/firebaseAdmin');
const axios = require('axios');

/**
 * Sync user with Firestore after Firebase Auth signup/login on frontend.
 */
const syncUser = async (req, res) => {
  try {
    const { uid, email, name, picture } = req.user;
    const { publicKey, encryptedPrivateKey } = req.body;

    const userRef = firestore.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      const newUser = {
        name: name || 'User',
        email: email || '',
        avatar: picture || '',
        firebaseUID: uid,
        publicKey: publicKey || null,
        encryptedPrivateKey: encryptedPrivateKey || null,
        createdAt: new Date().toISOString(),
        isMock: req.user.isMock || false
      };
      await userRef.set(newUser);
      return res.status(201).json(newUser);
    }

    const userData = doc.data();
    const updates = {};
    let shouldUpdate = false;

    // Update public key if missing
    if (publicKey && !userData.publicKey) {
      updates.publicKey = publicKey;
      shouldUpdate = true;
    }

    // Update encrypted private key for recovery if missing
    if (encryptedPrivateKey && !userData.encryptedPrivateKey) {
      updates.encryptedPrivateKey = encryptedPrivateKey;
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      await userRef.update(updates);
      Object.assign(userData, updates);
    }

    res.status(200).json({ ...userData, isMock: req.user.isMock || false });
  } catch (error) {
    console.error('Sync user error:', error.message);
    res.status(500).json({ message: 'Server error during user sync' });
  }
};

const getMe = async (req, res) => {
  try {
    const { uid } = req.user;
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ ...userDoc.data(), isMock: req.user.isMock || false });
  } catch (error) {
    console.error('Get me error:', error.message);
    res.status(500).json({ message: 'Server error fetching user profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const { name, avatar, avatarFileId } = req.body;

    if (!name && !avatar) {
      return res.status(400).json({ message: 'Name or Avatar is required' });
    }

    const userRef = firestore.collection('users').doc(uid);
    
    if (avatarFileId) {
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};
      const oldFileId = userData.avatarFileId;

      if (oldFileId && oldFileId !== avatarFileId) {
        try {
          const imagekit = require('../config/imagekit');
          await imagekit.deleteFile(oldFileId);
          console.log(`[Cleanup] Deleted previous avatar ${oldFileId} from ImageKit.`);
        } catch (delErr) {
          console.error(`[Cleanup] Failed to delete old avatar ${oldFileId}:`, delErr.message);
        }
      }
    }

    const updates = {};
    if (name) updates.name = name;
    if (avatar) updates.avatar = avatar;
    if (avatarFileId) updates.avatarFileId = avatarFileId;

    await userRef.update(updates);

    res.status(200).json({ 
      message: 'Profile updated successfully', 
      name: updates.name || null, 
      avatar: updates.avatar || null,
      avatarFileId: updates.avatarFileId || null
    });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ message: 'Server error updating profile' });
  }
};

const searchUsers = async (req, res) => {
  try {
    const { query: searchQuery } = req.query;
    if (!searchQuery) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchTerm = searchQuery.toLowerCase().trim();
    console.log(`[Search] Looking for: ${searchTerm}`);

    if (!isConfigured) {
      return res.status(200).json([]);
    }

    // 1. Search in Firestore
    const usersSnap = await firestore.collection('users')
      .where('email', '==', searchTerm)
      .get();
    
    let results = usersSnap.docs.map(doc => doc.data());

    // 2. Fallback to Firebase Auth
    if (results.length === 0) {
      try {
        const firebaseUser = await auth.getUserByEmail(searchTerm);
        if (firebaseUser) {
          const foundUser = {
            name: firebaseUser.displayName || 'Firebase User',
            email: firebaseUser.email || '',
            avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
            firebaseUID: firebaseUser.uid,
            createdAt: new Date().toISOString()
          };
          // Create in Firestore
          await firestore.collection('users').doc(firebaseUser.uid).set(foundUser);
          results = [foundUser];
        }
      } catch (authError) {
        // Not found in auth either
      }
    }

    res.status(200).json(results);
  } catch (error) {
    console.error('[Search] Error:', error.message);
    res.status(500).json({ message: 'Server error searching users' });
  }
};

const getContacts = async (req, res) => {
  try {
    const { uid } = req.user;
    const contactsSnap = await firestore.collection('users').doc(uid).collection('contacts').get();
    
    const updatedContacts = await Promise.all(contactsSnap.docs.map(async (contactDoc) => {
      const cUid = contactDoc.id;
      const contactData = contactDoc.data();
      const userDoc = await firestore.collection('users').doc(cUid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      
      return {
        uid: cUid,
        ...contactData,
        name: userData.name || contactData.name,
        avatar: userData.avatar || contactData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cUid}`,
        publicKey: userData.publicKey || null
      };
    }));

    res.status(200).json(updatedContacts);
  } catch (error) {
    console.error('Get contacts error:', error.message);
    res.status(500).json({ message: 'Server error fetching contacts' });
  }
};

const addContact = async (req, res) => {
  try {
    const { uid } = req.user;
    const { contact } = req.body;
    const contactUid = contact.firebaseUID || contact.uid || contact.id;

    if (!contactUid) {
      return res.status(400).json({ message: 'Valid contact info required' });
    }

    await firestore.collection('users').doc(uid).collection('contacts').doc(contactUid).set({
      ...contact,
      uid: contactUid,
      firebaseUID: contactUid,
      addedAt: Date.now()
    });

    res.status(200).json({ message: 'Contact added successfully', contactUid });
  } catch (error) {
    console.error('Add contact error:', error.message);
    res.status(500).json({ message: 'Server error adding contact' });
  }
};

const removeContact = async (req, res) => {
  try {
    const { uid } = req.user;
    const { contactUid } = req.params;

    await firestore.collection('users').doc(uid).collection('contacts').doc(contactUid).delete();
    res.status(200).json({ message: 'Contact removed successfully' });
  } catch (error) {
    console.error('[RemoveContact] Error:', error.message);
    res.status(500).json({ message: 'Server error removing contact' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'All password fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'New passwords do not match' });
    }

    const API_KEY = process.env.FIREBASE_API_KEY;
    try {
      const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
      await axios.post(verifyUrl, { email, password: oldPassword, returnSecureToken: true });
    } catch (verifyError) {
      return res.status(401).json({ message: 'Incorrect old password' });
    }

    await admin.auth().updateUser(uid, { password: newPassword });
    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ message: 'Server error updating password' });
  }
};

module.exports = { syncUser, getMe, updateProfile, searchUsers, getContacts, addContact, removeContact, changePassword };


module.exports = { syncUser, getMe, updateProfile, searchUsers, getContacts, addContact, removeContact, changePassword };
