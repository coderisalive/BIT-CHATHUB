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

    // Track upload in Firebase for auto-deletion (48 hours)
    try {
      const { db: adminDb } = require('../config/firebaseAdmin');
      await adminDb.ref('uploads').push({
        fileId: response.fileId,
        fileUrl: response.url,
        createdAt: Date.now()
      });
      console.log(`[Upload] Tracked file ${response.fileId} in Firebase.`);
    } catch (trackErr) {
      console.error('[Upload] Failed to track upload in Firebase:', trackErr);
      // We don't fail the request if tracking fails, but it's noted
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
