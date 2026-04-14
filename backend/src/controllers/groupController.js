const { firestore, admin, firebaseAdmin } = require('../config/firebaseAdmin');

const createGroup = async (req, res) => {
  try {
    const { uid } = req.user;
    const { name, members, keyMap } = req.body; 

    if (!name || !members || !Array.isArray(members)) {
      return res.status(400).json({ message: 'Group name and members array required' });
    }

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
      members: members 
    };

    // 1. Create group metadata
    await firestore.collection('groups').doc(groupId).set(groupData);

    // 2. Link group to each member's profile
    const groupSummary = {
      id: groupId,
      name,
      avatar: groupData.avatar,
      isGroup: true,
      lastMessage: 'Group created!',
      lastMessageTime: Date.now(),
      unread: 0
    };

    const batch = firestore.batch();
    members.forEach(memberUid => {
      const memberGroupRef = firestore.collection('users').doc(memberUid).collection('groups').doc(groupId);
      batch.set(memberGroupRef, groupSummary);

      if (keyMap && keyMap[memberUid]) {
        const keyRef = firestore.collection('groups').doc(groupId).collection('e2ee_keys').doc(memberUid);
        batch.set(keyRef, {
          wrappedKey: keyMap[memberUid].wrappedKey,
          iv: keyMap[memberUid].iv,
          wrapperUid: uid,
          createdAt: Date.now()
        });
      }
    });

    await batch.commit();

    res.status(201).json({ message: 'Group created successfully', group: groupSummary });
  } catch (error) {
    console.error('[CreateGroup] Error:', error.message);
    res.status(500).json({ message: 'Server error creating group' });
  }
};

const getGroups = async (req, res) => {
  try {
    const { uid } = req.user;
    const groupsSnap = await firestore.collection('users').doc(uid).collection('groups').get();
    
    const groupsArray = groupsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.status(200).json(groupsArray);
  } catch (error) {
    console.error('[GetGroups] Error:', error.message);
    res.status(500).json({ message: 'Server error fetching groups' });
  }
};

const getGroupMembers = async (req, res) => {
  try {
    const { groupId } = req.params;
    const groupDoc = await firestore.collection('groups').doc(groupId).get();

    if (!groupDoc.exists) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const groupData = groupDoc.data();
    const memberUids = groupData.members || [];
    const membersList = [];

    for (const uid of memberUids) {
      const userDoc = await firestore.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        membersList.push({
          uid,
          name: userData.name || userData.email,
          email: userData.email,
          avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.name || userData.email}`
        });
      }
    }

    res.status(200).json(membersList);
  } catch (error) {
    console.error('[GetGroupMembers] Error:', error.message);
    res.status(500).json({ message: 'Server error fetching group members' });
  }
};

const addGroupMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newMemberUid, wrappedKey } = req.body;

    if (!newMemberUid) {
      return res.status(400).json({ message: 'New member UID required' });
    }

    const groupRef = firestore.collection('groups').doc(groupId);
    const groupDoc = await groupRef.get();

    if (!groupDoc.exists) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const groupData = groupDoc.data();

    await groupRef.update({
      members: admin.firestore.FieldValue.arrayUnion(newMemberUid)
    });

    const groupSummary = {
      id: groupId,
      name: groupData.name,
      avatar: groupData.avatar,
      isGroup: true,
      lastMessage: 'Added to group',
      lastMessageTime: Date.now(),
      unread: 0
    };

    const batch = firestore.batch();
    batch.set(firestore.collection('users').doc(newMemberUid).collection('groups').doc(groupId), groupSummary);

    if (wrappedKey) {
      const keyRef = firestore.collection('groups').doc(groupId).collection('e2ee_keys').doc(newMemberUid);
      batch.set(keyRef, {
        wrappedKey: wrappedKey.wrappedKey,
        iv: wrappedKey.iv,
        wrapperUid: req.user.uid,
        createdAt: Date.now()
      });
    }

    await batch.commit();

    res.status(200).json({ message: 'Member added successfully', newMemberUid });
  } catch (error) {
    console.error('[AddGroupMember] Error:', error.message);
    res.status(500).json({ message: 'Server error adding group member' });
  }
};

const getGroupKey = async (req, res) => {
  try {
    const { uid } = req.user;
    const { groupId } = req.params;

    const keyDoc = await firestore.collection('groups').doc(groupId)
      .collection('e2ee_keys').doc(uid).get();

    if (!keyDoc.exists) {
      return res.status(404).json({ message: 'E2EE key not found for this user in this group' });
    }

    const keyData = keyDoc.data();
    const wrapperDoc = await firestore.collection('users').doc(keyData.wrapperUid).get();
    
    res.status(200).json({
      ...keyData,
      wrapperPublicKey: wrapperDoc.exists ? wrapperDoc.data().publicKey : null
    });
  } catch (error) {
    console.error('[GetGroupKey] Error:', error.message);
    res.status(500).json({ message: 'Server error fetching group key' });
  }
};

module.exports = { createGroup, getGroups, getGroupMembers, addGroupMember, getGroupKey };
