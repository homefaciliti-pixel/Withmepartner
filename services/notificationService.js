const http = require('http');
const https = require('https');
const { getDbPool } = require('../config/database');
const { users, saveUsers } = require('../store/db');

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

  // Update in-memory user
  const user = users.get(uId);
  if (user) {
    user.fcm_token = fcmToken;
    user.device_type = deviceType;
    saveUsers();
  }

  // Update in MySQL
  try {
    const db = getDbPool();
    await db.query(
      `UPDATE withme_partners SET fcm_token = ? WHERE user_id = ? OR partner_id = ? OR mobile_number = ?`,
      [fcmToken, uId, uId, uId]
    );
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
  const user = users.get(uId);
  if (user && user.fcm_token) {
    fcmToken = user.fcm_token;
  } else {
    try {
      const db = getDbPool();
      const [rows] = await db.query(
        `SELECT fcm_token FROM withme_partners WHERE user_id = ? OR partner_id = ? OR mobile_number = ? LIMIT 1`,
        [uId, uId, uId]
      );
      if (rows && rows.length > 0 && rows[0].fcm_token) {
        fcmToken = rows[0].fcm_token;
      }
    } catch (err) {
      // Ignore MySQL error
    }
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
    await db.query(
      `INSERT INTO withme_notifications (notification_id, user_id, title, body, data_payload) VALUES (?, ?, ?, ?, ?)`,
      [notificationId, uId, title, body, dataPayloadStr]
    );
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
    await db.query(
      `UPDATE withme_notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
      [nId, uId]
    );
  } catch (err) {
    // Ignore MySQL error
  }

  return { success: true };
}

module.exports = {
  saveUserFcmToken,
  sendNotification,
  getUserNotifications,
  markNotificationRead
};
