const { encrypt } = require('../utils/crypto');

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

// Seed Partner Requests
partnerRequests.set("req_001", {
  request_id: "req_001",
  name: "Priya Verma",
  age: 24,
  image: "https://cdn.yourdomain.com/users/priya.jpg",
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
  image: "https://cdn.yourdomain.com/users/ananya.jpg",
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
  image: "https://cdn.yourdomain.com/users/sneha.jpg",
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

// Seed Partner Bookings
partnerBookings.set("bk_001", {
  booking_id: "bk_001",
  profile_image: "https://cdn.yourdomain.com/users/ritika.jpg",
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
  profile_image: "https://cdn.yourdomain.com/users/megha.jpg",
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
  profile_image: "https://cdn.yourdomain.com/users/kavya.jpg",
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
  profile_image: "https://cdn.yourdomain.com/users/divya.jpg",
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
  normalizeCountryCode
};
