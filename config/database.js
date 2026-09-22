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
 * Initialize MySQL tables if not exist
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    console.log(`[MySQL] Initializing database tables on ${process.env.MYSQL_HOST}...`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS node_partner_users (
        user_id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255),
        country_code VARCHAR(20) DEFAULT '+91',
        mobile_number VARCHAR(30),
        password VARCHAR(255),
        email VARCHAR(255),
        gender VARCHAR(50),
        dob VARCHAR(50),
        area VARCHAR(255),
        city VARCHAR(255),
        state VARCHAR(255),
        pincode VARCHAR(20),
        profile_completed TINYINT(1) DEFAULT 0,
        profile_step_pending VARCHAR(100),
        rating DECIMAL(3,2) DEFAULT 0.00,
        total_ratings INT DEFAULT 0,
        phone_verified TINYINT(1) DEFAULT 1,
        profile_photo_url TEXT,
        photos_json JSON,
        aadhar_json JSON,
        about_json JSON,
        availability_json JSON,
        current_location_json JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mobile (mobile_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("[MySQL] Table 'node_partner_users' is ready.");
    return true;
  } catch (err) {
    console.error("[MySQL] Table init failed:", err.message);
    return false;
  }
}

/**
 * Upsert a single user into MySQL database
 */
async function syncUserToMysql(user) {
  try {
    const db = getDbPool();
    const query = `
      INSERT INTO node_partner_users (
        user_id, name, country_code, mobile_number, password, email, gender, dob,
        area, city, state, pincode, profile_completed, profile_step_pending,
        rating, total_ratings, phone_verified, profile_photo_url, photos_json,
        aadhar_json, about_json, availability_json, current_location_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        country_code = VALUES(country_code),
        mobile_number = VALUES(mobile_number),
        password = VALUES(password),
        email = VALUES(email),
        gender = VALUES(gender),
        dob = VALUES(dob),
        area = VALUES(area),
        city = VALUES(city),
        state = VALUES(state),
        pincode = VALUES(pincode),
        profile_completed = VALUES(profile_completed),
        profile_step_pending = VALUES(profile_step_pending),
        rating = VALUES(rating),
        total_ratings = VALUES(total_ratings),
        phone_verified = VALUES(phone_verified),
        profile_photo_url = VALUES(profile_photo_url),
        photos_json = VALUES(photos_json),
        aadhar_json = VALUES(aadhar_json),
        about_json = VALUES(about_json),
        availability_json = VALUES(availability_json),
        current_location_json = VALUES(current_location_json);
    `;

    const values = [
      user.user_id,
      user.name || '',
      user.country_code || '+91',
      user.mobile_number || '',
      user.password || '',
      user.email || '',
      user.gender || '',
      user.dob || '',
      user.area || '',
      user.city || '',
      user.state || '',
      user.pincode || '',
      user.profile_completed ? 1 : 0,
      user.profile_step_pending || null,
      user.rating || 0.0,
      user.total_ratings || 0,
      user.phone_verified ? 1 : 0,
      user.profile_photo_url || null,
      JSON.stringify(user.photos || []),
      JSON.stringify(user.aadhar || null),
      JSON.stringify(user.about || null),
      JSON.stringify(user.availability || null),
      JSON.stringify(user.current_location || null)
    ];

    await db.query(query, values);
  } catch (err) {
    console.error(`[MySQL] Failed to sync user ${user.user_id}:`, err.message);
  }
}

/**
 * Fetch all users from MySQL
 */
async function fetchUsersFromMysql() {
  try {
    const db = getDbPool();
    const [rows] = await db.query("SELECT * FROM node_partner_users");
    return rows.map(r => ({
      user_id: r.user_id,
      name: r.name,
      country_code: r.country_code,
      mobile_number: r.mobile_number,
      password: r.password,
      email: r.email,
      gender: r.gender,
      dob: r.dob,
      area: r.area,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
      profile_completed: Boolean(r.profile_completed),
      profile_step_pending: r.profile_step_pending,
      rating: parseFloat(r.rating || 0),
      total_ratings: r.total_ratings || 0,
      phone_verified: Boolean(r.phone_verified),
      profile_photo_url: r.profile_photo_url,
      photos: typeof r.photos_json === 'string' ? JSON.parse(r.photos_json || '[]') : (r.photos_json || []),
      aadhar: typeof r.aadhar_json === 'string' ? JSON.parse(r.aadhar_json || 'null') : r.aadhar_json,
      about: typeof r.about_json === 'string' ? JSON.parse(r.about_json || 'null') : r.about_json,
      availability: typeof r.availability_json === 'string' ? JSON.parse(r.availability_json || 'null') : r.availability_json,
      current_location: typeof r.current_location_json === 'string' ? JSON.parse(r.current_location_json || 'null') : r.current_location_json
    }));
  } catch (err) {
    console.error("[MySQL] Fetch users failed:", err.message);
    return null;
  }
}

module.exports = {
  getDbPool,
  initMysqlDatabase,
  syncUserToMysql,
  fetchUsersFromMysql
};
