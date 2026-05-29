const CallLog = require('../models/CallLog');
const { createError } = require('../middleware/errorHandler');

/**
 * GET /api/calls/history
 * Returns paginated call history for the authenticated user.
 */
const getCallHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const calls = await CallLog.find({
      $or: [{ callerId: req.user.userId }, { calleeId: req.user.userId }],
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('callerId', 'name phone avatarUrl')
      .populate('calleeId', 'name phone avatarUrl')
      .lean();

    const total = await CallLog.countDocuments({
      $or: [{ callerId: req.user.userId }, { calleeId: req.user.userId }],
    });

    // Transform: determine if call was incoming/outgoing from user's perspective
    const callList = calls.map((call) => {
      const isCaller = call.callerId._id.toString() === req.user.userId;
      return {
        id: call._id,
        peer: isCaller ? call.calleeId : call.callerId,
        type: isCaller ? 'outgoing' : call.status === 'missed' ? 'missed' : 'incoming',
        timestamp: call.startedAt || call.createdAt,
        durationSeconds: call.durationSeconds || 0,
      };
    });

    res.status(200).json({
      calls: callList,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCallHistory };