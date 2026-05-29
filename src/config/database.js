const mongoose = require('mongoose');
const config = require('./index');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      // Mongoose 8 uses these defaults, but explicit for clarity
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`[DB] MongoDB connected: ${conn.connection.host}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected. Attempting reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[DB] MongoDB reconnected');
    });

  } catch (error) {
    console.error('[DB] MongoDB connection failed:', error.message);
    // Retry after delay
    setTimeout(() => {
      console.log('[DB] Retrying MongoDB connection...');
      connectDB();
    }, 5000);
  }
};

module.exports = connectDB;