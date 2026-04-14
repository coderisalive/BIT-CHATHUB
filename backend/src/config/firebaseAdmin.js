const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

let serviceAccount;
let isConfigured = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT !== 'PASTE_YOUR_SERVICE_ACCOUNT_JSON_HERE') {
    let rawJson = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    // Strip surrounding quotes if they exist
    if ((rawJson.startsWith("'") && rawJson.endsWith("'")) || (rawJson.startsWith('"') && rawJson.endsWith('"'))) {
      rawJson = rawJson.substring(1, rawJson.length - 1);
    }
    console.log(`[FirebaseAdmin] Attempting to parse JSON (Length: ${rawJson.length})...`);
    serviceAccount = JSON.parse(rawJson);
    isConfigured = true;
  } else {
    // Fallback to local file
    try {
      serviceAccount = require('../../firebase-service-account.json');
      isConfigured = true;
    } catch {
      console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not configured. Some features (Search, Admin) will be disabled.');
    }
  }
} catch (error) {
  console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
}

if (isConfigured && admin.apps.length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://chat-app-db3ef-default-rtdb.firebaseio.com/"
    });
    console.log('✅ Firebase Admin initialized successfully.');
  } catch (initError) {
    console.error('❌ Firebase Admin initialization failed:', initError.message);
    isConfigured = false;
  }
} else if (!isConfigured) {
  // Mock initialize if not configured to prevent crashes on reference
  console.log('ℹ️ Running in limited mode (No Firebase Admin credentials).');
}

// Fallback for db/auth if not fully initialized
const db = isConfigured ? admin.database() : { 
  ref: (path) => ({ 
    get: async () => ({ val: () => ({}), exists: () => false }), 
    set: async () => {}, 
    update: async () => {},
    child: (p) => db.ref(`${path}/${p}`)
  }) 
};

const firestore = isConfigured ? admin.firestore() : {
  collection: (path) => ({
    doc: (docId) => ({
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async () => {},
      update: async () => {},
      delete: async () => {}
    }),
    add: async () => ({ id: 'mock-id' }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) })
  })
};

const auth = isConfigured ? admin.auth() : { 
  getUserByEmail: async () => null, 
  getUserByPhoneNumber: async () => null,
  verifyIdToken: async (token) => {
    console.warn('⚠️ verifyIdToken called in limited mode. Returning mock user.');
    return { uid: 'mock-uid', email: 'mock@example.com', name: 'Mock User', isMock: true };
  }
};

module.exports = { admin, db, firestore, auth, isConfigured };
