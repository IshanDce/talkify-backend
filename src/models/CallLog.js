const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    calleeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channelName: {
      type: String,
      required: true,
    },
    callType: {
      type: String,
      enum: ['audio', 'video'],
      default: 'audio',
    },
    status: {
      type: String,
      enum: ['missed', 'incoming', 'outgoing'],
      required: true,
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: Date.now,
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

// Compound indexes for call history queries
callLogSchema.index({ callerId: 1, createdAt: -1 });
callLogSchema.index({ calleeId: 1, createdAt: -1 });

module.exports = mongoose.model('CallLog', callLogSchema);