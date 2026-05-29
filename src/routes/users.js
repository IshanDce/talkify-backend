const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const authenticate = require('../middleware/auth');
const { getProfile, updateProfile, syncContacts } = require('../services/userService');

const router = Router();

// Allowed image extensions (lowercase, no dot)
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
]);

// --- Multer configuration for avatar upload (in-memory, no disk storage) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (_req, file, cb) => {
    // Accept image/* MIME types directly
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    // Fallback: some mobile clients send application/octet-stream for images.
    // Check the file extension instead.
    if (file.mimetype === 'application/octet-stream' && file.originalname) {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        return cb(null, true);
      }
    }
    cb(new Error('Invalid image type. Allowed: jpeg, png, gif, webp, bmp, svg'), false);
  },
});

// All user routes require authentication
router.use(authenticate);

router.get('/profile', getProfile);
router.put('/profile', upload.single('avatar'), updateProfile);
router.post('/sync-contacts', syncContacts);

module.exports = router;