const chatService = require('../services/chatService');
const { isUserOnline } = require('../sockets/chatSocket');

/**
 * API 1 – Create/Get Private Conversation
 * POST /api/chat/conversation
 */
async function handleCreateOrGetConversation(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const targetUserId = req.body ? (req.body.userId || req.body.target_user_id || req.body.user_id) : null;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Target userId is required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await chatService.createOrGetConversation(currentUserId, targetUserId);
    return res.status(200).json({
      success: true,
      conversationId: result.conversationId
    });
  } catch (err) {
    if (err.message === "User is blocked" || err.message === "Cannot create conversation with yourself") {
      return res.status(400).json({
        success: false,
        message: err.message,
        error_code: "BAD_REQUEST"
      });
    }
    if (err.message === "Target user not found") {
      return res.status(44).json ? res.status(404).json({
        success: false,
        message: err.message,
        error_code: "USER_NOT_FOUND"
      }) : next(err);
    }
    return next(err);
  }
}

/**
 * API 2 – Get Chat List
 * GET /api/chat/conversations
 */
async function handleGetConversations(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const result = await chatService.getUserConversations(currentUserId, req, isUserOnline);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * API 3 – Get Chat History
 * GET /api/chat/messages/:conversationId
 */
async function handleGetMessages(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "Conversation ID is required",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await chatService.getConversationMessages(conversationId, currentUserId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: err.message,
        error_code: "FORBIDDEN"
      });
    }
    return next(err);
  }
}

/**
 * API 4 – Delete Message
 * DELETE /api/chat/message/:messageId
 */
async function handleDeleteMessage(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const { messageId } = req.params;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "Message ID is required",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await chatService.deleteMessage(messageId, currentUserId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: err.message,
        error_code: "FORBIDDEN"
      });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({
        success: false,
        message: err.message,
        error_code: "NOT_FOUND"
      });
    }
    return next(err);
  }
}

/**
 * API 5 – Block User
 * POST /api/chat/block
 */
async function handleBlockUser(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const blockedUserId = req.body ? (req.body.userId || req.body.blocked_id || req.body.user_id) : null;

    if (!blockedUserId) {
      return res.status(400).json({
        success: false,
        message: "User ID to block is required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const result = await chatService.blockUser(currentUserId, blockedUserId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to block user",
      error_code: "BAD_REQUEST"
    });
  }
}

/**
 * API 6 – Send Message via HTTP REST
 * POST /api/chat/message or POST /api/chat/send
 */
async function handleSendMessage(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const { conversationId, receiverId, message, messageType } = req.body || {};

    if (!conversationId || !receiverId || message === undefined || message === null) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: conversationId, receiverId, message",
        error_code: "BAD_REQUEST"
      });
    }

    const cleanMessage = String(message).trim();
    if (!cleanMessage) {
      return res.status(400).json({
        success: false,
        message: "Message cannot be empty",
        error_code: "BAD_REQUEST"
      });
    }

    const isMember = await chatService.isUserInConversation(conversationId, currentUserId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You are not a member of this conversation",
        error_code: "FORBIDDEN"
      });
    }

    const isBlocked = await chatService.isUserBlocked(currentUserId, receiverId);
    if (isBlocked) {
      return res.status(400).json({
        success: false,
        message: "Cannot send message. User is blocked",
        error_code: "BAD_REQUEST"
      });
    }

    const savedMsg = await chatService.saveMessage({
      conversationId,
      senderId: currentUserId,
      receiverId,
      message: cleanMessage,
      messageType: messageType || 'text'
    });

    const msgPayload = {
      id: Number(savedMsg.id),
      messageId: Number(savedMsg.id),
      conversationId: Number(conversationId),
      senderId: isNaN(currentUserId) ? currentUserId : Number(currentUserId),
      receiverId: isNaN(receiverId) ? String(receiverId) : Number(receiverId),
      messageType: messageType || 'text',
      message: savedMsg.message,
      isDelivered: false,
      isRead: false,
      createdAt: typeof savedMsg.created_at === 'string' ? savedMsg.created_at : new Date(savedMsg.created_at).toISOString()
    };

    // Broadcast Socket.IO real-time event if io instance is attached
    if (req.app && req.app.get('io')) {
      const io = req.app.get('io');
      const rIdStr = String(receiverId);
      io.to(rIdStr).emit('receive_message', msgPayload);
      io.to(rIdStr).emit('new_message', msgPayload);
      io.to(`conv_${conversationId}`).emit('receive_message', msgPayload);
      io.to(`conv_${conversationId}`).emit('new_message', msgPayload);
    }

    // Trigger FCM Push Notification
    const { sendEventNotification } = require('../services/notificationService');
    setImmediate(() => {
      sendEventNotification('chat_message', {
        targetUserId: receiverId,
        sender_id: currentUserId,
        message: cleanMessage,
        conversation_id: conversationId
      }).catch(() => {});
    });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      data: msgPayload
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  handleCreateOrGetConversation,
  handleGetConversations,
  handleGetMessages,
  handleDeleteMessage,
  handleBlockUser,
  handleSendMessage
};
