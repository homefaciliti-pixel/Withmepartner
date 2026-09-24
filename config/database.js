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
 * Initialize / verify Standalone Partner MySQL database connection & dedicated tables
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    const host = process.env.MYSQL_HOST || 'localhost';
    console.log(`[Standalone Partner DB] Verifying database connection on ${host}...`);

    // 1. Dedicated Partner Users Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_users (
        user_id VARCHAR(64) PRIMARY KEY,
        mobile_number VARCHAR(20) UNIQUE NOT NULL,
        country_code VARCHAR(10) DEFAULT '+91',
        name VARCHAR(100),
        email VARCHAR(100),
        gender VARCHAR(20),
        dob VARCHAR(20),
        area VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(100),
        pincode VARCHAR(20),
        password VARCHAR(255),
        profile_completed TINYINT DEFAULT 1,
        rating FLOAT DEFAULT 4.8,
        total_ratings INT DEFAULT 10,
        profile_photo_url TEXT,
        photos JSON,
        aadhar JSON,
        bank_account JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Dedicated Partner OTPs Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mobile_number VARCHAR(20) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        type VARCHAR(50) DEFAULT 'registration',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Dedicated Partner Requests Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_requests (
        request_id VARCHAR(64) PRIMARY KEY,
        booking_id VARCHAR(64),
        name VARCHAR(100),
        interest VARCHAR(100),
        date_time VARCHAR(100),
        location TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Dedicated Partner Bookings Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_bookings (
        booking_id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(100),
        interest VARCHAR(100),
        location TEXT,
        date VARCHAR(50),
        time VARCHAR(50),
        status VARCHAR(50) DEFAULT 'Upcoming',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log(`[Standalone Partner DB] Dedicated partner database tables verified and connected successfully.`);
    return true;
  } catch (err) {
    console.log(`[Standalone Partner DB] External MySQL database disconnected. Operating on local isolated Partner JSON store (store/partner_users.json).`);
    return false;
  }
}

/**
 * Save OTP to `partner_otps` table in dedicated Partner MySQL database
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
      INSERT INTO partner_otps (mobile_number, otp, type, created_at)
      VALUES (?, ?, ?, NOW())
    `;

    await db.query(sql, [cleanMobile, otp, type || 'registration']);
    console.log(`[Partner DB] Saved OTP for ${cleanMobile} in 'partner_otps' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Sync / insert registered partner user into dedicated `partner_users` table
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
    const photoUrl = user.profile_photo_url || (user.photos && user.photos[0] ? user.photos[0].url : null);
    const photosJson = JSON.stringify(user.photos || []);
    const aadharJson = user.aadhar ? JSON.stringify(user.aadhar) : null;
    const bankJson = user.bank_account ? JSON.stringify(user.bank_account) : null;

    const sql = `
      INSERT INTO partner_users (
        user_id, mobile_number, country_code, name, email, gender, dob, area, city, state, pincode,
        password, profile_completed, rating, total_ratings, profile_photo_url, photos, aadhar, bank_account
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name), email = VALUES(email), profile_photo_url = VALUES(profile_photo_url),
        photos = VALUES(photos), aadhar = VALUES(aadhar), bank_account = VALUES(bank_account)
    `;

    await db.query(sql, [
      user.user_id, cleanMobile, cc, name, email, gender, user.dob || '', locality, city, state, user.pincode || '',
      password, user.rating || 4.8, user.total_ratings || 10, photoUrl, photosJson, aadharJson, bankJson
    ]);

    console.log(`[Partner DB] Synced partner ${name} (${cleanMobile}) to dedicated 'partner_users' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch existing partners from dedicated `partner_users` table
 */
async function fetchUsersFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query("SELECT * FROM partner_users ORDER BY created_at DESC LIMIT 500");
    
    return rows.map(r => ({
      user_id: r.user_id,
      name: r.name || 'Partner User',
      country_code: r.country_code || '+91',
      mobile_number: r.mobile_number,
      password: r.password,
      email: r.email || '',
      gender: r.gender || '',
      area: r.area || '',
      city: r.city || '',
      state: r.state || '',
      profile_completed: true,
      profile_step_pending: null,
      rating: parseFloat(r.rating || 4.8),
      total_ratings: r.total_ratings || 10,
      phone_verified: true,
      profile_photo_url: r.profile_photo_url || '/uploads/photos/photo_1.jpg',
      photos: typeof r.photos === 'string' ? JSON.parse(r.photos) : (r.photos || []),
      aadhar: typeof r.aadhar === 'string' ? JSON.parse(r.aadhar) : r.aadhar,
      bank_account: typeof r.bank_account === 'string' ? JSON.parse(r.bank_account) : r.bank_account
    }));
  } catch (err) {
    return null;
  }
}

/**
 * Delete partner user from dedicated `partner_users` table
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

    await db.query("DELETE FROM partner_users WHERE mobile_number = ?", [cleanMobile]);
    console.log(`[Partner DB] Deleted partner (${cleanMobile}) from 'partner_users' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch all pending / incoming partner requests from dedicated `partner_requests` table
 */
async function fetchPartnerRequestsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM partner_requests ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => ({
      request_id: r.request_id,
      booking_id: r.booking_id,
      name: r.name || 'Amit Sharma',
      age: 25,
      image: '/uploads/photos/photo_1.jpg',
      profile_image: '/uploads/photos/photo_1.jpg',
      id_verified: 1,
      selfie_verified: 1,
      interest: r.interest || 'Coffee',
      date_time: r.date_time || '2026-09-25 06:00 PM',
      location: r.location || 'Jaipur',
      status: r.status || 'Pending',
      activity: {
        type: r.interest || 'Coffee',
        date: '2026-09-25',
        time: '06:00 PM',
        area: r.location || 'Jaipur',
        description: 'Meetup request'
      }
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Save / insert partner request into dedicated `partner_requests` table
 */
async function savePartnerRequestToMysql(requestData) {
  try {
    const db = getDbPool();
    const reqId = requestData.request_id || `req_${Date.now()}`;
    const bId = requestData.booking_id || `BK${Date.now()}`;
    const name = requestData.name || 'User';
    const interest = requestData.interest || 'Coffee';
    const dateTime = requestData.date_time || '2026-09-25 06:00 PM';
    const location = requestData.location || 'Jaipur';
    const status = requestData.status || 'Pending';

    await db.query(
      `INSERT INTO partner_requests (request_id, booking_id, name, interest, date_time, location, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [reqId, bId, name, interest, dateTime, location, status]
    );
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Update partner request status in dedicated `partner_requests` table
 */
async function updatePartnerRequestStatusInMysql(requestId, status) {
  try {
    const db = getDbPool();
    await db.query(`UPDATE partner_requests SET status = ? WHERE request_id = ?`, [status, requestId]);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch all upcoming / past bookings from dedicated `partner_bookings` table
 */
async function fetchPartnerBookingsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM partner_bookings ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => ({
      booking_id: r.booking_id,
      name: r.name || 'User',
      profile_image: '/uploads/photos/photo_1.jpg',
      interest: r.interest || 'Coffee',
      location: r.location || 'Jaipur',
      date: r.date || '2026-09-25',
      time: r.time || '06:00 PM',
      status: r.status || 'Upcoming',
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
 * Save partner booking to dedicated `partner_bookings` table
 */
async function savePartnerBookingToMysql(bookingData) {
  try {
    const db = getDbPool();
    const bId = bookingData.booking_id || `BK${Date.now()}`;
    const name = bookingData.name || 'User';
    const interest = bookingData.interest || 'Coffee';
    const location = bookingData.location || 'Jaipur';
    const date = bookingData.date || '2026-09-25';
    const time = bookingData.time || '06:00 PM';
    const status = bookingData.status || 'Upcoming';

    await db.query(
      `INSERT INTO partner_bookings (booking_id, name, interest, location, date, time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [bId, name, interest, location, date, time, status]
    );
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
