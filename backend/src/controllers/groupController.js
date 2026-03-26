const { db, firebaseAdmin } = require('../config/firebaseAdmin');

const createGroup = async (req, res) => {
  try {
    const { uid } = req.user;
    const { name, members } = req.body; // members is an array of UIDs

    if (!name || !members || !Array.isArray(members)) {
      return res.status(400).json({ message: 'Group name and members array required' });
    }

    // Ensure creator is in members
    if (!members.includes(uid)) {
      members.push(uid);
    }

    const groupId = `group_${Date.now()}`;
    const groupData = {
      id: groupId,
      name,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      createdBy: uid,
      createdAt: Date.now(),
      members: members.reduce((acc, memberUid) => {
        acc[memberUid] = true;
        return acc;
      }, {})
    };

    // 1. Create group metadata
    await db.ref(`groups/${groupId}`).set(groupData);

    // 2. Link group to each member's profile for sidebar loading
    const groupSummary = {
      id: groupId,
      name,
      avatar: groupData.avatar,
      isGroup: true,
      lastMessage: 'Group created!',
      lastMessageTime: Date.now(),
      unread: 0
    };

    const updates = {};
    members.forEach(memberUid => {
      updates[`users/${memberUid}/groups/${groupId}`] = groupSummary;
    });

    await db.ref().update(updates);

    res.status(201).json({ message: 'Group created successfully', group: groupSummary });
  } catch (error) {
    console.error('[CreateGroup] Error:', error.message);
    res.status(500).json({ message: 'Server error creating group' });
  }
};

const getGroups = async (req, res) => {
  try {
    const { uid } = req.user;
    const groupsRef = db.ref(`users/${uid}/groups`);
    const snapshot = await groupsRef.get();
    const groups = snapshot.val() || {};
    
    // Inject key as 'id' to be 100% sure we don't lose the reference
    const groupsArray = Object.keys(groups).map(key => ({
      id: key,
      ...groups[key]
    }));
    
    res.status(200).json(groupsArray);
  } catch (error) {
    console.error('[GetGroups] Error:', error.message);
    res.status(500).json({ message: 'Server error fetching groups' });
  }
};

module.exports = { createGroup, getGroups };
