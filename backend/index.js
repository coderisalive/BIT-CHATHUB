const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const gameService = require('./src/services/gameService');
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const groupRoutes = require('./src/routes/groupRoutes');
const { firestore, admin, auth, isConfigured } = require('./src/config/firebaseAdmin');

dotenv.config();

const app = express();
const server = http.createServer(app);

// 1. GLOBAL MIDDLEWARE
app.use(cors({
  origin: (origin, callback) => {
    const allowedPatterns = [
      /^http:\/\/localhost:\d+$/,
      /^https:\/\/bit-chathub\.vercel\.app$/,
      /^https:\/\/bit-chathub-.*\.vercel\.app$/,
      /^https:\/\/bit-chathub\.onrender\.com$/
    ];
    if (!origin) return callback(null, true);
    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(express.json());

// 2. SOCKET INITIALIZATION
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowedPatterns = [
        /^http:\/\/localhost:\d+$/,
        /^https:\/\/bit-chathub\.vercel\.app$/,
        /^https:\/\/bit-chathub-.*\.vercel\.app$/,
        /^https:\/\/bit-chathub\.onrender\.com$/
      ];
      if (!origin) return callback(null, true);
      const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
      if (isAllowed) callback(null, true);
      else callback(new Error('Not allowed by Socket CORS'));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.get('/', (req, res) => res.status(200).send('BIT CHAT Backend is Live'));

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

  socket.on('join_chat_room', (chatId) => {
    if (chatId) {
      socket.join(String(chatId));
      console.log(`[Socket] Joined shared chat room: ${chatId}`);
    }
  });

  socket.on('send_message', async (data) => {
    const { 
      to, 
      text, 
      encryptedText, // E2EE
      iv,            // E2EE
      senderEmail, 
      senderName, 
      senderUid, 
      targetUid, 
      targetName, 
      imageUrl, 
      audioUrl,
      tempId,
      isViewOnce
    } = data;

    const normalizedTo = to.toLowerCase();
    const normalizedFrom = senderEmail.toLowerCase();
    const isEncrypted = !!encryptedText;

    try {
      const getChatId = (u1, u2) => u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
      const chatId = getChatId(senderUid, targetUid);

      const messagePayload = {
        senderId: senderUid,
        text: text || null,
        encryptedText: encryptedText || null,
        iv: iv || null,
        isEncrypted,
        imageUrl: imageUrl || null,
        audioUrl: audioUrl || null,
        timestamp: Date.now(),
        sent: true,
        seen: false,
        isViewOnce: isViewOnce || false,
        isOpened: false
      };

      // 1. Persist to Firestore
      const msgRef = await firestore.collection('chats').doc(chatId).collection('messages').add(messagePayload);
      const realId = msgRef.id;

      // 2. Notify sender of real ID
      socket.emit('message_persistence_success', { tempId, realId });

      // 3. Relay to recipient
      io.to(normalizedTo).emit('receive_message', {
        id: realId,
        ...messagePayload,
        senderEmail: normalizedFrom,
        senderName,
        senderUid
      });

      // 4. Update Contacts in Firestore
      const lastMsgPreview = isEncrypted ? '🔐 Encrypted Message' : (imageUrl ? '📷 Image' : (audioUrl ? '🎤 Voice Note' : text));
      
      // Update Recipient's Contact list
      const batch = firestore.batch();
      const recipientContactRef = firestore.collection('users').doc(targetUid).collection('contacts').doc(senderUid);
      batch.set(recipientContactRef, {
        uid: senderUid,
        name: senderName,
        lastMessage: lastMsgPreview,
        lastMessageTime: Date.now(),
        unread: admin.firestore.FieldValue.increment(1)
      }, { merge: true });

      // Update Sender's Contact list
      const senderContactRef = firestore.collection('users').doc(senderUid).collection('contacts').doc(targetUid);
      batch.set(senderContactRef, {
        uid: targetUid,
        email: normalizedTo,
        name: targetName || normalizedTo,
        lastMessage: lastMsgPreview,
        lastMessageTime: Date.now(),
        unread: 0
      }, { merge: true });

      await batch.commit();

      io.to(normalizedTo).emit('contacts_updated');
      io.to(normalizedFrom).emit('contacts_updated');

    } catch (err) {
      console.error('[Socket] Message error:', err);
    }
  });

  socket.on('join_group', (groupId) => {
    socket.join(groupId);
    console.log(`[Socket] Joined group: ${groupId}`);
  });

  socket.on('send_group_message', async (data) => {
    const { groupId, text, encryptedText, iv, senderUid, senderName, imageUrl, audioUrl, tempId } = data;
    const isEncrypted = !!encryptedText;

    const messageData = {
      senderId: senderUid,
      senderName,
      text: text || null,
      encryptedText: encryptedText || null,
      iv: iv || null,
      isEncrypted,
      imageUrl: imageUrl || null,
      audioUrl: audioUrl || null,
      timestamp: Date.now(),
      isViewOnce: data.isViewOnce || false,
      isOpened: false
    };

    try {
      const msgRef = await firestore.collection('groups').doc(groupId).collection('messages').add(messageData);
      const realId = msgRef.id;

      socket.emit('message_persistence_success', { tempId, realId });
      socket.to(groupId).emit('receive_group_message', { id: realId, groupId, ...messageData });

      // Group metadata update (Notify all users)
      io.emit('groups_updated');
    } catch (err) {
      console.error('[Socket] Group message error:', err);
    }
  });

  socket.on('mark_read', async (data) => {
    const { chatId, targetUid, senderUid } = data;
    try {
      const messagesSnap = await firestore.collection('chats').doc(chatId).collection('messages')
        .where('senderId', '==', senderUid)
        .where('seen', '==', false)
        .get();

      if (!messagesSnap.empty) {
        const batch = firestore.batch();
        messagesSnap.forEach(doc => batch.update(doc.ref, { seen: true }));
        await batch.commit();

        const userDoc = await firestore.collection('users').doc(senderUid).get();
        if (userDoc.exists && userDoc.data().email) {
          io.to(userDoc.data().email.toLowerCase()).emit('messages_read', { chatId, targetUid });
        }
      }
    } catch (err) {
      console.error('[Socket] Mark read error:', err);
    }
  });

  socket.on('mark_opened', async (data) => {
    const { chatId, messageId, isGroup } = data;
    try {
      const coll = isGroup ? 'groups' : 'chats';
      const msgRef = firestore.collection(coll).doc(chatId).collection('messages').doc(messageId);
      const doc = await msgRef.get();
      
      if (doc.exists) {
        const msgData = doc.data();
        await msgRef.update({ 
          isOpened: true,
          imageUrl: null, 
          text: msgData.isViewOnce ? "Message Viewed" : msgData.text,
          encryptedText: null
        });
        io.to(String(chatId)).emit('message_opened', { chatId, messageId, isGroup });
      }
    } catch (err) {
      console.error('[Socket] Mark opened error:', err);
    }
  });

  socket['on']('update_profile', (data) => {
    io.emit('profile_updated', data);
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

// GET HISTORY
const { protect } = require('./src/middleware/authMiddleware');

app.get('/api/messages/:chatId', protect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const messagesSnap = await firestore.collection('chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc').get();
    
    // Check for local clears/deletes
    const metaDoc = await firestore.collection('users').doc(req.user.uid).collection('meta').doc(chatId).get();
    const metaData = metaDoc.exists ? metaDoc.data() : {};
    const clearedAt = metaData.clearedAt || 0;
    const deletedMsgs = metaData.deletedMessages || {};

    const msgList = messagesSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(m => m.timestamp >= clearedAt && !deletedMsgs[m.id]);

    res.json(msgList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/groups/:groupId/messages', protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const messagesSnap = await firestore.collection('groups').doc(groupId).collection('messages').orderBy('timestamp', 'asc').get();
    
    const metaDoc = await firestore.collection('users').doc(req.user.uid).collection('meta').doc(groupId).get();
    const metaData = metaDoc.exists ? metaDoc.data() : {};
    const clearedAt = metaData.clearedAt || 0;
    const deletedMsgs = metaData.deletedMessages || {};

    const msgList = messagesSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(m => m.timestamp >= clearedAt && !deletedMsgs[m.id]);

    res.json(msgList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group history' });
  }
});

// MANAGE HISTORY
app.delete('/api/messages/:chatId', protect, async (req, res) => {
  await firestore.collection('users').doc(req.user.uid).collection('meta').doc(req.params.chatId).set({ clearedAt: Date.now() }, { merge: true });
  res.json({ success: true });
});

app.delete('/api/messages/:chatId/:messageId/:type', protect, async (req, res) => {
  const { chatId, messageId, type } = req.params;
  if (type === 'local') {
    await firestore.collection('users').doc(req.user.uid).collection('meta').doc(chatId).set({
      deletedMessages: { [messageId]: true }
    }, { merge: true });
  } else {
    const msgRef = firestore.collection('chats').doc(chatId).collection('messages').doc(messageId);
    const doc = await msgRef.get();
    if (doc.exists && doc.data().senderId === req.user.uid) {
      await msgRef.delete();
      io.to(chatId).emit('message_deleted', { chatId, messageId });
    }
  }
  res.json({ success: true });
});

app.post('/api/messages/reset-unread', protect, async (req, res) => {
  const { contactId } = req.body;
  await firestore.collection('users').doc(req.user.uid).collection('contacts').doc(contactId).update({ unread: 0 });
  res.json({ success: true });
});

// App Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/groups', groupRoutes);

// Mini-games support (re-implementing simplified logic if needed, but keeping gameService usage)
// ... Game handlers omitted but can be added back if needed ...

// Cleanup
const initCleanupJob = require('./src/jobs/cleanupJob');
initCleanupJob();

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
