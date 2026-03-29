const express = require('express');
const router = express.Router();
const { uploadImage, uploadMiddleware } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, uploadMiddleware, uploadImage);

module.exports = router;
