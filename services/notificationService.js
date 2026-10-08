const http = require('http');
const https = require('https');
const { getDbPool } = require('../config/database');

// In-memory notifications store
const memoryNotifications = new Map(); // notification_id -> object

/**
 * Save / Update FCM Token for a user
 */
async function saveUserFcmToken(userId, fcmToken, deviceType = 'android') {
  if (!userId || !fcmToken) {
    throw new Error("userId and fcm_token are required");
  }

  const uId = String(userId);

  // Update in MySQL
  try {
    const db = getDbPool();
    if (db && typeof db.query === 'function') {
      await db.query(
        `UPDATE withme_partners SET fcm_token = ? WHERE user_id = ? OR partner_id = ? OR mobile_number = ?`,
        [fcmToken, uId, uId, uId]
      );
    }
  } catch (err) {
    // Ignore MySQL error if operating on local store
  }

  return {
    user_id: uId,
    fcm_token: fcmToken,
    device_type: deviceType
  };
}

/**
 * Dispatch Push Notification via Firebase FCM HTTP API if Server Key present
 */
function sendFcmPushNotification(fcmToken, title, body, dataPayload = {}) {
  const serverKey = process.env.FIREBASE_SERVER_KEY || process.env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.log(`[FCM Notice] Notification stored. To enable Firebase push delivery, set FIREBASE_SERVER_KEY in .env`);
    return Promise.resolve({ sent: false, reason: "NO_SERVER_KEY" });
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      to: fcmToken,
      notification: {
        title: title,
        body: body,
        sound: "default"
      },
      data: dataPayload
    });

    const options = {
      hostname: 'fcm.googleapis.com',
      path: '/fcm/send',
      method: 'POST',
      headers: {
        'Authorization': `key=${serverKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ sent: true, response: parsed });
        } catch (e) {
          resolve({ sent: true, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error("[FCM Push Error]:", err.message);
      resolve({ sent: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Create and send a notification to a target user
 */
async function sendNotification({ userId, title, body, data = {} }) {
  if (!userId || !title || !body) {
    throw new Error("userId, title, and body are required");
  }

  const uId = String(userId);
  const notificationId = `ntf_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const nowStr = new Date().toISOString();

  // Find target user for FCM token
  let fcmToken = null;
  try {
    const db = getDbPool();
    if (db && typeof db.query === 'function') {
      const [rows] = await db.query(
        `SELECT fcm_token FROM withme_partners WHERE user_id = ? OR partner_id = ? OR mobile_number = ? LIMIT 1`,
        [uId, uId, uId]
      );
      if (rows && rows.length > 0 && rows[0].fcm_token) {
        fcmToken = rows[0].fcm_token;
      }
    }
  } catch (err) {
    // Ignore MySQL error
  }

  const dataPayloadStr = typeof data === 'string' ? data : JSON.stringify(data || {});

  const ntfObj = {
    notification_id: notificationId,
    user_id: uId,
    title: title,
    body: body,
    data: typeof data === 'object' ? data : JSON.parse(dataPayloadStr || '{}'),
    is_read: false,
    created_at: nowStr
  };

  // Save to memory
  memoryNotifications.set(notificationId, ntfObj);

  // Save to MySQL
  try {
    const db = getDbPool();
    if (db && typeof db.query === 'function') {
      await db.query(
        `INSERT INTO withme_notifications (notification_id, user_id, title, body, data_payload) VALUES (?, ?, ?, ?, ?)`,
        [notificationId, uId, title, body, dataPayloadStr]
      );
    }
  } catch (err) {
    // Ignore MySQL error
  }

  // Trigger FCM push if token exists
  let pushResult = { sent: false };
  if (fcmToken) {
    pushResult = await sendFcmPushNotification(fcmToken, title, body, ntfObj.data);
  }

  return {
    notification_id: notificationId,
    target_user_id: uId,
    title: title,
    body: body,
    data: ntfObj.data,
    fcm_sent: pushResult.sent,
    sent_at: nowStr
  };
}

/**
 * Get notification list for a user
 */
async function getUserNotifications(userId) {
  const uId = String(userId);
  let list = [];

  // Fetch from MySQL
  try {
    const db = getDbPool();
    if (db && typeof db.query === 'function') {
      const [rows] = await db.query(
        `SELECT * FROM withme_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        [uId]
      );
      if (rows && rows.length > 0) {
        list = rows.map(r => ({
          notification_id: r.notification_id,
          title: r.title,
          body: r.body,
          data: r.data_payload ? JSON.parse(r.data_payload) : {},
          is_read: Boolean(r.is_read),
          created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString()
        }));
      }
    }
  } catch (err) {
    // Ignore MySQL error
  }

  // Merge with memory store
  const memList = Array.from(memoryNotifications.values())
    .filter(n => String(n.user_id) === uId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const map = new Map();
  list.forEach(n => map.set(n.notification_id, n));
  memList.forEach(n => map.set(n.notification_id, n));

  const allNotifications = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const unreadCount = allNotifications.filter(n => !n.is_read).length;

  return {
    notifications: allNotifications,
    unread_count: unreadCount
  };
}

/**
 * Mark notification as read
 */
async function markNotificationRead(notificationId, userId) {
  const nId = String(notificationId);
  const uId = String(userId);

  if (memoryNotifications.has(nId)) {
    memoryNotifications.get(nId).is_read = true;
  }

  try {
    const db = getDbPool();
    if (db && typeof db.query === 'function') {
      await db.query(
        `UPDATE withme_notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
        [nId, uId]
      );
    }
  } catch (err) {
    // Ignore MySQL error
  }

  return { success: true };
}

/**
 * Trigger Event-Based Push Notification for WithMe24 Business Events:
 * 1. booking_request
 * 2. booking_confirmed
 * 3. booking_cancelled
 * 4. booking_completed
 * 5. request_cancelled
 * 6. booking_reminder
 * 7. safe_meet_alert
 * 8. wallet_credit
 * 9. withdraw_success
 * 10. withdraw_failed
 * 11. chat_message
 * 12. review_rating
 */
async function sendEventNotification(eventType, params = {}) {
  try {
    const recipientId = params.userId || params.targetUserId || params.user_id || params.target_user_id || params.partner_id;

    if (!recipientId) {
      return { sent: false, reason: "NO_RECIPIENT_ID" };
    }

  const name = params.name || params.customer_name || params.sender_name || 'User';
  const activity = params.activity || params.interest || 'Date';
  const location = params.location || 'Jaipur';
  const bookingId = params.booking_id || params.bookingId || '';
  const requestId = params.request_id || params.requestId || '';
  const amount = params.amount || 0;
  const dateStr = params.date || '';
  const timeStr = params.time || '';
  const ratingVal = params.rating || 5;

  let title = "WithMe24 Alert 🔔";
  let body = `You have a new update regarding ${eventType}.`;
  let dataPayload = { event_type: String(eventType).toLowerCase(), ...params };

  switch (String(eventType).toLowerCase()) {
    case 'booking_request':
    case 'request':
      title = "New Booking Request 💌";
      body = `You received a new booking request from ${name} for ${activity} at ${location}!`;
      dataPayload = { type: "booking_request", request_id: requestId || `req_${Date.now()}` };
      break;

    case 'booking_confirmed':
    case 'confirm':
    case 'booking_confirm':
      title = "Booking Confirmed! ✅";
      body = `Your booking ${bookingId} with ${name} for ${activity} is confirmed for ${dateStr} ${timeStr}!`;
      dataPayload = { type: "booking_confirmed", booking_id: bookingId, request_id: requestId };
      break;

    case 'booking_cancelled':
    case 'cancel':
    case 'cancle':
    case 'booking_cancel':
    case 'booking_cancle':
      title = "Booking Cancelled ❌";
      body = `Booking ${bookingId} with ${name} has been cancelled.`;
      dataPayload = { type: "booking_cancelled", booking_id: bookingId };
      break;

    case 'booking_completed':
    case 'complete':
    case 'booking_complete':
      title = "Booking Completed 🎉";
      body = `Booking ${bookingId} with ${name} has been marked as completed. Thank you!`;
      dataPayload = { type: "booking_completed", booking_id: bookingId };
      break;

    case 'request_cancelled':
    case 'request_cancel':
    case 'request_cancle':
      title = "Request Cancelled ❌";
      body = `Booking request ${requestId} has been cancelled.`;
      dataPayload = { type: "request_cancelled", request_id: requestId };
      break;

    case 'booking_reminder':
    case 'remind_booking':
    case 'remind_about_booking_details':
    case 'remind_booking_details':
    case 'remind':
      title = "Upcoming Booking Reminder ⏰";
      body = `Reminder: You have an upcoming booking with ${name} on ${dateStr} at ${timeStr}. Location: ${location}.`;
      dataPayload = { type: "booking_reminder", booking_id: bookingId, date: dateStr, time: timeStr, location };
      break;

    case 'safe_meet_alert':
    case 'safe_meet':
      title = "Safe Meet Mode Active 🛡️";
      body = `Safe Meet protection is active for booking ${bookingId}. Your emergency contacts and live location monitoring are enabled.`;
      dataPayload = { type: "safe_meet_alert", booking_id: bookingId };
      break;

    case 'wallet_credit':
    case 'credit_wallet':
    case 'credit_wallet_in_earning':
    case 'earning_credit':
      title = "Wallet Credited 💰";
      body = `₹${amount} has been credited to your WithMe earnings wallet!`;
      dataPayload = { type: "wallet_credit", amount: Number(amount), booking_id: bookingId };
      break;

    case 'withdraw_success':
    case 'withdraw_sucess':
    case 'withdrawal_success':
      title = "Withdrawal Successful 🏦";
      body = `Your withdrawal payout request of ₹${amount} has been processed successfully to your bank account.`;
      dataPayload = { type: "withdraw_success", amount: Number(amount) };
      break;

    case 'withdraw_failed':
    case 'withdrawal_failed':
      title = "Withdrawal Failed ❌";
      body = `Your withdrawal request of ₹${amount} failed. ${params.reason ? `Reason: ${params.reason}. ` : ''}Amount has been refunded to your wallet.`;
      dataPayload = { type: "withdraw_failed", amount: Number(amount), reason: params.reason || 'Processing error' };
      break;

    case 'chat_message':
    case 'chat':
    case 'message':
      title = `New Message from ${name} 💬`;
      body = params.message ? (params.message.length > 80 ? params.message.substring(0, 80) + '...' : params.message) : "Sent you a new chat message.";
      dataPayload = { type: "chat_message", conversation_id: params.conversation_id || '', sender_id: params.sender_id || '' };
      break;

    case 'review_rating':
    case 'review':
    case 'rating':
      title = `New Review (${ratingVal}⭐) Received`;
      body = `${name} rated you ${ratingVal} stars${params.review ? `: "${params.review}"` : ''}!`;
      dataPayload = { type: "review_rating", rating: Number(ratingVal), review: params.review || '' };
      break;

    default:
      title = params.title || `WithMe24 Alert: ${eventType}`;
      body = params.body || `Event update for ${eventType}`;
      dataPayload = { type: eventType, ...params };
      break;
  }

    return await sendNotification({
      userId: recipientId,
      title,
      body,
      data: dataPayload
    });
  } catch (err) {
    console.error("[Event Notification Error]:", err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  saveUserFcmToken,
  sendNotification,
  getUserNotifications,
  markNotificationRead,
  sendEventNotification
};
