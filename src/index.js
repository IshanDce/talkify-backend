const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const config = require('./config');
const connectDB = require('./config/database');
const { initFirebase } = require('./config/firebase');
const { initSocketIO } = require('./socket');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const mediaRoutes = require('./routes/media');
const callRoutes = require('./routes/calls');

// =========================================================================
// Initialize Express
// =========================================================================
const app = express();
const server = http.createServer(app);

// =========================================================================
// Global Middleware
// =========================================================================

// Security headers
app.use(helmet());

// Compression middleware for faster transfers
app.use(compression({
  filter: (req, res) => {
    // Don't compress if the request is for file upload
    if (req.path === '/api/media/upload') {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses larger than 1KB
}));

// CORS
app.use(
  cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Increase limits for media uploads specifically
app.use('/api/media/upload', express.json({ limit: '100mb' }));
app.use('/api/media/upload', express.urlencoded({ extended: true, limit: '100mb' }));

// Request logging
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// =========================================================================
// Health Check
// =========================================================================
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'talkify-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// =========================================================================
// API Routes
// =========================================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/calls', callRoutes);

// =========================================================================
// Multer Error Handler (must be AFTER routes)
// =========================================================================
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 100 MB limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Unexpected file field: ${err.field}` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message && err.message.startsWith('Invalid image type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// =========================================================================
// 404 Handler
// =========================================================================
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// =========================================================================
// Error Handler
// =========================================================================
app.use(errorHandler);

// =========================================================================
// Initialize Services and Start Server
// =========================================================================
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize Firebase Admin SDK
    initFirebase();

    // Initialize Socket.io
    const io = initSocketIO(server);
    console.log('[Socket] Socket.io initialized');

    // Start listening
    server.listen(config.port, config.host, () => {
      console.log('='.repeat(55));
      console.log(`  🎙️  Talkify Backend Server`);
      console.log(`  📡 Environment : ${config.nodeEnv}`);
      console.log(`  🌐 Host        : ${config.host}:${config.port}`);
      console.log(`  🗄️  MongoDB     : ${config.mongodbUri}`);
      console.log(`  🔌 WebSocket   : ws://${config.host}:${config.port}`);
      console.log('='.repeat(55));
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);

      // Close Socket.io
      io.close(() => {
        console.log('[Socket] Socket.io closed');
      });

      // Close HTTP server
      server.close(async () => {
        console.log('[Server] HTTP server closed');

        // Close MongoDB connection
        const mongoose = require('mongoose');
        await mongoose.connection.close(false);
        console.log('[DB] MongoDB connection closed');

        process.exit(0);
      });

      // Force shutdown after 10s
      setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;