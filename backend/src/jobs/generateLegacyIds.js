const { firestore } = require('../config/firebaseAdmin');

/**
 * Helper to generate a unique Chat ID: <name><symbol><4 digits>
 */
const generateChatId = async (name, email) => {
  const base = name || (email ? email.split('@')[0] : 'user');
  const sanitized = base.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 4);
  const symbols = ['@', '#', '$'];
  
  let attempts = 0;
  while (attempts < 5) {
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const digits = Math.floor(1000 + Math.random() * 9000);
    const chatId = `${sanitized}${symbol}${digits}`;
    
    // Check uniqueness
    const existing = await firestore.collection('users').where('chatId', '==', chatId).get();
    if (existing.empty) return chatId;
    attempts++;
  }
  return `${sanitized}${Date.now().toString().slice(-5)}`; // Fallback
};

const runMigration = async () => {
  console.log('🚀 Generating Chat IDs for all legacy users...');
  const usersSnap = await firestore.collection('users').get();
  let updated = 0;

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (!data.chatId) {
      const chatId = await generateChatId(data.name, data.email);
      await doc.ref.update({ chatId });
      console.log(`✅ Assigned ${chatId} to ${data.email || data.name}`);
      updated++;
    }
  }

  console.log(`🎉 Migration complete! ${updated} users updated.`);
  process.exit(0);
};

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
