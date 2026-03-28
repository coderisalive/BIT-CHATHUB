const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, groupController.createGroup);
router.get('/', protect, groupController.getGroups);
router.get('/:groupId/members', protect, groupController.getGroupMembers);
router.post('/:groupId/members', protect, groupController.addGroupMember);

module.exports = router;
