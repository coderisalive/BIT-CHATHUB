const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');

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
    const { to, text, senderEmail, senderName, senderUid, targetUid, targetName } = data;
    const normalizedTo = to.toLowerCase();
    const normalizedFrom = senderEmail.toLowerCase();
    
    console.log(`[Socket] Message from ${normalizedFrom} to ${normalizedTo}`);
    
    // 1. Relay to recipient (Live)
    io.to(normalizedTo).emit('receive_message', {
      text,
      senderEmail: normalizedFrom,
      senderName,
      senderUid,
      timestamp: Date.now()
    });

    // 2. Persist to Realtime Database (History)
    try {
      const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');
      const getChatId = (u1, u2) => u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
      const chatId = getChatId(senderUid, targetUid);
      
      const messagesRef = adminDb.ref(`messages/${chatId}`);
      await messagesRef.push({
        senderId: senderUid,
        text,
        timestamp: Date.now(),
        sent: true
      });
      console.log(`[Socket] Message persisted to DB for chat: ${chatId}`);

      // 3. Auto-add/Update Sender in Recipient's Contacts
      const recipientContactsRef = adminDb.ref(`users/${targetUid}/contacts/${senderUid}`);
      await recipientContactsRef.update({
        uid: senderUid,
        firebaseUID: senderUid,
        name: senderName,
        lastMessage: text,
        lastMessageTime: Date.now(),
        unread: firebaseAdmin.database.ServerValue.increment(1) 
      });

      // 4. Auto-add/Update Recipient in Sender's Contacts
      const senderContactsRef = adminDb.ref(`users/${senderUid}/contacts/${targetUid}`);
      await senderContactsRef.update({
        uid: targetUid,
        email: to,
        name: targetName || to,
        lastMessage: text,
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
    const { groupId, text, senderUid, senderName } = data;
    const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');
    
    console.log(`[Socket] Group Message in ${groupId} from ${senderName}`);

    const messageData = {
      senderId: senderUid,
      senderName,
      text,
      timestamp: Date.now()
    };

    try {
      // 1. Persist to groupMessages
      await adminDb.ref(`groupMessages/${groupId}`).push(messageData);

      // 2. Broadcast to everyone in group room
      io.to(groupId).emit('receive_group_message', { 
        groupId, 
        ...messageData 
      });

      // 3. Update last message for all members
      const groupSnap = await adminDb.ref(`groups/${groupId}`).get();
      const members = groupSnap.val()?.members || {};
      const updates = {};
      Object.keys(members).forEach(mUid => {
        updates[`users/${mUid}/groups/${groupId}/lastMessage`] = text;
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
const groupRoutes = require('./src/routes/groupRoutes');
app.use('/api/groups', groupRoutes);

// Message History Endpoint (Bypassing Frontend Permission Issues)
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const messagesRef = adminDb.ref(`messages/${chatId}`);
    const snapshot = await messagesRef.once('value');
    const data = snapshot.val();
    
    if (data) {
      const msgList = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      })).sort((a, b) => a.timestamp - b.timestamp);
      res.json(msgList);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('[API] History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/groups/:groupId/messages', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { db: adminDb } = require('./src/config/firebaseAdmin');
    const messagesRef = adminDb.ref(`groupMessages/${groupId}`);
    const snapshot = await messagesRef.once('value');
    const data = snapshot.val();
    
    if (data) {
      const msgList = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      })).sort((a, b) => a.timestamp - b.timestamp);
      res.json(msgList);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('[API] Group History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch group history' });
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
