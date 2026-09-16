const express = require('express');
const router = express.Router();
const { users, otpSessions, resetTokens, verifyTokens, normalizeCountryCode } = require('../store/db');
const { generateTokens } = require('../middleware/auth');

// Helper to find user by mobile and optional country code
function findUserByMobile(mobile_number, country_code) {
  const normCC = country_code ? normalizeCountryCode(country_code) : null;
  return Array.from(users.values()).find(u => {
    if (u.mobile_number !== mobile_number) return false;
    if (normCC && u.country_code) {
      return u.country_code === normCC;
    }
    return true;
  });
}

// 1.1 Login
router.post('/login', (req, res) => {
  const { country_code, mobile_number, password } = req.body;

  if (!mobile_number || !password) {
    return res.status(400).json({
      status: false,
      message: "Mobile number and password are required",
      error_code: "INVALID_INPUT"
    });
  }

  const normCC = normalizeCountryCode(country_code);
  let user = findUserByMobile(mobile_number, normCC);

  if (!user) {
    return res.status(404).json({
      status: false,
      message: "Account not found. Please register.",
      error_code: "USER_NOT_FOUND"
    });
  }

  if (user.locked) {
    return res.status(403).json({
      status: false,
      message: "Account temporarily locked due to multiple failed attempts",
      error_code: "ACCOUNT_LOCKED"
    });
  }

  if (user.password !== password) {
    user.failed_attempts = (user.failed_attempts || 0) + 1;
    if (user.failed_attempts >= 5) {
      user.locked = true;
      return res.status(403).json({
        status: false,
        message: "Account temporarily locked due to multiple failed attempts",
        error_code: "ACCOUNT_LOCKED"
      });
    }
    return res.status(400).json({
      status: false,
      message: "Invalid mobile number or password",
      error_code: "INVALID_CREDENTIALS"
    });
  }

  // Reset failed attempts on successful login
  user.failed_attempts = 0;

  const tokens = generateTokens(user.user_id);

  return res.status(200).json({
    status: true,
    message: "Login successful",
    data: {
      user_id: user.user_id,
      name: user.name,
      country_code: user.country_code || normCC,
      mobile_number: user.mobile_number,
      profile_completed: user.profile_completed || false,
      profile_step_pending: user.profile_step_pending || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_in: tokens.token_expires_in
    }
  });
});

// 2.1 Send OTP (Forgot Password)
router.post('/forgot-password/send-otp', (req, res) => {
  const { country_code, mobile_number } = req.body;
  const normCC = normalizeCountryCode(country_code);
  const user = findUserByMobile(mobile_number, normCC);

  if (!user) {
    return res.status(404).json({
      status: false,
      message: "Mobile number not registered",
      error_code: "USER_NOT_FOUND"
    });
  }

  const otp_session_id = `otp_sess_${Math.random().toString(36).substring(2, 8)}`;
  const otp = "4829"; // Mock OTP for testing

  otpSessions.set(otp_session_id, {
    country_code: normCC,
    mobile_number,
    otp,
    type: "forgot_password",
    expires_at: Date.now() + 5 * 60 * 1000 // 5 mins
  });

  return res.status(200).json({
    status: true,
    message: "OTP sent successfully",
    data: {
      otp_session_id,
      otp_expires_in: 300,
      country_code: normCC,
      mobile_number
    }
  });
});

// 2.2 Verify OTP (Forgot Password)
router.post('/forgot-password/verify-otp', (req, res) => {
  const { otp_session_id, otp } = req.body;
  const session = otpSessions.get(otp_session_id);

  if (!session || session.type !== "forgot_password") {
    return res.status(400).json({
      status: false,
      message: "Invalid OTP",
      error_code: "INVALID_OTP"
    });
  }

  if (Date.now() > session.expires_at) {
    otpSessions.delete(otp_session_id);
    return res.status(400).json({
      status: false,
      message: "OTP expired, please resend",
      error_code: "OTP_EXPIRED"
    });
  }

  if (session.otp !== otp && otp !== "4829") {
    return res.status(400).json({
      status: false,
      message: "Invalid OTP",
      error_code: "INVALID_OTP"
    });
  }

  otpSessions.delete(otp_session_id);
  const reset_token = `rst_tok_${Math.random().toString(36).substring(2, 8)}`;
  resetTokens.set(reset_token, {
    country_code: session.country_code,
    mobile_number: session.mobile_number,
    expires_at: Date.now() + 10 * 60 * 1000 // 10 mins
  });

  return res.status(200).json({
    status: true,
    message: "OTP verified",
    data: {
      reset_token,
      reset_token_expires_in: 600
    }
  });
});

// 2.3 Reset Password
router.post('/forgot-password/reset', (req, res) => {
  const { reset_token, new_password, confirm_password } = req.body;

  if (new_password !== confirm_password) {
    return res.status(400).json({
      status: false,
      message: "Passwords do not match",
      error_code: "PASSWORD_MISMATCH"
    });
  }

  const session = resetTokens.get(reset_token);
  if (!session || Date.now() > session.expires_at) {
    if (reset_token) resetTokens.delete(reset_token);
    return res.status(400).json({
      status: false,
      message: "Reset session expired, please try again",
      error_code: "RESET_TOKEN_EXPIRED"
    });
  }

  const user = findUserByMobile(session.mobile_number, session.country_code);
  if (user) {
    user.password = new_password;
    user.locked = false;
    user.failed_attempts = 0;
  }
  resetTokens.delete(reset_token);

  return res.status(200).json({
    status: true,
    message: "Password reset successful. Please login with your new password.",
    data: null
  });
});

// 3.1 Send OTP (Registration)
router.post('/register/send-otp', (req, res) => {
  const { country_code, mobile_number } = req.body;
  const normCC = normalizeCountryCode(country_code);
  const existingUser = findUserByMobile(mobile_number, normCC);

  if (existingUser) {
    return res.status(400).json({
      status: false,
      message: "Mobile number already registered",
      error_code: "MOBILE_ALREADY_EXISTS"
    });
  }

  const otp_session_id = `otp_sess_${Math.random().toString(36).substring(2, 8)}`;
  const otp = "5739";

  otpSessions.set(otp_session_id, {
    country_code: normCC,
    mobile_number,
    otp,
    type: "registration",
    expires_at: Date.now() + 5 * 60 * 1000
  });

  return res.status(200).json({
    status: true,
    message: "OTP sent successfully",
    data: {
      otp_session_id,
      otp_expires_in: 300,
      country_code: normCC,
      mobile_number
    }
  });
});

// 3.2 Verify OTP (Registration)
router.post('/register/verify-otp', (req, res) => {
  const { otp_session_id, otp } = req.body;
  const session = otpSessions.get(otp_session_id);

  if (!session || session.type !== "registration" || Date.now() > session.expires_at) {
    return res.status(400).json({
      status: false,
      message: "Invalid OTP",
      error_code: "INVALID_OTP"
    });
  }

  if (session.otp !== otp && otp !== "5739") {
    return res.status(400).json({
      status: false,
      message: "Invalid OTP",
      error_code: "INVALID_OTP"
    });
  }

  otpSessions.delete(otp_session_id);
  const token = `vtok_${Math.random().toString(36).substring(2, 8)}`;
  verifyTokens.set(token, {
    country_code: session.country_code,
    mobile_number: session.mobile_number,
    expires_at: Date.now() + 30 * 60 * 1000 // 1800s
  });

  return res.status(200).json({
    status: true,
    message: "Mobile number verified",
    data: {
      token,
      verification_token_expires_in: 1800
    }
  });
});

// 3.3 Complete Registration
router.post('/register', (req, res) => {
  const {
    token, name, country_code, mobile_number, email, gender, dob,
    area, city, state, pincode, password, confirm_password
  } = req.body;

  if (password !== confirm_password) {
    return res.status(400).json({
      status: false,
      message: "Passwords do not match",
      error_code: "PASSWORD_MISMATCH"
    });
  }

  const vSession = verifyTokens.get(token);
  if (!vSession || Date.now() > vSession.expires_at) {
    if (token) verifyTokens.delete(token);
    return res.status(400).json({
      status: false,
      message: "Verification session expired. Please verify mobile number again.",
      error_code: "VERIFICATION_TOKEN_EXPIRED"
    });
  }

  const normCC = normalizeCountryCode(country_code || vSession.country_code);

  // Check email existence
  const existingEmail = Array.from(users.values()).find(u => u.email === email);
  if (existingEmail) {
    return res.status(400).json({
      status: false,
      message: "Email already registered",
      error_code: "EMAIL_ALREADY_EXISTS"
    });
  }

  // Check pincode format (digits check)
  if (pincode && !/^\d{4,10}$/.test(pincode)) {
    return res.status(400).json({
      status: false,
      message: "Invalid pincode",
      error_code: "INVALID_PINCODE"
    });
  }

  verifyTokens.delete(token);

  const userId = `usr_${Math.floor(10000 + Math.random() * 90000)}`;
  const newUser = {
    user_id: userId,
    name,
    country_code: normCC,
    mobile_number: mobile_number || vSession.mobile_number,
    email,
    gender,
    dob,
    area,
    city,
    state,
    pincode,
    password,
    profile_completed: false,
    profile_step_pending: "PROFILE_PHOTO",
    failed_attempts: 0,
    locked: false,
    rating: 0.0,
    total_ratings: 0,
    phone_verified: true,
    photos: [],
    aadhar: null,
    about: null,
    availability: null
  };

  users.set(userId, newUser);

  const tokens = generateTokens(userId);

  return res.status(201).json({
    status: true,
    message: "Registration successful",
    data: {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_in: tokens.token_expires_in,
      profile_step_pending: "PROFILE_PHOTO"
    }
  });
});

module.exports = router;
