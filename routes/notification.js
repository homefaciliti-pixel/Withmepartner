const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  handleSaveFcmToken,
  handleSendNotification,
  handleGetNotifications,
  handleMarkRead
} = require('../controllers/notificationController');

// 1. Save Device FCM Token
router.post('/fcm-token', authenticateToken, handleSaveFcmToken);
router.post('/token', authenticateToken, handleSaveFcmToken);

// 2. Send / Trigger Push Notification
router.post('/send', authenticateToken, handleSendNotification);

// 3. Get Notifications History & Unread Count
router.get('/', authenticateToken, handleGetNotifications);
router.get('/list', authenticateToken, handleGetNotifications);
router.get('/history', authenticateToken, handleGetNotifications);

// 4. Mark Notification Read
router.post('/:notification_id/read', authenticateToken, handleMarkRead);
router.patch('/:notification_id/read', authenticateToken, handleMarkRead);
router.post('/read', authenticateToken, handleMarkRead);

module.exports = router;
