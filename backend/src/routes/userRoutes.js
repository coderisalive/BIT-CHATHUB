const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.get('/search', protect, authController.searchUsers);
router.put('/profile', protect, authController.updateProfile);
router.get('/contacts', protect, authController.getContacts);
router.post('/contacts', protect, authController.addContact);
router.delete('/contacts/:contactUid', protect, authController.removeContact);

module.exports = router;
