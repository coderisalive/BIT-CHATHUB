const express = require('express');
const router = express.Router();
const { syncUser, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/sync', protect, syncUser);
router.get('/me', protect, getMe);

module.exports = router;
