const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { getProfile, updateProfile, syncContacts } = require('../services/userService');

const router = Router();

// All user routes require authentication
router.use(authenticate);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/sync-contacts', syncContacts);

module.exports = router;