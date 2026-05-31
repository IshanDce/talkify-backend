const { getFirebase } = require('../config/firebase');
const config = require('../config');

/**
 * Send a push notification via FCM to a list of device tokens.
 *
 * @param {string[]} fcmTokens - Array of FCM device tokens
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body - Notification body
 * @param {Object} [payload.data] - Optional data payload for client-side handling
 * @returns {Promise<Object>} FCM response
 */
const sendPushNotification = async (fcmTokens, payload) => {
  const firebase = getFirebase();

  if (!firebase) {
    console.warn('[FCM] Firebase not initialized. Skipping push notification.');
    return null;
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    return null;
  }

  // Deduplicate tokens
  const uniqueTokens = [...new Set(fcmTokens)];

  try {
    const message = {
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
      tokens: uniqueTokens,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'talkify_messages',
          priority: 'high',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    const response = await firebase.messaging().sendEachForMulticast(message);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`[FCM] Failed for token ${uniqueTokens[idx].slice(0, 10)}...:`, resp.error?.message);
        }
      });
    }

    console.log(`[FCM] Push sent: ${response.successCount} success, ${response.failureCount} failed`);
    return response;
  } catch (error) {
    console.error('[FCM] Push notification error:', error.message);
    return null;
  }
};

/**
 * Send a new message notification to offline users.
 */
const notifyNewMessage = async (recipientUser, senderName, chatId, messageContent, messageType) => {
  const fcmTokens = recipientUser.fcmTokens?.map((t) => t.token) || [];
  if (fcmTokens.length === 0) return;

  const preview = messageType === 'text'
    ? messageContent.slice(0, 100)
    : messageType === 'image'
      ? '📷 Photo'
      : messageType === 'audio'
        ? '🎵 Audio'
        : messageType === 'video'
          ? '🎬 Video'
          : '📎 File';

  return sendPushNotification(fcmTokens, {
    title: senderName || 'Talkify',
    body: preview,
    data: {
      type: 'new_message',
      chatId: chatId.toString(),
      senderName: senderName || '',
    },
  });
};

/**
 * Send an incoming call notification. Uses a DATA-ONLY, high-priority message
 * (no `notification` block) so the Flutter background handler always runs and
 * can show the native CallKit / full-screen incoming-call UI.
 */
const notifyIncomingCall = async (
  recipientUser,
  callerName,
  callId,
  channelName,
  extra = {}
) => {
  const fcmTokens = recipientUser.fcmTokens?.map((t) => t.token) || [];
  if (fcmTokens.length === 0) return;

  const firebase = getFirebase();
  if (!firebase) {
    console.warn('[FCM] Firebase not initialized. Skipping call push.');
    return null;
  }

  const uniqueTokens = [...new Set(fcmTokens)];
  const message = {
    data: {
      type: 'incoming_call',
      callId: callId.toString(),
      channelName: channelName || '',
      callerName: callerName || '',
      callerId: (extra.callerId || '').toString(),
      callerAvatar: extra.callerAvatar || '',
      callType: extra.callType || 'audio',
      isGroup: extra.isGroup ? 'true' : 'false',
      chatId: (extra.chatId || '').toString(),
      groupName: extra.groupName || '',
    },
    tokens: uniqueTokens,
    android: {
      priority: 'high',
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'voip',
      },
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const response = await firebase.messaging().sendEachForMulticast(message);
    console.log(
      `[FCM] Call push sent: ${response.successCount} ok, ${response.failureCount} failed`
    );
    return response;
  } catch (error) {
    console.error('[FCM] Call push error:', error.message);
    return null;
  }
};

/**
 * POST /api/calls/test-push
 * Sends a test FCM push notification to the authenticated user's registered tokens.
 */
const testPush = async (req, res, next) => {
  try {
    const { title, body } = req.body;

    // Find the authenticated user to get their FCM tokens
    const User = require('../models/User');
    const user = await User.findById(req.user.userId).lean();
    if (!user || user.isDeleted) {
      throw require('../middleware/errorHandler').createError(404, 'User not found');
    }

    const fcmTokens = user.fcmTokens?.map((t) => t.token) || [];
    if (fcmTokens.length === 0) {
      return res.status(400).json({ error: 'No FCM tokens registered for this user. Send fcmToken during OTP verify first.' });
    }

    const result = await sendPushNotification(fcmTokens, {
      title: title || '🧪 Test Notification',
      body: body || 'This is a test push notification from Talkify!',
      data: {
        type: 'test_push',
        timestamp: new Date().toISOString(),
      },
    });

    res.status(200).json({
      message: 'Test push notification sent',
      tokensTargeted: fcmTokens.length,
      result: result
        ? { successCount: result.successCount, failureCount: result.failureCount }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { sendPushNotification, notifyNewMessage, notifyIncomingCall, testPush };