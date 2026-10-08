require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

/**
 * Obtain or initialize MySQL Connection Pool
 * Supports both DB_* and MYSQL_* environment variable prefixes
 */
function getDbPool() {
  if (!pool) {
    const host = process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10);
    const user = process.env.DB_USER || process.env.MYSQL_USER || 'partner_admin';
    const password = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || 'partner_pass_secure';
    const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'withme_partner_db';

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 15,
      queueLimit: 0,
      connectTimeout: 2000
    });
  }
  return pool;
}

/**
 * Initialize / verify Standalone WithMe MySQL database connection & dedicated tables
 */
async function initMysqlDatabase() {
  try {
    const db = getDbPool();
    const host = process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost';
    console.log(`[WithMe DB] Verifying database connection on ${host}...`);

    // 1. withme_partners
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id VARCHAR(50) NOT NULL UNIQUE,
        user_id VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        full_name VARCHAR(150),
        email VARCHAR(150),
        mobile_number VARCHAR(30) NOT NULL UNIQUE,
        phone_number VARCHAR(30),
        country_code VARCHAR(10) DEFAULT '+91',
        password VARCHAR(255) NOT NULL,
        gender VARCHAR(20) DEFAULT 'Female',
        dob VARCHAR(20),
        age INT DEFAULT 24,
        city VARCHAR(100) DEFAULT 'Jaipur',
        state VARCHAR(100) DEFAULT 'Rajasthan',
        locality VARCHAR(150) DEFAULT 'Vaishali Nagar',
        address TEXT,
        latitude DECIMAL(10, 7) DEFAULT NULL,
        longitude DECIMAL(10, 7) DEFAULT NULL,
        profile_photo_url TEXT,
        image TEXT,
        photos LONGTEXT,
        category VARCHAR(100) DEFAULT 'Coffee',
        activity VARCHAR(100) DEFAULT 'Coffee',
        interests LONGTEXT,
        categories LONGTEXT,
        rating DECIMAL(3,2) DEFAULT 4.80,
        total_reviews INT DEFAULT 0,
        price INT DEFAULT 1,
        price_type VARCHAR(50) DEFAULT 'per session/2hrs',
        currency VARCHAR(10) DEFAULT 'INR',
        pricing LONGTEXT,
        about LONGTEXT,
        available_days LONGTEXT,
        available_from VARCHAR(50) DEFAULT '10:00 AM',
        available_to VARCHAR(50) DEFAULT '09:00 PM',
        availability_status VARCHAR(50) DEFAULT 'Available',
        receive_requests TINYINT(1) DEFAULT 1,
        availability LONGTEXT,
        aadhar_number VARCHAR(50),
        aadhar_front_url TEXT,
        aadhar_back_url TEXT,
        bank_account LONGTEXT,
        withdrawals LONGTEXT,
        fcm_token TEXT,
        kyc_status VARCHAR(50) DEFAULT 'VERIFIED',
        is_approved TINYINT(1) DEFAULT 1,
        is_verified TINYINT(1) DEFAULT 1,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mobile (mobile_number),
        INDEX idx_city (city),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. withme_otps
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mobile_number VARCHAR(30) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        type VARCHAR(50) DEFAULT 'registration',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mobile_type (mobile_number, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. withme_partner_requests
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partner_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id VARCHAR(50) NOT NULL UNIQUE,
        booking_id VARCHAR(50),
        user_id VARCHAR(50),
        partner_id VARCHAR(50) NOT NULL,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_partner_status (partner_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. withme_partner_bookings
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partner_bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL UNIQUE,
        user_id VARCHAR(50),
        partner_id VARCHAR(50) NOT NULL,
        customer_name VARCHAR(150),
        customer_phone VARCHAR(30),
        profile_image TEXT,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_partner_booking (partner_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. withme_partner_transactions
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_partner_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL UNIQUE,
        partner_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(50),
        location TEXT,
        date VARCHAR(50),
        time VARCHAR(50),
        earn_money INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Complete',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_partner_tx (partner_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. conversations
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        type ENUM('private') DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. conversation_members
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_members (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        conversation_id BIGINT UNSIGNED NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_member (conversation_id, user_id),
        INDEX idx_user (user_id),
        INDEX idx_conversation (conversation_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. messages
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        conversation_id BIGINT UNSIGNED NOT NULL,
        sender_id VARCHAR(100) NOT NULL,
        receiver_id VARCHAR(100) NOT NULL,
        message_type ENUM('text') DEFAULT 'text',
        message TEXT NOT NULL,
        is_delivered TINYINT(1) DEFAULT 0,
        is_read TINYINT(1) DEFAULT 0,
        is_deleted TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_conversation_created (conversation_id, created_at),
        INDEX idx_receiver_read (receiver_id, is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 9. user_blocks
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_blocks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        blocker_id VARCHAR(100) NOT NULL,
        blocked_id VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (blocker_id, blocked_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 10. withme_notifications
    await db.query(`
      CREATE TABLE IF NOT EXISTS withme_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        notification_id VARCHAR(50) NOT NULL UNIQUE,
        user_id VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        data_payload TEXT,
        is_read TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_read (user_id, is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure missing columns are dynamically added if table was pre-created
    const alterStatements = [
      'ALTER TABLE withme_partners ADD COLUMN dob VARCHAR(20) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN latitude DECIMAL(10, 7) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN longitude DECIMAL(10, 7) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN interests LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN categories LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN pricing LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN availability LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN bank_account LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN withdrawals LONGTEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_number VARCHAR(50) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_front_url TEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN aadhar_back_url TEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN fcm_token TEXT DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN failed_attempts INT DEFAULT 0',
      'ALTER TABLE withme_partners ADD COLUMN locked TINYINT(1) DEFAULT 0',
      'ALTER TABLE withme_partners ADD COLUMN profile_step_pending VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE withme_partners ADD COLUMN profile_completed TINYINT(1) DEFAULT 0',
      'ALTER TABLE withme_partners ADD COLUMN pincode VARCHAR(20) DEFAULT NULL'
    ];

    for (const sql of alterStatements) {
      try {
        await db.query(sql);
      } catch (err) {
        // Ignore column already exists warnings
      }
    }

    console.log(`[WithMe DB] Dedicated MySQL tables verified and connected successfully.`);
    return true;
  } catch (err) {
    console.warn(`[WithMe DB] MySQL connection notice: ${err.message}.`);
    return false;
  }
}

/**
 * Format partner object from raw MySQL row
 */
function mapMysqlRowToPartner(r) {
  if (!r) return null;

  let photos = [];
  try {
    if (r.photos) {
      photos = typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos;
    }
  } catch (e) {}

  if (!Array.isArray(photos)) {
    photos = [];
  }

  const profilePhoto = r.profile_photo_url || r.image || '';

  if (photos.length === 0 && profilePhoto) {
    photos = [
      {
        photo_id: "ph_001",
        url: profilePhoto,
        is_primary: true
      }
    ];
  }

  let interests = [];
  try {
    if (r.interests) {
      interests = typeof r.interests === 'string' ? JSON.parse(r.interests) : r.interests;
    }
  } catch (e) {}

  let categories = [];
  try {
    if (r.categories) {
      categories = typeof r.categories === 'string' ? JSON.parse(r.categories) : r.categories;
    }
  } catch (e) {}

  let pricing = [];
  try {
    if (r.pricing) {
      pricing = typeof r.pricing === 'string' ? JSON.parse(r.pricing) : r.pricing;
    }
  } catch (e) {}

  let aboutObj = null;
  try {
    if (r.about) {
      aboutObj = typeof r.about === 'string' ? JSON.parse(r.about) : r.about;
    }
  } catch (e) {}
  if (!aboutObj) {
    aboutObj = {
      description: (typeof r.about === 'string' && !r.about.startsWith('{')) ? r.about : `Hi! I am ${r.name || 'a partner'}.`,
      interests: interests.length > 0 ? interests : [r.category || 'Coffee']
    };
  }

  let availabilityObj = null;
  try {
    if (r.availability) {
      availabilityObj = typeof r.availability === 'string' ? JSON.parse(r.availability) : r.availability;
    }
  } catch (e) {}
  if (!availabilityObj) {
    availabilityObj = {
      available_days: r.available_days ? (typeof r.available_days === 'string' ? JSON.parse(r.available_days) : r.available_days) : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      available_time: { from: r.available_from || "10:00 AM", to: r.available_to || "09:00 PM" },
      receive_requests: r.receive_requests !== undefined ? Boolean(r.receive_requests) : true,
      availability_status: r.availability_status || "Available",
      pricing: pricing.length > 0 ? pricing : [
        { interest: r.category || 'Coffee', label: `${r.category || 'Coffee'} Meetups`, price: r.price || 1, unit: r.price_type || 'per session/2hrs' }
      ],
      platform_commission_percent: 15
    };
  }

  let withdrawalsObj = [];
  try {
    if (r.withdrawals) {
      withdrawalsObj = typeof r.withdrawals === 'string' ? JSON.parse(r.withdrawals) : r.withdrawals;
    }
  } catch (e) {}

  let bankAccountObj = null;
  try {
    if (r.bank_account) {
      bankAccountObj = typeof r.bank_account === 'string' ? JSON.parse(r.bank_account) : r.bank_account;
    }
  } catch (e) {}

  let currentLocationObj = null;
  if (r.latitude !== null && r.longitude !== null && r.latitude !== undefined && r.longitude !== undefined) {
    currentLocationObj = {
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      address: r.address || `${r.locality || ''}, ${r.city || ''}`,
      updated_at: r.updated_at || new Date().toISOString()
    };
  }

  const pId = r.partner_id || r.user_id || `usr_${r.id}`;

  return {
    user_id: pId,
    partner_id: pId,
    id: pId,
    name: r.name || r.full_name || 'Partner User',
    full_name: r.name || r.full_name || 'Partner User',
    country_code: r.country_code || '+91',
    mobile_number: r.mobile_number || r.phone_number,
    phone_number: r.mobile_number || r.phone_number,
    password: r.password || '',
    email: r.email || '',
    gender: r.gender || 'Female',
    dob: r.dob || '',
    age: r.age || 24,
    area: r.locality || '',
    locality: r.locality || '',
    city: r.city || '',
    state: r.state || '',
    pincode: r.pincode || '',
    address: r.address || `${r.locality || ''}, ${r.city || ''}`,
    current_location: currentLocationObj,
    profile_completed: Boolean(r.profile_completed),
    profile_step_pending: r.profile_step_pending || null,
    failed_attempts: r.failed_attempts || 0,
    locked: Boolean(r.locked),
    rating: parseFloat(r.rating || 0),
    total_ratings: r.total_reviews || 0,
    total_reviews: r.total_reviews || 0,
    phone_verified: true,
    profile_photo_url: r.profile_photo_url || r.image || '',
    image: r.profile_photo_url || r.image || '',
    photos: photos,
    category: r.category || 'Coffee',
    activity: r.activity || 'Coffee',
    interests: interests,
    categories: categories,
    price: r.price || 1,
    currency: r.currency || 'INR',
    about: aboutObj,
    availability: availabilityObj,
    withdrawals: withdrawalsObj,
    bank_account: bankAccountObj,
    aadhar: r.aadhar_number ? {
      aadhar_number: r.aadhar_number,
      aadhar_front_url: r.aadhar_front_url,
      aadhar_back_url: r.aadhar_back_url,
      aadhar_verification_status: 'APPROVED'
    } : null,
    fcm_token: r.fcm_token || null,
    is_approved: Boolean(r.is_approved !== undefined ? r.is_approved : 1),
    is_verified: Boolean(r.is_verified !== undefined ? r.is_verified : 1),
    status: r.status || 'ACTIVE',
    created_at: r.created_at || new Date().toISOString()
  };
}

/**
 * Fetch all matching partners from MySQL database
 */
async function fetchUsersFromMysql(filter = {}) {
  const db = getDbPool();
  let sql = "SELECT * FROM withme_partners WHERE 1=1";
  const params = [];

  if (filter.status) {
    sql += " AND status = ?";
    params.push(filter.status);
  } else {
    sql += " AND status = 'ACTIVE'";
  }

  if (filter.city) {
    sql += " AND LOWER(city) = LOWER(?)";
    params.push(filter.city);
  }

  if (filter.category) {
    sql += " AND (LOWER(category) = LOWER(?) OR LOWER(activity) = LOWER(?) OR interests LIKE ?)";
    params.push(filter.category, filter.category, `%${filter.category}%`);
  }

  if (filter.query) {
    const q = `%${filter.query.toLowerCase()}%`;
    sql += " AND (LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(locality) LIKE ? OR LOWER(interests) LIKE ? OR LOWER(category) LIKE ?)";
    params.push(q, q, q, q, q);
  }

  sql += " ORDER BY created_at DESC";

  if (filter.limit) {
    sql += " LIMIT ?";
    params.push(parseInt(filter.limit, 10));
  } else {
    sql += " LIMIT 500";
  }

  const [rows] = await db.query(sql, params);
  return rows.map(mapMysqlRowToPartner);
}

/**
 * Find single partner by ID in MySQL
 */
async function findPartnerByIdFromMysql(userId) {
  if (!userId) return null;
  const db = getDbPool();
  const [rows] = await db.query(
    "SELECT * FROM withme_partners WHERE partner_id = ? OR user_id = ? LIMIT 1",
    [String(userId), String(userId)]
  );
  if (rows.length === 0) return null;
  return mapMysqlRowToPartner(rows[0]);
}

/**
 * Find single partner by Mobile Number in MySQL
 */
async function findPartnerByMobileFromMysql(mobileNumber, countryCode) {
  if (!mobileNumber) return null;
  const db = getDbPool();
  let cleanMobile = String(mobileNumber).replace(/\D/g, '');
  if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(-10);
  } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
    cleanMobile = cleanMobile.slice(-10);
  }

  const [rows] = await db.query(
    "SELECT * FROM withme_partners WHERE mobile_number = ? OR phone_number = ? LIMIT 1",
    [cleanMobile, cleanMobile]
  );
  if (rows.length === 0) return null;
  return mapMysqlRowToPartner(rows[0]);
}

/**
 * Find single partner by Email in MySQL
 */
async function findPartnerByEmailFromMysql(email) {
  if (!email) return null;
  const db = getDbPool();
  const [rows] = await db.query(
    "SELECT * FROM withme_partners WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [String(email).trim()]
  );
  if (rows.length === 0) return null;
  return mapMysqlRowToPartner(rows[0]);
}

/**
 * Insert new partner into MySQL database
 */
async function createPartnerInMysql(user) {
  const db = getDbPool();
  let cleanMobile = String(user.mobile_number || '').replace(/\D/g, '');
  if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(-10);
  } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
    cleanMobile = cleanMobile.slice(-10);
  }

  const pId = user.user_id || user.partner_id || `usr_${cleanMobile}`;
  const cc = user.country_code || '+91';
  const name = user.name || 'Partner User';
  const email = user.email || '';
  const password = user.password || '';
  const gender = user.gender || 'Female';
  const dob = user.dob || '';
  const city = user.city || '';
  const state = user.state || '';
  const locality = user.area || user.locality || '';
  const pincode = user.pincode || '';
  const address = user.address || `${locality}, ${city}, ${state}`;
  const photoUrl = user.profile_photo_url || (user.photos && user.photos[0] ? user.photos[0].url : '');
  const photosJson = JSON.stringify(user.photos || []);
  const interestsJson = JSON.stringify((user.about && user.about.interests) || user.interests || []);
  const aboutJson = user.about ? JSON.stringify(user.about) : null;
  const availJson = user.availability ? JSON.stringify(user.availability) : null;
  const profileStepPending = user.profile_step_pending || 'PROFILE_PHOTO';
  const profileCompleted = user.profile_completed ? 1 : 0;

  const sql = `
    INSERT INTO withme_partners (
      partner_id, user_id, name, full_name, email, mobile_number, phone_number, country_code,
      password, gender, dob, city, state, locality, pincode, address, profile_photo_url, image,
      photos, interests, about, availability, profile_step_pending, profile_completed,
      failed_attempts, locked, is_approved, is_verified, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 1, 'ACTIVE', NOW(), NOW())
  `;

  await db.query(sql, [
    pId, pId, name, name, email, cleanMobile, cleanMobile, cc,
    password, gender, dob, city, state, locality, pincode, address, photoUrl, photoUrl,
    photosJson, interestsJson, aboutJson, availJson, profileStepPending, profileCompleted
  ]);

  console.log(`[WithMe DB] Created partner ${name} (${pId}) in MySQL 'withme_partners'.`);
  return await findPartnerByIdFromMysql(pId);
}

/**
 * Update partner fields in MySQL database
 */
async function updatePartnerInMysql(userId, fields = {}) {
  const db = getDbPool();
  const pId = String(userId);

  const setClauses = [];
  const params = [];

  if (fields.name) {
    setClauses.push("name = ?", "full_name = ?");
    params.push(fields.name, fields.name);
  }
  if (fields.email) {
    setClauses.push("email = ?");
    params.push(fields.email);
  }
  if (fields.password) {
    setClauses.push("password = ?");
    params.push(fields.password);
  }
  if (fields.gender) {
    setClauses.push("gender = ?");
    params.push(fields.gender);
  }
  if (fields.dob) {
    setClauses.push("dob = ?");
    params.push(fields.dob);
  }
  if (fields.city) {
    setClauses.push("city = ?");
    params.push(fields.city);
  }
  if (fields.state) {
    setClauses.push("state = ?");
    params.push(fields.state);
  }
  if (fields.area || fields.locality) {
    setClauses.push("locality = ?");
    params.push(fields.area || fields.locality);
  }
  if (fields.address) {
    setClauses.push("address = ?");
    params.push(fields.address);
  }
  if (fields.latitude !== undefined && fields.latitude !== null) {
    setClauses.push("latitude = ?");
    params.push(parseFloat(fields.latitude));
  }
  if (fields.longitude !== undefined && fields.longitude !== null) {
    setClauses.push("longitude = ?");
    params.push(parseFloat(fields.longitude));
  }
  if (fields.profile_photo_url || fields.image) {
    const pUrl = fields.profile_photo_url || fields.image;
    setClauses.push("profile_photo_url = ?", "image = ?");
    params.push(pUrl, pUrl);
  }
  if (fields.photos) {
    setClauses.push("photos = ?");
    params.push(typeof fields.photos === 'string' ? fields.photos : JSON.stringify(fields.photos));
  }
  if (fields.about) {
    setClauses.push("about = ?");
    params.push(typeof fields.about === 'string' ? fields.about : JSON.stringify(fields.about));
  }
  if (fields.interests) {
    setClauses.push("interests = ?");
    params.push(typeof fields.interests === 'string' ? fields.interests : JSON.stringify(fields.interests));
  }
  if (fields.availability) {
    setClauses.push("availability = ?");
    params.push(typeof fields.availability === 'string' ? fields.availability : JSON.stringify(fields.availability));
  }
  if (fields.bank_account) {
    setClauses.push("bank_account = ?");
    params.push(typeof fields.bank_account === 'string' ? fields.bank_account : JSON.stringify(fields.bank_account));
  }
  if (fields.withdrawals) {
    setClauses.push("withdrawals = ?");
    params.push(typeof fields.withdrawals === 'string' ? fields.withdrawals : JSON.stringify(fields.withdrawals));
  }
  if (fields.aadhar) {
    if (fields.aadhar.aadhar_number) {
      setClauses.push("aadhar_number = ?");
      params.push(fields.aadhar.aadhar_number);
    }
    if (fields.aadhar.aadhar_front_url) {
      setClauses.push("aadhar_front_url = ?");
      params.push(fields.aadhar.aadhar_front_url);
    }
    if (fields.aadhar.aadhar_back_url) {
      setClauses.push("aadhar_back_url = ?");
      params.push(fields.aadhar.aadhar_back_url);
    }
  }
  if (fields.failed_attempts !== undefined) {
    setClauses.push("failed_attempts = ?");
    params.push(Number(fields.failed_attempts));
  }
  if (fields.locked !== undefined) {
    setClauses.push("locked = ?");
    params.push(fields.locked ? 1 : 0);
  }
  if (fields.profile_step_pending !== undefined) {
    setClauses.push("profile_step_pending = ?");
    params.push(fields.profile_step_pending);
  }
  if (fields.profile_completed !== undefined) {
    setClauses.push("profile_completed = ?");
    params.push(fields.profile_completed ? 1 : 0);
  }
  if (fields.pincode) {
    setClauses.push("pincode = ?");
    params.push(fields.pincode);
  }
  if (fields.fcm_token !== undefined) {
    setClauses.push("fcm_token = ?");
    params.push(fields.fcm_token);
  }

  setClauses.push("updated_at = NOW()");

  if (setClauses.length === 1) return await findPartnerByIdFromMysql(pId);

  const sql = `UPDATE withme_partners SET ${setClauses.join(', ')} WHERE partner_id = ? OR user_id = ?`;
  params.push(pId, pId);

  await db.query(sql, params);
  console.log(`[WithMe DB] Updated partner ${pId} in MySQL.`);
  return await findPartnerByIdFromMysql(pId);
}

/**
 * Delete partner user from `withme_partners` table
 */
async function deleteUserFromMysql(mobileNumber) {
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
}

/**
 * Save OTP to `withme_otps` table
 */
async function saveOtpToMysql(mobileNumber, otp, type) {
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
}

/**
 * Verify OTP from `withme_otps` table
 */
async function verifyOtpFromMysql(mobileNumber, otp, type) {
  const db = getDbPool();
  let cleanMobile = String(mobileNumber).replace(/\D/g, '');
  if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(-10);
  } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
    cleanMobile = cleanMobile.slice(-10);
  }

  const [rows] = await db.query(
    "SELECT * FROM withme_otps WHERE mobile_number = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
    [cleanMobile, type || 'registration']
  );

  if (rows.length === 0) return false;
  return rows[0].otp === String(otp).trim();
}

/**
 * Fetch partner requests for specific partnerId from `withme_partner_requests` table
 */
async function fetchPartnerRequestsFromMysql(partnerId) {
  const db = getDbPool();
  let sql = "SELECT * FROM withme_partner_requests";
  const params = [];

  if (partnerId) {
    const pId = String(partnerId);
    let cleanMobile = pId.replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) cleanMobile = cleanMobile.slice(-10);
    else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(-10);

    sql += " WHERE (partner_id = ? OR partner_id = ? OR partner_id IN (SELECT user_id FROM withme_partners WHERE mobile_number = ? OR phone_number = ? OR partner_id = ?))";
    params.push(pId, cleanMobile, cleanMobile, cleanMobile, pId);
  }

  sql += " ORDER BY created_at DESC LIMIT 200";

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    request_id: r.request_id || `req_${r.id}`,
    booking_id: r.booking_id,
    user_id: r.user_id,
    partner_id: r.partner_id,
    name: r.sender_name || 'User Request',
    age: 25,
    image: r.sender_avatar || '',
    profile_image: r.sender_avatar || '',
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
}

/**
 * Save / insert partner request into `withme_partner_requests` table
 */
async function savePartnerRequestToMysql(requestData) {
  const db = getDbPool();
  const reqId = requestData.request_id || `req_${Date.now()}`;
  const bId = requestData.booking_id || `BK${Date.now()}`;
  const senderName = requestData.name || requestData.sender_name || 'User';
  const senderPhone = requestData.phone_number || requestData.sender_phone || '';
  const senderAvatar = requestData.image || requestData.sender_avatar || '';
  const userId = requestData.user_id || '';
  const partnerId = String(requestData.partner_id || requestData.receiver_id || '');
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
}

/**
 * Update partner request status in `withme_partner_requests` table
 */
async function updatePartnerRequestStatusInMysql(requestId, status) {
  const db = getDbPool();
  await db.query(`UPDATE withme_partner_requests SET status = ?, updated_at = NOW() WHERE request_id = ?`, [status, requestId]);
  console.log(`[WithMe DB] Updated partner request ${requestId} status to ${status} in 'withme_partner_requests'.`);
}

/**
 * Fetch bookings for specific partnerId from `withme_partner_bookings` table
 */
async function fetchPartnerBookingsFromMysql(partnerId, statusFilter) {
  const db = getDbPool();
  let sql = "SELECT * FROM withme_partner_bookings";
  const params = [];

  const conditions = [];
  if (partnerId) {
    const pId = String(partnerId);
    let cleanMobile = pId.replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) cleanMobile = cleanMobile.slice(-10);
    else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(-10);

    conditions.push("(partner_id = ? OR partner_id = ? OR partner_id IN (SELECT user_id FROM withme_partners WHERE mobile_number = ? OR phone_number = ? OR partner_id = ?))");
    params.push(pId, cleanMobile, cleanMobile, cleanMobile, pId);
  }
  if (statusFilter && statusFilter !== 'all') {
    conditions.push("LOWER(status) = LOWER(?)");
    params.push(statusFilter);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC LIMIT 200";

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    booking_id: r.booking_id,
    partner_id: r.partner_id,
    user_id: r.user_id,
    name: r.customer_name || 'User',
    profile_image: r.profile_image || '',
    interest: r.activity || 'Coffee',
    location: r.location || 'Jaipur',
    date: r.date || '2026-09-25',
    time: r.time || '06:00 PM',
    status: r.status || 'CONFIRMED',
    meeting_info: {
      date: r.date || '2026-09-25',
      time: r.time || '06:00 PM',
      location: r.location || 'Jaipur',
      activity: r.activity || 'Coffee'
    }
  }));
}

/**
 * Save partner booking to `withme_partner_bookings` table
 */
async function savePartnerBookingToMysql(bookingData) {
  const db = getDbPool();
  const bId = bookingData.booking_id || `BK${Date.now()}`;
  const custName = bookingData.name || bookingData.customer_name || 'User';
  const partnerId = String(bookingData.partner_id || bookingData.receiver_id || '');
  const userId = bookingData.user_id || '';
  const profileImage = bookingData.profile_image || '';
  const activity = bookingData.interest || bookingData.activity || 'Coffee';
  const date = bookingData.date || '2026-09-25';
  const time = bookingData.time || '06:00 PM';
  const location = bookingData.location || 'Jaipur';
  const status = bookingData.status || 'CONFIRMED';

  await db.query(
    `INSERT INTO withme_partner_bookings (
      booking_id, user_id, partner_id, customer_name, profile_image, activity, date, time, location, price, currency, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'INR', ?)
    ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
    [bId, userId, partnerId, custName, profileImage, activity, date, time, location, status]
  );
  console.log(`[WithMe DB] Saved partner booking ${bId} to 'withme_partner_bookings' table.`);
}

/**
 * Fetch transactions for partner from `withme_partner_transactions`
 */
async function fetchPartnerTransactionsFromMysql(partnerId) {
  const db = getDbPool();
  let sql = "SELECT * FROM withme_partner_transactions";
  const params = [];

  if (partnerId) {
    const pId = String(partnerId);
    let cleanMobile = pId.replace(/\D/g, '');
    if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) cleanMobile = cleanMobile.slice(-10);
    else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(-10);

    sql += " WHERE (partner_id = ? OR partner_id = ? OR partner_id IN (SELECT user_id FROM withme_partners WHERE mobile_number = ? OR phone_number = ? OR partner_id = ?))";
    params.push(pId, cleanMobile, cleanMobile, cleanMobile, pId);
  }

  sql += " ORDER BY created_at DESC LIMIT 200";
  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    order_id: r.order_id,
    partner_id: r.partner_id,
    user_id: r.user_id,
    location: r.location,
    date: r.date,
    time: r.time,
    earn_money: r.earn_money || 0,
    status: r.status || 'Complete'
  }));
}

/**
 * Save transaction to `withme_partner_transactions`
 */
async function savePartnerTransactionToMysql(txData) {
  const db = getDbPool();
  const orderId = txData.order_id || `ORD_${Date.now()}`;
  const partnerId = String(txData.partner_id);
  const userId = txData.user_id || null;
  const location = txData.location || '';
  const date = txData.date || new Date().toISOString().split('T')[0];
  const time = txData.time || '12:00 PM';
  const earnMoney = Number(txData.earn_money) || 0;
  const status = txData.status || 'Complete';

  await db.query(
    `INSERT INTO withme_partner_transactions (order_id, partner_id, user_id, location, date, time, earn_money, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), earn_money = VALUES(earn_money)`,
    [orderId, partnerId, userId, location, date, time, earnMoney, status]
  );
}

// Backwards compatibility alias for syncUserToMysql
async function syncUserToMysql(user) {
  try {
    return await createPartnerInMysql(user);
  } catch (err) {
    console.warn(`[WithMe DB Sync Warning] ${err.message}`);
  }
}

module.exports = {
  getDbPool,
  initMysqlDatabase,
  saveOtpToMysql,
  verifyOtpFromMysql,
  syncUserToMysql,
  createPartnerInMysql,
  findPartnerByMobileFromMysql,
  findPartnerByIdFromMysql,
  findPartnerByEmailFromMysql,
  updatePartnerInMysql,
  fetchUsersFromMysql,
  deleteUserFromMysql,
  fetchPartnerRequestsFromMysql,
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  fetchPartnerBookingsFromMysql,
  savePartnerBookingToMysql,
  fetchPartnerTransactionsFromMysql,
  savePartnerTransactionToMysql,
  mapMysqlRowToPartner
};
