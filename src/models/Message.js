const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'audio', 'video', 'file'],
      default: 'text',
    },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    // For media messages: ImageKit URLs and metadata
    media: {
      url: { type: String, default: null },
      fileId: { type: String, default: null },
      fileName: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      thumbnailUrl: { type: String, default: null },
    },
    // For quoted/reply messages
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],
    deliveredTo: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        deliveredAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound index for fetching messages by chat, sorted by time
messageSchema.index({ chatId: 1, createdAt: -1 });
// Index for read receipts
messageSchema.index({ chatId: 1, senderId: 1, status: 1 });

module.exports = mongoose.model('Message', messageSchema);