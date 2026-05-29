const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const CallLog = require('../models/CallLog');
const { notifyNewMessage, notifyIncomingCall } = require('../services/pushService');

/**
 * Map of userId -> Set<socketId> for tracking active connections.
 * A user may have multiple sockets (multiple devices/tabs).
 */
const connectedUsers = new Map();

/**
 * Map of socketId -> userId for reverse lookup.
 */
const socketToUser = new Map();

/**
 * Initialize Socket.io on the HTTP server.
 */
const initSocketIO = (server) => {
  const io = require('socket.io')(server, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // =========================================================================
  // Authentication Middleware
  // =========================================================================
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.query.token || socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication token is required'));
      }

      const decoded = jwt.verify(token, config.jwt.accessSecret);
      socket.userId = decoded.userId;
      socket.phone = decoded.phone;

      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // =========================================================================
  // Connection Handler
  // =========================================================================
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`[Socket] User connected: ${userId} (socket: ${socket.id})`);

    // Track connection
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);
    socketToUser.set(socket.id, userId);

    // Update user status to online
    await User.findByIdAndUpdate(userId, { status: 'online' });

    // Broadcast online status to all contacts
    await broadcastStatus(io, userId, 'online');

    // =======================================================================
    // Event: user:status:poll (client requests status of a contact)
    // =======================================================================
    socket.on('user:status:poll', async (data) => {
      try {
        const { userId: targetUserId } = data;
        const user = await User.findById(targetUserId).select('status lastSeen').lean();
        if (user) {
          socket.emit('user:status:update', {
            userId: targetUserId,
            status: isUserOnline(targetUserId) ? 'online' : 'offline',
            lastSeen: user.lastSeen,
          });
        }
      } catch (err) {
        console.error('[Socket] user:status:poll error:', err.message);
      }
    });

    // =======================================================================
    // Event: message:send
    // =======================================================================
    socket.on('message:send', async (data) => {
      try {
        const { chatId, type = 'text', content, tempId, media } = data;

        // Verify chat exists and user is participant
        const chat = await Chat.findOne({
          _id: chatId,
          participants: userId,
        }).populate('participants', 'name fcmTokens');

        if (!chat) {
          socket.emit('message:error', {
            tempId,
            error: 'Chat not found or access denied',
          });
          return;
        }

        // Create the message
        const message = await Message.create({
          chatId,
          senderId: userId,
          type,
          content: content || '',
          media: media || null,
          status: 'sent',
          deliveredTo: [],
          readBy: [],
        });

        // Update chat's last message
        const sender = chat.participants.find((p) => p._id.toString() === userId);
        chat.lastMessage = {
          messageId: message._id,
          content: message.content,
          type: message.type,
          senderId: userId,
          timestamp: message.createdAt,
        };

        // Reset unread for sender, increment for others
        chat.unreadCounts = chat.participants.map((p) => {
          if (p._id.toString() === userId) {
            return { userId: p._id, count: 0 };
          }
          const existing = chat.unreadCounts?.find(
            (uc) => uc.userId?.toString() === p._id.toString()
          );
          return { userId: p._id, count: (existing?.count || 0) + 1 };
        });

        await chat.save();

        // Ack to sender
        socket.emit('message:ack', {
          tempId,
          messageId: message._id,
          status: 'sent',
          timestamp: message.createdAt,
        });

        // Deliver to online recipients
        const recipientIds = chat.participants
          .filter((p) => p._id.toString() !== userId)
          .map((p) => p._id.toString());

        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'name avatarUrl phone')
          .lean();

        const messagePayload = {
          messageId: populatedMessage._id,
          chatId,
          senderId: populatedMessage.senderId._id,
          senderName: populatedMessage.senderId.name,
          senderAvatar: populatedMessage.senderId.avatarUrl,
          type: populatedMessage.type,
          content: populatedMessage.content,
          media: populatedMessage.media,
          timestamp: populatedMessage.createdAt,
        };

        for (const recipientId of recipientIds) {
          const recipientSockets = connectedUsers.get(recipientId);
          if (recipientSockets && recipientSockets.size > 0) {
            // Recipient is online - deliver via socket
            for (const sockId of recipientSockets) {
              io.to(sockId).emit('message:receive', messagePayload);
            }
            // Mark as delivered
            await Message.findByIdAndUpdate(message._id, {
              $addToSet: {
                deliveredTo: { userId: recipientId, deliveredAt: new Date() },
              },
              status: 'delivered',
            });
          } else {
            // Recipient is offline - send push notification
            const recipientUser = chat.participants.find(
              (p) => p._id.toString() === recipientId
            );
            if (recipientUser) {
              await notifyNewMessage(
                recipientUser,
                sender?.name || '',
                chatId,
                message.content,
                message.type
              );
            }
          }
        }

        // Broadcast updated chat list to all participants
        for (const participant of chat.participants) {
          const participantId = participant._id.toString();
          const participantSockets = connectedUsers.get(participantId);
          if (participantSockets) {
            for (const sockId of participantSockets) {
              io.to(sockId).emit('chat:updated', { chatId });
            }
          }
        }
      } catch (err) {
        console.error('[Socket] message:send error:', err.message);
        socket.emit('message:error', {
          tempId: data.tempId,
          error: 'Failed to send message',
        });
      }
    });

    // =======================================================================
    // Event: message:read
    // =======================================================================
    socket.on('message:read', async (data) => {
      try {
        const { chatId, messageIds } = data;

        if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
          return;
        }

        // Mark messages as read
        await Message.updateMany(
          {
            _id: { $in: messageIds },
            chatId,
            senderId: { $ne: userId },
          },
          {
            status: 'read',
            $addToSet: {
              readBy: { userId, readAt: new Date() },
            },
          }
        );

        // Reset unread count for this user
        await Chat.findOneAndUpdate(
          { _id: chatId, 'unreadCounts.userId': userId },
          { $set: { 'unreadCounts.$.count': 0 } }
        );

        // Notify senders that their messages were read
        const messages = await Message.find({ _id: { $in: messageIds } })
          .select('senderId')
          .lean();

        const senderIds = [...new Set(messages.map((m) => m.senderId.toString()))];
        for (const senderId of senderIds) {
          const senderSockets = connectedUsers.get(senderId);
          if (senderSockets) {
            for (const sockId of senderSockets) {
              io.to(sockId).emit('message:read:ack', {
                chatId,
                readBy: userId,
                messageIds,
                readAt: new Date(),
              });
            }
          }
        }

        // Broadcast chat updated
        socket.emit('chat:updated', { chatId });
      } catch (err) {
        console.error('[Socket] message:read error:', err.message);
      }
    });

    // =======================================================================
    // Event: chat:typing
    // =======================================================================
    socket.on('chat:typing', (data) => {
      const { chatId, isTyping } = data;

      // Find chat participants and relay typing status
      Chat.findById(chatId)
        .select('participants')
        .lean()
        .then((chat) => {
          if (!chat) return;
          const recipientIds = chat.participants
            .map((p) => p.toString())
            .filter((p) => p !== userId);

          for (const recipientId of recipientIds) {
            const recipientSockets = connectedUsers.get(recipientId);
            if (recipientSockets) {
              for (const sockId of recipientSockets) {
                io.to(sockId).emit('chat:typing', {
                  chatId,
                  userId,
                  isTyping,
                });
              }
            }
          }
        })
        .catch((err) => {
          console.error('[Socket] chat:typing error:', err.message);
        });
    });

    // =======================================================================
    // Event: call:initiate
    // =======================================================================
    socket.on('call:initiate', async (data) => {
      try {
        const { targetUserId, callType = 'audio', channelName } = data;

        const caller = await User.findById(userId).select('name avatarUrl phone').lean();
        const targetUser = await User.findById(targetUserId).select('fcmTokens').lean();

        if (!targetUser) {
          socket.emit('call:error', { error: 'Target user not found' });
          return;
        }

        // Create call log entry (pending)
        const callLog = await CallLog.create({
          callerId: userId,
          calleeId: targetUserId,
          channelName,
          callType,
          status: 'missed', // Default to missed until accepted
          startedAt: new Date(),
        });

        const callPayload = {
          callId: callLog._id,
          channelName,
          caller: {
            id: userId,
            name: caller?.name || '',
            avatarUrl: caller?.avatarUrl || '',
          },
        };

        const targetSockets = connectedUsers.get(targetUserId);
        if (targetSockets && targetSockets.size > 0) {
          // Target is online - ring them
          for (const sockId of targetSockets) {
            io.to(sockId).emit('call:incoming', callPayload);
          }
        } else {
          // Target is offline - send FCM push
          await notifyIncomingCall(
            targetUser,
            caller?.name || '',
            callLog._id,
            channelName
          );
        }
      } catch (err) {
        console.error('[Socket] call:initiate error:', err.message);
        socket.emit('call:error', { error: 'Failed to initiate call' });
      }
    });

    // =======================================================================
    // Event: call:response
    // =======================================================================
    socket.on('call:response', async (data) => {
      try {
        const { callId, channelName, status } = data;

        const callLog = await CallLog.findById(callId);
        if (!callLog) {
          socket.emit('call:error', { error: 'Call not found' });
          return;
        }

        if (status === 'accepted') {
          callLog.status = callLog.calleeId.toString() === userId ? 'incoming' : 'outgoing';
          callLog.startedAt = new Date();
        } else {
          // rejected or missed
          callLog.endedAt = new Date();
          callLog.durationSeconds = 0;
        }
        await callLog.save();

        // Notify the caller about the response
        const callerId = callLog.callerId.toString();
        const callerSockets = connectedUsers.get(callerId);
        if (callerSockets) {
          for (const sockId of callerSockets) {
            io.to(sockId).emit('call:response:ack', {
              callId: callLog._id,
              channelName,
              status,
            });
          }
        }
      } catch (err) {
        console.error('[Socket] call:response error:', err.message);
        socket.emit('call:error', { error: 'Failed to process call response' });
      }
    });

    // =======================================================================
    // Event: call:end
    // =======================================================================
    socket.on('call:end', async (data) => {
      try {
        const { callId, durationSeconds = 0 } = data;

        const callLog = await CallLog.findById(callId);
        if (!callLog) {
          socket.emit('call:error', { error: 'Call not found' });
          return;
        }

        callLog.endedAt = new Date();
        callLog.durationSeconds = durationSeconds;
        await callLog.save();

        // Notify the other peer
        const otherUserId =
          callLog.callerId.toString() === userId
            ? callLog.calleeId.toString()
            : callLog.callerId.toString();

        const otherSockets = connectedUsers.get(otherUserId);
        if (otherSockets) {
          for (const sockId of otherSockets) {
            io.to(sockId).emit('call:ended', {
              callId: callLog._id,
              durationSeconds,
            });
          }
        }
      } catch (err) {
        console.error('[Socket] call:end error:', err.message);
      }
    });

    // =======================================================================
    // Disconnect Handler
    // =======================================================================
    socket.on('disconnect', async () => {
      console.log(`[Socket] User disconnected: ${userId} (socket: ${socket.id})`);

      // Remove socket tracking
      const userSockets = connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(userId);
          // User has no more active sockets - mark offline
          await User.findByIdAndUpdate(userId, {
            status: 'offline',
            lastSeen: new Date(),
          });

          // Broadcast offline to contacts
          await broadcastStatus(io, userId, 'offline');
        }
      }
      socketToUser.delete(socket.id);
    });
  });

  return io;
};

// ===========================================================================
// Helper: Check if a user is online
// ===========================================================================
const isUserOnline = (userId) => {
  const sockets = connectedUsers.get(userId);
  return sockets && sockets.size > 0;
};

// ===========================================================================
// Helper: Broadcast user status to their contacts
// ===========================================================================
const broadcastStatus = async (io, userId, status) => {
  try {
    // Find all chats this user participates in
    const chats = await Chat.find({ participants: userId }).select('participants').lean();

    const contactIds = new Set();
    for (const chat of chats) {
      for (const p of chat.participants) {
        const pId = p.toString();
        if (pId !== userId) {
          contactIds.add(pId);
        }
      }
    }

    const lastSeen = status === 'offline' ? new Date() : null;

    for (const contactId of contactIds) {
      const contactSockets = connectedUsers.get(contactId);
      if (contactSockets) {
        const payload = {
          userId,
          status,
          ...(lastSeen && { lastSeen }),
        };
        for (const sockId of contactSockets) {
          io.to(sockId).emit('user:status:update', payload);
        }
      }
    }
  } catch (err) {
    console.error('[Socket] broadcastStatus error:', err.message);
  }
};

module.exports = { initSocketIO, isUserOnline, connectedUsers };