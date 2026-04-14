const { firestore } = require('./src/config/firebaseAdmin');

const updateSpecificUser = async (email) => {
    try {
        const usersSnap = await firestore.collection('users').where('email', '==', email).get();
        if (usersSnap.empty) {
            console.log(`❌ User with email ${email} not found.`);
            return;
        }

        const userDoc = usersSnap.docs[0];
        const data = userDoc.data();
        
        // Generate new ID using the refined logic (mocked here for the script)
        const base = data.name && data.name !== 'User' ? data.name : (data.email ? data.email.split('@')[0] : 'user');
        const sanitized = base.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 4);
        const symbols = ['@', '#', '$'];
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const digits = Math.floor(1000 + Math.random() * 9000);
        const newChatId = `${sanitized}${symbol}${digits}`;

        await userDoc.ref.update({ chatId: newChatId });
        console.log(`✅ Updated ${email}'s Chat ID from ${data.chatId} to ${newChatId}`);
    } catch (err) {
        console.error('Error updating user:', err);
    }
    process.exit(0);
};

updateSpecificUser('siftain@gmail.com');
