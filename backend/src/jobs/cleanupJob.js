const cron = require('node-cron');
const imagekit = require('../config/imagekit');
const { firestore } = require('../config/firebaseAdmin');

/**
 * Cleanup job to delete files from ImageKit and Firestore after 48 hours.
 * Runs every hour.
 */
const initCleanupJob = () => {
  cron.schedule('0 * * * *', async () => {
    console.log('[CleanupJob] Starting hourly file cleanup check...');
    
    try {
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      const threshold = Date.now() - FORTY_EIGHT_HOURS_MS;
      
      const uploadsSnap = await firestore.collection('uploads')
        .where('createdAt', '<', threshold)
        .get();
        
      if (uploadsSnap.empty) {
        console.log('[CleanupJob] No expired files found.');
        return;
      }
      
      console.log(`[CleanupJob] Found ${uploadsSnap.size} expired files to delete.`);
      
      for (const doc of uploadsSnap.docs) {
        const file = doc.data();
        try {
          // 1. Delete from ImageKit
          await imagekit.deleteFile(file.fileId);
          console.log(`[CleanupJob] Deleted ${file.fileId} from ImageKit.`);
          
          // 2. Delete the record from Firestore
          await doc.ref.delete();
          console.log(`[CleanupJob] Removed record ${doc.id} from Firestore.`);
        } catch (error) {
          console.error(`[CleanupJob] Error deleting file ${file.fileId}:`, error.message);
          // If the file doesn't exist on ImageKit anymore, still remove our tracking record
          if (error.message.includes('not found') || error.status === 404) {
            await doc.ref.delete();
          }
        }
      }
      
      console.log('[CleanupJob] Cleanup finished successfully.');
    } catch (error) {
      console.error('[CleanupJob] Fatal error during cleanup:', error);
    }
  });
  
  console.log('🚀 ImageKit Cleanup Job Initialized (Hourly check).');
};

module.exports = initCleanupJob;
