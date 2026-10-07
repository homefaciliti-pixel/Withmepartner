const fs = require('fs');
const path = require('path');
const {
  initMysqlDatabase,
  syncUserToMysql,
  fetchUsersFromMysql,
  fetchPartnerRequestsFromMysql,
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  fetchPartnerBookingsFromMysql,
  savePartnerBookingToMysql
} = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// EPHEMERAL IN-MEMORY STORES (safe — these are session-scoped and short-lived)
// ─────────────────────────────────────────────────────────────────────────────
const otpSessions = new Map();   // session_id -> { mobile_number, country_code, type, otp, expires_at }
const resetTokens = new Map();   // reset_token -> { mobile_number, country_code, expires_at }
const verifyTokens = new Map();  // token -> { mobile_number, country_code, expires_at }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCountryCode(cc) {
  if (!cc) return '+91';
  let clean = cc.trim();
  if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

function normalizePhoneDigits(num) {
  if (!num) return '';
  let clean = String(num).replace(/\D/g, '');
  if (clean.length > 10 && clean.startsWith('91')) clean = clean.slice(-10);
  else if (clean.length === 11 && clean.startsWith('0')) clean = clean.slice(-10);
  return clean;
}

// Dynamic Base URL Helper
function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  if (req && req.get) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:5000';
    return `${protocol}://${host}`;
  }
  return process.env.RENDER_EXTERNAL_URL || 'https://withmepartner.onrender.com';
}

// Format photo URL to full absolute URL
function formatPhotoUrl(urlOrPath, req) {
  if (!urlOrPath) return '';
  const baseUrl = getBaseUrl(req);

  if (urlOrPath.includes('cdn.yourdomain.com')) {
    const match = urlOrPath.match(/ph_00(\d)/);
    if (match) return `${baseUrl}/uploads/photos/photo_${match[1]}.jpg`;
    return `${baseUrl}/uploads/photos/photo_1.jpg`;
  }

  let formatted = urlOrPath;
  if (formatted.includes('localhost:5000')) {
    formatted = formatted.replace(/https?:\/\/localhost:5000/, baseUrl);
  } else if (formatted.includes('withmepartner.onrender.com')) {
    formatted = formatted.replace(/https?:\/\/withmepartner\.onrender\.com/, baseUrl);
  } else if (formatted.startsWith('/uploads')) {
    formatted = `${baseUrl}${formatted}`;
  } else if (formatted.startsWith('uploads/')) {
    formatted = `${baseUrl}/${formatted}`;
  }

  if (formatted.startsWith(`${baseUrl}/uploads/`)) {
    const relPath = formatted.substring(baseUrl.length);
    const diskPath = path.join(__dirname, '..', relPath);
    if (!fs.existsSync(diskPath)) {
      return `${baseUrl}/uploads/photos/photo_1.jpg`;
    }
  }

  return formatted;
}

// Default photo constants (used in profile upload fallbacks)
const PHOTO_1 = '/uploads/photos/photo_1.jpg';
const PHOTO_2 = '/uploads/photos/photo_2.jpg';
const PHOTO_3 = '/uploads/photos/photo_3.jpg';
const PHOTO_4 = '/uploads/photos/photo_4.jpg';
const PHOTO_5 = '/uploads/photos/photo_5.jpg';

const DEFAULT_PHOTOS = [
  { photo_id: 'ph_001', url: PHOTO_1, is_primary: true },
  { photo_id: 'ph_002', url: PHOTO_2, is_primary: false },
  { photo_id: 'ph_003', url: PHOTO_3, is_primary: false },
  { photo_id: 'ph_004', url: PHOTO_4, is_primary: false },
  { photo_id: 'ph_005', url: PHOTO_5, is_primary: false }
];

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    await initMysqlDatabase();
    console.log('[Store] MySQL database initialized and tables verified.');
  } catch (err) {
    console.error('[Store] Error initializing MySQL database:', err.message);
  }
}

// Perform initial DB setup on startup
loadUsers();

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  // Ephemeral session stores (in-memory only — intentional)
  otpSessions,
  resetTokens,
  verifyTokens,

  // Helpers
  normalizeCountryCode,
  normalizePhoneDigits,
  getBaseUrl,
  formatPhotoUrl,
  loadUsers,

  // Photo constants
  PHOTO_1,
  PHOTO_2,
  PHOTO_3,
  PHOTO_4,
  PHOTO_5,
  DEFAULT_PHOTOS,

  // MySQL pass-throughs (re-exported for backwards compat with routes that import from store/db)
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  savePartnerBookingToMysql
};
