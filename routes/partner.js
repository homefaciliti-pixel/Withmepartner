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
const { emitToUser } = require('../sockets/chatSocket');

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
  const bookingId = requestPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`;
  const paymentId = requestPayload.payment_id || `pay_${requestId}`;
  const partnerId = requestPayload.partner_id || requestPayload.receiver_id || '';
  const userId = requestPayload.user_id || requestPayload.sender_id || '';
  const partnerName = requestPayload.partner_name || '';
  const customerName = requestPayload.user_name || requestPayload.customer_name || requestPayload.sender_name || requestPayload.name || 'User';
  const senderPhone = requestPayload.phone_number || requestPayload.sender_phone || '';
  const interest = requestPayload.interest || requestPayload.activity_name || requestPayload.activity || (requestPayload.activity && requestPayload.activity.type) || 'Coffee';
  const location = requestPayload.location || (requestPayload.activity && requestPayload.activity.area) || 'Jaipur';
  const dateTime = requestPayload.date_time || `${requestPayload.date || getISTDateString()} ${requestPayload.time || '06:00 PM'}`;
  const profileImage = requestPayload.profile_image || requestPayload.image || requestPayload.sender_avatar || '';
  const amount = requestPayload.amount || requestPayload.price || 1;
  const currency = requestPayload.currency || 'INR';

  const isPaid = Boolean(
    requestPayload.is_paid === true ||
    requestPayload.is_paid === 1 ||
    requestPayload.is_paid === '1' ||
    String(requestPayload.payment_status).toUpperCase() === 'PAID' ||
    String(requestPayload.payment_status).toUpperCase() === 'COMPLETED' ||
    String(requestPayload.status).toUpperCase() === 'CONFIRMED' ||
    String(requestPayload.status).toUpperCase() === 'PAID'
  );
  const paymentStatus = isPaid ? 'PAID' : (requestPayload.payment_status || 'PENDING');
  const status = isPaid ? 'CONFIRMED' : 'PENDING';
  const isAccepted = isPaid ? 1 : 0;
  const message = requestPayload.message || (isPaid ? 'Payment completed. Meetup confirmed.' : 'Meetup request received.');

  console.log(`[PARTNER REQUEST] Incoming sync: requestId=${requestId}, bookingId=${bookingId}, partnerId=${partnerId}, partnerName=${partnerName}, customerName=${customerName}, userId=${userId}, status=${status}, is_paid=${isPaid ? 1 : 0}`);

  const newRequest = {
    request_id: requestId,
    booking_id: bookingId,
    payment_id: paymentId,
    partner_id: partnerId,
    partner_name: partnerName,
    user_id: userId,
    name: customerName,
    customer_name: customerName,
    user_name: customerName,
    sender_name: customerName,
    title: customerName,
    header_title: `Request from: ${customerName}`,
    phone_number: senderPhone,
    sender_avatar: profileImage,
    age: requestPayload.age || 25,
    image: profileImage,
    profile_image: profileImage,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    activity: interest,
    amount,
    currency,
    payment_status: paymentStatus,
    is_paid: isPaid,
    isPaid: isPaid,
    date_time: dateTime,
    date: requestPayload.date || getISTDateString(),
    time: requestPayload.time || '06:00 PM',
    location,
    status,
    pending_status: status,
    is_accepted: isAccepted,
    can_chat: isPaid,
    chat_status: isPaid ? 'UNLOCKED' : 'LOCKED',
    can_pay: !isPaid,
    badge: isPaid ? 'Payment Received - Chat Open' : 'New Request',
    actions: isPaid ? [] : ['ACCEPT', 'REJECT'],
    message,
    meeting_info: requestPayload.meeting_info || {
      date: requestPayload.date || getISTDateString(),
      time: requestPayload.time || '06:00 PM',
      location,
      place: location,
      activity: interest
    }
  };

  try {
    const db = getDbPool();

    // 1. If payment is confirmed, update any existing request and booking rows for this booking_id / request_id
    if (isPaid) {
      console.log(`[BOOKING] Payment confirmed for bookingId=${bookingId}, requestId=${requestId}. Updating DB...`);
      await db.query(`
        UPDATE withme_partner_requests 
        SET 
          payment_status = 'PAID',
          is_paid = 1,
          status = 'CONFIRMED',
          is_accepted = 1,
          payment_id = COALESCE(?, payment_id),
          partner_id = CASE WHEN (partner_id IS NULL OR partner_id = '') AND ? != '' THEN ? ELSE partner_id END,
          partner_name = CASE WHEN (partner_name IS NULL OR partner_name = '') AND ? != '' THEN ? ELSE partner_name END,
          updated_at = NOW()
        WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
           OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)
      `, [paymentId, partnerId, partnerId, partnerName, partnerName, bookingId, requestId]);

      await db.query(`
        UPDATE withme_partner_bookings 
        SET 
          payment_status = 'PAID',
          is_paid = 1,
          status = 'Confirmed',
          is_accepted = 1,
          payment_id = COALESCE(?, payment_id),
          partner_id = CASE WHEN (partner_id IS NULL OR partner_id = '') AND ? != '' THEN ? ELSE partner_id END,
          partner_name = CASE WHEN (partner_name IS NULL OR partner_name = '') AND ? != '' THEN ? ELSE partner_name END,
          updated_at = NOW()
        WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
           OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)
      `, [paymentId, partnerId, partnerId, partnerName, partnerName, bookingId, requestId]);
    }

    // 2. Save / upsert into withme_partner_requests
    await savePartnerRequestToMysql(newRequest);

    // If paid, ensure booking row also exists in withme_partner_bookings
    if (isPaid) {
      await savePartnerBookingToMysql({
        ...newRequest,
        status: 'CONFIRMED',
        payment_status: 'PAID',
        is_paid: 1,
        is_accepted: 1
      });
    }

    console.log(`[BOOKING] MySQL INSERT/UPDATE SUCCESS for requestId=${requestId}, isPaid=${isPaid}`);
  } catch (err) {
    console.error(`[BOOKING] MySQL save FAILED for requestId=${requestId}:`, err.message);
    return res.status(500).json({
      success: false,
      status: false,
      message: 'Booking request could not be saved to database.',
      error: err.message
    });
  }

  // Real-time socket delivery to partner
  try {
    emitToUser(partnerId, isPaid ? 'payment_success' : 'new_request', newRequest);
    emitToUser(partnerId, 'request_updated', newRequest);
    if (isPaid) {
      emitToUser(partnerId, 'chat_unlocked', newRequest);
      emitToUser(userId, 'chat_unlocked', newRequest);
    }
  } catch (sErr) {
    console.error('[Socket] emit error on incoming-request:', sErr.message);
  }

  // Trigger push notification to partner
  try {
    sendEventNotification(isPaid ? 'booking_confirmed' : 'booking_request', {
      targetUserId: partnerId,
      sender_name: customerName,
      name: customerName,
      activity: interest,
      location,
      request_id: requestId,
      booking_id: bookingId
    }).catch(e => console.error('[FCM] Notification dispatch error:', e.message));
  } catch (e) {
    console.error('[FCM] Notification error:', e.message);
  }

  console.log(`[Partner API] Registered incoming user request: ${requestId} for ${interest} in ${location} (Status: ${status})`);

  return res.status(200).json({
    success: true,
    status: true,
    message: isPaid ? 'Payment received and request confirmed' : 'Request received',
    data: newRequest
  });
};

router.post('/incoming-request', handleIncomingUserRequest);
router.post('/sync-request', handleIncomingUserRequest);
router.post('/requests/create', handleIncomingUserRequest);

const handleIncomingUserBooking = async (req, res) => {
  const bookingPayload = req.body || {};
  const bookingId = bookingPayload.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`;
  const requestId = bookingPayload.request_id || `req_b_${bookingId}`;
  const partnerId = bookingPayload.partner_id || bookingPayload.receiver_id || '';
  const userId = bookingPayload.user_id || bookingPayload.sender_id || '';
  const partnerName = bookingPayload.partner_name || '';
  const customerName = bookingPayload.user_name || bookingPayload.customer_name || bookingPayload.sender_name || bookingPayload.name || 'User';
  const userPhone = bookingPayload.phone_number || bookingPayload.customer_phone || '';
  const interest = bookingPayload.interest || bookingPayload.activity || 'Coffee';
  const location = bookingPayload.location || (bookingPayload.meeting_info && (bookingPayload.meeting_info.location || bookingPayload.meeting_info.place)) || 'Jaipur';
  const profileImage = bookingPayload.profile_image || bookingPayload.user_image || '';
  const date = bookingPayload.date || (bookingPayload.meeting_info && bookingPayload.meeting_info.date) || getISTDateString();
  const time = bookingPayload.time || (bookingPayload.meeting_info && bookingPayload.meeting_info.time) || '06:00 PM';
  const price = bookingPayload.amount || bookingPayload.price || 1;
  const currency = bookingPayload.currency || 'INR';

  const isPaid = Boolean(
    bookingPayload.is_paid === true ||
    bookingPayload.is_paid === 1 ||
    bookingPayload.is_paid === '1' ||
    String(bookingPayload.payment_status).toUpperCase() === 'PAID' ||
    String(bookingPayload.payment_status).toUpperCase() === 'COMPLETED' ||
    String(bookingPayload.status).toUpperCase() === 'CONFIRMED' ||
    String(bookingPayload.status).toUpperCase() === 'PAID'
  );
  const paymentStatus = isPaid ? 'PAID' : (bookingPayload.payment_status || 'PENDING');
  const status = isPaid ? 'CONFIRMED' : 'PENDING';
  const isAccepted = isPaid ? 1 : 0;

  console.log(`[PARTNER BOOKING] Incoming sync: bookingId=${bookingId}, requestId=${requestId}, partnerId=${partnerId}, partnerName=${partnerName}, customerName=${customerName}, userId=${userId}, status=${status}, is_paid=${isPaid ? 1 : 0}`);

  const requestItem = {
    request_id: requestId,
    booking_id: bookingId,
    user_id: userId,
    partner_id: partnerId,
    partner_name: partnerName,
    profile_image: profileImage,
    image: profileImage,
    sender_avatar: profileImage,
    name: customerName,
    customer_name: customerName,
    user_name: customerName,
    sender_name: customerName,
    title: customerName,
    header_title: `Request from: ${customerName}`,
    phone_number: userPhone,
    age: bookingPayload.age || 25,
    id_verified: 1,
    selfie_verified: 1,
    interest,
    activity: interest,
    location,
    date,
    time,
    date_time: `${date} ${time}`,
    amount: price,
    price,
    currency,
    is_paid: isPaid,
    isPaid: isPaid,
    payment_status: paymentStatus,
    status,
    pending_status: status,
    is_accepted: isAccepted,
    can_chat: isPaid,
    chat_status: isPaid ? 'UNLOCKED' : 'LOCKED',
    can_pay: !isPaid,
    badge: isPaid ? 'Payment Received - Chat Open' : 'New Request',
    actions: isPaid ? [] : ['ACCEPT', 'REJECT'],
    message: bookingPayload.message || (isPaid ? 'Payment completed. Meetup confirmed.' : `Booking request for ${interest}`),
    meeting_info: bookingPayload.meeting_info || {
      date,
      time,
      place: location,
      location,
      type: interest,
      activity: interest,
      description: `Confirmed ${interest} booking`
    },
    safety_checklist: { start_safe_meet: false },
    safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
  };

  try {
    const db = getDbPool();

    // 1. If payment is confirmed, update existing rows in both tables
    if (isPaid) {
      console.log(`[BOOKING] Payment confirmed for bookingId=${bookingId}, requestId=${requestId}. Updating DB...`);
      await db.query(`
        UPDATE withme_partner_requests 
        SET 
          payment_status = 'PAID',
          is_paid = 1,
          status = 'CONFIRMED',
          is_accepted = 1,
          payment_id = COALESCE(?, payment_id),
          partner_id = CASE WHEN (partner_id IS NULL OR partner_id = '') AND ? != '' THEN ? ELSE partner_id END,
          partner_name = CASE WHEN (partner_name IS NULL OR partner_name = '') AND ? != '' THEN ? ELSE partner_name END,
          updated_at = NOW()
        WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
           OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)
      `, [bookingPayload.payment_id || null, partnerId, partnerId, partnerName, partnerName, bookingId, requestId]);

      await db.query(`
        UPDATE withme_partner_bookings 
        SET 
          payment_status = 'PAID',
          is_paid = 1,
          status = 'Confirmed',
          is_accepted = 1,
          payment_id = COALESCE(?, payment_id),
          partner_id = CASE WHEN (partner_id IS NULL OR partner_id = '') AND ? != '' THEN ? ELSE partner_id END,
          partner_name = CASE WHEN (partner_name IS NULL OR partner_name = '') AND ? != '' THEN ? ELSE partner_name END,
          updated_at = NOW()
        WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
           OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)
      `, [bookingPayload.payment_id || null, partnerId, partnerId, partnerName, partnerName, bookingId, requestId]);
    }

    // 2. Save / upsert into withme_partner_requests
    await savePartnerRequestToMysql(requestItem);
    // 3. Save / upsert into withme_partner_bookings
    await savePartnerBookingToMysql({
      ...requestItem,
      status: isPaid ? 'CONFIRMED' : 'PENDING',
      is_accepted: isAccepted
    });
    console.log(`[BOOKING] MySQL INSERT/UPDATE SUCCESS for bookingId=${bookingId}, isPaid=${isPaid}`);
  } catch (err) {
    console.error(`[BOOKING] MySQL save FAILED for bookingId=${bookingId}:`, err.message);
    return res.status(500).json({
      success: false,
      status: false,
      message: 'Booking could not be saved to database.',
      error: err.message
    });
  }

  // Real-time socket delivery to partner
  try {
    emitToUser(partnerId, isPaid ? 'payment_success' : 'new_request', requestItem);
    emitToUser(partnerId, isPaid ? 'booking_confirmed' : 'new_booking', requestItem);
    emitToUser(partnerId, 'incoming_booking', requestItem);
    emitToUser(partnerId, 'request_updated', requestItem);
    if (isPaid) {
      emitToUser(partnerId, 'chat_unlocked', requestItem);
      emitToUser(userId, 'chat_unlocked', requestItem);
    }
  } catch (sErr) {
    console.error('[Socket] emit error on incoming-booking:', sErr.message);
  }

  // Push notification via FCM
  try {
    sendEventNotification(isPaid ? 'booking_confirmed' : 'booking_request', {
      targetUserId: partnerId,
      name: customerName,
      customer_name: customerName,
      activity: interest,
      location,
      booking_id: bookingId,
      request_id: requestId,
      date,
      time
    }).catch(e => console.error('[FCM] Notification dispatch error:', e.message));
  } catch (e) {
    console.error('[FCM] Notification error:', e.message);
  }

  console.log(`[Partner API] Registered incoming user booking: ${bookingId} (Status: ${status}, is_paid: ${isPaid})`);

  return res.status(200).json({
    success: true,
    status: true,
    message: isPaid ? 'Payment received and booking confirmed' : 'Booking received',
    data: requestItem
  });
};

router.post('/incoming-booking', handleIncomingUserBooking);
router.post('/sync-booking', handleIncomingUserBooking);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT SUCCESS / WEBHOOK ENDPOINTS (Chat Unlocked)
// ─────────────────────────────────────────────────────────────────────────────
const handlePaymentSuccessWebhook = async (req, res) => {
  const payload = req.body || {};
  const bookingId = payload.booking_id || '';
  const requestId = payload.request_id || '';
  const paymentId = payload.payment_id || `pay_${Date.now()}`;
  const partnerId = payload.partner_id || payload.receiver_id || '';
  const userId = payload.user_id || payload.sender_id || '';

  console.log(`[PAYMENT WEBHOOK] Processing payment for bookingId=${bookingId}, requestId=${requestId}, paymentId=${paymentId}`);

  if (!bookingId && !requestId) {
    return res.status(400).json({
      status: false,
      success: false,
      message: 'booking_id or request_id is required',
      error_code: 'IDENTIFIER_REQUIRED'
    });
  }

  try {
    const db = getDbPool();

    // 1. Update withme_partner_requests
    const [reqUpdate] = await db.query(
      `UPDATE withme_partner_requests 
       SET payment_status = 'PAID', is_paid = 1, status = 'CONFIRMED', is_accepted = 1, payment_id = COALESCE(?, payment_id), updated_at = NOW()
       WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
          OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)`,
      [paymentId, bookingId, requestId]
    );

    // 2. Update withme_partner_bookings
    const [bkUpdate] = await db.query(
      `UPDATE withme_partner_bookings 
       SET payment_status = 'PAID', is_paid = 1, status = 'Confirmed', is_accepted = 1, payment_id = COALESCE(?, payment_id), updated_at = NOW()
       WHERE (booking_id IS NOT NULL AND booking_id != '' AND booking_id = ?)
          OR (request_id IS NOT NULL AND request_id != '' AND request_id = ?)`,
      [paymentId, bookingId, requestId]
    );

    console.log(`[PAYMENT WEBHOOK] Updated requests=${reqUpdate.affectedRows}, bookings=${bkUpdate.affectedRows}`);

    let targetPartnerId = partnerId;
    let targetUserId = userId;

    const [reqRows] = await db.query(
      'SELECT * FROM withme_partner_requests WHERE (booking_id = ? AND booking_id != "") OR (request_id = ? AND request_id != "") LIMIT 1',
      [bookingId, requestId]
    );

    if (reqRows.length > 0) {
      if (!targetPartnerId) targetPartnerId = reqRows[0].partner_id;
      if (!targetUserId) targetUserId = reqRows[0].user_id;
    }

    const socketPayload = {
      booking_id: bookingId,
      request_id: requestId,
      payment_id: paymentId,
      payment_status: 'PAID',
      is_paid: true,
      isPaid: true,
      can_chat: true,
      status: 'CONFIRMED',
      chat_status: 'UNLOCKED',
      partner_id: targetPartnerId,
      user_id: targetUserId
    };

    if (targetPartnerId) {
      emitToUser(targetPartnerId, 'payment_success', socketPayload);
      emitToUser(targetPartnerId, 'payment_completed', socketPayload);
      emitToUser(targetPartnerId, 'request_updated', socketPayload);
      emitToUser(targetPartnerId, 'chat_unlocked', socketPayload);
    }
    if (targetUserId) {
      emitToUser(targetUserId, 'payment_success', socketPayload);
      emitToUser(targetUserId, 'chat_unlocked', socketPayload);
    }

    return res.status(200).json({
      status: true,
      success: true,
      message: 'Payment recorded and chat unlocked successfully',
      data: socketPayload
    });
  } catch (err) {
    console.error('[PAYMENT WEBHOOK ERROR]:', err.message);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Failed to record payment',
      error: err.message
    });
  }
};

router.post('/payment-success', handlePaymentSuccessWebhook);
router.post('/payment-complete', handlePaymentSuccessWebhook);
router.post('/payment-webhook', handlePaymentSuccessWebhook);
router.post('/payment/success', handlePaymentSuccessWebhook);
router.post('/payment/webhook', handlePaymentSuccessWebhook);
router.post('/payment/callback', handlePaymentSuccessWebhook);
router.post('/update-payment-status', handlePaymentSuccessWebhook);
router.post('/booking/payment-success', handlePaymentSuccessWebhook);
router.post('/request/payment-success', handlePaymentSuccessWebhook);

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
      const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
      const secondaryPhotos = photoUrlsList.slice(1);
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
        profile_images: photoUrlsList,
        images: photoUrlsList,
        profileImages: photoUrlsList,
        secondary_photos: secondaryPhotos,
        photo_gallery: photoUrlsList,
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

    // Pending requests tab: ONLY requests that are NOT yet accepted!
    const newRequestsList = dbRequests
      .filter(r => {
        const s = String(r.status || 'PENDING').toUpperCase();
        const accepted = Number(r.is_accepted !== undefined ? r.is_accepted : (s === 'ACCEPTED' ? 1 : 0));
        return accepted === 0 && ['PENDING', 'PENDING_CONFIRMATION', 'NEW', 'PAID'].includes(s);
      })
      .map(r => {
        const isPaid =
          r.is_paid === 1 || r.is_paid === true || r.is_paid === '1' ||
          String(r.payment_status || '').toUpperCase() === 'PAID' ||
          String(r.payment_status || '').toUpperCase() === 'COMPLETED' ||
          String(r.status || '').toUpperCase() === 'CONFIRMED' ||
          String(r.status || '').toUpperCase() === 'PAID';
        const payStatus = isPaid ? 'PAID' : (r.payment_status || 'PENDING');
        const custName = r.customer_name || r.user_name || (r.sender && r.sender.name) || r.sender_name || r.name || 'Amit';
        const partName = r.partner_name || (req.user && req.user.name) || '';
        const photoUrl = formatPhotoUrl(r.image, req);
        const senderObj = {
          id: r.user_id,
          user_id: r.user_id,
          name: custName,
          customer_name: custName,
          user_name: custName,
          sender_name: custName,
          image: photoUrl,
          profile_image: photoUrl
        };
        return {
          request_id: r.request_id,
          booking_id: r.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`,
          user_id: r.user_id,
          partner_id: r.partner_id || currentUserId,
          partner_name: partName,
          customer_name: custName,
          user_name: custName,
          sender_name: custName,
          name: custName,
          title: custName,
          header_title: `Request from: ${custName}`,
          sender: senderObj,
          user: senderObj,
          interest: r.interest,
          activity: r.interest,
          date_time: r.date_time,
          date: r.date,
          time: r.time,
          location: r.location,
          image: photoUrl,
          profile_image: photoUrl,
          phone_number: r.phone_number || '',
          pending_status: 'PENDING',
          status: 'PENDING',
          is_accepted: 0,
          actions: ['ACCEPT', 'REJECT'],
          is_paid: isPaid,
          payment_status: payStatus,
          is_payment_completed: isPaid,
          payment_id: r.payment_id || `pay_${r.request_id}`,
          payment_status_text: isPaid ? 'Paid' : 'Pending',
          can_pay: r.can_pay !== undefined ? r.can_pay : false,
          can_chat: r.can_chat !== undefined ? r.can_chat : false,
          chat_status: r.chat_status || 'LOCKED',
          badge: r.badge || 'New Request'
        };
      });

    // Upcoming bookings tab: ONLY bookings that have been manually accepted!
    const upcomingBookingsList = dbBookings
      .filter(b => {
        const s = String(b.status || '').toUpperCase();
        const accepted = Number(b.is_accepted !== undefined ? b.is_accepted : (s === 'PENDING' ? 0 : 1));
        return accepted === 1 && ['UPCOMING', 'CONFIRMED', 'ACCEPTED'].includes(s) && s !== 'PENDING';
      })
      .map(b => {
        const isPaid =
          b.is_paid === 1 || b.is_paid === true || b.is_paid === '1' ||
          String(b.payment_status || '').toUpperCase() === 'PAID' ||
          String(b.payment_status || '').toUpperCase() === 'COMPLETED' ||
          String(b.status || '').toUpperCase() === 'CONFIRMED' ||
          String(b.status || '').toUpperCase() === 'PAID';
        const payStatus = isPaid ? 'PAID' : (b.payment_status || 'PENDING');
        const custName = b.customer_name || b.user_name || (b.sender && b.sender.name) || b.sender_name || b.name || 'Amit';
        const partName = b.partner_name || (req.user && req.user.name) || '';
        const photoUrl = formatPhotoUrl(b.profile_image, req);
        const senderObj = {
          id: b.user_id,
          user_id: b.user_id,
          name: custName,
          customer_name: custName,
          user_name: custName,
          sender_name: custName,
          image: photoUrl,
          profile_image: photoUrl
        };
        return {
          booking_id: b.booking_id,
          request_id: b.request_id,
          user_id: b.user_id,
          partner_id: b.partner_id || currentUserId,
          partner_name: partName,
          customer_name: custName,
          user_name: custName,
          sender_name: custName,
          name: custName,
          title: custName,
          header_title: `Booking with: ${custName}`,
          sender: senderObj,
          user: senderObj,
          phone_number: b.phone_number || '',
          interest: b.interest,
          activity: b.interest,
          location: b.location,
          date_time: `${b.date} ${b.time}`,
          date: b.date,
          time: b.time,
          image: photoUrl,
          profile_image: photoUrl,
          status: b.status || 'Upcoming',
          is_accepted: 1,
          is_paid: isPaid,
          payment_status: payStatus,
          is_payment_completed: isPaid,
          payment_id: b.payment_id || `pay_${b.booking_id}`,
          payment_status_text: isPaid ? 'Paid' : 'Pending',
          can_chat: b.can_chat !== undefined ? b.can_chat : isPaid,
          chat_status: b.chat_status || (isPaid ? 'UNLOCKED' : 'LOCKED')
        };
      });

    const totalEarnings = dbTx
      .filter(t => !t.status || ['COMPLETE', 'COMPLETED', 'SUCCESS'].includes(String(t.status).toUpperCase()))
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

router.get(['/me', '/profile', '/user', '/session'], authenticateToken, async (req, res) => {
  const uid = (req.user && (req.user.user_id || req.user.partner_id || req.user.id)) || (req.query && req.query.user_id) || (req.body && req.body.user_id);
  const user = await findPartnerByIdFromMysql(uid);
  if (!user) return res.status(404).json({ status: false, message: 'Partner not found', error_code: 'USER_NOT_FOUND' });

  const formattedPhotos = (user.photos || []).map((p, idx) => {
    const rawUrl = typeof p === 'string' ? p : (p ? (p.url || p.path || '') : '');
    return {
      photo_id: (p && p.photo_id) || `ph_00${idx + 1}`,
      url: formatPhotoUrl(rawUrl, req),
      is_primary: p && p.is_primary !== undefined ? Boolean(p.is_primary) : (idx === 0)
    };
  });
  const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
  const secondaryPhotos = photoUrlsList.slice(1);
  const primaryUrl = (photoUrlsList[0] || formatPhotoUrl(user.profile_photo_url || user.image, req) || '');

  const enrichedUser = {
    ...user,
    profile_photo_url: primaryUrl,
    image: primaryUrl,
    profile_image: primaryUrl,
    photos: formattedPhotos,
    profile_images: photoUrlsList,
    images: photoUrlsList,
    profileImages: photoUrlsList,
    secondary_photos: secondaryPhotos,
    photo_gallery: photoUrlsList
  };

  return res.status(200).json({ status: true, success: true, message: 'Success', data: enrichedUser, partner: enrichedUser });
});

// Profile edit & photos endpoints on /partner router
const {
  handleUploadPhotos,
  handleGetPhotos,
  handleUpdateSinglePhoto,
  handleSaveProfileAndPhotos
} = require('./profile');

router.put(['/profile', '/profile/edit', '/edit-profile'], authenticateToken, handleSaveProfileAndPhotos);
router.post(['/profile', '/profile/edit', '/edit-profile'], authenticateToken, handleSaveProfileAndPhotos);
router.patch(['/profile', '/profile/edit', '/edit-profile'], authenticateToken, handleSaveProfileAndPhotos);

router.post(['/photos', '/profile/photos'], authenticateToken, handleUploadPhotos);
router.put(['/photos', '/profile/photos'], authenticateToken, handleUploadPhotos);
router.get(['/photos', '/profile/photos'], authenticateToken, handleGetPhotos);

router.put(['/photos/:photo_id', '/profile/photos/:photo_id'], authenticateToken, handleUpdateSinglePhoto);
router.post(['/photos/:photo_id', '/profile/photos/:photo_id'], authenticateToken, handleUpdateSinglePhoto);
router.patch(['/photos/:photo_id', '/profile/photos/:photo_id'], authenticateToken, handleUpdateSinglePhoto);

// ─────────────────────────────────────────────────────────────────────────────
// 11. REQUEST DETAIL & ACCEPT / DECLINE
// ─────────────────────────────────────────────────────────────────────────────

const handleGetAllPartnerRequests = async (req, res) => {
  try {
    const currentUserId = String(req.user ? req.user.user_id : '').trim();
    if (!currentUserId) {
      return res.status(200).json({
        success: true,
        status: true,
        count: 0,
        requests: [],
        data: { requests: [], count: 0 }
      });
    }

    const { status: filterStatus } = req.query;
    const dbRequests = await fetchPartnerRequestsFromMysql(currentUserId);
    if (!dbRequests || dbRequests.length === 0) {
      return res.status(200).json({
        success: true,
        status: true,
        message: 'No requests found for this partner',
        count: 0,
        requests: [],
        data: { requests: [], count: 0 }
      });
    }

    let filtered = dbRequests;
    if (filterStatus) {
      const fs = String(filterStatus).toUpperCase();
      if (fs === 'PENDING') {
        filtered = dbRequests.filter(r => Number(r.is_accepted || 0) === 0 && ['PENDING', 'PENDING_CONFIRMATION', 'NEW', 'PAID'].includes(String(r.status || 'PENDING').toUpperCase()));
      } else if (fs === 'ACCEPTED') {
        filtered = dbRequests.filter(r => Number(r.is_accepted || 0) === 1 || String(r.status).toUpperCase() === 'ACCEPTED');
      } else if (fs === 'REJECTED' || fs === 'DECLINED') {
        filtered = dbRequests.filter(r => ['REJECTED', 'DECLINED'].includes(String(r.status).toUpperCase()));
      }
    }

    const formattedList = filtered.map(r => {
      const photoUrl = formatPhotoUrl(r.image || r.profile_image, req);
      const isAcc = Number(r.is_accepted !== undefined ? r.is_accepted : (String(r.status).toUpperCase() === 'ACCEPTED' ? 1 : 0));
      const isPaid =
        r.is_paid === 1 || r.is_paid === true || r.is_paid === '1' ||
        String(r.payment_status || '').toUpperCase() === 'PAID' ||
        String(r.payment_status || '').toUpperCase() === 'COMPLETED' ||
        String(r.status || '').toUpperCase() === 'CONFIRMED' ||
        String(r.status || '').toUpperCase() === 'PAID';
      const payStatus = isPaid ? 'PAID' : (r.payment_status || 'PENDING');
      const custName = r.customer_name || r.user_name || (r.sender && r.sender.name) || r.sender_name || r.name || 'Amit';
      const partName = r.partner_name || (req.user && req.user.name) || '';
      const senderObj = {
        id: r.user_id,
        user_id: r.user_id,
        name: custName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        image: photoUrl,
        profile_image: photoUrl
      };
      return {
        request_id: r.request_id,
        booking_id: r.booking_id,
        user_id: r.user_id,
        partner_id: r.partner_id || currentUserId,
        partner_name: partName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        name: custName,
        title: custName,
        header_title: `Request from: ${custName}`,
        sender: senderObj,
        user: senderObj,
        phone_number: r.phone_number || '',
        age: r.age || 25,
        image: photoUrl,
        profile_image: photoUrl,
        id_verified: r.id_verified !== undefined ? r.id_verified : 1,
        selfie_verified: r.selfie_verified !== undefined ? r.selfie_verified : 1,
        location: r.location || '',
        interest: r.interest || 'Coffee',
        activity: r.interest || 'Coffee',
        date_time: r.date_time || `${getISTDateString()} 06:00 PM`,
        date: r.date || getISTDateString(),
        time: r.time || '06:00 PM',
        status: isAcc === 1 ? 'ACCEPTED' : (r.status || 'PENDING'),
        pending_status: isAcc === 1 ? 'ACCEPTED' : (r.status || 'PENDING'),
        is_accepted: isAcc,
        actions: isAcc === 1 ? [] : ['ACCEPT', 'REJECT'],
        is_paid: isPaid,
        payment_status: payStatus,
        is_payment_completed: isPaid,
        payment_id: r.payment_id || `pay_${r.request_id}`,
        payment_status_text: isPaid ? 'Paid' : 'Pending',
        can_pay: r.can_pay !== undefined ? r.can_pay : (isAcc === 1 && !isPaid),
        can_chat: r.can_chat !== undefined ? r.can_chat : isPaid,
        chat_status: r.chat_status || (isPaid ? 'UNLOCKED' : 'LOCKED'),
        badge: r.badge || (isPaid ? 'Payment Received - Chat Open' : (isAcc === 1 ? 'Payment Pending' : 'New Request'))
      };
    });

    return res.status(200).json({
      success: true,
      status: true,
      message: 'Partner requests list fetched successfully',
      count: formattedList.length,
      requests: formattedList,
      data: { requests: formattedList, count: formattedList.length }
    });
  } catch (err) {
    console.error('[Get Requests Error]:', err.message);
    return res.status(500).json({ success: false, status: false, message: 'Failed to fetch requests.', error_code: 'SERVER_ERROR' });
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
    const isAcc = Number(r.is_accepted !== undefined ? r.is_accepted : (String(r.status).toUpperCase() === 'ACCEPTED' ? 1 : 0));

    // Cross-table check: also query withme_partner_bookings by booking_id
    let bkRow = null;
    if (r.booking_id) {
      const [bkRows] = await db.query(
        'SELECT is_paid, payment_status, status FROM withme_partner_bookings WHERE booking_id = ? LIMIT 1',
        [r.booking_id]
      );
      if (bkRows.length > 0) bkRow = bkRows[0];
    }

    const isPaid =
      r.is_paid === 1 || r.is_paid === true || r.is_paid === '1' ||
      String(r.payment_status || '').toUpperCase() === 'PAID' ||
      String(r.payment_status || '').toUpperCase() === 'COMPLETED' ||
      String(r.status || '').toUpperCase() === 'CONFIRMED' ||
      String(r.status || '').toUpperCase() === 'PAID' ||
      (bkRow && (
        bkRow.is_paid === 1 || bkRow.is_paid === true || bkRow.is_paid === '1' ||
        String(bkRow.payment_status || '').toUpperCase() === 'PAID' ||
        String(bkRow.payment_status || '').toUpperCase() === 'COMPLETED' ||
        String(bkRow.status || '').toUpperCase() === 'CONFIRMED'
      ));
    const payStatus = isPaid ? 'PAID' : (r.payment_status || 'PENDING');
    let custName = r.customer_name || r.user_name || r.sender_name || r.name || '';
    const partName = r.partner_name || (req.user && req.user.name) || '';

    // Fetch customer profile photos & verify name from users table
    let customerPhotos = [];
    let customerProfileImages = [];
    if (r.user_id) {
      try {
        const [userRows] = await db.query(
          'SELECT id, name, image, profile_image, profile_images FROM users WHERE id = ? OR user_id = ? LIMIT 1',
          [r.user_id, r.user_id]
        );
        if (userRows.length > 0) {
          const uRow = userRows[0];
          if (uRow.name && (!custName || custName === 'User' || custName === 'User Request')) {
            custName = uRow.name.trim();
          }
          let parsedImages = [];
          try {
            if (typeof uRow.profile_images === 'string') {
              parsedImages = JSON.parse(uRow.profile_images);
            } else if (Array.isArray(uRow.profile_images)) {
              parsedImages = uRow.profile_images;
            }
          } catch {}
          if (!Array.isArray(parsedImages) || parsedImages.length === 0) {
            const fallbackImg = uRow.profile_image || uRow.image || r.sender_avatar || '';
            if (fallbackImg) parsedImages = [fallbackImg];
          }
          customerProfileImages = parsedImages.map(img => formatPhotoUrl(img, req));
          customerPhotos = customerProfileImages.map((url, idx) => ({
            photo_id: `ph_00${idx + 1}`,
            url,
            is_primary: idx === 0
          }));
        }
      } catch (uErr) {
        console.error('[Request Details] User fetch error:', uErr.message);
      }
    }
    if (!custName) custName = 'Amit';
    if (customerProfileImages.length === 0 && photoUrl) {
      customerProfileImages = [photoUrl];
      customerPhotos = [{ photo_id: 'ph_001', url: photoUrl, is_primary: true }];
    }

    const senderObj = {
      id: r.user_id,
      user_id: r.user_id,
      name: custName,
      customer_name: custName,
      user_name: custName,
      sender_name: custName,
      image: photoUrl,
      profile_image: photoUrl,
      avatar: photoUrl,
      phone_number: r.sender_phone || '',
      photos: customerPhotos,
      profile_images: customerProfileImages,
      images: customerProfileImages,
      profileImages: customerProfileImages
    };

    const responseData = {
      request_id: r.request_id,
      booking_id: r.booking_id,
      user_id: r.user_id,
      partner_id: r.partner_id,
      partner_name: partName,
      partner_user_id: partnerUserIdVal,
      partnerUserId: partnerUserIdVal,
      image: photoUrl,
      profile_image: photoUrl,
      customer_name: custName,
      user_name: custName,
      sender_name: custName,
      name: custName,
      title: custName,
      header_title: `Request from: ${custName}`,
      sender: senderObj,
      user: senderObj,
      photos: customerPhotos,
      profile_images: customerProfileImages,
      images: customerProfileImages,
      profileImages: customerProfileImages,
      photo_gallery: customerProfileImages,
      phone_number: r.sender_phone || '',
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
      is_paid: isPaid,
      isPaid: isPaid,
      payment_status: payStatus,
      paymentStatus: payStatus,
      is_payment_completed: isPaid,
      payment_id: r.payment_id || `pay_${r.request_id}`,
      paymentId: r.payment_id || `pay_${r.request_id}`,
      payment_status_text: isPaid ? 'Paid' : 'Pending',
      can_pay: isAcc === 1 && !isPaid,
      can_chat: isPaid,
      chat_status: isPaid ? 'UNLOCKED' : 'LOCKED',
      badge: isPaid ? 'Payment Received - Chat Open' : (isAcc === 1 ? 'Payment Pending' : 'New Request'),
      status: isAcc === 1 ? 'ACCEPTED' : (r.status || 'PENDING'),
      pending_status: isAcc === 1 ? 'ACCEPTED' : (r.status || 'PENDING'),
      is_accepted: isAcc,
      actions: isAcc === 1 ? [] : ['ACCEPT', 'REJECT']
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

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL ACCEPT / REJECT APIS
// ─────────────────────────────────────────────────────────────────────────────

const handlePartnerRequestDecision = async (req, res, actionType) => {
  const targetId = req.params.request_id || req.params.id || (req.body && (req.body.request_id || req.body.id || req.body.booking_id));
  const rawAction = actionType || (req.body && req.body.action) || '';

  if (!targetId) {
    return res.status(400).json({
      success: false,
      status: false,
      message: 'request_id is required',
      error_code: 'REQUEST_ID_REQUIRED'
    });
  }

  const action = String(rawAction).toUpperCase().trim();
  const isAccept = ['ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED'].includes(action);
  const isReject = ['REJECT', 'REJECTED', 'DECLINE', 'DECLINED'].includes(action);

  if (!isAccept && !isReject) {
    return res.status(400).json({
      success: false,
      status: false,
      message: "Invalid action. Use 'ACCEPT' or 'REJECT'",
      error_code: 'INVALID_ACTION'
    });
  }

  try {
    const db = getDbPool();

    // Find the request by request_id or booking_id
    const [rows] = await db.query(
      'SELECT * FROM withme_partner_requests WHERE request_id = ? OR booking_id = ? LIMIT 1',
      [targetId, targetId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        status: false,
        message: 'Request not found',
        error_code: 'REQUEST_NOT_FOUND'
      });
    }

    const requestData = rows[0];
    const requestId = requestData.request_id;
    const bookingId = requestData.booking_id || `BK${Math.floor(100000 + Math.random() * 900000)}`;
    const newStatus = isAccept ? 'ACCEPTED' : 'REJECTED';
    const isAcceptedNum = isAccept ? 1 : 0;

    // UPDATE withme_partner_requests: status = 'ACCEPTED'/'REJECTED', is_accepted = 1/0
    await updatePartnerRequestStatusInMysql(requestId, newStatus, isAcceptedNum);

    // Notify User App via webhook callback
    notifyUserAppStatusUpdate({
      request_id: requestId,
      booking_id: bookingId,
      status: newStatus,
      action: isAccept ? 'ACCEPT' : 'DECLINE',
      partner_id: requestData.partner_id
    }).catch(err => console.error('User App callback notification failed:', err.message));

    // Real-time socket notification
    try {
      const socketPayload = {
        request_id: requestId,
        booking_id: bookingId,
        status: newStatus,
        is_accepted: isAcceptedNum,
        partner_id: requestData.partner_id,
        user_id: requestData.user_id
      };
      emitToUser(requestData.user_id, isAccept ? 'request_accepted' : 'request_rejected', socketPayload);
      emitToUser(requestData.partner_id, isAccept ? 'request_accepted' : 'request_rejected', socketPayload);
    } catch (sErr) {
      console.error('[Socket] Decision emit error:', sErr.message);
    }

    if (isAccept) {
      // Create confirmed/upcoming booking in withme_partner_bookings
      const custName = requestData.customer_name || requestData.user_name || requestData.sender_name || requestData.name || 'User';
      const partName = requestData.partner_name || (req.user && req.user.name) || '';
      const newBooking = {
        booking_id: bookingId,
        request_id: requestId,
        user_id: requestData.user_id,
        partner_id: requestData.partner_id,
        partner_name: partName,
        profile_image: requestData.sender_avatar || '',
        name: custName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        title: custName,
        header_title: `Booking with: ${custName}`,
        phone_number: requestData.sender_phone || '',
        age: 25,
        id_verified: 1,
        selfie_verified: 1,
        interest: requestData.activity || 'Coffee',
        activity: requestData.activity || 'Coffee',
        location: requestData.location || '',
        date: requestData.date || getISTDateString(),
        time: requestData.time || '06:00 PM',
        status: 'Upcoming',
        is_accepted: 1,
        payment_status: 'PAID',
        price: requestData.price || 1,
        currency: 'INR',
        is_paid: true,
        meeting_info: {
          date: requestData.date || getISTDateString(),
          time: requestData.time || '06:00 PM',
          place: requestData.location || '',
          location: requestData.location || '',
          type: requestData.activity || 'Coffee',
          activity: requestData.activity || 'Coffee',
          description: requestData.message || 'Accepted meetup'
        },
        safety_checklist: { start_safe_meet: false },
        safe_meet_mode: { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 }
      };

      await savePartnerBookingToMysql(newBooking);

      // FCM push notification to User
      try {
        sendEventNotification('booking_confirmed', {
          targetUserId: requestData.user_id,
          name: requestData.sender_name || 'User',
          activity: requestData.activity || 'Coffee',
          location: requestData.location || '',
          booking_id: bookingId,
          request_id: requestId
        }).catch(e => console.error('[FCM] Notification error:', e.message));
      } catch (e) {}

      console.log(`[Partner Action] Request ${requestId} ACCEPTED by partner. Added to My Bookings.`);

      return res.status(200).json({
        success: true,
        status: true,
        message: 'Request accepted successfully. Added to My Bookings.',
        data: {
          request_id: requestId,
          booking_id: bookingId,
          status: 'ACCEPTED',
          is_accepted: 1,
          goes_to: 'My Booking List'
        }
      });
    }

    // REJECT / DECLINE
    try {
      await db.query(
        `UPDATE withme_partner_bookings SET status = 'CANCELLED', is_accepted = 0, updated_at = NOW() WHERE booking_id = ?`,
        [bookingId]
      );
    } catch (bErr) {}

    // FCM push notification to User
    try {
      sendEventNotification('booking_cancelled', {
        targetUserId: requestData.user_id,
        name: requestData.sender_name || 'User',
        booking_id: bookingId,
        request_id: requestId
      }).catch(e => console.error('[FCM] Notification error:', e.message));
    } catch (e) {}

    console.log(`[Partner Action] Request ${requestId} REJECTED by partner.`);

    return res.status(200).json({
      success: true,
      status: true,
      message: 'Request rejected successfully',
      data: {
        request_id: requestId,
        booking_id: bookingId,
        status: 'REJECTED',
        is_accepted: 0
      }
    });
  } catch (err) {
    console.error('[Request Decision Error]:', err.message);
    return res.status(500).json({
      success: false,
      status: false,
      message: 'Failed to process request action.',
      error_code: 'SERVER_ERROR'
    });
  }
};

// Mount Accept Routes
router.post('/request/accept', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'ACCEPT'));
router.post('/requests/accept', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'ACCEPT'));
router.post('/requests/:request_id/accept', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'ACCEPT'));

// Mount Reject Routes
router.post('/request/reject', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'REJECT'));
router.post('/requests/reject', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'REJECT'));
router.post('/requests/:request_id/reject', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'REJECT'));
router.post('/requests/:request_id/decline', authenticateToken, (req, res) => handlePartnerRequestDecision(req, res, 'REJECT'));

// Existing /action endpoint for backwards compatibility
router.post('/requests/:request_id/action', authenticateToken, (req, res) => {
  const action = req.body && req.body.action;
  return handlePartnerRequestDecision(req, res, action);
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
    let custName = b.customer_name || b.user_name || b.sender_name || b.name || '';
    const partName = b.partner_name || (req.user && req.user.name) || '';
    const isPaid =
      b.is_paid === 1 || b.is_paid === true || b.is_paid === '1' ||
      String(b.payment_status || '').toUpperCase() === 'PAID' ||
      String(b.payment_status || '').toUpperCase() === 'COMPLETED' ||
      String(b.status || '').toUpperCase() === 'CONFIRMED' ||
      String(b.status || '').toUpperCase() === 'PAID';
    const payStatus = isPaid ? 'PAID' : (b.payment_status || 'PENDING');
    const photoUrl = formatPhotoUrl(b.profile_image, req);

    // Fetch customer profile photos & verify name from users table
    let customerPhotos = [];
    let customerProfileImages = [];
    if (b.user_id) {
      try {
        const [userRows] = await db.query(
          'SELECT id, name, image, profile_image, profile_images FROM users WHERE id = ? OR user_id = ? LIMIT 1',
          [b.user_id, b.user_id]
        );
        if (userRows.length > 0) {
          const uRow = userRows[0];
          if (uRow.name && (!custName || custName === 'User' || custName === 'User Request')) {
            custName = uRow.name.trim();
          }
          let parsedImages = [];
          try {
            if (typeof uRow.profile_images === 'string') {
              parsedImages = JSON.parse(uRow.profile_images);
            } else if (Array.isArray(uRow.profile_images)) {
              parsedImages = uRow.profile_images;
            }
          } catch {}
          if (!Array.isArray(parsedImages) || parsedImages.length === 0) {
            const fallbackImg = uRow.profile_image || uRow.image || b.profile_image || '';
            if (fallbackImg) parsedImages = [fallbackImg];
          }
          customerProfileImages = parsedImages.map(img => formatPhotoUrl(img, req));
          customerPhotos = customerProfileImages.map((url, idx) => ({
            photo_id: `ph_00${idx + 1}`,
            url,
            is_primary: idx === 0
          }));
        }
      } catch (uErr) {
        console.error('[Booking Details] User fetch error:', uErr.message);
      }
    }
    if (!custName) custName = 'Amit';
    if (customerProfileImages.length === 0 && photoUrl) {
      customerProfileImages = [photoUrl];
      customerPhotos = [{ photo_id: 'ph_001', url: photoUrl, is_primary: true }];
    }

    const senderObj = {
      id: b.user_id,
      user_id: b.user_id,
      name: custName,
      customer_name: custName,
      user_name: custName,
      sender_name: custName,
      image: photoUrl,
      profile_image: photoUrl,
      avatar: photoUrl,
      phone_number: b.customer_phone || '',
      photos: customerPhotos,
      profile_images: customerProfileImages,
      images: customerProfileImages,
      profileImages: customerProfileImages
    };

    let meetingInfo = { date: b.date, time: b.time, place: b.location, type: b.activity, description: 'Meetup details' };
    let safetyChecklist = { start_safe_meet: false };
    let safeMeetMode = { location_allow: 1, notify_trusted_contact: 1, safety_check_in: 1 };

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        booking_id: b.booking_id,
        request_id: b.request_id || null,
        user_id: b.user_id,
        partner_id: b.partner_id,
        partner_name: partName,
        image: photoUrl,
        profile_image: photoUrl,
        name: custName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        title: custName,
        header_title: `Booking with: ${custName}`,
        sender: senderObj,
        user: senderObj,
        photos: customerPhotos,
        profile_images: customerProfileImages,
        images: customerProfileImages,
        profileImages: customerProfileImages,
        photo_gallery: customerProfileImages,
        phone_number: b.customer_phone || '',
        age: 25,
        id_verified: 1,
        selfie_verified: 1,
        location: b.location,
        interest: b.activity,
        activity: b.activity,
        date: b.date,
        time: b.time,
        status: b.status,
        is_accepted: b.is_accepted !== undefined ? Number(b.is_accepted) : 1,
        is_paid: isPaid,
        isPaid: isPaid,
        payment_status: payStatus,
        paymentStatus: payStatus,
        is_payment_completed: isPaid,
        payment_id: b.payment_id || null,
        payment_status_text: isPaid ? 'Paid' : 'Pending',
        can_chat: isPaid,
        chat_status: isPaid ? 'UNLOCKED' : 'LOCKED',
        badge: isPaid ? 'Payment Received - Chat Open' : 'Payment Pending',
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

router.get(['/bookings', '/bookings/list'], authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    const currentUserId = String(req.user.user_id);
    const dbBookings = await fetchPartnerBookingsFromMysql(currentUserId, status);

    const list = dbBookings.map(b => {
      const isPaid =
        b.is_paid === 1 || b.is_paid === true || b.is_paid === '1' ||
        String(b.payment_status || '').toUpperCase() === 'PAID' ||
        String(b.payment_status || '').toUpperCase() === 'COMPLETED' ||
        String(b.status || '').toUpperCase() === 'CONFIRMED' ||
        String(b.status || '').toUpperCase() === 'PAID';
      const payStatus = isPaid ? 'PAID' : (b.payment_status || 'PENDING');
      const custName = b.customer_name || b.user_name || (b.sender && b.sender.name) || b.sender_name || b.name || 'Amit';
      const partName = b.partner_name || (req.user && req.user.name) || '';
      const photoUrl = formatPhotoUrl(b.profile_image, req);
      const senderObj = {
        id: b.user_id,
        user_id: b.user_id,
        name: custName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        image: photoUrl,
        profile_image: photoUrl
      };
      return {
        booking_id: b.booking_id,
        request_id: b.request_id,
        user_id: b.user_id,
        partner_id: b.partner_id || currentUserId,
        partner_name: partName,
        image: photoUrl,
        profile_image: photoUrl,
        name: custName,
        customer_name: custName,
        user_name: custName,
        sender_name: custName,
        title: custName,
        header_title: `Booking with: ${custName}`,
        sender: senderObj,
        user: senderObj,
        phone_number: b.phone_number || '',
        interest: b.interest,
        activity: b.interest,
        location: b.location,
        date: b.date,
        time: b.time,
        status: b.status,
        is_accepted: b.is_accepted !== undefined ? Number(b.is_accepted) : 1,
        is_paid: isPaid,
        payment_status: payStatus,
        is_payment_completed: isPaid,
        payment_id: b.payment_id || `pay_${b.booking_id}`,
        payment_status_text: isPaid ? 'Paid' : 'Pending',
        can_chat: b.can_chat !== undefined ? b.can_chat : isPaid,
        chat_status: b.chat_status || (isPaid ? 'UNLOCKED' : 'LOCKED')
      };
    });

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: { filter_status: status || 'all', total_count: list.length, bookings: list },
      bookings: list
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
