const fs = require('fs');
const path = require('path');
const { encrypt } = require('../utils/crypto');
const { initMysqlDatabase, syncUserToMysql, fetchUsersFromMysql } = require('../config/database');

const USERS_FILE = path.join(__dirname, 'users.json');

// In-memory Database Store
const users = new Map();
const otpSessions = new Map(); // session_id -> { mobile_number, country_code, type, otp, expires_at }
const resetTokens = new Map(); // reset_token -> { mobile_number, country_code, expires_at }
const verifyTokens = new Map(); // token -> { mobile_number, country_code, expires_at }
const partnerRequests = new Map();
const partnerBookings = new Map();
const partnerTransactions = [];

// Helper function to format country code
function normalizeCountryCode(cc) {
  if (!cc) return '+91';
  let clean = cc.trim();
  if (!clean.startsWith('+')) {
    clean = '+' + clean;
  }
  return clean;
}

// Helper to strip non-digits and extract normalized 10-digit mobile number
function normalizePhoneDigits(num) {
  if (!num) return "";
  let clean = String(num).replace(/\D/g, '');
  if (clean.length > 10 && clean.startsWith('91')) {
    clean = clean.slice(-10);
  } else if (clean.length === 11 && clean.startsWith('0')) {
    clean = clean.slice(-10);
  }
  return clean;
}

// Dynamic Base URL Helper for Local / Render / Custom Domain
function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  if (req && req.get) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:5000';
    return `${protocol}://${host}`;
  }
  return 'http://localhost:5000';
}

// Format any photo URL or relative path dynamically to full URL using active host/Render domain
function formatPhotoUrl(urlOrPath, req) {
  if (!urlOrPath) return "";
  const baseUrl = getBaseUrl(req);

  // If it's fake domain cdn.yourdomain.com, replace with valid uploaded photo path
  if (urlOrPath.includes("cdn.yourdomain.com")) {
    const match = urlOrPath.match(/ph_00(\d)/);
    if (match) {
      return `${baseUrl}/uploads/photos/photo_${match[1]}.jpg`;
    }
    return `${baseUrl}/uploads/photos/photo_1.jpg`;
  }

  // If it's hardcoded localhost:5000, replace with active server/Render domain
  if (urlOrPath.includes("localhost:5000")) {
    return urlOrPath.replace(/https?:\/\/localhost:5000/, baseUrl);
  }

  // If relative path starting with /uploads or uploads
  if (urlOrPath.startsWith('/uploads')) {
    return `${baseUrl}${urlOrPath}`;
  }
  if (urlOrPath.startsWith('uploads/')) {
    return `${baseUrl}/${urlOrPath}`;
  }

  return urlOrPath;
}

// User-uploaded profile photos relative paths
const PHOTO_1 = "/uploads/photos/photo_1.jpg";
const PHOTO_2 = "/uploads/photos/photo_2.jpg";
const PHOTO_3 = "/uploads/photos/photo_3.jpg";
const PHOTO_4 = "/uploads/photos/photo_4.jpg";
const PHOTO_5 = "/uploads/photos/photo_5.jpg";

const DEFAULT_PHOTOS = [
  { photo_id: "ph_001", url: PHOTO_1, is_primary: true },
  { photo_id: "ph_002", url: PHOTO_2, is_primary: false },
  { photo_id: "ph_003", url: PHOTO_3, is_primary: false },
  { photo_id: "ph_004", url: PHOTO_4, is_primary: false },
  { photo_id: "ph_005", url: PHOTO_5, is_primary: false }
];

// Helper to save users Map to users.json file & sync with MySQL
function saveUsers() {
  try {
    const userArray = Array.from(users.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(userArray, null, 2), 'utf-8');
    userArray.forEach(u => {
      syncUserToMysql(u).catch(err => console.error("MySQL sync error:", err.message));
    });
  } catch (err) {
    console.error("Failed to save users:", err);
  }
}

// Seed default user matching sample request/responses
const seedUserId = "usr_10234";
const seedUserObj = {
  user_id: seedUserId,
  name: "Rahul Sharma",
  country_code: "+91",
  mobile_number: "9876543210",
  password: "MySecurePass123",
  email: "rahul.sharma@example.com",
  gender: "Male",
  dob: "1998-05-14",
  area: "Vaishali Nagar",
  city: "Jaipur",
  state: "Rajasthan",
  pincode: "302021",
  profile_completed: true,
  profile_step_pending: null,
  failed_attempts: 0,
  locked: false,
  rating: 4.6,
  total_ratings: 128,
  phone_verified: true,
  pending_phone_change: null,
  profile_photo_url: PHOTO_1,
  current_location: {
    latitude: 26.9124,
    longitude: 75.7873,
    address: "Vaishali Nagar, Jaipur, Rajasthan",
    updated_at: "2026-09-15T10:32:00Z"
  },
  photos: DEFAULT_PHOTOS,
  aadhar: {
    aadhar_number_encrypted: encrypt("999988887777"),
    aadhar_front_url: "https://private-bucket.s3.amazonaws.com/aadhar_front.jpg",
    aadhar_back_url: "https://private-bucket.s3.amazonaws.com/aadhar_back.jpg",
    aadhar_verification_status: "APPROVED",
    remarks: null
  },
  about: {
    description: "I love meeting new people and exploring the city over a good cup of coffee...",
    interests: ["Coffee", "Travel", "Music", "Photography"]
  },
  availability: {
    available_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    available_time: { from: "10:00 AM", to: "09:00 PM" },
    receive_requests: true,
    availability_status: "Available",
    pricing: [
      { interest: "Coffee", label: "Coffee / Cafe Meetups", price: 999, unit: "per session/2hrs" },
      { interest: "Travel", label: "Travel / Day Out / Trips", price: 2999, unit: "per session/24hrs" }
    ],
    platform_commission_percent: 15
  }
};

// Helper to load users from users.json file and MySQL
async function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      if (raw.trim()) {
        const userArray = JSON.parse(raw);
        if (Array.isArray(userArray)) {
          userArray.forEach(u => users.set(u.user_id, u));
        }
      }
    }
  } catch (err) {
    console.error("Error reading users.json:", err);
  }

  // Load / sync from MySQL Database
  try {
    await initMysqlDatabase();
    const dbUsers = await fetchUsersFromMysql();
    if (dbUsers && dbUsers.length > 0) {
      dbUsers.forEach(u => users.set(u.user_id, u));
    }
  } catch (err) {
    console.error("Error loading from MySQL:", err.message);
  }

  // Ensure seed user exists
  if (!users.has(seedUserId)) {
    users.set(seedUserId, seedUserObj);
  }
  saveUsers();
}

// Perform initial load
loadUsers();

// Helper function to find user by mobile and optional country code
function findUserByMobile(mobile_number, country_code) {
  const searchDigits = normalizePhoneDigits(mobile_number);
  const searchCC = country_code ? normalizeCountryCode(country_code) : null;

  return Array.from(users.values()).find(u => {
    const userDigits = normalizePhoneDigits(u.mobile_number);
    if (userDigits !== searchDigits) return false;

    if (searchCC && u.country_code) {
      const userCC = normalizeCountryCode(u.country_code);
      return userCC === searchCC;
    }
    return true;
  });
}

// Seed Partner Requests with User-Uploaded Photos
partnerRequests.set("req_001", {
  request_id: "req_001",
  name: "Priya Verma",
  age: 24,
  image: PHOTO_1,
  id_verified: 1,
  selfie_verified: 1,
  interest: "Coffee",
  date_time: "2026-09-18 05:00 PM",
  location: "Malviya Nagar, Jaipur",
  status: "Pending",
  activity: {
    type: "Coffee",
    date: "2026-09-18",
    time: "05:00 PM",
    area: "Malviya Nagar, Jaipur",
    description: "Looking for a coffee hangout partner to discuss tech & books."
  }
});

partnerRequests.set("req_002", {
  request_id: "req_002",
  name: "Ananya Sen",
  age: 26,
  image: PHOTO_2,
  id_verified: 1,
  selfie_verified: 1,
  interest: "Travel",
  date_time: "2026-09-19 11:00 AM",
  location: "C-Scheme, Jaipur",
  status: "Pending",
  activity: {
    type: "Travel",
    date: "2026-09-19",
    time: "11:00 AM",
    area: "C-Scheme, Jaipur",
    description: "Exploring local cafes and historic spots in Pink City."
  }
});

partnerRequests.set("req_003", {
  request_id: "req_003",
  name: "Sneha Kapoor",
  age: 23,
  image: PHOTO_3,
  id_verified: 0,
  selfie_verified: 1,
  interest: "Music",
  date_time: "2026-09-20 07:00 PM",
  location: "Vaishali Nagar, Jaipur",
  status: "Pending",
  activity: {
    type: "Music",
    date: "2026-09-20",
    time: "07:00 PM",
    area: "Vaishali Nagar, Jaipur",
    description: "Attending live acoustic jam night."
  }
});

// Seed Partner Bookings with User-Uploaded Photos
partnerBookings.set("bk_001", {
  booking_id: "bk_001",
  profile_image: PHOTO_1,
  name: "Ritika Singh",
  age: 25,
  id_verified: 1,
  selfie_verified: 1,
  interest: "Coffee",
  location: "Raja Park, Jaipur",
  date: "2026-09-18",
  time: "04:00 PM",
  status: "Upcoming",
  meeting_info: {
    date: "2026-09-18",
    time: "04:00 PM",
    place: "Raja Park, Jaipur",
    type: "Coffee",
    description: "Casual cafe meetup at Tapri Central."
  },
  safety_checklist: {
    start_safe_meet: false
  },
  safe_meet_mode: {
    location_allow: 1,
    notify_trusted_contact: 1,
    safety_check_in: 1
  }
});

partnerBookings.set("bk_002", {
  booking_id: "bk_002",
  profile_image: PHOTO_2,
  name: "Megha Sharma",
  age: 27,
  id_verified: 1,
  selfie_verified: 1,
  interest: "Travel",
  location: "MI Road, Jaipur",
  date: "2026-09-19",
  time: "02:00 PM",
  status: "Upcoming",
  meeting_info: {
    date: "2026-09-19",
    time: "02:00 PM",
    place: "MI Road, Jaipur",
    type: "Travel",
    description: "Heritage walk around Hawa Mahal and Johari Bazar."
  },
  safety_checklist: {
    start_safe_meet: false
  },
  safe_meet_mode: {
    location_allow: 1,
    notify_trusted_contact: 1,
    safety_check_in: 1
  }
});

partnerBookings.set("bk_003", {
  booking_id: "bk_003",
  profile_image: PHOTO_4,
  name: "Kavya Roy",
  age: 24,
  id_verified: 1,
  selfie_verified: 1,
  interest: "Movies",
  location: "WTP Mall, Jaipur",
  date: "2026-09-15",
  time: "06:00 PM",
  status: "Complete",
  meeting_info: {
    date: "2026-09-15",
    time: "06:00 PM",
    place: "WTP Mall, Jaipur",
    type: "Movies",
    description: "Movie night & dinner."
  },
  safety_checklist: {
    start_safe_meet: true
  },
  safe_meet_mode: {
    location_allow: 1,
    notify_trusted_contact: 1,
    safety_check_in: 1
  }
});

partnerBookings.set("bk_004", {
  booking_id: "bk_004",
  profile_image: PHOTO_5,
  name: "Divya Jain",
  age: 26,
  id_verified: 1,
  selfie_verified: 0,
  interest: "Events",
  location: "JLN Marg, Jaipur",
  date: "2026-09-12",
  time: "08:00 PM",
  status: "Cancelled",
  meeting_info: {
    date: "2026-09-12",
    time: "08:00 PM",
    place: "JLN Marg, Jaipur",
    type: "Events",
    description: "Exhibition meetup."
  },
  safety_checklist: {
    start_safe_meet: false
  },
  safe_meet_mode: {
    location_allow: 0,
    notify_trusted_contact: 0,
    safety_check_in: 0
  }
});

// Seed Transactions
partnerTransactions.push(
  { order_id: "ORD_90123", location: "Raja Park, Jaipur", time: "04:00 PM", date: "2026-09-15", earn_money: 1200, status: "Complete" },
  { order_id: "ORD_90124", location: "C-Scheme, Jaipur", time: "11:00 AM", date: "2026-09-14", earn_money: 1300, status: "Complete" },
  { order_id: "ORD_90125", location: "WTP Mall, Jaipur", time: "06:00 PM", date: "2026-09-18", earn_money: 999, status: "Pending" },
  { order_id: "ORD_90126", location: "JLN Marg, Jaipur", time: "08:00 PM", date: "2026-09-12", earn_money: 800, status: "Cancel" }
);

module.exports = {
  users,
  otpSessions,
  resetTokens,
  verifyTokens,
  partnerRequests,
  partnerBookings,
  partnerTransactions,
  normalizeCountryCode,
  normalizePhoneDigits,
  findUserByMobile,
  saveUsers,
  loadUsers,
  getBaseUrl,
  formatPhotoUrl,
  PHOTO_1,
  PHOTO_2,
  PHOTO_3,
  PHOTO_4,
  PHOTO_5,
  DEFAULT_PHOTOS
};
