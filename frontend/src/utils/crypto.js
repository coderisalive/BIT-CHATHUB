/**
 * End-to-End Encryption Utilities using Web Crypto API.
 * Uses ECDH (Curve P-256) for key exchange and AES-GCM for encryption.
 */

const KEY_DB_NAME = 'bitchat-keys';
const KEY_STORE_NAME = 'identity-keys';

/**
 * Generates an ECDH key pair and stores it in IndexedDB for persistence.
 */
export const generateIdentityKeys = async () => {
    try {
        const keyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true, // extractable
            ["deriveKey", "deriveBits"]
        );

        // Export public key as SPKI (Subject Public Key Info) to share with the server/other users
        const publicKeySPKI = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
        const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySPKI)));

        // Store private key securely in IndexedDB
        await storePrivateKey(keyPair.privateKey);

        return publicKeyBase64;
    } catch (error) {
        console.error('[Crypto] Key generation failed:', error);
        throw error;
    }
};

/**
 * Derives a symmetric AES-GCM key from our private key and the recipient's public key.
 */
export const deriveSharedSecret = async (recipientPublicKeyBase64) => {
    try {
        const privateKey = await getPrivateKey();
        if (!privateKey) throw new Error('Private key not found. Please re-login.');

        const recipientPublicKeySPKI = new Uint8Array(
            atob(recipientPublicKeyBase64).split("").map(c => c.charCodeAt(0))
        );

        const recipientPublicKey = await window.crypto.subtle.importKey(
            "spki",
            recipientPublicKeySPKI,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );

        return await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: recipientPublicKey },
            privateKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    } catch (error) {
        console.error('[Crypto] Secret derivation failed:', error);
        throw error;
    }
};

/**
 * Encrypts a plaintext string using AES-GCM.
 */
export const encryptMessage = async (plaintext, sharedKey) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        sharedKey,
        encoded
    );

    return {
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
        iv: btoa(String.fromCharCode(...iv))
    };
};

/**
 * Decrypts a ciphertext using AES-GCM.
 */
export const decryptMessage = async (encryptedData, sharedKey) => {
    try {
        const { ciphertext, iv } = encryptedData;
        
        const decodedCiphertext = new Uint8Array(
            atob(ciphertext).split("").map(c => c.charCodeAt(0))
        );
        const decodedIv = new Uint8Array(
            atob(iv).split("").map(c => c.charCodeAt(0))
        );

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: decodedIv },
            sharedKey,
            decodedCiphertext
        );

        return new TextDecoder().decode(decrypted);
    } catch (error) {
        console.error('[Crypto] Decryption failed:', error);
        return '[Decryption Error]';
    }
};

/**
 * Generates a random AES-GCM 256-bit key for a chat group.
 */
export const generateGroupKey = async () => {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
};

/**
 * Exports a symmetric key to a Base64 string.
 */
export const exportSymmetricKey = async (key) => {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
};

/**
 * Imports a symmetric key from a Base64 string.
 */
export const importSymmetricKey = async (base64Key) => {
    const rawKey = new Uint8Array(
        atob(base64Key).split("").map(c => c.charCodeAt(0))
    );
    return await window.crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
};

/**
 * Backup the private identity key by encrypting it with a passphrase.
 * Returns { ciphertext, salt, iv } to be stored in Firestore.
 */
export const backupPrivateKey = async (passphrase) => {
    try {
        const privateKey = await getPrivateKey();
        if (!privateKey) throw new Error('No private key to backup');

        // 1. Export private key to PKCS#8 format
        const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);

        // 2. Derive a key from the passphrase
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const encryptionKey = await deriveKeyFromPassphrase(passphrase, salt);

        // 3. Encrypt the exported key
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            encryptionKey,
            exported
        );

        return {
            ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
            salt: btoa(String.fromCharCode(...salt)),
            iv: btoa(String.fromCharCode(...iv))
        };
    } catch (error) {
        console.error('[Crypto] Backup failed:', error);
        throw error;
    }
};

/**
 * Recovers a private key from backup data using the passphrase.
 * Stores it in IndexedDB and returns the CryptoKey object.
 */
export const recoverPrivateKey = async (backupData, passphrase) => {
    try {
        const { ciphertext, salt, iv } = backupData;

        // 1. Decode inputs
        const decodedCiphertext = new Uint8Array(atob(ciphertext).split("").map(c => c.charCodeAt(0)));
        const decodedSalt = new Uint8Array(atob(salt).split("").map(c => c.charCodeAt(0)));
        const decodedIv = new Uint8Array(atob(iv).split("").map(c => c.charCodeAt(0)));

        // 2. Derive the encryption key
        const encryptionKey = await deriveKeyFromPassphrase(passphrase, decodedSalt);

        // 3. Decrypt the PKCS#8 data
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: decodedIv },
            encryptionKey,
            decodedCiphertext
        );

        // 4. Import the identity key
        const privateKey = await window.crypto.subtle.importKey(
            "pkcs8",
            decrypted,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
        );

        // 5. Store in IndexedDB
        await storePrivateKey(privateKey);
        return privateKey;
    } catch (error) {
        console.error('[Crypto] Recovery failed. Incorrect passphrase?', error);
        throw new Error('Invalid Recovery Passphrase');
    }
};

/**
 * Internal helper to derive an AES-GCM key from a passphrase using PBKDF2.
 */
const deriveKeyFromPassphrase = async (passphrase, salt) => {
    const encoder = new TextEncoder();
    const passphraseKey = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        passphraseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
};

export const hasPrivateKey = async () => {
    const pk = await getPrivateKey();
    return !!pk;
};

// --- IndexedDB Helpers ---

const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(KEY_DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
                db.createObjectStore(KEY_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const storePrivateKey = async (privateKey) => {
    const db = await openDB();
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(KEY_STORE_NAME);
    store.put(privateKey, 'current-identity');
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const getPrivateKey = async () => {
    const db = await openDB();
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.get('current-identity');
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};
