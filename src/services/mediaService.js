const config = require('../config');
const path = require('path');
const { getImageKit } = require('../config/imagekit');
const { createError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

// In-memory store for chunked uploads (use Redis in production)
const chunkStore = new Map();

// Clean up old chunk data after 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [uploadId, data] of chunkStore.entries()) {
    if (now - data.timestamp > 3600000) { // 1 hour
      chunkStore.delete(uploadId);
    }
  }
}, 300000); // Check every 5 minutes

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
 * Optimized for faster video uploads with better buffer handling.
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
    const isVideo = file.mimetype && file.mimetype.startsWith('video/');

    // Optimize upload parameters based on file type
    const uploadOptions = {
      file: file.buffer,
      fileName: `chat_media_${req.user.userId}_${Date.now()}${ext}`,
      folder: '/chat-media/',
      useUniqueFileName: true,
    };

    // For videos, add optimization parameters
    if (isVideo) {
      uploadOptions.tags = ['video', 'chat'];
      // ImageKit will handle video optimization on their end
    }

    const uploadResponse = await imagekit.upload(uploadOptions);

    uploadedFileId = uploadResponse.fileId;

    // Clear the buffer immediately after upload to free memory
    file.buffer = null;

    res.status(200).json({
      url: uploadResponse.url,
      fileId: uploadResponse.fileId,
      fileName: uploadResponse.name,
      width: uploadResponse.width || 0,
      height: uploadResponse.height || 0,
      size: uploadResponse.size || 0,
      fileType: uploadResponse.fileType || 'unknown',
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

/**
 * POST /api/media/upload-chunk
 * Upload a single chunk of a large file.
 * Body params: uploadId, chunkIndex, totalChunks, fileName
 */
const uploadChunked = async (req, res, next) => {
  try {
    const chunk = req.file;
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;

    if (!chunk) {
      throw createError(400, 'No chunk provided');
    }

    if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      throw createError(400, 'Missing required parameters: uploadId, chunkIndex, totalChunks, fileName');
    }

    const index = parseInt(chunkIndex);
    const total = parseInt(totalChunks);

    // Initialize or retrieve chunk data
    if (!chunkStore.has(uploadId)) {
      chunkStore.set(uploadId, {
        chunks: new Array(total),
        fileName,
        userId: req.user.userId,
        timestamp: Date.now(),
      });
    }

    const uploadData = chunkStore.get(uploadId);
    uploadData.chunks[index] = chunk.buffer;
    uploadData.timestamp = Date.now(); // Update timestamp

    res.status(200).json({
      message: 'Chunk uploaded successfully',
      uploadId,
      chunkIndex: index,
      received: uploadData.chunks.filter(c => c !== undefined).length,
      total,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/media/upload-complete
 * Finalize chunked upload by combining chunks and uploading to ImageKit.
 * Body params: uploadId
 */
const completeChunkedUpload = async (req, res, next) => {
  let uploadedFileId = null;

  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      throw createError(400, 'uploadId is required');
    }

    const uploadData = chunkStore.get(uploadId);
    if (!uploadData) {
      throw createError(404, 'Upload session not found or expired');
    }

    // Check if all chunks are received
    const missingChunks = uploadData.chunks.findIndex(c => c === undefined);
    if (missingChunks !== -1) {
      throw createError(400, `Missing chunk at index ${missingChunks}`);
    }

    // Combine all chunks into a single buffer
    const completeFile = Buffer.concat(uploadData.chunks);

    const imagekit = getImageKit();
    if (!imagekit) {
      throw createError(503, 'Media service is not configured');
    }

    const ext = path.extname(uploadData.fileName) || '.mp4';
    const isVideo = ext.match(/\.(mp4|mov|avi|mkv|webm)$/i);

    const uploadOptions = {
      file: completeFile,
      fileName: `chat_media_${uploadData.userId}_${Date.now()}${ext}`,
      folder: '/chat-media/',
      useUniqueFileName: true,
    };

    if (isVideo) {
      uploadOptions.tags = ['video', 'chat'];
    }

    const uploadResponse = await imagekit.upload(uploadOptions);
    uploadedFileId = uploadResponse.fileId;

    // Clean up
    chunkStore.delete(uploadId);

    res.status(200).json({
      url: uploadResponse.url,
      fileId: uploadResponse.fileId,
      fileName: uploadResponse.name,
      width: uploadResponse.width || 0,
      height: uploadResponse.height || 0,
      size: uploadResponse.size || 0,
      fileType: uploadResponse.fileType || 'unknown',
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

module.exports = { getAuthParams, uploadMedia, deleteMedia, uploadChunked, completeChunkedUpload };
