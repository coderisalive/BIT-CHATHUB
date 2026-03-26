const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, groupController.createGroup);
router.get('/', protect, groupController.getGroups);

module.exports = router;
