const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const config = require('../config');
const { createError } = require('../middleware/errorHandler');

/**
 * POST /api/calls/agora-token
 * Generates an Agora RTC token for a specific channel.
 */
const generateAgoraToken = async (req, res, next) => {
  try {
    const { channelName } = req.body;

    if (!channelName || !channelName.trim()) {
      throw createError(400, 'channelName is required');
    }

    if (!config.agora.appId || !config.agora.appCertificate) {
      throw createError(503, 'Agora service is not configured');
    }

    const uid = 0; // 0 means Agora assigns a uid
    const role = RtcRole.PUBLISHER;

    const expirationTimeInSeconds = config.agora.tokenExpirySeconds;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      config.agora.appId,
      config.agora.appCertificate,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    res.status(200).json({
      token,
      appId: config.agora.appId,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { generateAgoraToken };