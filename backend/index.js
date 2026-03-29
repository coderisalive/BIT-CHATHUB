const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://bit-chathub.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});

// User to Socket mapping
const connectedUsers = new Map(); // email -> socketId

io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  socket.on('join', (email) => {
    if (email) {
      const normalizedEmail = email.toLowerCase();
      connectedUsers.set(normalizedEmail, socket.id);
      socket.join(normalizedEmail);
      console.log(`[Socket] User ${normalizedEmail} joined`);
    }
  });

  socket.on('send_message', async (data) => {
    const { to, text, senderEmail, senderName, senderUid, targetUid, targetName, imageUrl } = data;
    const normalizedTo = to.toLowerCase();
    const normalizedFrom = senderEmail.toLowerCase();

    console.log(`[Socket] Message from ${normalizedFrom} to ${normalizedTo}`);
    if (imageUrl) console.log(`[Socket] imageUrl detected: ${imageUrl}`);

    // 1. Relay to recipient (Live)
    io.to(normalizedTo).emit('receive_message', {
      text,
      imageUrl,
      senderEmail: normalizedFrom,
      senderName,
      senderUid,
      timestamp: Date.now()
    });

    // 2. Persist to Realtime Database (History)
    try {
      console.log(`[Firebase] Persisting message to ${normalizedFrom} <-> ${normalizedTo}. Image: ${!!imageUrl}`);
      const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');
      const getChatId = (u1, u2) => u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
      const chatId = getChatId(senderUid, targetUid);

      const messagesRef = adminDb.ref(`messages/${chatId}`);
      await messagesRef.push({
        senderId: senderUid,
        text,
        imageUrl,
        timestamp: Date.now(),
        sent: true
      });
      console.log(`[Socket] Message persisted to DB for chat: ${chatId}`);

      // 3. Auto-add/Update Sender in Recipient's Contacts
      const lastMessageText = imageUrl ? '📷 Image' : text;
      const recipientContactsRef = adminDb.ref(`users/${targetUid}/contacts/${senderUid}`);
      await recipientContactsRef.update({
        uid: senderUid,
        firebaseUID: senderUid,
        name: senderName,
        lastMessage: lastMessageText,
        lastMessageTime: Date.now(),
        unread: firebaseAdmin.database.ServerValue.increment(1)
      });

      // 4. Auto-add/Update Recipient in Sender's Contacts
      const senderContactsRef = adminDb.ref(`users/${senderUid}/contacts/${targetUid}`);
      await senderContactsRef.update({
        uid: targetUid,
        email: to,
        name: targetName || to,
        lastMessage: lastMessageText,
        lastMessageTime: Date.now(),
        unread: 0
      });

      console.log(`[Socket] Contacts updated and notifying clients...`);
      io.to(normalizedTo).emit('contacts_updated');
      io.to(normalizedFrom).emit('contacts_updated');
    } catch (err) {
      console.error('[Socket] Failed to persist/update:', err.message);
    }
  });

  socket.on('join_group', (groupId) => {
    socket.join(groupId);
    console.log(`[Socket] User joined group room: ${groupId}`);
  });

  socket.on('send_group_message', async (data) => {
    const { groupId, text, senderUid, senderName, imageUrl } = data;
    const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');

    console.log(`[Socket] Group Message in ${groupId} from ${senderName}. Image: ${!!imageUrl}`);
    if (imageUrl) console.log(`[Socket] Group imageUrl: ${imageUrl}`);

    const messageData = {
      senderId: senderUid,
      senderName,
      text,
      imageUrl,
      timestamp: Date.now()
    };

    try {
      // 1. Persist to groupMessages
      await adminDb.ref(`groupMessages/${groupId}`).push(messageData);

      // 2. Broadcast to everyone in group room EXCEPT the sender
      socket.to(groupId).emit('receive_group_message', {
        groupId,
        ...messageData
      });

      // 3. Update last message for all members
      const lastMessageText = imageUrl ? '📷 Image' : text;
      const groupSnap = await adminDb.ref(`groups/${groupId}`).get();
      const members = groupSnap.val()?.members || {};
      const updates = {};
      Object.keys(members).forEach(mUid => {
        updates[`users/${mUid}/groups/${groupId}/lastMessage`] = lastMessageText;
        updates[`users/${mUid}/groups/${groupId}/lastMessageTime`] = Date.now();
      });
      await adminDb.ref().update(updates);

      // Notify all members to refresh their sidebars
      Object.keys(members).forEach(mUid => {
        // We need to know their email to emit to their specific room
        // Or we can just emit a global 'groups_updated' if they are connected
      });
      io.emit('groups_updated'); // simple global refresh for now

    } catch (err) {
      console.error('[Socket] Group message error:', err);
    }
  });

  socket.on('disconnect', () => {
    for (let [email, id] of connectedUsers.entries()) {
      if (id === socket.id) {
        connectedUsers.delete(email);
        break;
      }
    }
  });
});

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "https://bit-chathub.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.options(/.*/, cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
const groupRoutes = require('./src/routes/groupRoutes');
app.use('/api/groups', groupRoutes);

const { protect } = require('./src/middleware/authMiddleware');

// Message History Endpoint (Bypassing Frontend Permission Issues but with Auth)
app.get('/api/messages/:chatId', protect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const messagesRef = adminDb.ref(`messages/${chatId}`);
    const clearRef = adminDb.ref(`users/${req.user.uid}/clears/${chatId}`);
    const deletedRef = adminDb.ref(`users/${req.user.uid}/deletedMessages/${chatId}`);

    const [snapshot, clearSnap, deletedSnap] = await Promise.all([
      messagesRef.once('value'),
      clearRef.once('value'),
      deletedRef.once('value')
    ]);

    const data = snapshot.val();
    const clearedAt = clearSnap.val() || 0;
    const deletedMsgs = deletedSnap.val() || {};

    if (data) {
      const msgList = Object.keys(data)
        .map(key => ({
          id: key,
          ...data[key]
        }))
        .filter(m => m.timestamp >= clearedAt && !deletedMsgs[m.id])
        .sort((a, b) => a.timestamp - b.timestamp);

      res.json(msgList);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('[API] History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/groups/:groupId/messages', protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');

    const messagesRef = adminDb.ref(`groupMessages/${groupId}`);
    const clearRef = adminDb.ref(`users/${req.user.uid}/clears/${groupId}`);
    const deletedRef = adminDb.ref(`users/${req.user.uid}/deletedMessages/${groupId}`);

    const [snapshot, clearSnap, deletedSnap] = await Promise.all([
      messagesRef.once('value'),
      clearRef.once('value'),
      deletedRef.once('value')
    ]);

    const data = snapshot.val();
    const clearedAt = clearSnap.val() || 0;
    const deletedMsgs = deletedSnap.val() || {};

    if (data) {
      const msgList = Object.keys(data)
        .map(key => ({
          id: key,
          ...data[key]
        }))
        .filter(m => m.timestamp >= clearedAt && !deletedMsgs[m.id])
        .sort((a, b) => a.timestamp - b.timestamp);

      res.json(msgList);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('[API] Group History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch group history' });
  }
});

// Clear Message History Endpoint (Local Clear)
app.delete('/api/messages/:chatId', protect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');

    // Set clearedAt timestamp for this user & chat
    await adminDb.ref(`users/${req.user.uid}/clears/${chatId}`).set(Date.now());

    res.json({ success: true, message: 'Chat cleared locally successfully' });
  } catch (error) {
    console.error('[API] Clear history error:', error);
    res.status(500).json({ error: 'Failed to clear chat history locally' });
  }
});

app.delete('/api/groups/:groupId/messages', protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');

    // Set clearedAt timestamp for this user & group
    await adminDb.ref(`users/${req.user.uid}/clears/${groupId}`).set(Date.now());

    res.json({ success: true, message: 'Group chat cleared locally successfully' });
  } catch (error) {
    console.error('[API] Clear group history error:', error);
    res.status(500).json({ error: 'Failed to clear group chat history' });
  }
});

// Individual Message Deletion
app.delete('/api/messages/:chatId/:messageId/local', protect, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    await adminDb.ref(`users/${req.user.uid}/deletedMessages/${chatId}/${messageId}`).set(true);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete message locally' });
  }
});

app.delete('/api/messages/:chatId/:messageId/global', protect, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const msgRef = adminDb.ref(`messages/${chatId}/${messageId}`);
    const snapshot = await msgRef.once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'Message not found' });

    const msgData = snapshot.val();
    if (msgData.senderId !== req.user.uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await msgRef.remove();
    // Broadcast deletion
    io.to(chatId).emit('message_deleted', { chatId, messageId, isGroup: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete message globally' });
  }
});

app.delete('/api/groups/:groupId/messages/:messageId/local', protect, async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    await adminDb.ref(`users/${req.user.uid}/deletedMessages/${groupId}/${messageId}`).set(true);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete group message locally' });
  }
});

app.delete('/api/groups/:groupId/messages/:messageId/global', protect, async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const msgRef = adminDb.ref(`groupMessages/${groupId}/${messageId}`);
    const snapshot = await msgRef.once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'Message not found' });

    const msgData = snapshot.val();
    if (msgData.senderId !== req.user.uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await msgRef.remove();
    // Broadcast deletion
    io.to(groupId).emit('message_deleted', { groupId, messageId, isGroup: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete group message globally' });
  }
});

// Reset Unread Count
app.post('/api/messages/reset-unread', async (req, res) => {
  try {
    const { userId, contactId } = req.body;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const contactRef = adminDb.ref(`users/${userId}/contacts/${contactId}`);
    await contactRef.update({ unread: 0 });
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Reset unread error:', error);
    res.status(500).json({ error: 'Failed to reset unread' });
  }
});

app.get('/', (req, res) => {
  res.send('BIT CHAT API with Socket.io is running...');
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
