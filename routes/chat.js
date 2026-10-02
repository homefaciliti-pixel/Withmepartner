const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  handleCreateOrGetConversation,
  handleGetConversations,
  handleGetMessages,
  handleDeleteMessage,
  handleBlockUser,
  handleSendMessage
} = require('../controllers/chatController');

// 1. Create/Get Conversation
router.post('/conversation', authenticateToken, handleCreateOrGetConversation);
router.post('/conversations', authenticateToken, handleCreateOrGetConversation);

// 2. Get Chat List
router.get('/conversations', authenticateToken, handleGetConversations);
router.get('/conversation', authenticateToken, handleGetConversations);

// 3. Send Message via HTTP REST
router.post('/message', authenticateToken, handleSendMessage);
router.post('/send', authenticateToken, handleSendMessage);

// 4. Get Chat History
router.get('/messages/:conversationId', authenticateToken, handleGetMessages);
router.get('/messages', authenticateToken, (req, res, next) => {
  if (req.query && req.query.conversationId) {
    req.params.conversationId = req.query.conversationId;
    return handleGetMessages(req, res, next);
  }
  return res.status(400).json({
    success: false,
    message: "conversationId parameter is required",
    error_code: "BAD_REQUEST"
  });
});

// 5. Delete Message
router.delete('/message/:messageId', authenticateToken, handleDeleteMessage);
router.post('/message/:messageId/delete', authenticateToken, handleDeleteMessage);

// 6. Block User
router.post('/block', authenticateToken, handleBlockUser);

module.exports = router;
