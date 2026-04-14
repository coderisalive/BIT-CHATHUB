const express = require('express');
const router = express.Router();
const { syncUser, getMe, changePassword, resolveIdentifier } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/resolve-identifier', resolveIdentifier);
router.post('/sync', protect, syncUser);
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);

module.exports = router;
