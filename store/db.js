const { encrypt } = require('../utils/crypto');

// In-memory Database Store
const users = new Map();
const otpSessions = new Map(); // session_id -> { mobile_number, country_code, type, otp, expires_at }
const resetTokens = new Map(); // reset_token -> { mobile_number, country_code, expires_at }
const verifyTokens = new Map(); // token -> { mobile_number, country_code, expires_at }

// Helper function to format country code
function normalizeCountryCode(cc) {
  if (!cc) return '+91';
  let clean = cc.trim();
  if (!clean.startsWith('+')) {
    clean = '+' + clean;
  }
  return clean;
}

// Seed default user matching sample request/responses
const seedUserId = "usr_10234";
users.set(seedUserId, {
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
  current_location: {
    latitude: 26.9124,
    longitude: 75.7873,
    address: "Vaishali Nagar, Jaipur, Rajasthan",
    updated_at: "2026-09-15T10:32:00Z"
  },
  photos: [
    { photo_id: "ph_001", url: "https://cdn.yourdomain.com/usr_10234/ph_001.jpg", is_primary: true },
    { photo_id: "ph_002", url: "https://cdn.yourdomain.com/usr_10234/ph_002.jpg", is_primary: false },
    { photo_id: "ph_003", url: "https://cdn.yourdomain.com/usr_10234/ph_003.jpg", is_primary: false },
    { photo_id: "ph_004", url: "https://cdn.yourdomain.com/usr_10234/ph_004.jpg", is_primary: false },
    { photo_id: "ph_005", url: "https://cdn.yourdomain.com/usr_10234/ph_005.jpg", is_primary: false }
  ],
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
});

module.exports = {
  users,
  otpSessions,
  resetTokens,
  verifyTokens,
  normalizeCountryCode
};
