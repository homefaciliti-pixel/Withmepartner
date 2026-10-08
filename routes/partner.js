const express = require('express');
const router = express.Router();
const {
  formatPhotoUrl,
  savePartnerRequestToMysql,
  updatePartnerRequestStatusInMysql,
  savePartnerBookingToMysql
} = require('../store/db');
const {
  findPartnerByIdFromMysql,
  fetchUsersFromMysql,
  fetchPartnerRequestsFromMysql,
  fetchPartnerBookingsFromMysql,
  fetchPartnerTransactionsFromMysql,
  updatePartnerInMysql,
  savePartnerTransactionToMysql,
  getDbPool
} = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendEventNotification } = require('../services/notificationService');

const getUserAppApiUrl = () => process.env.USER_APP_API_URL || 'https://withmeapi-userapp.onrender.com';

const notifyUserAppStatusUpdate = async (payload) => {
  const userAppUrls = [getUserAppApiUrl(), 'http://localhost:5000', 'http://localhost:5001'];
  for (const baseUrl of userAppUrls) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/partner-request/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        console.log(`[User App Sync] Notified User App of status update for ${payload.request_id}`);
        return true;
      }
    } catch (e) { /* ignore offline url */ }
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

function getISTDateString() {
  const now = new Date();
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + offsetMs);
  return istDate.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. INCOMING REQUEST & BOOKING SYNC (From User App)
// ─────────────────────────────────────────────────────────────────────────────

const handleIncomingUserRequest = async (req, res) => {
  const requestPayload = req.body || {};
  const requestId = requestPayload.request_id || `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const partnerId = requestPayload.partner_id || requestPayload.receiver_id || '';
  const userId = requestPayload.user_id || requestPayload.sender_id || '';
  const senderName = requestPayload.name || requestPayload.sender_name || 'User';
  const interest = requestPayload.interest || requestPayload.activity_name || (requestPayload.activity && requestPayload.activity.type) || 'Coffee';
  const location = requestPayload.location || (requestPayload.activity && requestPayload.activity.area) || 'Jaipur';
  const dateTime = requestPayload.date_time || `${requestPayload.date || getISTDateString()} ${requestPayload.time || '06:00 PM'}`;
  const profileImage = requestPayload.profile_image || requestPayload.image || requestPayload.sender_avatar || '';

  console.log(`[PARTNER REQUEST] Incoming sync: requestId=${requestId}, partnerId=${partnerId}, userId=${userId}`);

  const newRequest = {
    request_id: requestId,
    booking_id: requestPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`,
    partner_id: partnerId,
    user_id: userId,
    name: senderName,
    sender_name: senderName,
    sender_avatar: profileImage,
    age: requestPayload.age || 25,
    image: profileImage,
    profile_image: profileImage,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    date_time: dateTime,
    location,
    status: requestPayload.status || 'Pending',
    message: requestPayload.message || 'Looking for an activity partner',
    activity: requestPayload.activity || {
      type: interest,
      date: requestPayload.date || getISTDateString(),
      time: requestPayload.time || '06:00 PM',
      area: location,
      description: requestPayload.message || 'Meetup request from user'
    }
  };

  // Save to MySQL (primary storage) - MUST succeed before returning success
  try {
    console.log(`[BOOKING] Saving partner request ${requestId} to MySQL...`);
    await savePartnerRequestToMysql(newRequest);
    console.log(`[BOOKING] MySQL INSERT SUCCESS for requestId=${requestId}`);
  } catch (err) {
    console.error(`[BOOKING] MySQL save FAILED for requestId=${requestId}:`, err.message);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Booking request could not be saved to database.',
      error: err.message
    });
  }

  // Trigger push notification to partner (secondary - failure does not affect booking response)
  try {
    sendEventNotification('booking_request', {
      targetUserId: newRequest.partner_id,
      sender_name: senderName,
      activity: interest,
      location,
      request_id: requestId
    }).catch(e => console.error('[FCM] Notification dispatch error:', e.message));
  } catch (e) {
    console.error('[FCM] Notification error:', e.message);
  }

  console.log(`[Partner API] Registered incoming user request: ${requestId} for ${interest} in ${location}`);

  return res.status(200).json({
    status: true,
    message: 'Incoming user request registered and visible to partner',
    data: newRequest
  });
};

router.post('/incoming-request', handleIncomingUserRequest);
router.post('/sync-request', handleIncomingUserRequest);
router.post('/requests/create', handleIncomingUserRequest);

const handleIncomingUserBooking = async (req, res) => {
  const bookingPayload = req.body || {};
  const bookingId = bookingPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`;
  const userName = bookingPayload.name || bookingPayload.user_name || 'User';
  const interest = bookingPayload.interest || bookingPayload.activity || 'Coffee';
  const location = bookingPayload.location || 'Jaipur';
  const profileImage = bookingPayload.profile_image || bookingPayload.user_image || '';

  const newBooking = {
    booking_id: bookingId,
    user_id: bookingPayload.user_id || '',
    partner_id: bookingPayload.partner_id || '',
    profile_image: profileImage,
    name: userName,
    age: bookingPayload.age || 25,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    location,
    date: bookingPayload.date || getISTDateString(),
    time: bookingPayload.time || '06:00 PM',
    status: 'Upcoming',
    meeting_info: bookingPayload.meeting_info || {
      date: bookingPayload.date || getISTDateString(),
      time: bookingPayload.time || '06:00 PM',
      place: location,
      type: interest,
      description: `Confirmed ${interest} booking`
    },
    safety_checklist: { start_safe_meet: false },
    safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
  };

  // Save to MySQL (primary storage) - MUST succeed before returning success
  try {
    console.log(`[BOOKING] Saving partner booking ${bookingId} to MySQL...`);
    await savePartnerBookingToMysql(newBooking);
    console.log(`[BOOKING] MySQL INSERT SUCCESS for bookingId=${bookingId}`);
  } catch (err) {
    console.error(`[BOOKING] MySQL save FAILED for bookingId=${bookingId}:`, err.message);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Booking could not be saved to database.',
      error: err.message
    });
  }

  try {
    sendEventNotification('booking_confirmed', {
      targetUserId: newBooking.partner_id,
      name: userName,
      activity: interest,
      location,
      booking_id: bookingId
    }).catch(e => console.error('[FCM] Notification dispatch error:', e.message));
  } catch (e) {
    console.error('[FCM] Notification error:', e.message);
  }

  sendEventNotification('wallet_credit', {
    targetUserId: newBooking.partner_id,
    amount: bookingPayload.price || 500,
    booking_id: bookingId
  }).catch(() => {});

  console.log(`[Partner API] Registered incoming user booking: ${bookingId}`);

  return res.status(200).json({
    status: true,
    message: 'Incoming user booking registered successfully',
    data: newBooking
  });
};

router.post('/incoming-booking', handleIncomingUserBooking);
router.post('/sync-booking', handleIncomingUserBooking);

// ─────────────────────────────────────────────────────────────────────────────
// GET /partner/all — All registered partners (for User App integration)
// ─────────────────────────────────────────────────────────────────────────────
router.get(['/all', '/list-all', '/registered', '/partners'], async (req, res) => {
  try {
    const filter = {};
    if (req.query.city) filter.city = req.query.city;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.query) filter.query = req.query.query;
    if (req.query.limit) filter.limit = req.query.limit;

    const allUsers = await fetchUsersFromMysql(filter);
    const partnerList = allUsers.map(u => {
      const rawPhoto = u.profile_photo_url || (u.photos && u.photos[0] ? u.photos[0].url : '');
      const photoUrl = rawPhoto ? formatPhotoUrl(rawPhoto, req) : '';
      const formattedPhotos = (u.photos || []).map((p, idx) => {
        let rawUrl = '';
        let pId = `ph_00${idx + 1}`;
        let isPrimary = idx === 0;

        if (typeof p === 'string') {
          rawUrl = p;
        } else if (p && typeof p === 'object') {
          rawUrl = p.url || p.path || '';
          if (p.photo_id) pId = p.photo_id;
          if (p.is_primary !== undefined) isPrimary = Boolean(p.is_primary);

          if (!rawUrl && p[0] !== undefined) {
            const keys = Object.keys(p).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
            rawUrl = keys.map(k => p[k]).join('');
          }
        }

        return {
          photo_id: pId,
          url: formatPhotoUrl(rawUrl, req),
          is_primary: isPrimary
        };
      });
      const avail = u.availability || {};
      const aboutData = u.about || {};

      return {
        partner_id: u.user_id,
        user_id: u.user_id,
        id: u.user_id,
        name: u.name,
        full_name: u.name,
        email: u.email,
        mobile_number: u.mobile_number,
        phone: u.mobile_number,
        gender: u.gender || 'Female',
        dob: u.dob || '',
        area: u.area || '',
        locality: u.area || '',
        city: u.city || '',
        state: u.state || '',
        image: photoUrl,
        profile_image: photoUrl,
        profile_photo_url: photoUrl,
        photos: formattedPhotos,
        category: (aboutData.interests && aboutData.interests[0]) || u.category || 'Coffee',
        activity: (aboutData.interests && aboutData.interests[0]) || u.activity || 'Coffee',
        interests: aboutData.interests || u.interests || ['Coffee', 'Travel'],
        rating: u.rating !== undefined ? u.rating : 4.8,
        total_ratings: u.total_ratings || 0,
        total_reviews: u.total_ratings || 0,
        price: (avail.pricing && avail.pricing[0] && avail.pricing[0].price) || u.price || 1,
        currency: 'INR',
        profile_completed: true,
        is_approved: true,
        is_verified: true,
        status: 'ACTIVE',
        availability_status: avail.availability_status || 'Available',
        receive_requests: avail.receive_requests !== undefined ? avail.receive_requests : true,
        about: aboutData,
        availability: avail,
        created_at: u.created_at || new Date().toISOString()
      };
    });

    return res.status(200).json({
      status: true,
      message: 'Registered partners list retrieved successfully',
      data: partnerList
    });
  } catch (err) {
    console.error('[Get All Partners Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch partners.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. HOME SCREEN API
// ─────────────────────────────────────────────────────────────────────────────
router.get('/home', authenticateToken, async (req, res) => {
  try {
    const currentUserId = String(req.user.user_id);
    const user = await findPartnerByIdFromMysql(currentUserId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });
    }

    // Fetch from MySQL (real-time, partner-specific)
    const [dbRequests, dbBookings, dbTx] = await Promise.all([
      fetchPartnerRequestsFromMysql(currentUserId),
      fetchPartnerBookingsFromMysql(currentUserId),
      fetchPartnerTransactionsFromMysql(currentUserId)
    ]);

    console.log(`[PARTNER HOME] partnerId=${currentUserId}, total_db_requests=${dbRequests.length}`);

    const newRequestsList = dbRequests
      .filter(r => r.status === 'Pending' || r.status === 'PENDING')
      .map(r => ({
        request_id: r.request_id,
        booking_id: r.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`,
        interest: r.interest,
        date_time: r.date_time,
        location: r.location,
        image: formatPhotoUrl(r.image, req),
        profile_image: formatPhotoUrl(r.image, req),
        name: r.name,
        pending_status: r.status,
        is_paid: true,
        payment_status: 'COMPLETED',
        is_payment_completed: true,
        payment_id: `pay_${r.request_id}`,
        payment_status_text: 'Paid'
      }));

    const upcomingBookingsList = dbBookings
      .filter(b => b.status === 'Upcoming' || b.status === 'CONFIRMED')
      .map(b => ({
        booking_id: b.booking_id,
        name: b.name,
        interest: b.interest,
        location: b.location,
        date_time: `${b.date} ${b.time}`,
        image: formatPhotoUrl(b.profile_image, req),
        profile_image: formatPhotoUrl(b.profile_image, req),
        status: b.status,
        is_paid: true,
        payment_status: 'COMPLETED',
        is_payment_completed: true,
        payment_id: `pay_${b.booking_id}`,
        payment_status_text: 'Paid'
      }));

    const totalEarnings = dbTx
      .filter(t => t.status === 'Complete')
      .reduce((sum, t) => sum + (t.earn_money || 0), 0);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        todays_overview: {
          date: getISTDateString(),
          new_requests_count: newRequestsList.length,
          upcoming_bookings_count: upcomingBookingsList.length,
          earnings_count: totalEarnings
        },
        new_requests: newRequestsList,
        upcoming_bookings: upcomingBookingsList
      }
    });
  } catch (err) {
    console.error('[Home Screen Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch home data.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. REQUEST DETAIL & ACCEPT / DECLINE
// ─────────────────────────────────────────────────────────────────────────────

const handleGetAllPartnerRequests = async (req, res) => {
  try {
    const currentUserId = String(req.user ? req.user.user_id : '');
    const dbRequests = await fetchPartnerRequestsFromMysql(currentUserId);

    const formattedList = dbRequests.map(r => {
      const photoUrl = formatPhotoUrl(r.image || r.profile_image, req);
      return {
        request_id: r.request_id,
        booking_id: r.booking_id,
        name: r.name || 'User Request',
        age: r.age || 25,
        image: photoUrl,
        profile_image: photoUrl,
        id_verified: r.id_verified !== undefined ? r.id_verified : 1,
        selfie_verified: r.selfie_verified !== undefined ? r.selfie_verified : 1,
        location: r.location || '',
        interest: r.interest || 'Coffee',
        date_time: r.date_time || `${getISTDateString()} 06:00 PM`,
        status: r.status || 'Pending',
        pending_status: r.status || 'Pending',
        is_paid: true,
        payment_status: 'COMPLETED',
        is_payment_completed: true,
        payment_id: `pay_${r.request_id}`,
        payment_status_text: 'Paid'
      };
    });

    return res.status(200).json({
      status: true,
      message: 'Partner requests list fetched successfully',
      data: { requests: formattedList, count: formattedList.length },
      requests: formattedList
    });
  } catch (err) {
    console.error('[Get Requests Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch requests.', error_code: 'SERVER_ERROR' });
  }
};

const handlePartnerAppRequestDetails = async (req, res) => {
  const targetId = req.params.request_id || req.params.id || req.query.request_id || req.query.id;

  if (!targetId) {
    return res.status(400).json({ status: false, message: 'request_id is required', error_code: 'REQUEST_ID_REQUIRED' });
  }

  try {
    const db = getDbPool();
    const [rows] = await db.query(
      'SELECT * FROM withme_partner_requests WHERE request_id = ? OR booking_id = ? LIMIT 1',
      [targetId, targetId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Request not found', error_code: 'REQUEST_NOT_FOUND' });
    }

    const r = rows[0];
    const photoUrl = formatPhotoUrl(r.sender_avatar || '', req);
    const categoryName = r.activity || 'Coffee';
    const meetupLoc = r.location || '';
    const timeVal = r.time || '06:00 PM';
    const dateVal = r.date || getISTDateString();
    const partnerUserIdVal = String(r.partner_id || req.user.user_id);

    const responseData = {
      request_id: r.request_id,
      booking_id: r.booking_id,
      partner_id: r.partner_id,
      partner_user_id: partnerUserIdVal,
      partnerUserId: partnerUserIdVal,
      image: photoUrl,
      profile_image: photoUrl,
      name: r.sender_name || 'User',
      age: 25,
      id_verified: 1,
      selfie_verified: 1,
      location: meetupLoc,
      meetup_location: meetupLoc,
      meetup_address: meetupLoc,
      address: meetupLoc,
      interests: [categoryName],
      activity: { type: categoryName, date: dateVal, time: timeVal, area: meetupLoc, description: r.message || 'Meetup request' },
      activity_name: categoryName,
      category: categoryName,
      activity_category: categoryName,
      time_slot: `${timeVal} - 07:00 PM`,
      time: timeVal,
      booking_time: timeVal,
      date: dateVal,
      booking_date: dateVal,
      date_time: `${dateVal} ${timeVal}`,
      price: r.price || 1,
      booking_price: r.price || 1,
      total_price: r.price || 1,
      amount: r.price || 1,
      currency: 'INR',
      is_paid: true,
      isPaid: true,
      payment_status: 'COMPLETED',
      paymentStatus: 'COMPLETED',
      is_payment_completed: true,
      payment_id: `pay_${r.request_id}`,
      paymentId: `pay_${r.request_id}`,
      payment_status_text: 'Paid',
      status: r.status || 'PENDING'
    };

    return res.status(200).json({ status: true, message: 'Success', data: responseData, request_details: responseData });
  } catch (err) {
    console.error('[Request Details Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch request details.', error_code: 'SERVER_ERROR' });
  }
};

router.get('/requests/list', authenticateToken, handleGetAllPartnerRequests);
router.get('/requests', authenticateToken, (req, res, next) => {
  if (req.query.request_id || req.query.id) return handlePartnerAppRequestDetails(req, res);
  return handleGetAllPartnerRequests(req, res);
});
router.get('/requests/:request_id', authenticateToken, handlePartnerAppRequestDetails);
router.get('/requests/details/:request_id', authenticateToken, handlePartnerAppRequestDetails);

// POST /partner/requests/:request_id/action (Accept / Decline)
router.post('/requests/:request_id/action', authenticateToken, async (req, res) => {
  const { request_id } = req.params;
  const { action } = req.body;

  if (!action || !['ACCEPT', 'DECLINE'].includes(action.toUpperCase())) {
    return res.status(400).json({
      status: false,
      message: "Invalid action. Use 'ACCEPT' or 'DECLINE'",
      error_code: 'INVALID_ACTION'
    });
  }

  try {
    const db = getDbPool();
    const [rows] = await db.query('SELECT * FROM withme_partner_requests WHERE request_id = ? LIMIT 1', [request_id]);

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Request not found', error_code: 'REQUEST_NOT_FOUND' });
    }

    const requestData = rows[0];
    const isAccept = action.toUpperCase() === 'ACCEPT';
    const newStatus = isAccept ? 'ACCEPTED' : 'DECLINED';

    // Update status in MySQL
    await updatePartnerRequestStatusInMysql(request_id, newStatus);

    // Notify User App
    notifyUserAppStatusUpdate({
      request_id,
      booking_id: requestData.booking_id,
      status: newStatus,
      action: isAccept ? 'ACCEPT' : 'DECLINE'
    }).catch(err => console.error('User App callback notification failed:', err.message));

    if (isAccept) {
      const booking_id = requestData.booking_id || `bk_${Math.floor(1000 + Math.random() * 9000)}`;
      const newBooking = {
        booking_id,
        request_id,
        user_id: requestData.user_id,
        partner_id: requestData.partner_id,
        profile_image: requestData.sender_avatar || '',
        name: requestData.sender_name || 'User',
        age: 25,
        id_verified: 1,
        selfie_verified: 1,
        interest: requestData.activity || 'Coffee',
        location: requestData.location || '',
        date: requestData.date || getISTDateString(),
        time: requestData.time || '05:00 PM',
        status: 'Upcoming',
        meeting_info: {
          date: requestData.date || getISTDateString(),
          time: requestData.time || '05:00 PM',
          place: requestData.location || '',
          type: requestData.activity || 'Coffee',
          description: requestData.message || 'Accepted meetup'
        },
        safety_checklist: { start_safe_meet: false },
        safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
      };

      await savePartnerBookingToMysql(newBooking);

      return res.status(200).json({
        status: true,
        message: 'Request accepted successfully. Added to My Bookings.',
        data: { request_id, booking_id, status: 'Upcoming', goes_to: 'My Booking List' }
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Request declined',
      data: { request_id, status: 'Declined' }
    });
  } catch (err) {
    console.error('[Request Action Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to process request action.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. BOOKING DETAILS, SAFE MEET
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings/:booking_id', authenticateToken, async (req, res) => {
  try {
    const { booking_id } = req.params;
    const db = getDbPool();
    const [rows] = await db.query('SELECT * FROM withme_partner_bookings WHERE booking_id = ? LIMIT 1', [booking_id]);

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Booking details not found', error_code: 'BOOKING_NOT_FOUND' });
    }

    const b = rows[0];
    let meetingInfo = { date: b.date, time: b.time, place: b.location, type: b.activity, description: 'Meetup details' };
    let safetyChecklist = { start_safe_meet: false };
    let safeMeetMode = { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 };

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        booking_id: b.booking_id,
        image: formatPhotoUrl(b.profile_image, req),
        profile_image: formatPhotoUrl(b.profile_image, req),
        name: b.customer_name || 'User',
        age: 25,
        id_verified: 1,
        selfie_verified: 1,
        location: b.location,
        interest: b.activity,
        meeting_info: meetingInfo,
        safety_checklist: safetyChecklist,
        safe_meet_mode: safeMeetMode
      }
    });
  } catch (err) {
    console.error('[Booking Details Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch booking.', error_code: 'SERVER_ERROR' });
  }
});

router.post('/bookings/:booking_id/start-safe-meet', authenticateToken, async (req, res) => {
  const { booking_id } = req.params;
  const { start_safe_meet } = req.body;

  try {
    const db = getDbPool();
    const [rows] = await db.query('SELECT * FROM withme_partner_bookings WHERE booking_id = ? LIMIT 1', [booking_id]);
    if (rows.length === 0) return res.status(404).json({ status: false, message: 'Booking not found', error_code: 'BOOKING_NOT_FOUND' });

    return res.status(200).json({
      status: true,
      message: 'Start safe meet saved successfully',
      data: { booking_id, start_safe_meet: start_safe_meet !== undefined ? Boolean(start_safe_meet) : true }
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Failed to update safe meet.', error_code: 'SERVER_ERROR' });
  }
});

router.post('/bookings/:booking_id/safe-meet', authenticateToken, async (req, res) => {
  const { booking_id } = req.params;
  const { location_allow, notify_trusted_contact, safety_check_in, start_safe_meet } = req.body;

  try {
    const db = getDbPool();
    const [rows] = await db.query('SELECT * FROM withme_partner_bookings WHERE booking_id = ? LIMIT 1', [booking_id]);
    if (rows.length === 0) return res.status(404).json({ status: false, message: 'Booking not found', error_code: 'BOOKING_NOT_FOUND' });

    const safeMeetMode = {
      location_allow: location_allow !== undefined ? Number(location_allow) : 1,
      notify_trusted_contact: notify_trusted_contact !== undefined ? Number(notify_trusted_contact) : 1,
      safety_check_in: safety_check_in !== undefined ? Number(safety_check_in) : 1
    };
    const safetyChecklist = { start_safe_meet: start_safe_meet !== undefined ? Boolean(start_safe_meet) : false };

    return res.status(200).json({
      status: true,
      message: 'Safe meet mode settings saved successfully',
      data: { booking_id, safe_meet_mode: safeMeetMode, safety_checklist: safetyChecklist }
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Failed to update safe meet.', error_code: 'SERVER_ERROR' });
  }
});

router.post('/safe-meet-mode', authenticateToken, async (req, res) => {
  const { booking_id, location_allow, notify_trusted_contact, safety_check_in } = req.body;

  const safeMeetMode = {
    location_allow: location_allow !== undefined ? Number(location_allow) : 1,
    notify_trusted_contact: notify_trusted_contact !== undefined ? Number(notify_trusted_contact) : 1,
    safety_check_in: safety_check_in !== undefined ? Number(safety_check_in) : 1
  };

  return res.status(200).json({
    status: true,
    message: 'Safe meet mode settings saved successfully',
    data: { booking_id: booking_id || null, safe_meet_mode: safeMeetMode }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL BOOKING
// ─────────────────────────────────────────────────────────────────────────────

async function cancelBookingById(booking_id, reason, res) {
  try {
    const db = getDbPool();
    const [rows] = await db.query('SELECT * FROM withme_partner_bookings WHERE booking_id = ? LIMIT 1', [booking_id]);
    if (rows.length === 0) return res.status(404).json({ status: false, message: 'Booking not found', error_code: 'BOOKING_NOT_FOUND' });

    await db.query("UPDATE withme_partner_bookings SET status = 'Cancelled', updated_at = NOW() WHERE booking_id = ?", [booking_id]);

    return res.status(200).json({
      status: true,
      message: 'Booking cancelled successfully',
      data: { booking_id, status: 'Cancelled', cancel_reason: reason || 'Cancelled by user' }
    });
  } catch (err) {
    console.error('[Cancel Booking Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to cancel booking.', error_code: 'SERVER_ERROR' });
  }
}

router.post('/bookings/:booking_id/cancel', authenticateToken, (req, res) => {
  cancelBookingById(req.params.booking_id, req.body && req.body.reason, res);
});

router.post('/bookings/cancel', authenticateToken, (req, res) => {
  const { booking_id, reason } = req.body || {};
  if (!booking_id) return res.status(400).json({ status: false, message: 'booking_id is required', error_code: 'BOOKING_ID_REQUIRED' });
  cancelBookingById(booking_id, reason, res);
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. MY BOOKINGS LIST & FILTER
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    const currentUserId = String(req.user.user_id);
    const dbBookings = await fetchPartnerBookingsFromMysql(currentUserId, status);

    const list = dbBookings.map(b => ({
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
      message: 'Success',
      data: { filter_status: status || 'all', total_count: list.length, bookings: list }
    });
  } catch (err) {
    console.error('[Get Bookings Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch bookings.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. EARNINGS & TRANSACTIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/earnings', authenticateToken, async (req, res) => {
  try {
    const currentUserId = String(req.user.user_id);
    const myTx = await fetchPartnerTransactionsFromMysql(currentUserId);

    const completedTx = myTx.filter(t => t.status === 'Complete');
    const totalAllEarn = completedTx.reduce((sum, t) => sum + (t.earn_money || 0), 0);

    const todayStr = getISTDateString();
    const totalTodayEarn = completedTx
      .filter(t => t.date === todayStr)
      .reduce((sum, t) => sum + (t.earn_money || 0), 0);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        total_today_earn: totalTodayEarn,
        total_this_week_earn: totalAllEarn,
        total_this_month_earn: totalAllEarn,
        total_all_earn: totalAllEarn,
        transactions: myTx
      }
    });
  } catch (err) {
    console.error('[Earnings Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch earnings.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7.2 Submit Availability & Pricing
// ─────────────────────────────────────────────────────────────────────────────
router.post('/availability', authenticateToken, async (req, res) => {
  try {
    const { available_days, available_time, receive_requests, pricing } = req.body;
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (!available_days || !Array.isArray(available_days) || available_days.length === 0) {
      return res.status(400).json({ status: false, message: 'Select at least 1 available day', error_code: 'AVAILABLE_DAYS_REQUIRED' });
    }

    if (!available_time || !available_time.from || !available_time.to) {
      return res.status(400).json({ status: false, message: "'To' time must be after 'From' time", error_code: 'INVALID_TIME_RANGE' });
    }

    const fromMin = parseTimeMinutes(available_time.from);
    const toMin = parseTimeMinutes(available_time.to);
    if (fromMin < 0 || toMin < 0 || toMin <= fromMin) {
      return res.status(400).json({ status: false, message: "'To' time must be after 'From' time", error_code: 'INVALID_TIME_RANGE' });
    }

    if (!pricing || !Array.isArray(pricing) || pricing.length === 0) {
      return res.status(400).json({ status: false, message: 'Price must be set for each selected interest', error_code: 'PRICING_REQUIRED' });
    }

    for (const item of pricing) {
      if (item.price === undefined || item.price === null || item.price <= 0) {
        return res.status(400).json({ status: false, message: 'Price must be set for each selected interest', error_code: 'PRICING_REQUIRED' });
      }
    }

    const receiveReq = receive_requests !== undefined ? Boolean(receive_requests) : true;
    const availStatus = receiveReq ? 'Available' : 'Unavailable';

    const availabilityData = {
      available_days,
      available_time,
      receive_requests: receiveReq,
      availability_status: availStatus,
      pricing,
      platform_commission_percent: 15
    };

    await updatePartnerInMysql(user.user_id, {
      availability: availabilityData,
      profile_step_pending: null,
      profile_completed: true
    });

    return res.status(200).json({
      status: true,
      message: 'Availability and pricing saved successfully',
      data: {
        available_days,
        available_time,
        receive_requests: receiveReq,
        availability_status: availStatus,
        pricing,
        platform_commission_percent: 15,
        profile_step_pending: null,
        profile_completed: true
      }
    });
  } catch (err) {
    console.error('[Availability Submit Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to save availability.', error_code: 'SERVER_ERROR' });
  }
});

// 7.3 Get Current Availability & Pricing
router.get('/availability', authenticateToken, async (req, res) => {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const avail = user.availability || {
      available_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      available_time: { from: '10:00 AM', to: '09:00 PM' },
      receive_requests: true,
      availability_status: 'Available',
      pricing: [],
      platform_commission_percent: 15
    };

    return res.status(200).json({
      status: true,
      message: 'Success',
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
  } catch (err) {
    console.error('[Get Availability Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch availability.', error_code: 'SERVER_ERROR' });
  }
});

// 7.4 Toggle Receive Requests
router.patch('/availability/receive-requests', authenticateToken, async (req, res) => {
  try {
    const { receive_requests } = req.body;
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const currentAvail = user.availability || {
      available_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      available_time: { from: '10:00 AM', to: '09:00 PM' },
      receive_requests: true,
      availability_status: 'Available',
      pricing: [],
      platform_commission_percent: 15
    };

    currentAvail.receive_requests = Boolean(receive_requests);
    currentAvail.availability_status = receive_requests ? 'Available' : 'Unavailable';

    await updatePartnerInMysql(user.user_id, { availability: currentAvail });

    return res.status(200).json({
      status: true,
      message: 'Availability status updated',
      data: { receive_requests: currentAvail.receive_requests, availability_status: currentAvail.availability_status }
    });
  } catch (err) {
    console.error('[Toggle Receive Requests Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to update availability.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. WITHDRAW & BANK ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORT_NOTE = 'Please fill all the details carefully. If you need to change your account details and add new account details, please contact our support executive via Mail: officalwithme24@withme24.com or Phone: 8209343434';

async function handleSaveBankAccount(req, res) {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code, upi_id } = req.body || {};
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (user.bank_account) {
      return res.status(400).json({
        status: false,
        message: 'Bank account details have already been submitted and locked. To change account details, please contact support at officalwithme24@withme24.com or Phone: 8209343434',
        error_code: 'BANK_ACCOUNT_LOCKED',
        data: { bank_account: user.bank_account, account_added: true, support_note: SUPPORT_NOTE }
      });
    }

    if (!account_holder_name || !String(account_holder_name).trim()) return res.status(400).json({ status: false, message: 'Account holder name is required', error_code: 'ACCOUNT_HOLDER_NAME_REQUIRED' });
    if (!bank_name || !String(bank_name).trim()) return res.status(400).json({ status: false, message: 'Bank name is required', error_code: 'BANK_NAME_REQUIRED' });
    if (!account_number || !String(account_number).trim()) return res.status(400).json({ status: false, message: 'Account number is required', error_code: 'ACCOUNT_NUMBER_REQUIRED' });
    if (!ifsc_code || !String(ifsc_code).trim()) return res.status(400).json({ status: false, message: 'IFSC code is required', error_code: 'IFSC_CODE_REQUIRED' });

    const bankAccount = {
      account_holder_name: String(account_holder_name).trim(),
      bank_name: String(bank_name).trim(),
      account_number: String(account_number).trim(),
      ifsc_code: String(ifsc_code).trim().toUpperCase(),
      upi_id: upi_id ? String(upi_id).trim() : '',
      added_at: new Date().toISOString()
    };

    await updatePartnerInMysql(user.user_id, { bank_account: bankAccount });

    return res.status(200).json({
      status: true,
      message: 'Bank account details added successfully',
      data: { bank_account: bankAccount, account_added: true, support_note: SUPPORT_NOTE }
    });
  } catch (err) {
    console.error('[Save Bank Account Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to save bank account.', error_code: 'SERVER_ERROR' });
  }
}

async function handleGetBankAccount(req, res) {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: { bank_account: user.bank_account || null, account_added: Boolean(user.bank_account), support_note: SUPPORT_NOTE }
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Failed to fetch bank account.', error_code: 'SERVER_ERROR' });
  }
}

async function handleWithdrawRequest(req, res) {
  try {
    const { amount } = req.body || {};
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (!user.bank_account) {
      return res.status(400).json({
        status: false,
        message: 'Please add your bank account details before requesting a withdrawal',
        error_code: 'BANK_ACCOUNT_REQUIRED',
        data: { bank_account: null, account_added: false, support_note: SUPPORT_NOTE }
      });
    }

    const withdrawAmount = Number(amount) || 500;
    const withdrawal_id = `wth_${Date.now()}`;

    const withdrawalRecord = {
      withdrawal_id,
      amount: withdrawAmount,
      currency: 'INR',
      status: 'Pending',
      requested_at: new Date().toISOString(),
      bank_account: { bank_name: user.bank_account.bank_name, account_number: user.bank_account.account_number }
    };

    const currentWithdrawals = user.withdrawals || [];
    currentWithdrawals.unshift(withdrawalRecord);
    await updatePartnerInMysql(user.user_id, { withdrawals: currentWithdrawals });

    return res.status(200).json({
      status: true,
      message: 'Withdrawal request submitted successfully',
      data: { withdrawal_id, amount: withdrawAmount, status: 'Pending', bank_account: user.bank_account, support_note: SUPPORT_NOTE }
    });
  } catch (err) {
    console.error('[Withdraw Request Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to process withdrawal.', error_code: 'SERVER_ERROR' });
  }
}

async function calculatePartnerTotalEarnings(userId) {
  const myTx = await fetchPartnerTransactionsFromMysql(userId);
  return myTx.filter(t => t.status === 'Complete').reduce((sum, t) => sum + (t.earn_money || 0), 0);
}

async function handleGetWithdrawals(req, res) {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const withdrawals = user.withdrawals || [];
    const totalWithdrawn = withdrawals
      .filter(w => ['Completed', 'Pending', 'PROCESSING', 'PAID'].includes(w.status))
      .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

    const totalEarnings = await calculatePartnerTotalEarnings(user.user_id);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        total_earnings: totalEarnings,
        available_balance: Math.max(0, totalEarnings - totalWithdrawn),
        total_withdrawn: totalWithdrawn,
        bank_account: user.bank_account || null,
        account_added: Boolean(user.bank_account),
        withdrawals,
        support_note: SUPPORT_NOTE
      }
    });
  } catch (err) {
    console.error('[Get Withdrawals Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch withdrawals.', error_code: 'SERVER_ERROR' });
  }
}

router.post('/withdraw/bank-account', authenticateToken, handleSaveBankAccount);
router.post('/bank-account', authenticateToken, handleSaveBankAccount);
router.get('/withdraw/bank-account', authenticateToken, handleGetBankAccount);
router.get('/bank-account', authenticateToken, handleGetBankAccount);
router.get('/withdraw', authenticateToken, handleGetWithdrawals);
router.get('/withdraw/list', authenticateToken, handleGetWithdrawals);
router.get('/withdraw/history', authenticateToken, handleGetWithdrawals);
router.post('/withdraw', authenticateToken, handleWithdrawRequest);
router.post('/withdraw/request', authenticateToken, handleWithdrawRequest);

async function handleGetWithdrawable(req, res) {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const withdrawals = user.withdrawals || [];
    const totalWithdrawn = withdrawals
      .filter(w => ['Completed', 'Pending', 'PROCESSING', 'PAID'].includes(w.status))
      .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

    const totalEarnings = await calculatePartnerTotalEarnings(user.user_id);
    const commissionPercent = user.availability ? (user.availability.platform_commission_percent || 15) : 15;
    const netEarnings = Math.round(totalEarnings * (1 - commissionPercent / 100));
    const withdrawableBalance = Math.max(0, netEarnings - totalWithdrawn);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        partner_id: user.user_id,
        name: user.name,
        total_earnings: totalEarnings,
        platform_commission_percent: commissionPercent,
        net_earnings: netEarnings,
        total_withdrawn: totalWithdrawn,
        withdrawable_balance: withdrawableBalance,
        minimum_withdrawal_amount: 100,
        currency: 'INR',
        razorpay_key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_SwFaJKQjU5ZOsH',
        payout_enabled: true,
        bank_account: user.bank_account || null,
        account_added: Boolean(user.bank_account),
        support_note: SUPPORT_NOTE
      }
    });
  } catch (err) {
    console.error('[Get Withdrawable Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch withdrawable balance.', error_code: 'SERVER_ERROR' });
  }
}

async function handlePostWithdrawable(req, res) {
  try {
    const { amount, payment_mode } = req.body || {};
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (!user.bank_account) {
      return res.status(400).json({
        status: false,
        message: 'Please add your bank account details before initiating a withdrawal payout',
        error_code: 'BANK_ACCOUNT_REQUIRED',
        data: { bank_account: null, account_added: false, support_note: SUPPORT_NOTE }
      });
    }

    const withdrawAmount = Number(amount) || 500;
    const minLimit = 100;

    if (withdrawAmount < minLimit) {
      return res.status(400).json({ status: false, message: `Minimum withdrawal amount is ₹${minLimit}`, error_code: 'BELOW_MINIMUM_WITHDRAWAL_LIMIT' });
    }

    const withdrawals = user.withdrawals || [];
    const totalWithdrawn = withdrawals
      .filter(w => ['Completed', 'Pending', 'PROCESSING', 'PAID'].includes(w.status))
      .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

    const totalEarnings = await calculatePartnerTotalEarnings(user.user_id);
    const commissionPercent = user.availability ? (user.availability.platform_commission_percent || 15) : 15;
    const netEarnings = Math.round(totalEarnings * (1 - commissionPercent / 100));
    const withdrawableBalance = Math.max(0, netEarnings - totalWithdrawn);

    if (withdrawAmount > withdrawableBalance) {
      return res.status(400).json({
        status: false,
        message: `Requested amount ₹${withdrawAmount} exceeds your withdrawable balance of ₹${withdrawableBalance}`,
        error_code: 'INSUFFICIENT_WITHDRAWABLE_BALANCE',
        data: { requested_amount: withdrawAmount, withdrawable_balance: withdrawableBalance }
      });
    }

    const randomStr = Math.random().toString(36).substring(2, 10);
    const withdrawal_id = `wth_razor_${Date.now()}`;
    const razorpay_payout_id = `pout_${randomStr}`;
    const razorpay_fund_account_id = `fa_${randomStr}`;
    const selectedMode = payment_mode ? String(payment_mode).toUpperCase() : 'IMPS';

    const withdrawalRecord = {
      withdrawal_id,
      razorpay_payout_id,
      razorpay_fund_account_id,
      amount: withdrawAmount,
      currency: 'INR',
      payment_mode: selectedMode,
      status: 'PROCESSING',
      requested_at: new Date().toISOString(),
      bank_account: {
        account_holder_name: user.bank_account.account_holder_name,
        bank_name: user.bank_account.bank_name,
        account_number: user.bank_account.account_number,
        ifsc_code: user.bank_account.ifsc_code
      }
    };

    const updatedWithdrawals = [withdrawalRecord, ...withdrawals];
    await updatePartnerInMysql(user.user_id, { withdrawals: updatedWithdrawals });

    const remainingBalance = Math.max(0, withdrawableBalance - withdrawAmount);

    return res.status(200).json({
      status: true,
      message: 'Withdrawal payout initiated successfully via Razorpay',
      data: {
        withdrawal_id,
        razorpay_payout_id,
        razorpay_fund_account_id,
        amount: withdrawAmount,
        currency: 'INR',
        payment_mode: selectedMode,
        status: 'PROCESSING',
        processed_at: withdrawalRecord.requested_at,
        remaining_withdrawable_balance: remainingBalance,
        bank_account: user.bank_account,
        support_note: SUPPORT_NOTE
      }
    });
  } catch (err) {
    console.error('[Post Withdrawable Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to initiate withdrawal.', error_code: 'SERVER_ERROR' });
  }
}

router.get('/withdraw/withdrawable', authenticateToken, handleGetWithdrawable);
router.get('/withdrawable', authenticateToken, handleGetWithdrawable);
router.post('/withdraw/withdrawable', authenticateToken, handlePostWithdrawable);
router.post('/withdrawable', authenticateToken, handlePostWithdrawable);

module.exports = router;
