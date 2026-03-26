const { admin, db, auth, isConfigured } = require('../config/firebaseAdmin');

/**
 * Sync user with Firestore after Firebase Auth signup/login on frontend.
 */
const syncUser = async (req, res) => {
  try {
    const { uid, email, name, picture } = req.user;

    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.get();

    if (!snapshot.exists()) {
      const newUser = {
        name: name || 'User',
        email: email || '',
        avatar: picture || '',
        firebaseUID: uid,
        createdAt: new Date().toISOString(),
        isMock: req.user.isMock || false
      };
      newUser.isMock = req.user.isMock || false;
      await userRef.set(newUser);
      return res.status(201).json(newUser);
    }

    res.status(200).json({ ...snapshot.val(), isMock: req.user.isMock || false });
  } catch (error) {
    console.error('Sync user error:', error.message);
    res.status(500).json({ message: 'Server error during user sync' });
  }
};

const getMe = async (req, res) => {
  try {
    const { uid } = req.user;
    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ ...snapshot.val(), isMock: req.user.isMock || false });
  } catch (error) {
    console.error('Get me error:', error.message);
    res.status(500).json({ message: 'Server error fetching user profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const userRef = db.ref(`users/${uid}`);
    await userRef.update({ name });

    res.status(200).json({ message: 'Profile updated successfully', name });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ message: 'Server error updating profile' });
  }
};

const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchTerm = query.toLowerCase().trim();
    console.log(`[Search] Looking for: ${searchTerm}`);

    if (!isConfigured) {
      console.warn(`[Search] Limited mode active. Cannot search database without Service Account.`);
      return res.status(200).json([]);
    }

    // 1. Search in our Realtime Database
    const usersRef = db.ref('users');
    const snapshot = await usersRef.get();
    const users = snapshot.val() || {};

    let results = Object.values(users).filter(u =>
      u.email?.toLowerCase() === searchTerm || (u.phone && u.phone === searchTerm)
    );

    console.log(`[Search] Found in RTDB: ${results.length} matches`);

    // 2. If not found in RTDB, check Firebase Authentication directly (only if Admin is configured)
    if (results.length === 0 && isConfigured) {
      try {
        console.log(`[Search] Not found in RTDB, checking Firebase Auth for ${searchTerm}...`);
        let firebaseUser;
        if (searchTerm.includes('@')) {
          firebaseUser = await auth.getUserByEmail(searchTerm);
        } else {
          firebaseUser = await admin.auth().getUserByPhoneNumber(searchTerm);
        }

        if (firebaseUser) {
          console.log(`[Search] Found in Firebase Auth: ${firebaseUser.uid}`);
          const foundUser = {
            name: firebaseUser.displayName || 'Firebase User',
            email: firebaseUser.email || '',
            avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
            firebaseUID: firebaseUser.uid,
            isNew: true
          };
          results = [foundUser];

          // Pre-create the user in RTDB so they are searchable by others
          await db.ref(`users/${firebaseUser.uid}`).set({
            ...foundUser,
            createdAt: new Date().toISOString()
          });
          console.log(`[Search] Profile pre-created for ${firebaseUser.uid}`);
        }
      } catch (authError) {
        console.log(`[Search] Firebase Auth lookup failed/not found: ${authError.message}`);
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
    const contactsRef = db.ref(`users/${uid}/contacts`);
    const snapshot = await contactsRef.get();
    const contacts = snapshot.val() || {};
    
    // Inject the key as 'uid' just in case it's missing from the object body
    const contactsArray = Object.keys(contacts).map(key => ({
      uid: key,
      ...contacts[key]
    }));

    res.status(200).json(contactsArray);
  } catch (error) {
    console.error('Get contacts error:', error.message);
    res.status(500).json({ message: 'Server error fetching contacts' });
  }
};

const addContact = async (req, res) => {
  try {
    const { uid } = req.user;
    const { contact } = req.body;

    // Support any possible ID field passed from frontend
    const contactUid = contact.firebaseUID || contact.uid || contact.id;

    if (!contact || !contactUid) {
      console.warn('[AddContact] No UID found for contact:', contact);
      return res.status(400).json({ message: 'Valid contact info required' });
    }

    const contactsRef = db.ref(`users/${uid}/contacts/${contactUid}`);
    // Save everything, but ensure the ID fields are present
    await contactsRef.update({
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

    if (!contactUid) {
      return res.status(400).json({ message: 'Contact UID required' });
    }

    const contactRef = db.ref(`users/${uid}/contacts/${contactUid}`);
    const snapshot = await contactRef.once('value');
    const contactData = snapshot.val();

    if (!contactData) {
      console.warn(`[RemoveContact] Contact ${contactUid} not found for user ${uid}`);
      return res.status(404).json({ message: 'Contact not found' });
    }

    await contactRef.remove();
    console.log(`[RemoveContact] Successfully removed ${contactData.name || contactUid} (${contactUid}) for user ${uid}`);
    
    // We don't necessarily need a socket emit here if the user's Sidebar is relying on onValue
    // But for consistency with our hybrid approach, we can emit:
    // io.to(uid).emit('contacts_updated'); 
    // Wait, authController doesn't have io. We'll rely on the real-time listener.

    res.status(200).json({ message: 'Contact removed successfully' });
  } catch (error) {
    console.error('[RemoveContact] Error:', error.message);
    res.status(500).json({ message: 'Server error removing contact' });
  }
};

module.exports = { syncUser, getMe, updateProfile, searchUsers, getContacts, addContact, removeContact };
