const User = require('../models/User');
const { createError } = require('../middleware/errorHandler');
const { getImageKit } = require('../config/imagekit');
const path = require('path');

/**
 * GET /api/users/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).lean();
    if (!user || user.isDeleted) {
      throw createError(404, 'User not found');
    }

    res.status(200).json({
      id: user._id,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      status: user.status,
      lastSeen: user.lastSeen,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/users/profile
 * Accepts: multipart/form-data
 * Fields: name (text), bio (text)
 * File:   avatar (image file)
 *
 * Accepted image types: jpg, jpeg, png, gif, webp, bmp, svg
 * Maximum file size: 5 MB
 */
const updateProfile = async (req, res, next) => {
  let uploadedImageKitFileId = null;

  try {
    const { name, bio } = req.body;
    const avatarFile = req.file; // Provided by multer middleware (memoryStorage)

    const updates = {};
    if (name !== undefined && name !== '') updates.name = name;
    if (bio !== undefined && bio !== '') updates.bio = bio;

    // --- Handle avatar image upload to ImageKit ---
    if (avatarFile) {
      // Validate MIME type (accepts any image/* — multer already pre-filters)
      if (!avatarFile.mimetype || !avatarFile.mimetype.startsWith('image/')) {
        throw createError(
          400,
          `Invalid image type: ${avatarFile.mimetype}. Please upload a valid image file.`
        );
      }

      const imagekit = getImageKit();
      if (!imagekit) {
        throw createError(503, 'Media service is not configured');
      }

      // Upload directly from memory buffer (no disk I/O)
      const ext = path.extname(avatarFile.originalname) || '.jpg';
      const uploadResponse = await imagekit.upload({
        file: avatarFile.buffer,
        fileName: `avatar_${req.user.userId}_${Date.now()}${ext}`,
        folder: '/talkify/avatars/',
        useUniqueFileName: true,
      });

      uploadedImageKitFileId = uploadResponse.fileId;
      updates.avatarUrl = uploadResponse.url;

      // --- Delete old avatar from ImageKit if it exists ---
      const currentUser = await User.findById(req.user.userId).select('avatarUrl').lean();
      if (currentUser && currentUser.avatarUrl) {
        try {
          const existingFiles = await imagekit.listFiles({
            searchQuery: `url="${currentUser.avatarUrl}"`,
          });
          if (existingFiles && existingFiles.length > 0) {
            await imagekit.deleteFile(existingFiles[0].fileId);
          }
        } catch (deleteErr) {
          // Non-critical: log and continue
          console.warn('[userService] Failed to delete old avatar:', deleteErr.message);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      throw createError(400, 'No valid fields to update');
    }

    const user = await User.findByIdAndUpdate(req.user.userId, updates, {
      new: true,
      runValidators: true,
    }).lean();

    if (!user) {
      throw createError(404, 'User not found');
    }

    res.status(200).json({
      message: 'Profile updated',
      user: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
      },
    });
  } catch (err) {
    // If we uploaded to ImageKit but DB update failed, delete the uploaded image
    if (uploadedImageKitFileId) {
      try {
        const imagekit = getImageKit();
        if (imagekit) {
          await imagekit.deleteFile(uploadedImageKitFileId);
        }
      } catch (_) {
        // ignore
      }
    }
    next(err);
  }
};

/**
 * POST /api/users/sync-contacts
 * Accepts an array of phone contacts, returns registered and unregistered splits.
 */
const syncContacts = async (req, res, next) => {
  try {
    const { contacts } = req.body;

    if (!Array.isArray(contacts)) {
      throw createError(400, 'contacts must be an array');
    }

    if (contacts.length === 0) {
      return res.status(200).json({ registeredUsers: [], unregisteredContacts: [] });
    }

    if (contacts.length > 1000) {
      throw createError(400, 'Maximum 1000 contacts per request');
    }

    // Extract phone numbers and normalize
    const phones = contacts.map((c) => c.phone.trim());

    // Find all registered users matching those phones
    const registeredUsers = await User.find({
      phone: { $in: phones },
      isDeleted: false,
    })
      .select('phone name avatarUrl')
      .lean();

    const registeredPhoneSet = new Set(registeredUsers.map((u) => u.phone));

    // Map registered users with their local contact name
    const registeredResult = contacts
      .filter((c) => registeredPhoneSet.has(c.phone.trim()))
      .map((c) => {
        const talkifyUser = registeredUsers.find((u) => u.phone === c.phone.trim());
        return {
          phone: c.phone,
          id: talkifyUser._id,
          talkifyName: talkifyUser.name || '',
          localName: c.name || '',
          avatarUrl: talkifyUser.avatarUrl || '',
        };
      });

    // Unregistered contacts
    const unregisteredResult = contacts
      .filter((c) => !registeredPhoneSet.has(c.phone.trim()))
      .map((c) => ({
        phone: c.phone,
        localName: c.name || '',
      }));

    res.status(200).json({
      registeredUsers: registeredResult,
      unregisteredContacts: unregisteredResult,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile, updateProfile, syncContacts };