const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const authenticate = require('../middleware/auth');
const { getAuthParams, uploadMedia, deleteMedia } = require('../services/mediaService');

const router = Router();

// Allowed image/video extensions for upload
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
  'mp4', 'mov', 'avi', 'mkv', 'webm',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'))) {
      return cb(null, true);
    }
    if (file.mimetype === 'application/octet-stream' && file.originalname) {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
        return cb(null, true);
      }
    }
    cb(new Error('Invalid media type. Allowed: images and videos'), false);
  },
});

// All media routes require authentication
router.use(authenticate);

router.get('/auth', getAuthParams);
router.post('/upload', upload.single('file'), uploadMedia);
router.delete('/delete', deleteMedia);

module.exports = router;
