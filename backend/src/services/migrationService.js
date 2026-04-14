const { db, firestore } = require('../config/firebaseAdmin');

const runMigration = async () => {
  console.log('🚀 Starting Data Migration: RTDB -> Firestore');
  const stats = { users: 0, contacts: 0, groups: 0 };

  try {
    // 1. Migrate Users & Contacts
    const usersSnapshot = await db.ref('users').get();
    if (usersSnapshot.exists()) {
      const usersData = usersSnapshot.val();
      for (const uid in usersData) {
        const legacyUser = usersData[uid];
        
        // Update Firestore User Profile if not exists
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          await userRef.set({
            name: legacyUser.name || 'Legacy User',
            email: legacyUser.email || '',
            avatar: legacyUser.avatar || '',
            firebaseUID: uid,
            createdAt: new Date().toISOString(),
          });
          stats.users++;
        }

        // Migrate Contacts
        if (legacyUser.contacts) {
          for (const contactId in legacyUser.contacts) {
            const contactData = legacyUser.contacts[contactId];
            await userRef.collection('contacts').doc(contactId).set({
              ...contactData,
              uid: contactId,
              lastMessageTime: contactData.lastMessageTime || Date.now()
            });
            stats.contacts++;
          }
        }
      }
    }

    // 2. Migrate Groups
    const groupsSnapshot = await db.ref('groups').get();
    if (groupsSnapshot.exists()) {
      const groupsData = groupsSnapshot.val();
      for (const groupId in groupsData) {
        const legacyGroup = groupsData[groupId];
        
        const groupRef = firestore.collection('groups').doc(groupId);
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) {
          await groupRef.set({
            id: groupId,
            name: legacyGroup.name || 'Legacy Group',
            members: legacyGroup.members || [],
            avatar: legacyGroup.avatar || '',
            createdAt: legacyGroup.createdAt || new Date().toISOString(),
            isLegacy: true // Mark as legacy so we know it lacks E2EE keys
          });
          stats.groups++;
        }
      }
    }

    console.log('✅ Migration Complete!', stats);
    return stats;
  } catch (error) {
    console.error('❌ Migration Failed:', error);
    throw error;
  }
};

module.exports = { runMigration };
