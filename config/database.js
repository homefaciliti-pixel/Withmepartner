require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

function getDbPool() {
  if (!pool) {
    const host = process.env.MYSQL_HOST || 'homefaciliti.com';
    const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
    const user = process.env.MYSQL_USER || 'homef4fw_homefaci';
    const password = process.env.MYSQL_PASSWORD || 'Xnj3*t%F36RDK+!';
    const database = process.env.MYSQL_DATABASE || 'homef4fw_homefaci';

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
 * Initialize / verify dedicated WithMe MySQL database connection & tables
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    const host = process.env.MYSQL_HOST || 'homefaciliti.com';
    console.log(`[WithMe Partner DB] Verifying database connection on ${host}...`);

    // 1. Dedicated withme_partners Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id VARCHAR(50) UNIQUE,
        user_id VARCHAR(50),
        name VARCHAR(150) NOT NULL,
        full_name VARCHAR(150),
        email VARCHAR(150),
        mobile_number VARCHAR(30) UNIQUE,
        phone_number VARCHAR(30),
        country_code VARCHAR(10) DEFAULT '+91',
        password VARCHAR(255),
        gender VARCHAR(20) DEFAULT 'Female',
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
        kyc_status VARCHAR(50) DEFAULT 'VERIFIED',
        is_approved TINYINT(1) DEFAULT 1,
        is_verified TINYINT(1) DEFAULT 1,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Dedicated withme_partner_requests Table
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

    // 3. Dedicated withme_partner_bookings Table
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

    // 4. Dedicated withme_otps Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mobile_number VARCHAR(30),
        otp VARCHAR(10),
        type VARCHAR(50) DEFAULT 'registration',
        purpose VARCHAR(100),
        status VARCHAR(20) DEFAULT '0',
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log(`[WithMe Partner DB] Dedicated WithMe database tables verified and connected successfully.`);
    return true;
  } catch (err) {
    console.log(`[WithMe Partner DB] MySQL connection notice: ${err.message}. Operating with local caching.`);
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
      INSERT INTO withme_otps (mobile_number, otp, type, purpose, status, expires_at, created_at)
      VALUES (?, ?, ?, 'partner_auth', '0', DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW())
    `;

    await db.query(sql, [cleanMobile, otp, type || 'registration']);
    console.log(`[WithMe Partner DB] Saved OTP for ${cleanMobile} in 'withme_otps' table.`);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Sync / insert registered partner user into dedicated `withme_partners` table
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
    const name = (user.name || user.full_name || 'Partner User').trim();
    const email = user.email || '';
    const password = user.password || '';
    const gender = user.gender || 'Female';
    const city = user.city ? user.city.trim() : 'Jaipur';
    const state = user.state ? user.state.trim() : 'Rajasthan';
    const locality = user.area || user.locality || 'Vaishali Nagar';
    const address = user.address || `${locality}, ${city}`;
    const photoUrl = user.profile_photo_url || (user.photos && user.photos[0] ? user.photos[0].url : '/uploads/photos/photo_1.jpg');
    const photosJson = JSON.stringify(user.photos || []);
    
    let aadharNum = '';
    let aadharFront = '';
    let aadharBack = '';
    if (user.aadhar) {
      aadharNum = user.aadhar.aadhar_number || user.aadhar.aadhar_number_encrypted || '';
      aadharFront = user.aadhar.aadhar_front_url || '';
      aadharBack = user.aadhar.aadhar_back_url || '';
    }

    let interestsStr = '["Coffee", "Travel"]';
    if (user.about && user.about.interests) {
      interestsStr = JSON.stringify(user.about.interests);
    }

    let aboutText = user.about ? (user.about.description || user.about) : 'Friendly partner available for meetups.';
    if (typeof aboutText !== 'string') aboutText = JSON.stringify(aboutText);

    const userId = user.user_id || `usr_${Date.now()}`;
    const partnerId = user.partner_id || user.user_id || `usr_${Date.now()}`;

    const sql = `
      INSERT INTO withme_partners (
        partner_id, user_id, name, full_name, email, mobile_number, phone_number, country_code,
        password, gender, age, city, state, locality, address, profile_photo_url, image,
        category, activity, rating, total_reviews, price, currency, about, interests, photos,
        aadhar_number, aadhar_front_url, aadhar_back_url, kyc_status, is_approved, is_verified, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'Coffee', 'Coffee', ?, ?, 1, 'INR', ?, ?, ?,
        ?, ?, ?, 'VERIFIED', 1, 1, 'ACTIVE'
      )
      ON DUPLICATE KEY UPDATE
        name = VALUES(name), full_name = VALUES(full_name), email = VALUES(email),
        profile_photo_url = VALUES(profile_photo_url), image = VALUES(image),
        photos = VALUES(photos), city = VALUES(city), state = VALUES(state),
        locality = VALUES(locality), address = VALUES(address),
        about = VALUES(about), interests = VALUES(interests),
        aadhar_number = VALUES(aadhar_number), aadhar_front_url = VALUES(aadhar_front_url),
        aadhar_back_url = VALUES(aadhar_back_url), is_approved = 1, status = 'ACTIVE'
    `;

    await db.query(sql, [
      partnerId, userId, name, name, email, cleanMobile, cleanMobile, cc,
      password, gender, user.age || 24, city, state, locality, address, photoUrl, photoUrl,
      user.rating || 4.8, user.total_ratings || user.total_reviews || 120, aboutText, interestsStr, photosJson,
      aadharNum, aadharFront, aadharBack
    ]);

    console.log(`[WithMe Partner DB] Synced partner ${name} (${cleanMobile}) to 'withme_partners' table.`);
  } catch (err) {
    console.error(`[WithMe Partner DB] syncUserToMysql error: ${err.message}`);
  }
}

/**
 * Fetch existing partners from dedicated `withme_partners` table
 */
async function fetchUsersFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query("SELECT * FROM withme_partners WHERE is_approved = 1 AND status = 'ACTIVE' ORDER BY id DESC LIMIT 500");
    
    return rows.map(r => {
      let parsedPhotos = [];
      try {
        if (r.photos) parsedPhotos = typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos;
      } catch (e) {}

      let parsedInterests = ['Coffee', 'Travel'];
      try {
        if (r.interests) parsedInterests = typeof r.interests === 'string' ? JSON.parse(r.interests) : r.interests;
      } catch (e) {}

      const photoUrl = r.profile_photo_url || r.image || '/uploads/photos/photo_1.jpg';

      return {
        user_id: r.user_id || r.partner_id || `usr_${r.id}`,
        partner_id: r.partner_id || r.id,
        name: r.name || r.full_name || 'Partner User',
        full_name: r.full_name || r.name || 'Partner User',
        country_code: r.country_code || '+91',
        mobile_number: r.mobile_number || r.phone_number,
        password: r.password,
        email: r.email || '',
        gender: r.gender || 'Female',
        age: r.age || 24,
        area: r.locality || 'Vaishali Nagar',
        city: r.city || 'Jaipur',
        state: r.state || 'Rajasthan',
        profile_completed: true,
        profile_step_pending: null,
        rating: parseFloat(r.rating || 4.8),
        total_ratings: r.total_reviews || 120,
        phone_verified: true,
        profile_photo_url: photoUrl,
        photos: parsedPhotos.length > 0 ? parsedPhotos : [
          { photo_id: "ph_001", url: photoUrl, is_primary: true }
        ],
        aadhar: r.aadhar_number ? {
          aadhar_number: r.aadhar_number,
          aadhar_front_url: r.aadhar_front_url,
          aadhar_back_url: r.aadhar_back_url,
          aadhar_verification_status: "APPROVED"
        } : null,
        about: {
          description: r.about || 'Friendly partner available for meetups.',
          interests: parsedInterests
        },
        availability: {
          available_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          available_time: { from: "10:00 AM", to: "09:00 PM" },
          receive_requests: true,
          availability_status: "Available",
          pricing: [
            { interest: "Coffee", label: "Coffee / Cafe Meetups", price: 1, unit: "per session/2hrs" },
            { interest: "Travel", label: "Travel / Day Out / Trips", price: 699, unit: "per session/24hrs" }
          ],
          platform_commission_percent: 15
        }
      };
    });
  } catch (err) {
    console.error(`[WithMe Partner DB] fetchUsersFromMysql error: ${err.message}`);
    return null;
  }
}

/**
 * Delete partner user from dedicated `withme_partners` table
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
    console.log(`[WithMe Partner DB] Deleted partner (${cleanMobile}) from 'withme_partners' table.`);
  } catch (err) {
    console.error(`[WithMe Partner DB] deleteUserFromMysql error: ${err.message}`);
  }
}

/**
 * Fetch all pending / incoming partner requests from dedicated `withme_partner_requests` table
 */
async function fetchPartnerRequestsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM withme_partner_requests ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => {
      const dateTime = (r.date && r.time) ? `${r.date} ${r.time}` : '2026-09-25 06:00 PM';
      const avatar = r.sender_avatar || '/uploads/photos/photo_1.jpg';
      return {
        request_id: r.request_id || `req_${r.id}`,
        booking_id: r.booking_id || `BK${r.id}`,
        partner_id: r.partner_id,
        user_id: r.user_id,
        name: r.sender_name || 'Amit Sharma',
        sender_name: r.sender_name || 'Amit Sharma',
        age: 25,
        image: avatar,
        profile_image: avatar,
        id_verified: 1,
        selfie_verified: 1,
        interest: r.activity || 'Coffee',
        activity_name: r.activity || 'Coffee',
        date_time: dateTime,
        date: r.date || '2026-09-25',
        time: r.time || '06:00 PM',
        location: r.location || 'Jaipur',
        status: r.status ? (r.status.charAt(0).toUpperCase() + r.status.slice(1).toLowerCase()) : 'Pending',
        activity: {
          type: r.activity || 'Coffee',
          date: r.date || '2026-09-25',
          time: r.time || '06:00 PM',
          area: r.location || 'Jaipur',
          description: r.message || 'Meetup request'
        }
      };
    });
  } catch (err) {
    return [];
  }
}

/**
 * Save / insert partner request into dedicated `withme_partner_requests` table
 */
async function savePartnerRequestToMysql(requestData) {
  try {
    const db = getDbPool();
    const reqId = requestData.request_id || `req_${Date.now()}`;
    const bId = requestData.booking_id || `BK${Date.now()}`;
    const sName = requestData.name || requestData.sender_name || 'Amit';
    const sPhone = requestData.phone_number || requestData.mobile_number || '+917250642635';
    const sAvatar = requestData.image || requestData.profile_image || '/uploads/photos/photo_1.jpg';
    const activity = requestData.interest || requestData.activity_name || 'Coffee';
    const date = requestData.date || '2026-09-25';
    const time = requestData.time || '06:00 PM';
    const location = typeof requestData.location === 'string' ? requestData.location : (requestData.location?.address || 'Jaipur');
    const msg = requestData.message || (requestData.activity && requestData.activity.description) || 'Meetup request';
    const status = (requestData.status || 'PENDING').toUpperCase();

    await db.query(
      `INSERT INTO withme_partner_requests (
        request_id, booking_id, partner_id, user_id, sender_name, sender_phone, sender_avatar,
        activity, date, time, location, message, price, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())
      ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [reqId, bId, requestData.partner_id || '101', requestData.user_id || 'usr_998877', sName, sPhone, sAvatar, activity, date, time, location, msg, status]
    );
  } catch (err) {
    console.error(`[WithMe Partner DB] savePartnerRequestToMysql error: ${err.message}`);
  }
}

/**
 * Update partner request status in dedicated `withme_partner_requests` table
 */
async function updatePartnerRequestStatusInMysql(requestId, status) {
  try {
    const db = getDbPool();
    const cleanStatus = (status || 'PENDING').toUpperCase();
    await db.query(`UPDATE withme_partner_requests SET status = ?, updated_at = NOW() WHERE request_id = ? OR id = ?`, [cleanStatus, requestId, requestId]);
  } catch (err) {
    // Ignore fallback
  }
}

/**
 * Fetch all upcoming / past bookings from dedicated `withme_partner_bookings` table
 */
async function fetchPartnerBookingsFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query(`SELECT * FROM withme_partner_bookings ORDER BY created_at DESC LIMIT 100`);
    return rows.map(r => ({
      booking_id: r.booking_id || `BK${r.id}`,
      name: r.customer_name || 'User',
      profile_image: '/uploads/photos/photo_1.jpg',
      interest: r.activity || 'Coffee',
      location: r.location || 'Jaipur',
      date: r.date || '2026-09-25',
      time: r.time || '06:00 PM',
      status: r.status || 'Upcoming',
      meeting_info: {
        date: r.date || '2026-09-25',
        time: r.time || '06:00 PM',
        location: r.location || 'Jaipur',
        activity: r.activity || 'Coffee'
      }
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Save partner booking to dedicated `withme_partner_bookings` table
 */
async function savePartnerBookingToMysql(bookingData) {
  try {
    const db = getDbPool();
    const bId = bookingData.booking_id || `BK${Date.now()}`;
    const name = bookingData.customer_name || bookingData.name || 'User';
    const phone = bookingData.customer_phone || bookingData.phone_number || '+917250642635';
    const activity = bookingData.activity || bookingData.interest || 'Coffee';
    const location = bookingData.location || 'Jaipur';
    const date = bookingData.date || '2026-09-25';
    const time = bookingData.time || '06:00 PM';
    const status = bookingData.status || 'CONFIRMED';
    const price = bookingData.price || 1;

    await db.query(
      `INSERT INTO withme_partner_bookings (
        booking_id, user_id, partner_id, customer_name, customer_phone,
        activity, date, time, duration, location, price, currency, payment_status, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'INR', 'PAID', ?, NOW())
      ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [bId, bookingData.user_id || 'usr_998877', bookingData.partner_id || '101', name, phone, activity, date, time, location, price, status]
    );
  } catch (err) {
    console.error(`[WithMe Partner DB] savePartnerBookingToMysql error: ${err.message}`);
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
