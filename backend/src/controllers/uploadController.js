const imagekit = require('../config/imagekit');
const multer = require('multer');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = `chat_${Date.now()}_${req.file.originalname}`;

    const response = await imagekit.upload({
      file: fileBuffer,
      fileName: fileName,
      folder: '/chat_uploads/'
    });

    // Track upload in Firestore for auto-deletion (48 hours)
    try {
      const { firestore } = require('../config/firebaseAdmin');
      await firestore.collection('uploads').add({
        fileId: response.fileId,
        fileUrl: response.url,
        createdAt: Date.now()
      });
      console.log(`[Upload] Tracked file ${response.fileId} in Firestore.`);
    } catch (trackErr) {
      console.error('[Upload] Failed to track upload in Firestore:', trackErr);
    }

    res.json({
      success: true,
      url: response.url,
      fileId: response.fileId
    });
  } catch (error) {
    console.error('[Upload] ImageKit error:', error);
    res.status(500).json({ error: 'Failed to upload file to ImageKit' });
  }
};

module.exports = {
  uploadImage,
  uploadMiddleware: upload.single('image')
};
