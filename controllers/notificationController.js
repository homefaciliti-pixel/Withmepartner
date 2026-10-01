const notificationService = require('../services/notificationService');

/**
 * 1. Register / Update Device FCM Token
 * POST /api/notification/fcm-token
 */
async function handleSaveFcmToken(req, res, next) {
  try {
    const userId = (req.user && (req.user.user_id || req.user.id)) || (req.body ? req.body.user_id : null) || 'usr_10001';
    const fcmToken = req.body ? (req.body.fcm_token || req.body.fcmToken || req.body.token || req.body.device_token) : null;
    const deviceType = req.body ? (req.body.device_type || req.body.platform || 'android') : 'android';

    if (!fcmToken) {
      return res.status(400).json({
        status: false,
        message: "fcm_token is required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await notificationService.saveUserFcmToken(userId, fcmToken, deviceType);
    return res.status(200).json({
      status: true,
      message: "FCM token updated successfully",
      data: result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * 2. Send Push Notification / Trigger Notification
 * POST /api/notification/send
 */
async function handleSendNotification(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || null;
    const targetUserId = req.body ? (req.body.user_id || req.body.target_user_id || req.body.userId || currentUserId) : currentUserId;
    const title = req.body ? (req.body.title || req.body.subject) : null;
    const body = req.body ? (req.body.body || req.body.message || req.body.content) : null;
    const dataPayload = req.body ? (req.body.data || req.body.payload || {}) : {};

    if (!targetUserId || !title || !body) {
      return res.status(400).json({
        status: false,
        message: "user_id, title, and body are required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await notificationService.sendNotification({
      userId: targetUserId,
      title,
      body,
      data: dataPayload
    });

    return res.status(200).json({
      status: true,
      message: "Notification sent successfully",
      data: result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * 3. Get User Notifications History
 * GET /api/notification
 */
async function handleGetNotifications(req, res, next) {
  try {
    const userId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const result = await notificationService.getUserNotifications(userId);
    return res.status(200).json({
      status: true,
      message: "Notifications retrieved successfully",
      data: result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * 4. Mark Notification Read
 * POST /api/notification/:notification_id/read
 */
async function handleMarkRead(req, res, next) {
  try {
    const userId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const notificationId = req.params.notification_id || (req.body ? req.body.notification_id : null);

    if (!notificationId) {
      return res.status(400).json({
        status: false,
        message: "notification_id is required",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await notificationService.markNotificationRead(notificationId, userId);
    return res.status(200).json({
      status: true,
      message: "Notification marked as read",
      data: result
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * 5. Trigger Business Event Push Notification
 * Supported event types:
 * - booking_request
 * - booking_confirmed
 * - booking_cancelled
 * - booking_completed
 * - request_cancelled
 * - booking_reminder
 * - safe_meet_alert
 * - wallet_credit
 * - withdraw_success
 * - withdraw_failed
 * - chat_message
 * - review_rating
 * POST /api/notification/event
 */
async function handleTriggerEventNotification(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || null;
    const eventType = req.body ? (req.body.event_type || req.body.event || req.body.type) : null;
    const targetUserId = req.body ? (req.body.user_id || req.body.target_user_id || req.body.userId || currentUserId) : currentUserId;

    if (!eventType || !targetUserId) {
      return res.status(400).json({
        status: false,
        message: "event_type and user_id are required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await notificationService.sendEventNotification(eventType, {
      ...req.body,
      user_id: targetUserId
    });

    return res.status(200).json({
      status: true,
      message: `Event notification '${eventType}' triggered successfully`,
      data: result
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  handleSaveFcmToken,
  handleSendNotification,
  handleGetNotifications,
  handleMarkRead,
  handleTriggerEventNotification
};
