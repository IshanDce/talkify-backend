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
    // Accept any image/* MIME type (jpg, jpeg, png, gif, webp, bmp, svg, etc.)
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Please upload a valid image file (jpg, png, gif, webp, etc.)'), false);
    }
  },
});

// All user routes require authentication
router.use(authenticate);

router.get('/profile', getProfile);
router.put('/profile', upload.single('avatar'), updateProfile);
router.post('/sync-contacts', syncContacts);

module.exports = router;