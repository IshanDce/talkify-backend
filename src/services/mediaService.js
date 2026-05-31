const config = require('../config');
const path = require('path');
const { getImageKit } = require('../config/imagekit');
const { createError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /api/media/auth
 * Generates ImageKit authentication parameters for client-side upload.
 */
const getAuthParams = async (req, res, next) => {
  try {
    const imagekit = getImageKit();

    if (!imagekit) {
      throw createError(503, 'Media service is not configured');
    }

    const authParams = imagekit.getAuthenticationParameters();

    res.status(200).json({
      publicKey: config.imagekit.publicKey,
      token: authParams.token,
      expire: authParams.expire,
      signature: authParams.signature,
      urlEndpoint: config.imagekit.urlEndpoint,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/media/upload
 * Server-side upload to ImageKit. The file is sent as multipart/form-data
 * with field name "file". Returns the ImageKit URL, fileId, width, height.
 */
const uploadMedia = async (req, res, next) => {
  let uploadedFileId = null;

  try {
    const file = req.file; // Provided by multer (memoryStorage)

    if (!file) {
      throw createError(400, 'No file provided. Use field name "file".');
    }

    const imagekit = getImageKit();
    if (!imagekit) {
      throw createError(503, 'Media service is not configured');
    }

    const ext = path.extname(file.originalname) || '.jpg';
    const uploadResponse = await imagekit.upload({
      file: file.buffer,
      fileName: `chat_media_${req.user.userId}_${Date.now()}${ext}`,
      folder: '/chat-media/',
      useUniqueFileName: true,
    });

    uploadedFileId = uploadResponse.fileId;

    res.status(200).json({
      url: uploadResponse.url,
      fileId: uploadResponse.fileId,
      fileName: uploadResponse.name,
      width: uploadResponse.width || 0,
      height: uploadResponse.height || 0,
      size: uploadResponse.size || 0,
    });
  } catch (err) {
    // Clean up on failure
    if (uploadedFileId) {
      try {
        const imagekit = getImageKit();
        if (imagekit) await imagekit.deleteFile(uploadedFileId);
      } catch (_) { /* ignore */ }
    }
    next(err);
  }
};

/**
 * DELETE /api/media/delete
 * Deletes a file from ImageKit by fileId.
 */
const deleteMedia = async (req, res, next) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      throw createError(400, 'fileId is required');
    }

    const imagekit = getImageKit();
    if (!imagekit) {
      throw createError(503, 'Media service is not configured');
    }

    await imagekit.deleteFile(fileId);

    res.status(200).json({ message: 'File deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAuthParams, uploadMedia, deleteMedia };
