const { Router } = require('express');
const authenticate = require('../middleware/auth');
const { getAuthParams, deleteMedia } = require('../services/mediaService');

const router = Router();

// All media routes require authentication
router.use(authenticate);

router.get('/auth', getAuthParams);
router.delete('/delete', deleteMedia);

module.exports = router;