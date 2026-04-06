const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const gameService = require('./src/services/gameService');
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');

dotenv.config();

const app = express();
const server = http.createServer(app);

// 1. GLOBAL MIDDLEWARE (Set early to catch all requests)
app.use(cors({
  origin: (origin, callback) => {
    // 1. ALLOWED ORIGINS (Direct strings + Regex for Vercel Previews)
    const allowedPatterns = [
      /^http:\/\/localhost:\d+$/,
      /^https:\/\/bit-chathub\.vercel\.app$/,
      /^https:\/\/bit-chathub-.*\.vercel\.app$/, // Allow all Vercel Previews
      /^https:\/\/bit-chathub\.onrender\.com$/
    ];

    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected Origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(express.json());

// 2. SOCKET INITIALIZATION
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedPatterns = [
        /^http:\/\/localhost:\d+$/,
        /^https:\/\/bit-chathub\.vercel\.app$/,
        /^https:\/\/bit-chathub-.*\.vercel\.app$/,
        /^https:\/\/bit-chathub\.onrender\.com$/
      ];
      const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by Socket CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Health check for Render
app.get('/', (req, res) => {
  res.status(200).send('BIT CHAT Backend is Live');
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

  socket.on('join_chat_room', (chatId) => {
    if (chatId) {
      socket.join(String(chatId));
      console.log(`[Socket] User joined shared chat room: ${chatId}`);
    }
  });

  socket.on('send_message', async (data) => {
    const { to, text, senderEmail, senderName, senderUid, targetUid, targetName, imageUrl, audioUrl } = data;
    const normalizedTo = to.toLowerCase();
    const normalizedFrom = senderEmail.toLowerCase();

    console.log(`[Socket] Message from ${normalizedFrom} to ${normalizedTo}`);
    if (imageUrl) console.log(`[Socket] imageUrl detected: ${imageUrl}`);
    if (audioUrl) console.log(`[Socket] audioUrl detected: ${audioUrl}`);

    // Relay part moved AFTER persistence to include the real ID
    // 2. Persist to Realtime Database (History)
    try {
      console.log(`[Firebase] Persisting message to ${normalizedFrom} <-> ${normalizedTo}. Image: ${!!imageUrl}, Audio: ${!!audioUrl}`);
      const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');
      const getChatId = (u1, u2) => u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
      const chatId = getChatId(senderUid, targetUid);

      const messagesRef = adminDb.ref(`messages/${chatId}`);
      const newMsgRef = await messagesRef.push({
        senderId: senderUid,
        text,
        imageUrl: imageUrl || null,
        audioUrl: audioUrl || null,
        timestamp: Date.now(),
        sent: true,
        seen: false,
        isViewOnce: data.isViewOnce || false,
        isOpened: false
      });

      const realId = newMsgRef.key;

      // 1.5 Notify sender of the real ID for their temp snippet
      socket.emit('message_persistence_success', {
        tempId: data.tempId,
        realId
      });

      // Relay to recipient with real ID
      io.to(normalizedTo).emit('receive_message', {
        id: realId,
        text,
        imageUrl,
        audioUrl,
        isViewOnce: data.isViewOnce || false,
        isOpened: false,
        senderEmail: normalizedFrom,
        senderName,
        senderUid,
        timestamp: Date.now()
      });
      console.log(`[Socket] Message persisted to DB for chat: ${chatId}`);

      // 3. Auto-add/Update Sender in Recipient's Contacts
      const lastMessageText = imageUrl ? '📷 Image' : (audioUrl ? '🎤 Voice Note' : text);
      const recipientContactsRef = adminDb.ref(`users/${targetUid}/contacts/${senderUid}`);
      const senderSnap = await adminDb.ref(`users/${senderUid}`).get();
      const senderData = senderSnap.val() || {};

      await recipientContactsRef.update({
        uid: senderUid,
        firebaseUID: senderUid,
        name: senderName,
        avatar: senderData.avatar || null,
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
    const { groupId, text, senderUid, senderName, imageUrl, audioUrl } = data;
    const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');

    console.log(`[Socket] Group Message in ${groupId} from ${senderName}. Image: ${!!imageUrl}, Audio: ${!!audioUrl}`);
    if (imageUrl) console.log(`[Socket] Group imageUrl: ${imageUrl}`);
    if (audioUrl) console.log(`[Socket] Group audioUrl: ${audioUrl}`);

    const messageData = {
      senderId: senderUid,
      senderName,
      text,
      imageUrl: imageUrl || null,
      audioUrl: audioUrl || null,
      timestamp: Date.now(),
      isViewOnce: data.isViewOnce || false,
      isOpened: false
    };

    try {
      // 1. Persist to groupMessages
      const newMsgRef = await adminDb.ref(`groupMessages/${groupId}`).push(messageData);
      const realId = newMsgRef.key;

      // 1.5 Notify sender
      socket.emit('message_persistence_success', {
        tempId: data.tempId,
        realId
      });

      // 2. Broadcast to everyone in group room EXCEPT the sender (with real ID)
      socket.to(groupId).emit('receive_group_message', {
        id: realId,
        groupId,
        ...messageData
      });

      // 3. Update last message for all members
      const lastMessageText = imageUrl ? '📷 Image' : (audioUrl ? '🎤 Voice Note' : text);
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

  socket.on('update_profile', (data) => {
    const { uid, name, avatar } = data;
    console.log(`[Socket] Profile updated broadcast for UID: ${uid}`);
    io.emit('profile_updated', { uid, name, avatar });
  });

  // --- MINI GAME SYSTEM ---
  socket.on('create_game', async (data) => {
    const { to, senderUid, senderName, targetUid, gameType, senderEmail } = data;
    const game = gameService.createGame(senderUid, targetUid, gameType);
    console.log(`[Game] Created ${gameType} game: ${game.gameId} between ${senderUid} and ${targetUid}`);
    
    socket.join(`game_${game.gameId}`);
    
    try {
      const { admin: firebaseAdmin, db: adminDb } = require('./src/config/firebaseAdmin');
      const getChatId = (u1, u2) => u1 < u2 ? `${u1}_${u2}` : `${u2}_${u1}`;
      const chatId = getChatId(senderUid, targetUid);
      
      const newMsgRef = await adminDb.ref(`messages/${chatId}`).push({
        senderId: senderUid,
        text: `🎮 Join my Tic-Tac-Toe game!`,
        type: 'game',
        gameId: game.gameId,
        timestamp: Date.now(),
        sent: true
      });
      
      const realId = newMsgRef.key;
      const normalizedTo = to.toLowerCase();
      const normalizedFrom = senderEmail ? senderEmail.toLowerCase() : '';

      const messageData = {
        id: realId,
        text: `🎮 Join my Tic-Tac-Toe game!`,
        type: 'game',
        gameId: game.gameId,
        senderEmail: normalizedFrom,
        senderName,
        senderUid,
        timestamp: Date.now()
      };

      io.to(normalizedTo).emit('receive_message', messageData);
      socket.emit('game_created', { game, message: messageData });
      
      console.log(`[Game] Invitation persisted with ID: ${realId}`);
    } catch (err) {
      console.error('[Game] Persistence error:', err);
      socket.emit('game_created', game); // Fallback
    }
  });

  socket.on('join_game', (data) => {
    const { gameId, playerId } = data;
    const game = gameService.joinGame(gameId, playerId);
    if (game) {
      console.log(`[Game] Player ${playerId} joined game: ${gameId}`);
      socket.join(`game_${gameId}`);
      io.to(`game_${gameId}`).emit('game_update', game);
    }
  });

  socket.on('make_move', (data) => {
    const { gameId, playerId, position } = data;
    const result = gameService.makeMove(gameId, playerId, position);
    if (result.game) {
      console.log(`[Game] Move made in ${gameId} by ${playerId} at ${position}`);
      io.to(`game_${gameId}`).emit('game_update', result.game);
      
      if (result.game.status === 'finished') {
        console.log(`[Game] Game ${gameId} finished. Winner: ${result.game.winner}`);
        // Optionally delete game from memory after some delay
        setTimeout(() => gameService.deleteGame(gameId), 60000); 
      }
    } else {
      socket.emit('game_error', { message: result.error });
    }
  });

  socket.on('leave_game', (data) => {
    const { gameId, playerId } = data;
    const game = gameService.leaveGame(gameId, playerId);
    if (game) {
      io.to(`game_${gameId}`).emit('game_update', game);
      socket.leave(`game_${gameId}`);
    }
  });

  socket.on('mark_read', async (data) => {
    const { chatId, targetUid, senderUid } = data; // targetUid is the user who read the messages
    console.log(`[Socket] Marking messages as read in chat: ${chatId} for user: ${targetUid}`);

    try {
      const { db: adminDb } = require('./src/config/firebaseAdmin');
      const messagesRef = adminDb.ref(`messages/${chatId}`);
      const snapshot = await messagesRef.once('value');
      const messages = snapshot.val();

      if (messages) {
        const updates = {};
        Object.keys(messages).forEach(msgId => {
          // If the message was sent by the other user (senderUid) and matches the chat
          if (messages[msgId].senderId === senderUid && !messages[msgId].seen) {
            updates[`${msgId}/seen`] = true;
          }
        });

        if (Object.keys(updates).length > 0) {
          await messagesRef.update(updates);
          console.log(`[Socket] Updated ${Object.keys(updates).length} messages to seen.`);
          
          // Notify the original sender (senderUid) that their messages were read
          const senderEmail = (await adminDb.ref(`users/${senderUid}/email`).get()).val();
          if (senderEmail) {
            io.to(senderEmail.toLowerCase()).emit('messages_read', { chatId, targetUid });
          }
        }
      }
    } catch (err) {
      console.error('[Socket] Failed to mark as read:', err.message);
    }
  });

  socket.on('mark_opened', async (data) => {
    const { chatId, messageId, isGroup } = data;
    console.log(`[Socket] Marking message ${messageId} as opened in ${chatId}`);

    try {
      const { db: adminDb } = require('./src/config/firebaseAdmin');
      const path = isGroup ? `groupMessages/${chatId}/${messageId}` : `messages/${chatId}/${messageId}`;
      const msgRef = adminDb.ref(path);
      const snapshot = await msgRef.once('value');
      const existing = snapshot.val();
      
      if (existing) {
        await msgRef.update({ 
          isOpened: true,
          imageUrl: null, // For security, remove the URL from DB after viewing
          text: existing.isViewOnce ? "Message Viewed" : existing.text
        });

        // Update lastMessage in metadata for sidebar sync
        const lastMsgPreview = existing.type === 'image' ? "Photo Viewed" : "Message Viewed";
        if (isGroup) {
          // Update for all group members (This is complex in this setup, usually done via a centralized groups ref)
          // For now, update the main group metadata if it exists
          adminDb.ref(`groups/${chatId}/lastMessage`).set(lastMsgPreview);
        } else {
          // Update for both users in private chat
          const [u1, u2] = chatId.split('_');
          adminDb.ref(`users/${u1}/contacts/${u2}/lastMessage`).set(lastMsgPreview);
          adminDb.ref(`users/${u2}/contacts/${u1}/lastMessage`).set(lastMsgPreview);
        }

        console.log(`[Socket] Broadcasting message_opened to room: ${chatId}`);
        io.to(String(chatId)).emit('message_opened', { chatId, messageId, isGroup });
      }
    } catch (err) {
      console.error('[Socket] Failed to mark as opened:', err.message);
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

// (Redundant middleware removed)


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

// (Duplicate route removed - handled at top)


// Initialize background jobs
const initCleanupJob = require('./src/jobs/cleanupJob');
initCleanupJob();

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
