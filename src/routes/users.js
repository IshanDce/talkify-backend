const { Router } = require('express');
const multer = require('multer');
const authenticate = require('../middleware/auth');
const { getProfile, updateProfile, syncContacts } = require('../services/userService');

const router = Router();

// --- Multer configuration for avatar upload (in-memory, no disk storage) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/svg+xml',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Allowed: jpg, jpeg, png, gif, webp, bmp, svg'), false);
    }
  },
});

// All user routes require authentication
router.use(authenticate);

router.get('/profile', getProfile);
router.put('/profile', upload.single('avatar'), updateProfile);
router.post('/sync-contacts', syncContacts);

module.exports = router;