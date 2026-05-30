const config = require('../config');
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

module.exports = { getAuthParams, deleteMedia };