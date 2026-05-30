const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { getOrCreateDirectChat, getChats, getMessages, createGroup } = require('../services/messagingService');

const router = Router();

// All chat routes require authentication
router.use(authenticate);

router.get('/', getChats);
router.get('/:chatId/messages', getMessages);
router.post('/direct', getOrCreateDirectChat);
router.post('/group', createGroup);

module.exports = router;
