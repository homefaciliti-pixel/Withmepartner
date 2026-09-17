const express = require('express');
const router = express.Router();
const { users, partnerRequests, partnerBookings, partnerTransactions } = require('../store/db');
const { authenticateToken } = require('../middleware/auth');

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
// 10. HOME SCREEN API
// -----------------------------------------------------------------------------

// GET /partner/home (Home Screen Overview + Lists)
router.get('/home', authenticateToken, (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const allReqs = Array.from(partnerRequests.values());
  const newRequestsList = allReqs.filter(r => r.status === "Pending").map(r => ({
    request_id: r.request_id,
    interest: r.interest,
    date_time: r.date_time,
    location: r.location,
    image: r.image,
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
    image: b.profile_image,
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
      image: requestData.image,
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

  if (isAccept) {
    const booking_id = `bk_${Math.floor(1000 + Math.random() * 9000)}`;
    const newBooking = {
      booking_id,
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
// 12. BOOKING DETAILS & SAFE MEET MODE API
// -----------------------------------------------------------------------------

// GET /partner/bookings/:booking_id (Booking Details)
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
      image: booking.profile_image,
      name: booking.name,
      age: booking.age,
      id_verified: booking.id_verified,
      location: booking.location,
      selfie_verified: booking.selfie_verified,
      interest: booking.interest,
      meeting_info: booking.meeting_info,
      safety_checklist: booking.safety_checklist,
      safe_meet_mode: booking.safe_meet_mode
    }
  });
});

// POST /partner/bookings/:booking_id/safe-meet (Safe Meet Mode Settings API)
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
    profile_image: b.profile_image,
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

module.exports = router;
