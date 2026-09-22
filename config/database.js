require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

function getDbPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'homefaciliti.com',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'homef4fw_homefaci',
      password: process.env.MYSQL_PASSWORD || 'Xnj3*t%F36RDK+!',
      database: process.env.MYSQL_DATABASE || 'homef4fw_homefaci',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000
    });
  }
  return pool;
}

/**
 * Initialize / verify MySQL database connection
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    console.log(`[MySQL] Verifying database connection on ${process.env.MYSQL_HOST}...`);
    const [rows] = await db.query("SHOW TABLES LIKE 'partners'");
    console.log(`[MySQL] Connection established successfully.`);
    return true;
  } catch (err) {
    console.error("[MySQL] Connection error:", err.message);
    return false;
  }
}

/**
 * Save OTP to `otps` table in MySQL database
 */
async function saveOtpToMysql(mobileNumber, otp, type) {
  try {
    const db = getDbPool();
    let cleanMobile = String(mobileNumber).replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
      cleanMobile = cleanMobile.slice(-10);
    } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
      cleanMobile = cleanMobile.slice(-10);
    }

    const purpose = type === 'registration' ? 'PARTNER_REGISTRATION' : 'PARTNER_PASSWORD_RESET';
    const otpType = type === 'registration' ? 'register_account' : 'forgot_password';

    const sql = `
      INSERT INTO otps (mobile_number, mobile, otp, otp_hash, status, type, purpose, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, '0', ?, ?, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 10 MINUTE))
    `;

    await db.query(sql, [cleanMobile, cleanMobile, otp, otp, otpType, purpose]);
    console.log(`[MySQL] Saved OTP ${otp} for ${cleanMobile} in 'otps' table.`);
  } catch (err) {
    console.error("[MySQL] Failed to save OTP in 'otps' table:", err.message);
  }
}

/**
 * Sync / insert registered partner user into existing MySQL tables: `node_partners` and `partners`
 */
async function syncUserToMysql(user) {
  try {
    const db = getDbPool();
    let cleanMobile = String(user.mobile_number || '').replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
      cleanMobile = cleanMobile.slice(-10);
    } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
      cleanMobile = cleanMobile.slice(-10);
    }

    if (!cleanMobile) return;

    const cc = user.country_code || '+91';
    const name = user.name || 'Partner User';
    const email = user.email || '';
    const password = user.password || '';
    const gender = user.gender || '';
    const city = user.city || '';
    const state = user.state || '';
    const locality = user.area || '';
    const address = `${locality}, ${city}, ${state}`.replace(/^,\s*|,\s*$/g, '');
    const photoUrl = user.profile_photo_url || (user.photos && user.photos[0] ? user.photos[0].url : null);
    const aadharFront = user.aadhar ? user.aadhar.aadhar_front_url : null;
    const aadharBack = user.aadhar ? user.aadhar.aadhar_back_url : null;
    const aadharNum = user.aadhar ? user.aadhar.aadhar_number : null;

    // 1. Sync to node_partners table
    const [existingNp] = await db.query("SELECT id FROM node_partners WHERE mobile = ? OR phone_number = ? LIMIT 1", [cleanMobile, cleanMobile]);

    if (existingNp && existingNp.length > 0) {
      const npId = existingNp[0].id;
      const sqlNpUpdate = `
        UPDATE node_partners SET
          name = ?, email = ?, countryCode = ?, city = ?, state = ?, locality = ?,
          address = ?, image = ?, gender = ?, password = ?, aadharFront = ?, aadharBack = ?, aadhaarNumber = ?
        WHERE id = ?
      `;
      await db.query(sqlNpUpdate, [name, email, cc, city, state, locality, address, photoUrl, gender, password, aadharFront, aadharBack, aadharNum, npId]);
    } else {
      const sqlNpInsert = `
        INSERT INTO node_partners (name, email, mobile, phone_number, countryCode, city, state, locality, address, image, status, isApproved, gender, password, aadharFront, aadharBack, aadhaarNumber, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, DATE_FORMAT(NOW(), '%d/%m/%Y'))
      `;
      await db.query(sqlNpInsert, [name, email, cleanMobile, cleanMobile, cc, city, state, locality, address, photoUrl, gender, password, aadharFront, aadharBack, aadharNum]);
    }

    // 2. Sync to partners table
    const [existingP] = await db.query("SELECT id FROM partners WHERE mobile = ? LIMIT 1", [cleanMobile]);

    if (existingP && existingP.length > 0) {
      const pId = existingP[0].id;
      const sqlPUpdate = `
        UPDATE partners SET
          name = ?, email = ?, city = ?, state = ?, locality = ?, address = ?,
          image = ?, gender = ?, password = ?, aadharFront = ?, aadharBack = ?, aadhaarNumber = ?
        WHERE id = ?
      `;
      await db.query(sqlPUpdate, [name, email, city, state, locality, address, photoUrl, gender, password, aadharFront, aadharBack, aadharNum, pId]);
    } else {
      const sqlPInsert = `
        INSERT INTO partners (name, email, mobile, city, state, locality, address, image, status, isApproved, gender, password, aadharFront, aadharBack, aadhaarNumber, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, DATE_FORMAT(NOW(), '%d/%m/%Y'))
      `;
      await db.query(sqlPInsert, [name, email, cleanMobile, city, state, locality, address, photoUrl, gender, password, aadharFront, aadharBack, aadharNum]);
    }

    console.log(`[MySQL] Synced partner ${name} (${cleanMobile}) to 'node_partners' & 'partners' tables.`);
  } catch (err) {
    console.error(`[MySQL] Sync partner ${user.name} failed:`, err.message);
  }
}

/**
 * Fetch existing partners from MySQL `node_partners` and `partners`
 */
async function fetchUsersFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query("SELECT * FROM node_partners WHERE mobile IS NOT NULL AND mobile != '' ORDER BY id DESC LIMIT 500");
    
    return rows.map(r => ({
      user_id: `usr_${r.id}`,
      name: r.name || 'Partner User',
      country_code: r.countryCode || '+91',
      mobile_number: r.mobile || r.phone_number,
      password: r.password,
      email: r.email || '',
      gender: r.gender || '',
      area: r.locality || '',
      city: r.city || '',
      state: r.state || '',
      profile_completed: true,
      profile_step_pending: null,
      rating: parseFloat(r.rating || 4.5),
      total_ratings: r.totalReviews || 10,
      phone_verified: true,
      profile_photo_url: r.image || '/uploads/photos/photo_1.jpg',
      photos: [
        { photo_id: "ph_001", url: r.image || '/uploads/photos/photo_1.jpg', is_primary: true },
        { photo_id: "ph_002", url: '/uploads/photos/photo_2.jpg', is_primary: false },
        { photo_id: "ph_003", url: '/uploads/photos/photo_3.jpg', is_primary: false },
        { photo_id: "ph_004", url: '/uploads/photos/photo_4.jpg', is_primary: false },
        { photo_id: "ph_005", url: '/uploads/photos/photo_5.jpg', is_primary: false }
      ],
      aadhar: r.aadhaarNumber ? {
        aadhar_number: r.aadhaarNumber,
        aadhar_front_url: r.aadharFront,
        aadhar_back_url: r.aadharBack,
        aadhar_verification_status: "APPROVED"
      } : null
    }));
  } catch (err) {
    console.error("[MySQL] Fetch partners failed:", err.message);
    return null;
  }
}

module.exports = {
  getDbPool,
  initMysqlDatabase,
  saveOtpToMysql,
  syncUserToMysql,
  fetchUsersFromMysql
};
