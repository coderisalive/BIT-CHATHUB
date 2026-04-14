# BIT CHATHUB 🚀

BIT CHATHUB is a high-performance, secure, and modern chat application featuring **End-to-End Encryption (E2EE)**, real-time communication, and cross-device key recovery.

## 🏗️ Architecture Overview

The system is built with a decoupled architecture to ensure scalability and security.

- **Frontend**: React (Vite) + Vanilla CSS (Custom Design System).
- **Backend**: Node.js + Express + Socket.io.
- **Database/Auth**: Firebase Authentication + Cloud Firestore.
- **Storage**: Custom Cloudinary/Backend integration for media.

---

## 🔒 Security & E2EE Flow

The application implements a zero-knowledge End-to-End Encryption architecture. The server never sees your plaintext messages or your private keys.

### 1. Key Generation
When a user signs up or logs in for the first time on a new device:
- **Identity Keys**: An `Ed25519` key pair is generated locally in the browser.
- **Public Key**: Uploaded to Firestore for others to find.
- **Private Key**: Stored securely in the browser's **IndexedDB**. It never leaves the device unencrypted.

### 2. The Recovery Passphrase (Phase 3)
To enable cross-device syncing without compromising security:
- We use **PBKDF2** (100k iterations) to derive a strong key from your "Recovery Passphrase".
- Your Identity Private Key is encrypted using **AES-GCM** with this derived key.
- The resulting **encrypted blob** is stored in Firestore.
- **Result**: You can log in on a new device, enter your passphrase, and "recover" your identity instantly.

### 3. Messaging Flow
1. **Encryption**: When you send a message, the app fetches the recipient's **Public Key** from Firestore.
2. **Shared Secret**: A shared AES-256 key is derived using Diffie-Hellman.
3. **Payload**: The message is encrypted locally.
4. **Transmission**: The encrypted payload is sent via **Socket.io** to the backend.
5. **Persistence**: The backend saves the encrypted message to **Firestore**.
6. **Decryption**: The recipient receives the socket event (or pulls from history) and uses their Private Key to derive the same Shared Secret and decrypt the message.

---

## 📡 Data Flow & Synchronization

### Real-time Engine
- **Socket.io** handles the "instant" feel of the app (typing indicators, online status, message relay).
- **Firestore Snapshots** handle the persistence and state synchronization. If a socket disconnects, Firestore listeners ensure the UI stays up to date.

### Auth & Sync
- **Backend Sync**: OnEvery login, the frontend calls `/api/auth/sync`. This ensures the Firestore record is consistent with the Firebase Auth state and checks for E2EE key presence.
- **Cleanup**: The application uses authenticated requests (JWT/Firebase ID Tokens) for all sensitive operations, including resetting unread counts and deleting history.

---

## 🔄 Legacy Data Migration
The project recently migrated from **Firebase Realtime Database (RTDB)** to **Cloud Firestore**. 
- A migration script was used to move all legacy contacts, user profiles, and groups.
- Legacy users are supported via a "Graceful E2EE Fallback"—if they haven't set up keys yet, messages are clearly marked to avoid confusion.

---

## 🛠️ Setup & Environment Variables

Required `.env` variables:

### Frontend
- `VITE_FIREBASE_API_KEY`
- `VITE_API_URL`
- `VITE_SOCKET_URL`

### Backend
- `FIREBASE_SERVICE_ACCOUNT` (JSON string)
- `CLOUDINARY_URL`
- `PORT` (Default: 5001)

---

## 🚀 Future Roadmap
- [ ] Group E2EE Key Rotation on member removal.
- [ ] Multi-device active session management.
- [ ] Native Mobile App (React Native).

---

*Designed and Developed with 💙 by Antigravity.*
