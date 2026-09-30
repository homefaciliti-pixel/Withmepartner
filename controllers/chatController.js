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

module.exports = {
  handleCreateOrGetConversation,
  handleGetConversations,
  handleGetMessages,
  handleDeleteMessage,
  handleBlockUser
};
