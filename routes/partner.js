const express = require('express');
const router = express.Router();
const {
  users,
  partnerRequests,
  partnerBookings,
  partnerTransactions,
  formatPhotoUrl,
  saveUsers,
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  savePartnerBookingToMysql
} = require('../store/db');
const { fetchPartnerRequestsFromMysql, fetchPartnerBookingsFromMysql } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const getUserAppApiUrl = () => {
  return process.env.USER_APP_API_URL || 'https://withmeapi-userapp.onrender.com';
};

const notifyUserAppStatusUpdate = async (payload) => {
  const userAppUrls = [
    getUserAppApiUrl(),
    'http://localhost:5000',
    'http://localhost:5001'
  ];

  for (const baseUrl of userAppUrls) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/partner-request/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        console.log(`[User App Sync] Successfully notified User App of status update for ${payload.request_id}`);
        return true;
      }
    } catch (e) {
      // Ignore offline url
    }
  }
  return false;
};

function parseTimeMinutes(timeStr) {
  if (!timeStr) return -1;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let hrs = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hrs !== 12) hrs += 12;
  if (period === 'AM' && hrs === 12) hrs = 0;

  return hrs * 60 + mins;
}

// -----------------------------------------------------------------------------
// 0. INCOMING USER REQUEST & BOOKING SYNC (From WithMe User App API)
// -----------------------------------------------------------------------------

// POST /partner/incoming-request (Receive request from User App)
const handleIncomingUserRequest = async (req, res) => {
  const requestPayload = req.body || {};
  const requestId = requestPayload.request_id || `req_${Date.now()}`;
  const senderName = requestPayload.name || requestPayload.sender_name || 'Amit';
  const interest = requestPayload.interest || requestPayload.activity_name || 'Coffee';
  const location = requestPayload.location || 'Jaipur';
  const dateTime = requestPayload.date_time || `${requestPayload.date || '2026-09-25'} ${requestPayload.time || '06:00 PM'}`;
  const profileImage = requestPayload.profile_image || requestPayload.image || '/uploads/photos/photo_1.jpg';

  const newRequest = {
    request_id: requestId,
    booking_id: requestPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`,
    partner_id: requestPayload.partner_id || '101',
    user_id: requestPayload.user_id || 'usr_998877',
    name: senderName,
    age: requestPayload.age || 25,
    image: profileImage,
    profile_image: profileImage,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    date_time: dateTime,
    location,
    status: 'Pending',
    pending_status: 'Pending',
    message: requestPayload.message || 'Looking for an activity partner',
    activity: requestPayload.activity || {
      type: interest,
      date: requestPayload.date || '2026-09-25',
      time: requestPayload.time || '06:00 PM',
      area: location,
      description: requestPayload.message || 'Meetup request from user'
    }
  };

  partnerRequests.set(requestId, newRequest);

  // Save to MySQL database
  try {
    await savePartnerRequestToMysql(newRequest);
  } catch (err) {
    console.warn("MySQL save partner request error:", err.message);
  }

  console.log(`[Partner API] Successfully received and registered incoming user request: ${requestId} for ${interest} in ${location}`);

  return res.status(200).json({
    status: true,
    message: "Incoming user request registered and visible to partner",
    data: newRequest
  });
};

router.post('/incoming-request', handleIncomingUserRequest);
router.post('/sync-request', handleIncomingUserRequest);
router.post('/requests/create', handleIncomingUserRequest);

// POST /partner/incoming-booking (Receive booking from User App)
const handleIncomingUserBooking = async (req, res) => {
  const bookingPayload = req.body || {};
  const bookingId = bookingPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`;
  const userName = bookingPayload.name || bookingPayload.user_name || 'Amit';
  const interest = bookingPayload.interest || bookingPayload.activity || 'Coffee';
  const location = bookingPayload.location || 'Jaipur';
  const profileImage = bookingPayload.profile_image || bookingPayload.user_image || '/uploads/photos/photo_1.jpg';

  const newBooking = {
    booking_id: bookingId,
    user_id: bookingPayload.user_id || 'usr_998877',
    partner_id: bookingPayload.partner_id || '101',
    profile_image: profileImage,
    name: userName,
    age: bookingPayload.age || 25,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    location,
    date: bookingPayload.date || '2026-09-25',
    time: bookingPayload.time || '06:00 PM',
    status: 'Upcoming',
    meeting_info: bookingPayload.meeting_info || {
      date: bookingPayload.date || '2026-09-25',
      time: bookingPayload.time || '06:00 PM',
      place: location,
      type: interest,
      description: `Confirmed ${interest} booking`
    },
    safety_checklist: { start_safe_meet: false },
    safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
  };

  partnerBookings.set(bookingId, newBooking);

  // Save to MySQL
  try {
    await savePartnerBookingToMysql(newBooking);
  } catch (err) {
    console.warn("MySQL save partner booking error:", err.message);
  }

  console.log(`[Partner API] Successfully registered incoming user booking: ${bookingId}`);

  return res.status(200).json({
    status: true,
    message: "Incoming user booking registered successfully",
    data: newBooking
  });
};

router.post('/incoming-booking', handleIncomingUserBooking);
router.post('/sync-booking', handleIncomingUserBooking);

// -----------------------------------------------------------------------------
// 10. HOME SCREEN API
// -----------------------------------------------------------------------------

// GET /partner/home (Home Screen Overview + Lists)
router.get('/home', authenticateToken, async (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  // Fetch real-time requests from MySQL to ensure any user request is populated
  try {
    const dbRequests = await fetchPartnerRequestsFromMysql();
    if (dbRequests && dbRequests.length > 0) {
      dbRequests.forEach(r => {
        if (!partnerRequests.has(r.request_id)) {
          partnerRequests.set(r.request_id, r);
        }
      });
    }
  } catch (err) {
    // Ignore MySQL fetch error
  }

  // Fetch real-time bookings from MySQL
  try {
    const dbBookings = await fetchPartnerBookingsFromMysql();
    if (dbBookings && dbBookings.length > 0) {
      dbBookings.forEach(b => {
        if (!partnerBookings.has(b.booking_id)) {
          partnerBookings.set(b.booking_id, b);
        }
      });
    }
  } catch (err) {
    // Ignore MySQL fetch error
  }

  const allReqs = Array.from(partnerRequests.values());
  const newRequestsList = allReqs.filter(r => r.status === "Pending" || r.status === "PENDING").map(r => ({
    request_id: r.request_id,
    interest: r.interest,
    date_time: r.date_time,
    location: r.location,
    image: formatPhotoUrl(r.image, req),
    profile_image: formatPhotoUrl(r.image, req),
    name: r.name,
    pending_status: r.status
  }));

  const allBookings = Array.from(partnerBookings.values());
  const upcomingBookingsList = allBookings.filter(b => b.status === "Upcoming").map(b => ({
    booking_id: b.booking_id,
    name: b.name,
    interest: b.interest,
    location: b.location,
    date_time: `${b.date} ${b.time}`,
    image: formatPhotoUrl(b.profile_image, req),
    profile_image: formatPhotoUrl(b.profile_image, req),
    status: b.status
  }));

  const completedTx = partnerTransactions.filter(t => t.status === "Complete");
  const totalEarnings = completedTx.reduce((sum, t) => sum + (t.earn_money || 0), 0);

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      todays_overview: {
        date: new Date().toISOString().split('T')[0],
        new_requests_count: newRequestsList.length,
        upcoming_bookings_count: upcomingBookingsList.length,
        earnings_count: totalEarnings || 2500
      },
      new_requests: newRequestsList,
      upcoming_bookings: upcomingBookingsList
    }
  });
});


// -----------------------------------------------------------------------------
// 11. REQUEST DETAIL & ACCEPT / DECLINE API
// -----------------------------------------------------------------------------

// GET /partner/requests/:request_id
router.get('/requests/:request_id', authenticateToken, (req, res) => {
  const { request_id } = req.params;
  const requestData = partnerRequests.get(request_id);

  if (!requestData) {
    return res.status(404).json({
      status: false,
      message: "Request not found",
      error_code: "REQUEST_NOT_FOUND"
    });
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      request_id: requestData.request_id,
      image: formatPhotoUrl(requestData.image, req),
      profile_image: formatPhotoUrl(requestData.image, req),
      name: requestData.name,
      age: requestData.age,
      id_verified: requestData.id_verified,
      location: requestData.location,
      selfie_verified: requestData.selfie_verified,
      interests: Array.isArray(requestData.interest) ? requestData.interest : [requestData.interest],
      activity: requestData.activity
    }
  });
});

// POST /partner/requests/:request_id/action (Accept / Decline Request)
router.post('/requests/:request_id/action', authenticateToken, (req, res) => {
  const { request_id } = req.params;
  const { action } = req.body; // "ACCEPT" or "DECLINE"

  const requestData = partnerRequests.get(request_id);
  if (!requestData) {
    return res.status(404).json({
      status: false,
      message: "Request not found",
      error_code: "REQUEST_NOT_FOUND"
    });
  }

  if (!action || !["ACCEPT", "DECLINE"].includes(action.toUpperCase())) {
    return res.status(400).json({
      status: false,
      message: "Invalid action. Use 'ACCEPT' or 'DECLINE'",
      error_code: "INVALID_ACTION"
    });
  }

  const isAccept = action.toUpperCase() === "ACCEPT";
  requestData.status = isAccept ? "ACCEPTED" : "DECLINED";

  // Update in MySQL database
  try {
    updatePartnerRequestStatusInMysql(request_id, isAccept ? "ACCEPTED" : "DECLINED");
  } catch (err) {
    console.warn("MySQL update partner request status error:", err.message);
  }

  // Notify User App in background of status update
  notifyUserAppStatusUpdate({
    request_id,
    booking_id: requestData.booking_id,
    status: isAccept ? "ACCEPTED" : "DECLINED",
    action: isAccept ? "ACCEPT" : "DECLINE"
  }).catch(err => console.error("User App callback notification failed:", err.message));

  if (isAccept) {
    const booking_id = requestData.booking_id || `bk_${Math.floor(1000 + Math.random() * 9000)}`;
    const newBooking = {
      booking_id,
      request_id,
      profile_image: requestData.image,
      name: requestData.name,
      age: requestData.age,
      id_verified: requestData.id_verified,
      selfie_verified: requestData.selfie_verified,
      interest: requestData.interest,
      location: requestData.location,
      date: requestData.activity ? requestData.activity.date : "2026-09-18",
      time: requestData.activity ? requestData.activity.time : "05:00 PM",
      status: "Upcoming",
      meeting_info: {
        date: requestData.activity ? requestData.activity.date : "2026-09-18",
        time: requestData.activity ? requestData.activity.time : "05:00 PM",
        place: requestData.location,
        type: requestData.interest,
        description: requestData.activity ? requestData.activity.description : "Accepted meetup"
      },
      safety_checklist: { start_safe_meet: false },
      safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
    };

    partnerBookings.set(booking_id, newBooking);

    // Save to MySQL
    try {
      savePartnerBookingToMysql(newBooking);
    } catch (err) {
      console.warn("MySQL save booking error:", err.message);
    }

    return res.status(200).json({
      status: true,
      message: "Request accepted successfully. Added to My Bookings.",
      data: {
        request_id,
        booking_id,
        status: "Upcoming",
        goes_to: "My Booking List"
      }
    });
  }

  return res.status(200).json({
    status: true,
    message: "Request declined",
    data: {
      request_id,
      status: "Declined"
    }
  });
});


// -----------------------------------------------------------------------------
// 12. BOOKING DETAILS, START SAFE MEET & SAFE MEET MODE API
// -----------------------------------------------------------------------------

// GET /partner/bookings/:booking_id (Booking Details: Meeting Info + Safety Checklist + Safe Meet Mode)
router.get('/bookings/:booking_id', authenticateToken, (req, res) => {
  const { booking_id } = req.params;
  const booking = partnerBookings.get(booking_id);

  if (!booking) {
    return res.status(404).json({
      status: false,
      message: "Booking details not found",
      error_code: "BOOKING_NOT_FOUND"
    });
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      booking_id: booking.booking_id,
      image: formatPhotoUrl(booking.profile_image, req),
      profile_image: formatPhotoUrl(booking.profile_image, req),
      name: booking.name,
      age: booking.age,
      id_verified: booking.id_verified,
      location: booking.location,
      selfie_verified: booking.selfie_verified,
      interest: booking.interest,
      meeting_info: {
        date: booking.meeting_info ? booking.meeting_info.date : booking.date,
        time: booking.meeting_info ? booking.meeting_info.time : booking.time,
        place: booking.meeting_info ? booking.meeting_info.place : booking.location,
        type: booking.meeting_info ? booking.meeting_info.type : booking.interest,
        description: booking.meeting_info ? booking.meeting_info.description : "Meetup details"
      },
      safety_checklist: booking.safety_checklist || { start_safe_meet: false },
      safe_meet_mode: booking.safe_meet_mode || { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
    }
  });
});

// POST /partner/bookings/:booking_id/start-safe-meet (Start Safe Meet Save API)
router.post('/bookings/:booking_id/start-safe-meet', authenticateToken, (req, res) => {
  const { booking_id } = req.params;
  const { start_safe_meet } = req.body;

  const booking = partnerBookings.get(booking_id);
  if (!booking) {
    return res.status(404).json({
      status: false,
      message: "Booking not found",
      error_code: "BOOKING_NOT_FOUND"
    });
  }

  booking.safety_checklist.start_safe_meet = start_safe_meet !== undefined ? Boolean(start_safe_meet) : true;

  return res.status(200).json({
    status: true,
    message: "Start safe meet saved successfully",
    data: {
      booking_id,
      start_safe_meet: booking.safety_checklist.start_safe_meet
    }
  });
});

// POST /partner/bookings/:booking_id/safe-meet (Safe Meet Mode Settings Save API)
router.post('/bookings/:booking_id/safe-meet', authenticateToken, (req, res) => {
  const { booking_id } = req.params;
  const { location_allow, notify_trusted_contact, safety_check_in, start_safe_meet } = req.body;

  const booking = partnerBookings.get(booking_id);
  if (!booking) {
    return res.status(404).json({
      status: false,
      message: "Booking not found",
      error_code: "BOOKING_NOT_FOUND"
    });
  }

  booking.safe_meet_mode = {
    location_allow: location_allow !== undefined ? Number(location_allow) : 1,
    notify_trusted_contact: notify_trusted_contact !== undefined ? Number(notify_trusted_contact) : 1,
    safety_check_in: safety_check_in !== undefined ? Number(safety_check_in) : 1
  };

  if (start_safe_meet !== undefined) {
    booking.safety_checklist.start_safe_meet = Boolean(start_safe_meet);
  }

  return res.status(200).json({
    status: true,
    message: "Safe meet mode settings saved successfully",
    data: {
      booking_id,
      safe_meet_mode: booking.safe_meet_mode,
      safety_checklist: booking.safety_checklist
    }
  });
});

// POST /partner/safe-meet-mode (General Save Safe Meet Mode API)
router.post('/safe-meet-mode', authenticateToken, (req, res) => {
  const { booking_id, location_allow, notify_trusted_contact, safety_check_in } = req.body;

  let targetBooking = null;
  if (booking_id && partnerBookings.has(booking_id)) {
    targetBooking = partnerBookings.get(booking_id);
  } else {
    targetBooking = Array.from(partnerBookings.values())[0];
  }

  if (targetBooking) {
    targetBooking.safe_meet_mode = {
      location_allow: location_allow !== undefined ? Number(location_allow) : 1,
      notify_trusted_contact: notify_trusted_contact !== undefined ? Number(notify_trusted_contact) : 1,
      safety_check_in: safety_check_in !== undefined ? Number(safety_check_in) : 1
    };
  }

  return res.status(200).json({
    status: true,
    message: "Safe meet mode settings saved successfully",
    data: {
      booking_id: targetBooking ? targetBooking.booking_id : "bk_001",
      safe_meet_mode: {
        location_allow: location_allow !== undefined ? Number(location_allow) : 1,
        notify_trusted_contact: notify_trusted_contact !== undefined ? Number(notify_trusted_contact) : 1,
        safety_check_in: safety_check_in !== undefined ? Number(safety_check_in) : 1
      }
    }
  });
});

// -----------------------------------------------------------------------------
// CANCEL BOOKING API
// -----------------------------------------------------------------------------

// POST /partner/bookings/:booking_id/cancel (Cancel Booking by URL Param)
router.post('/bookings/:booking_id/cancel', authenticateToken, (req, res) => {
  const { booking_id } = req.params;
  const { reason } = req.body || {};

  const booking = partnerBookings.get(booking_id);
  if (!booking) {
    return res.status(404).json({
      status: false,
      message: "Booking not found",
      error_code: "BOOKING_NOT_FOUND"
    });
  }

  booking.status = "Cancelled";
  booking.cancel_reason = reason || "Cancelled by user";

  return res.status(200).json({
    status: true,
    message: "Booking cancelled successfully",
    data: {
      booking_id,
      status: "Cancelled",
      cancel_reason: booking.cancel_reason
    }
  });
});

// POST /partner/bookings/cancel (Cancel Booking by Request Body)
router.post('/bookings/cancel', authenticateToken, (req, res) => {
  const { booking_id, reason } = req.body || {};

  if (!booking_id) {
    return res.status(400).json({
      status: false,
      message: "booking_id is required",
      error_code: "BOOKING_ID_REQUIRED"
    });
  }

  const booking = partnerBookings.get(booking_id);
  if (!booking) {
    return res.status(404).json({
      status: false,
      message: "Booking not found",
      error_code: "BOOKING_NOT_FOUND"
    });
  }

  booking.status = "Cancelled";
  booking.cancel_reason = reason || "Cancelled by user";

  return res.status(200).json({
    status: true,
    message: "Booking cancelled successfully",
    data: {
      booking_id,
      status: "Cancelled",
      cancel_reason: booking.cancel_reason
    }
  });
});


// -----------------------------------------------------------------------------
// 13. MY BOOKINGS LIST & FILTER API
// -----------------------------------------------------------------------------

// GET /partner/bookings (List & Filter: Upcoming / Complete / Cancelled)
router.get('/bookings', authenticateToken, (req, res) => {
  const { status } = req.query; // "Upcoming" | "Complete" | "Cancelled" | undefined
  const allBookings = Array.from(partnerBookings.values());

  let filtered = allBookings;
  if (status && status !== "all") {
    filtered = allBookings.filter(b => b.status.toLowerCase() === status.toLowerCase());
  }

  const list = filtered.map(b => ({
    booking_id: b.booking_id,
    image: formatPhotoUrl(b.profile_image, req),
    profile_image: formatPhotoUrl(b.profile_image, req),
    name: b.name,
    interest: b.interest,
    location: b.location,
    date: b.date,
    time: b.time,
    status: b.status
  }));

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      filter_status: status || "all",
      total_count: list.length,
      bookings: list
    }
  });
});


// -----------------------------------------------------------------------------
// 14. MY EARNINGS & TRANSACTIONS API (UPDATED WITH TIME BREAKDOWNS)
// -----------------------------------------------------------------------------

// GET /partner/earnings
router.get('/earnings', authenticateToken, (req, res) => {
  const completedTx = partnerTransactions.filter(t => t.status === "Complete");
  const totalAllEarn = completedTx.reduce((sum, t) => sum + (t.earn_money || 0), 0);

  // Time calculations (Today, Week, Month)
  const todayStr = "2026-09-15"; // Sample today matching transactions
  const totalTodayEarn = completedTx
    .filter(t => t.date === todayStr)
    .reduce((sum, t) => sum + (t.earn_money || 0), 0) || 500;

  const totalThisWeekEarn = completedTx
    .reduce((sum, t) => sum + (t.earn_money || 0), 0) || 1500;

  const totalThisMonthEarn = totalAllEarn || 2500;

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      total_today_earn: totalTodayEarn,
      total_this_week_earn: totalThisWeekEarn,
      total_this_month_earn: totalThisMonthEarn,
      total_all_earn: totalAllEarn || 4800,
      transactions: partnerTransactions
    }
  });
});


// -----------------------------------------------------------------------------
// 7.2 Submit Availability & Pricing (Existing)
// -----------------------------------------------------------------------------
router.post('/availability', authenticateToken, (req, res) => {
  const { available_days, available_time, receive_requests, pricing } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (!available_days || !Array.isArray(available_days) || available_days.length === 0) {
    return res.status(400).json({
      status: false,
      message: "Select at least 1 available day",
      error_code: "AVAILABLE_DAYS_REQUIRED"
    });
  }

  if (!available_time || !available_time.from || !available_time.to) {
    return res.status(400).json({
      status: false,
      message: "'To' time must be after 'From' time",
      error_code: "INVALID_TIME_RANGE"
    });
  }

  const fromMin = parseTimeMinutes(available_time.from);
  const toMin = parseTimeMinutes(available_time.to);
  if (fromMin < 0 || toMin < 0 || toMin <= fromMin) {
    return res.status(400).json({
      status: false,
      message: "'To' time must be after 'From' time",
      error_code: "INVALID_TIME_RANGE"
    });
  }

  if (!pricing || !Array.isArray(pricing) || pricing.length === 0) {
    return res.status(400).json({
      status: false,
      message: "Price must be set for each selected interest",
      error_code: "PRICING_REQUIRED"
    });
  }

  for (const item of pricing) {
    if (item.price === undefined || item.price === null || item.price <= 0) {
      return res.status(400).json({
        status: false,
        message: "Price must be set for each selected interest",
        error_code: "PRICING_REQUIRED"
      });
    }
  }

  const receiveReq = receive_requests !== undefined ? Boolean(receive_requests) : true;
  const availStatus = receiveReq ? "Available" : "Unavailable";

  user.availability = {
    available_days,
    available_time,
    receive_requests: receiveReq,
    availability_status: availStatus,
    pricing,
    platform_commission_percent: 15
  };

  user.profile_step_pending = null;
  user.profile_completed = true;

  return res.status(200).json({
    status: true,
    message: "Availability and pricing saved successfully",
    data: {
      available_days: user.availability.available_days,
      available_time: user.availability.available_time,
      receive_requests: user.availability.receive_requests,
      availability_status: user.availability.availability_status,
      pricing: user.availability.pricing,
      platform_commission_percent: 15,
      profile_step_pending: null,
      profile_completed: true
    }
  });
});

// 7.3 Get Current Availability & Pricing
router.get('/availability', authenticateToken, (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const avail = user.availability || {
    available_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    available_time: { from: "10:00 AM", to: "09:00 PM" },
    receive_requests: true,
    availability_status: "Available",
    pricing: [],
    platform_commission_percent: 15
  };

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      available_days: avail.available_days,
      available_time: avail.available_time,
      receive_requests: avail.receive_requests,
      availability_status: avail.availability_status,
      pricing: avail.pricing,
      platform_commission_percent: avail.platform_commission_percent || 15,
      profile_step_pending: user.profile_step_pending || null,
      profile_completed: user.profile_completed || false
    }
  });
});

// 7.4 Toggle "Receive Requests" only
router.patch('/availability/receive-requests', authenticateToken, (req, res) => {
  const { receive_requests } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (user.availability) {
    user.availability.receive_requests = Boolean(receive_requests);
    user.availability.availability_status = receive_requests ? "Available" : "Unavailable";
  } else {
    user.availability = {
      available_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      available_time: { from: "10:00 AM", to: "09:00 PM" },
      receive_requests: Boolean(receive_requests),
      availability_status: receive_requests ? "Available" : "Unavailable",
      pricing: [],
      platform_commission_percent: 15
    };
  }

  return res.status(200).json({
    status: true,
    message: "Availability status updated",
    data: {
      receive_requests: user.availability.receive_requests,
      availability_status: user.availability.availability_status
    }
  });
});

// -----------------------------------------------------------------------------
// 15. WITHDRAW & BANK ACCOUNT DETAILS API
// -----------------------------------------------------------------------------

const SUPPORT_NOTE = "Please fill all the details carefully. If you need to change your account details and add new account details, please contact our support executive via Mail: me24with@gmail.com";

// Helper to save Bank Account Details
function handleSaveBankAccount(req, res) {
  const { account_holder_name, bank_name, account_number, ifsc_code, upi_id } = req.body || {};
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  // Restrict adding again if already submitted
  if (user.bank_account) {
    return res.status(400).json({
      status: false,
      message: "Bank account details have already been submitted and locked. To change account details, please contact support at me24with@gmail.com",
      error_code: "BANK_ACCOUNT_LOCKED",
      data: {
        bank_account: user.bank_account,
        account_added: true,
        support_note: SUPPORT_NOTE
      }
    });
  }

  if (!account_holder_name || !String(account_holder_name).trim()) {
    return res.status(400).json({
      status: false,
      message: "Account holder name is required",
      error_code: "ACCOUNT_HOLDER_NAME_REQUIRED"
    });
  }

  if (!bank_name || !String(bank_name).trim()) {
    return res.status(400).json({
      status: false,
      message: "Bank name is required",
      error_code: "BANK_NAME_REQUIRED"
    });
  }

  if (!account_number || !String(account_number).trim()) {
    return res.status(400).json({
      status: false,
      message: "Account number is required",
      error_code: "ACCOUNT_NUMBER_REQUIRED"
    });
  }

  if (!ifsc_code || !String(ifsc_code).trim()) {
    return res.status(400).json({
      status: false,
      message: "IFSC code is required",
      error_code: "IFSC_CODE_REQUIRED"
    });
  }

  user.bank_account = {
    account_holder_name: String(account_holder_name).trim(),
    bank_name: String(bank_name).trim(),
    account_number: String(account_number).trim(),
    ifsc_code: String(ifsc_code).trim().toUpperCase(),
    upi_id: upi_id ? String(upi_id).trim() : "",
    added_at: new Date().toISOString()
  };

  saveUsers();

  return res.status(200).json({
    status: true,
    message: "Bank account details added successfully",
    data: {
      bank_account: user.bank_account,
      account_added: true,
      support_note: SUPPORT_NOTE
    }
  });
}

// Helper to fetch Bank Account Details
function handleGetBankAccount(req, res) {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      bank_account: user.bank_account || null,
      account_added: Boolean(user.bank_account),
      support_note: SUPPORT_NOTE
    }
  });
}

// Helper to submit Withdrawal Request
function handleWithdrawRequest(req, res) {
  const { amount } = req.body || {};
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (!user.bank_account) {
    return res.status(400).json({
      status: false,
      message: "Please add your bank account details before requesting a withdrawal",
      error_code: "BANK_ACCOUNT_REQUIRED",
      data: {
        bank_account: null,
        account_added: false,
        support_note: SUPPORT_NOTE
      }
    });
  }

  const withdrawAmount = Number(amount) || 500;
  const withdrawal_id = `wth_${Date.now()}`;

  return res.status(200).json({
    status: true,
    message: "Withdrawal request submitted successfully",
    data: {
      withdrawal_id,
      amount: withdrawAmount,
      status: "Pending",
      bank_account: user.bank_account,
      support_note: SUPPORT_NOTE
    }
  });
}

// Register Bank Account & Withdraw Routes with multiple endpoint aliases
router.post('/withdraw/bank-account', authenticateToken, handleSaveBankAccount);
router.post('/bank-account', authenticateToken, handleSaveBankAccount);

router.get('/withdraw/bank-account', authenticateToken, handleGetBankAccount);
router.get('/bank-account', authenticateToken, handleGetBankAccount);

router.post('/withdraw', authenticateToken, handleWithdrawRequest);
router.post('/withdraw/request', authenticateToken, handleWithdrawRequest);

module.exports = router;

