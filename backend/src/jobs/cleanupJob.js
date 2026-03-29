const cron = require('node-cron');
const imagekit = require('../config/imagekit');
const { db: adminDb } = require('../config/firebaseAdmin');

/**
 * Cleanup job to delete files from ImageKit and Firebase after 48 hours.
 * Runs every hour.
 */
const initCleanupJob = () => {
  // Cron schedule: "0 * * * *" means "at minute 0 of every hour"
  cron.schedule('0 * * * *', async () => {
    console.log('[CleanupJob] Starting hourly file cleanup check...');
    
    try {
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      const threshold = Date.now() - FORTY_EIGHT_HOURS_MS;
      
      const uploadsRef = adminDb.ref('uploads');
      // Query for uploads created before the threshold
      const snapshot = await uploadsRef
        .orderByChild('createdAt')
        .endAt(threshold)
        .once('value');
        
      const uploads = snapshot.val();
      
      if (!uploads) {
        console.log('[CleanupJob] No expired files found.');
        return;
      }
      
      const uploadKeys = Object.keys(uploads);
      console.log(`[CleanupJob] Found ${uploadKeys.length} expired files to delete.`);
      
      for (const key of uploadKeys) {
        const file = uploads[key];
        try {
          // 1. Delete from ImageKit
          await imagekit.deleteFile(file.fileId);
          console.log(`[CleanupJob] Deleted ${file.fileId} from ImageKit.`);
          
          // 2. Delete the record from Firebase
          await uploadsRef.child(key).remove();
          console.log(`[CleanupJob] Removed record ${key} from Firebase.`);
        } catch (error) {
          console.error(`[CleanupJob] Error deleting file ${file.fileId}:`, error.message);
          // If the file doesn't exist on ImageKit anymore, still remove our tracking record
          if (error.message.includes('not found') || error.status === 404) {
            await uploadsRef.child(key).remove();
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
