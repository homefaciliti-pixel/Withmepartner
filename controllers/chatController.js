const chatService = require('../services/chatService');
const { isUserOnline } = require('../sockets/chatSocket');

/**
 * API 1 – Create/Get Private Conversation
 * POST /api/chat/conversation
 */
async function handleCreateOrGetConversation(req, res, next) {
  try {
    const currentUserId = (req.user && (req.user.user_id || req.user.id)) || 'usr_10001';
    const targetUserId = req.body ? (req.body.userId || req.body.target_user_id || req.body.user_id || req.body.partner_id || req.body.otherUserId) : null;
    const bookingId = req.body ? (req.body.bookingId || req.body.booking_id || req.body.requestId || req.body.request_id) : null;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Target userId is required in request body",
        error_code: "BAD_REQUEST"
      });
    }

    const canChat = await chatService.canUsersChat(currentUserId, targetUserId, bookingId);
    if (!canChat) {
      return res.status(403).json({
        success: false,
        can_chat: false,
        message: "Chat will be unlocked once payment is completed!",
        error_code: "CHAT_LOCKED_PAYMENT_REQUIRED"
      });
    }

    const result = await chatService.createOrGetConversation(currentUserId, targetUserId, bookingId);
    return res.status(200).json({
      success: true,
      can_chat: true,
      conversationId: result.conversationId,
      conversation_id: result.conversationId,
      bookingId: result.bookingId || null,
      booking_id: result.bookingId || null,
      // Socket hints: frontend should join this room and listen to these events
      socket_hints: {
        join_room: `conv_${result.conversationId}`,
        booking_room: result.bookingId ? `conv_${result.bookingId}` : null,
        emit_on_open: {
          event: 'join_conversation',
          data: {
            conversationId: result.conversationId,
            bookingId: result.bookingId || undefined
          }
        },
        listen_events: ['receive_message', 'new_message', 'chat_message'],
        send_event: 'send_message',
        receiver_id: targetUserId
      }
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
        can_chat: false,
        message: err.message || "Chat will be unlocked once payment is completed!",
        error_code: err.errorCode || "FORBIDDEN"
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
    let { conversationId, bookingId, booking_id, receiverId, message, messageType } = req.body || {};
    const bId = bookingId || booking_id || null;

    if ((!conversationId && !bId) || !receiverId || message === undefined || message === null) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: conversationId (or bookingId), receiverId, message",
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

    if (conversationId) {
      const isMember = await chatService.isUserInConversation(conversationId, currentUserId);
      if (!isMember && !bId) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized: You are not a member of this conversation",
          error_code: "FORBIDDEN"
        });
      }
    }

    const isBlocked = await chatService.isUserBlocked(currentUserId, receiverId);
    if (isBlocked) {
      return res.status(400).json({
        success: false,
        message: "Cannot send message. User is blocked",
        error_code: "BAD_REQUEST"
      });
    }

    const canChat = await chatService.canUsersChat(currentUserId, receiverId, bId);
    if (!canChat) {
      return res.status(403).json({
        success: false,
        can_chat: false,
        message: "Chat will be unlocked once payment is completed!",
        error_code: "CHAT_LOCKED_PAYMENT_REQUIRED"
      });
    }

    const savedMsg = await chatService.saveMessage({
      conversationId,
      bookingId: bId,
      senderId: currentUserId,
      receiverId,
      message: cleanMessage,
      messageType: messageType || 'text'
    });

    const resolvedConvId = Number(savedMsg.conversation_id || conversationId);
    const resolvedBookingId = savedMsg.booking_id || bId || null;

    const { toIST } = chatService;
    const msgPayload = {
      id: Number(savedMsg.id),
      messageId: Number(savedMsg.id),
      conversationId: resolvedConvId,
      conversation_id: resolvedConvId,
      bookingId: resolvedBookingId,
      booking_id: resolvedBookingId,
      senderId: isNaN(currentUserId) ? currentUserId : Number(currentUserId),
      sender_id: isNaN(currentUserId) ? currentUserId : Number(currentUserId),
      receiverId: isNaN(receiverId) ? String(receiverId) : Number(receiverId),
      receiver_id: isNaN(receiverId) ? String(receiverId) : Number(receiverId),
      messageType: messageType || 'text',
      message_type: messageType || 'text',
      message: savedMsg.message,
      isDelivered: false,
      isRead: false,
      createdAt: savedMsg.created_at,
      created_at: savedMsg.created_at,
      timestamp: savedMsg.timestamp || Date.now()
    };

    // Broadcast Socket.IO real-time event — emit all 3 event names for frontend compatibility
    if (req.app && req.app.get('io')) {
      const io = req.app.get('io');
      const rIdStr = String(receiverId);
      const rDigits = rIdStr.replace(/\D/g, '');

      // Emit to conversation room & booking room
      if (resolvedConvId) {
        io.to(`conv_${resolvedConvId}`).emit('receive_message', msgPayload);
        io.to(`conv_${resolvedConvId}`).emit('new_message', msgPayload);
        io.to(`conv_${resolvedConvId}`).emit('chat_message', msgPayload);
        io.to(String(resolvedConvId)).emit('receive_message', msgPayload);
        io.to(String(resolvedConvId)).emit('new_message', msgPayload);
        io.to(String(resolvedConvId)).emit('chat_message', msgPayload);
      }
      if (resolvedBookingId) {
        io.to(`conv_${resolvedBookingId}`).emit('receive_message', msgPayload);
        io.to(`conv_${resolvedBookingId}`).emit('new_message', msgPayload);
        io.to(`conv_${resolvedBookingId}`).emit('chat_message', msgPayload);
        io.to(String(resolvedBookingId)).emit('receive_message', msgPayload);
        io.to(String(resolvedBookingId)).emit('new_message', msgPayload);
        io.to(String(resolvedBookingId)).emit('chat_message', msgPayload);
      }

      // Emit directly to receiver user room variants
      [rIdStr, rDigits, `usr_${rDigits}`, `user_${rDigits}`, `partner_${rDigits}`].forEach(room => {
        if (room) {
          io.to(room).emit('receive_message', msgPayload);
          io.to(room).emit('new_message', msgPayload);
          io.to(room).emit('chat_message', msgPayload);
        }
      });
    }

    // Trigger FCM Push Notification
    const { sendEventNotification } = require('../services/notificationService');
    setImmediate(async () => {
      let senderName = 'User';
      try {
        const senderUser = await chatService.findUser(currentUserId);
        if (senderUser) senderName = senderUser.name || senderUser.full_name || senderUser.customer_name || 'User';
      } catch (e) {}

      sendEventNotification('chat_message', {
        targetUserId: receiverId,
        sender_id: currentUserId,
        otherUserId: currentUserId,
        otherUserName: senderName,
        name: senderName,
        message: cleanMessage,
        conversation_id: resolvedConvId,
        chatId: resolvedConvId,
        bookingId: resolvedBookingId || '',
        booking_id: resolvedBookingId || ''
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

/**
 * API 7 – Clear Chat Messages
 * DELETE /api/chat/messages/:conversationId/clear
 * POST /api/chat/messages/:conversationId/clear
 * DELETE /api/chat/clear
 * POST /api/chat/clear
 */
async function handleClearChat(req, res, next) {
  try {
    const conversationId = (req.params && (req.params.conversationId || req.params.id)) ||
                           (req.body && (req.body.conversationId || req.body.conversation_id || req.body.bookingId || req.body.booking_id)) ||
                           (req.query && (req.query.conversationId || req.query.conversation_id || req.query.bookingId || req.query.booking_id));

    if (conversationId) {
      const result = await chatService.clearConversationMessages(conversationId);
      if (req.app && req.app.get('io')) {
        const io = req.app.get('io');
        io.to(`conv_${conversationId}`).emit('chat_cleared', { conversationId });
        io.to(String(conversationId)).emit('chat_cleared', { conversationId });
      }
      return res.status(200).json(result);
    }

    const result = await chatService.clearAllMessages();
    if (req.app && req.app.get('io')) {
      const io = req.app.get('io');
      io.emit('chat_cleared', { all: true });
    }
    return res.status(200).json(result);
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
  handleSendMessage,
  handleClearChat
};
