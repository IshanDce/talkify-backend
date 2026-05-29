const { Router } = require('express');
const { sendOtp, verifyOtp, refreshToken } = require('../services/authService');
const rateLimit = require('express-rate-limit');
const config = require('../config');

const router = Router();

// Rate limit OTP requests: 5 per 15 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/send-otp', otpLimiter, sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/refresh', refreshToken);

module.exports = router;