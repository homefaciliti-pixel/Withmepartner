require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

function getDbPool() {
  if (!pool) {
    const host = process.env.MYSQL_HOST || 'localhost';
    const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
    const user = process.env.MYSQL_USER || 'partner_admin';
    const password = process.env.MYSQL_PASSWORD || 'partner_pass_secure';
    const database = process.env.MYSQL_DATABASE || 'withme_partner_db';

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000
    });
  }
  return pool;
}

/**
 * Initialize / verify Standalone WithMe MySQL database connection & dedicated tables:
 * - withme_partners
 * - withme_partner_requests
 * - withme_partner_bookings
 * - withme_otps
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    const host = process.env.MYSQL_HOST || 'localhost';
    console.log(`[WithMe DB] Verifying database connection on ${host}...`);

    // 1. withme_partners
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id VARCHAR(50) UNIQUE,
        user_id VARCHAR(50) UNIQUE,
        name VARCHAR(150) NOT NULL,
        full_name VARCHAR(150),
        email VARCHAR(150),
        mobile_number VARCHAR(30) UNIQUE,
        phone_number VARCHAR(30),
        country_code VARCHAR(10) DEFAULT '+91',
        password VARCHAR(255),
        gender VARCHAR(20) DEFAULT 'Female',
        dob VARCHAR(20),
        age INT DEFAULT 24,
        city VARCHAR(100) DEFAULT 'Jaipur',
        state VARCHAR(100) DEFAULT 'Rajasthan',
        locality VARCHAR(150) DEFAULT 'Vaishali Nagar',
        address TEXT,
        profile_photo_url TEXT,
        image TEXT,
        category VARCHAR(100) DEFAULT 'Coffee',
        activity VARCHAR(100) DEFAULT 'Coffee',
        rating DECIMAL(3,2) DEFAULT 4.80,
        total_reviews INT DEFAULT 120,
        price INT DEFAULT 1,
        currency VARCHAR(10) DEFAULT 'INR',
        about TEXT,
        interests TEXT,
        photos TEXT,
        available_for TEXT,
        aadhar_number VARCHAR(50),
        aadhar_front_url TEXT,
        aadhar_back_url TEXT,
        bank_account TEXT,
        kyc_status VARCHAR(50) DEFAULT 'VERIFIED',
        is_approved TINYINT(1) DEFAULT 1,
        is_verified TINYINT(1) DEFAULT 1,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. withme_otps
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mobile_number VARCHAR(30),
        otp VARCHAR(10),
        type VARCHAR(50) DEFAULT 'registration',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. withme_partner_requests
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partner_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id VARCHAR(50) UNIQUE,
        booking_id VARCHAR(50),
        user_id VARCHAR(50),
        partner_id VARCHAR(50),
        sender_name VARCHAR(150),
        sender_phone VARCHAR(30),
        sender_avatar TEXT,
        activity VARCHAR(100) DEFAULT 'Coffee',
        date VARCHAR(50),
        time VARCHAR(50),
        location TEXT,
        message TEXT,
        price INT DEFAULT 1,
        status VARCHAR(50) DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. withme_partner_bookings
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partner_bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id VARCHAR(50) UNIQUE,
        user_id VARCHAR(50),
        partner_id VARCHAR(50),
        customer_name VARCHAR(150),
        customer_phone VARCHAR(30),
        activity VARCHAR(100) DEFAULT 'Coffee',
        date VARCHAR(50),
        time VARCHAR(50),
        duration INT DEFAULT 1,
        location TEXT,
        price INT DEFAULT 1,
        currency VARCHAR(10) DEFAULT 'INR',
        payment_status VARCHAR(50) DEFAULT 'PAID',
        status VARCHAR(50) DEFAULT 'CONFIRMED',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure missing columns are dynamically added if table was pre-created
    const alterStatements = [
      'ALTER TABLE withme_partners ADD COLUMN dob VARCHAR(20) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN bank_account TEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_number VARCHAR(50) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_front_url TEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_back_url TEXT DEFAULT NULL'
    ];

    for (const sql of alterStatements) {
      try {
        await db.query(sql);
      } catch (err) {
        // Ignore column already exists warnings
      }
    }

    console.log(`[WithMe DB] Dedicated tables ('withme_partners', 'withme_partner_requests', 'withme_partner_bookings', 'withme_otps') verified and connected successfully.`);
    return true;
  } catch (err) {
    console.log(`[WithMe DB] MySQL connection on ${process.env.MYSQL_HOST || 'localhost'} notice: ${err.message}. Operating on local isolated store.`);
    return false;
  }
}

/**
 * Save OTP to `withme_otps` table
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

    const sql = `
      INSERT INTO withme_otps (mobile_number, otp, type, created_at)
      VALUES (?, ?, ?, NOW())
    `;

    await db.query(sql, [cleanMobile, otp, type || 'registration']);
    console.log(`[WithMe DB] Saved OTP for ${cleanMobile} in 'withme_otps' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Sync / insert registered partner user into `withme_partners` table
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
    const gender = user.gender || 'Female';
    const city = user.city || 'Jaipur';
    const state = user.state || 'Rajasthan';
    const locality = user.area || 'Vaishali Nagar';
    const photoUrl = user.profile_photo_url || (user.photos && user.photos[0] ? user.photos[0].url : null);
    const photosJson = JSON.stringify(user.photos || []);
    const aadharNum = user.aadhar ? user.aadhar.aadhar_number : null;
    const aadharFront = user.aadhar ? user.aadhar.aadhar_front_url : null;
    const aadharBack = user.aadhar ? user.aadhar.aadhar_back_url : null;
    const bankJson = user.bank_account ? JSON.stringify(user.bank_account) : null;

    try {
      const sql = `
        INSERT INTO withme_partners (
          partner_id, user_id, name, full_name, email, mobile_number, phone_number, country_code,
          password, gender, dob, city, state, locality, address, profile_photo_url, image,
          photos, aadhar_number, aadhar_front_url, aadhar_back_url, bank_account, is_approved, is_verified, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE')
        ON DUPLICATE KEY UPDATE
          name = VALUES(name), email = VALUES(email), profile_photo_url = VALUES(profile_photo_url),
          image = VALUES(image), photos = VALUES(photos), aadhar_number = VALUES(aadhar_number),
          aadhar_front_url = VALUES(aadhar_front_url), aadhar_back_url = VALUES(aadhar_back_url),
          bank_account = VALUES(bank_account), updated_at = NOW()
      `;

      await db.query(sql, [
        user.user_id, user.user_id, name, name, email, cleanMobile, cleanMobile, cc,
        password, gender, user.dob || '', city, state, locality, `${locality}, ${city}, ${state}`,
        photoUrl, photoUrl, photosJson, aadharNum, aadharFront, aadharBack, bankJson
      ]);
      console.log(`[WithMe DB] Synced partner ${name} (${cleanMobile}) to 'withme_partners' table.`);
    } catch (sqlErr) {
      const fallbackSql = `
        INSERT INTO withme_partners (
          partner_id, user_id, name, full_name, email, mobile_number, phone_number, country_code,
          password, gender, city, state, locality, address, profile_photo_url, image,
          photos, is_approved, is_verified, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE')
        ON DUPLICATE KEY UPDATE
          name = VALUES(name), email = VALUES(email), profile_photo_url = VALUES(profile_photo_url),
          image = VALUES(image), updated_at = NOW()
      `;
      await db.query(fallbackSql, [
        user.user_id, user.user_id, name, name, email, cleanMobile, cleanMobile, cc,
        password, gender, city, state, locality, `${locality}, ${city}, ${state}`,
        photoUrl, photoUrl, photosJson
      ]);
      console.log(`[WithMe DB] Synced partner ${name} (${cleanMobile}) to 'withme_partners' table (fallback).`);
    }
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch existing partners from `withme_partners` table
 */
async function fetchUsersFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query("SELECT * FROM withme_partners ORDER BY created_at DESC LIMIT 500");
    
    return rows.map(r => ({
      user_id: r.partner_id || r.user_id || (r.id ? `usr_${r.id}` : `usr_${r.mobile_number || r.phone_number}`),
      name: r.name || r.full_name || 'Partner User',
      country_code: r.country_code || '+91',
      mobile_number: r.mobile_number || r.phone_number,
      password: r.password || 'MySecurePass123',
      email: r.email || '',
      gender: r.gender || 'Female',
      dob: r.dob || '2001-05-14',
      area: r.locality || '',
      city: r.city || '',
      state: r.state || '',
      profile_completed: true,
      profile_step_pending: null,
      rating: parseFloat(r.rating || 4.8),
      total_ratings: r.total_reviews || 120,
      phone_verified: true,
      profile_photo_url: r.profile_photo_url || r.image || '/uploads/photos/photo_1.jpg',
      photos: typeof r.photos === 'string' ? (JSON.parse(r.photos || '[]').length > 0 ? JSON.parse(r.photos) : [{ photo_id: "ph_001", url: r.profile_photo_url || "/uploads/photos/photo_1.jpg", is_primary: true }]) : (r.photos || [{ photo_id: "ph_001", url: "/uploads/photos/photo_1.jpg", is_primary: true }]),
      aadhar: r.aadhar_number ? {
        aadhar_number: r.aadhar_number,
        aadhar_front_url: r.aadhar_front_url,
        aadhar_back_url: r.aadhar_back_url,
        aadhar_verification_status: "APPROVED"
      } : null,
      bank_account: typeof r.bank_account === 'string' ? JSON.parse(r.bank_account) : r.bank_account
    }));
  } catch (err) {
    return null;
  }
}

/**
 * Delete partner user from `withme_partners` table
 */
async function deleteUserFromMysql(mobileNumber) {
  try {
    const db = getDbPool();
    let cleanMobile = String(mobileNumber || '').replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
      cleanMobile = cleanMobile.slice(-10);
    } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
      cleanMobile = cleanMobile.slice(-10);
    }
    if (!cleanMobile) return;

    await db.query("DELETE FROM withme_partners WHERE mobile_number = ? OR phone_number = ?", [cleanMobile, cleanMobile]);
    console.log(`[WithMe DB] Deleted partner (${cleanMobile}) from 'withme_partners' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch all pending / incoming partner requests from `withme_partner_requests` table
 */
async function fetchPartnerRequestsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM withme_partner_requests ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => ({
      request_id: r.request_id || `req_${r.id}`,
      booking_id: r.booking_id,
      name: r.sender_name || 'Amit Sharma',
      age: 25,
      image: r.sender_avatar || '/uploads/photos/photo_1.jpg',
      profile_image: r.sender_avatar || '/uploads/photos/photo_1.jpg',
      id_verified: 1,
      selfie_verified: 1,
      interest: r.activity || 'Coffee',
      date_time: `${r.date || '2026-09-25'} ${r.time || '06:00 PM'}`,
      location: r.location || 'Jaipur',
      status: r.status || 'PENDING',
      message: r.message,
      activity: {
        type: r.activity || 'Coffee',
        date: r.date || '2026-09-25',
        time: r.time || '06:00 PM',
        area: r.location || 'Jaipur',
        description: r.message || 'Meetup request'
      }
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Save / insert partner request into `withme_partner_requests` table
 */
async function savePartnerRequestToMysql(requestData) {
  try {
    const db = getDbPool();
    const reqId = requestData.request_id || `req_${Date.now()}`;
    const bId = requestData.booking_id || `BK${Date.now()}`;
    const senderName = requestData.name || requestData.sender_name || 'User';
    const senderPhone = requestData.phone_number || requestData.sender_phone || '+917250642635';
    const senderAvatar = requestData.image || requestData.sender_avatar || '/uploads/photos/photo_1.jpg';
    const userId = requestData.user_id || 'usr_998877';
    const partnerId = requestData.partner_id || '101';
    const activity = requestData.interest || requestData.activity_name || (requestData.activity && requestData.activity.type) || 'Coffee';
    const date = requestData.date || (requestData.activity && requestData.activity.date) || '2026-09-25';
    const time = requestData.time || (requestData.activity && requestData.activity.time) || '06:00 PM';
    const location = requestData.location || (requestData.activity && requestData.activity.area) || 'Jaipur';
    const message = requestData.message || (requestData.activity && requestData.activity.description) || 'Meetup request';
    const status = requestData.status || 'PENDING';

    await db.query(
      `INSERT INTO withme_partner_requests (
        request_id, booking_id, user_id, partner_id, sender_name, sender_phone, sender_avatar,
        activity, date, time, location, message, price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [reqId, bId, userId, partnerId, senderName, senderPhone, senderAvatar, activity, date, time, location, message, status]
    );
    console.log(`[WithMe DB] Saved partner request ${reqId} to 'withme_partner_requests' table.`);
  } catch (err) {
    console.warn("[WithMe DB] Save partner request notice:", err.message);
  }
}

/**
 * Update partner request status in `withme_partner_requests` table
 */
async function updatePartnerRequestStatusInMysql(requestId, status) {
  try {
    const db = getDbPool();
    await db.query(`UPDATE withme_partner_requests SET status = ?, updated_at = NOW() WHERE request_id = ?`, [status, requestId]);
    console.log(`[WithMe DB] Updated partner request ${requestId} status to ${status} in 'withme_partner_requests'.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch all upcoming / past bookings from `withme_partner_bookings` table
 */
async function fetchPartnerBookingsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM withme_partner_bookings ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => ({
      booking_id: r.booking_id,
      name: r.customer_name || 'User',
      profile_image: '/uploads/photos/photo_1.jpg',
      interest: r.activity || 'Coffee',
      location: r.location || 'Jaipur',
      date: r.date || '2026-09-25',
      time: r.time || '06:00 PM',
      status: r.status || 'CONFIRMED',
      meeting_info: {
        date: r.date || '2026-09-25',
        time: r.time || '06:00 PM',
        location: r.location || 'Jaipur',
        activity: r.interest || 'Coffee'
      }
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Save partner booking to `withme_partner_bookings` table
 */
async function savePartnerBookingToMysql(bookingData) {
  try {
    const db = getDbPool();
    const bId = bookingData.booking_id || `BK${Date.now()}`;
    const custName = bookingData.name || bookingData.customer_name || 'User';
    const partnerId = bookingData.partner_id || '101';
    const activity = bookingData.interest || bookingData.activity || 'Coffee';
    const date = bookingData.date || '2026-09-25';
    const time = bookingData.time || '06:00 PM';
    const location = bookingData.location || 'Jaipur';
    const status = bookingData.status || 'CONFIRMED';

    await db.query(
      `INSERT INTO withme_partner_bookings (
        booking_id, user_id, partner_id, customer_name, activity, date, time, location, price, currency, status
      ) VALUES (?, 'usr_998877', ?, ?, ?, ?, ?, ?, 1, 'INR', ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [bId, partnerId, custName, activity, date, time, location, status]
    );
    console.log(`[WithMe DB] Saved partner booking ${bId} to 'withme_partner_bookings' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

module.exports = {
  getDbPool,
  initMysqlDatabase,
  saveOtpToMysql,
  syncUserToMysql,
  fetchUsersFromMysql,
  deleteUserFromMysql,
  fetchPartnerRequestsFromMysql,
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  fetchPartnerBookingsFromMysql,
  savePartnerBookingToMysql
};
