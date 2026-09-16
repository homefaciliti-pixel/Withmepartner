const express = require('express');
const router = express.Router();
const { users } = require('../store/db');
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

// 7.2 Submit Availability & Pricing
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
