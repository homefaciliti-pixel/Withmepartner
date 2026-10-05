const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const chatService = require('../services/chatService');
const { sendEventNotification } = require('../services/notificationService');
const { toIST } = chatService;

// Active socket connection map: userId -> Set of socketId(s)
const onlineUsersMap = new Map();

function isUserOnline(userId) {
  if (!userId) return false;
  const uId = String(userId);
  const userSockets = onlineUsersMap.get(uId);
  return userSockets && userSockets.size > 0;
}

function initChatSocket(server) {
  const io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Socket Authentication Middleware
  io.use((socket, next) => {
    try {
      let token = null;

      if (socket.handshake && socket.handshake.auth && socket.handshake.auth.token) {
        token = socket.handshake.auth.token;
      } else if (socket.handshake && socket.handshake.headers && socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        token = authHeader.split(' ')[1] || authHeader;
      } else if (socket.handshake && socket.handshake.query && socket.handshake.query.token) {
        token = socket.handshake.query.token;
      }

      if (!token) {
        return next(new Error("Authentication error: Access token required"));
      }

      // Strip "Bearer " prefix if present
      if (token.startsWith('Bearer ')) {
        token = token.slice(7);
      }

      jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, decoded) => {
        if (err || !decoded) {
          return next(new Error("Authentication error: Invalid or expired access token"));
        }
        const uId = String(decoded.user_id || decoded.id);
        socket.userId = uId;
        next();
      });
    } catch (err) {
      return next(new Error("Authentication error: Failed to authenticate socket"));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`[Socket.IO] User connected: ${userId} (Socket ID: ${socket.id})`);

    const uIdStr = String(userId).trim();
    const digitsOnly = uIdStr.replace(/\D/g, '');

    socket.join(uIdStr);
    socket.join(`user_${uIdStr}`);
    socket.join(`partner_${uIdStr}`);
    if (digitsOnly) {
      socket.join(digitsOnly);
      socket.join(`usr_${digitsOnly}`);
      socket.join(`user_${digitsOnly}`);
      socket.join(`partner_${digitsOnly}`);
    }

    // Track online user socket across all key variants
    const trackKeys = new Set([
      uIdStr,
      digitsOnly,
      `usr_${digitsOnly}`,
      `user_${digitsOnly}`,
      `partner_${digitsOnly}`
    ]);

    trackKeys.forEach(k => {
      if (k) {
        if (!onlineUsersMap.has(k)) {
          onlineUsersMap.set(k, new Set());
        }
        onlineUsersMap.get(k).add(socket.id);
      }
    });

    // Broadcast user online event
    io.emit('user_online', { userId: isNaN(userId) ? userId : Number(userId) });

    // Handle join_conversation room
    socket.on('join_conversation', (data) => {
      const cId = data ? (data.conversationId || data.conversation_id) : null;
      if (cId) {
        socket.join(`conv_${cId}`);
        socket.join(String(cId));
      }
    });

    socket.on('join_room', (data) => {
      const cId = data ? (data.conversationId || data.conversation_id || data.room) : null;
      if (cId) {
        socket.join(`conv_${cId}`);
        socket.join(String(cId));
      }
    });

    // Handle send_message
    socket.on('send_message', async (data, callback) => {
      try {
        const senderId = socket.userId; // ALWAYS use authenticated socket.userId
        const { conversationId, receiverId, message } = data || {};

        if (!conversationId || !receiverId || message === undefined || message === null) {
          const errRes = { success: false, message: "Missing required fields: conversationId, receiverId, message" };
          if (typeof callback === 'function') callback(errRes);
          socket.emit('error', errRes);
          return;
        }

        const cleanMessage = String(message).trim();
        if (!cleanMessage) {
          const errRes = { success: false, message: "Message cannot be empty" };
          if (typeof callback === 'function') callback(errRes);
          socket.emit('error', errRes);
          return;
        }

        if (cleanMessage.length > 5000) {
          const errRes = { success: false, message: "Message length exceeds 5000 limit" };
          if (typeof callback === 'function') callback(errRes);
          socket.emit('error', errRes);
          return;
        }

        // Auto-join sender to conversation room
        socket.join(`conv_${conversationId}`);
        socket.join(String(conversationId));

        // Verify sender is in conversation
        const isMember = await chatService.isUserInConversation(conversationId, senderId);
        if (!isMember) {
          const errRes = { success: false, message: "Unauthorized: You are not a member of this conversation" };
          if (typeof callback === 'function') callback(errRes);
          socket.emit('error', errRes);
          return;
        }

        // Verify blocks
        const isBlocked = await chatService.isUserBlocked(senderId, receiverId);
        if (isBlocked) {
          const errRes = { success: false, message: "Cannot send message. User is blocked" };
          if (typeof callback === 'function') callback(errRes);
          socket.emit('error', errRes);
          return;
        }

        // Save message
        const savedMsg = await chatService.saveMessage({
          conversationId,
          senderId,
          receiverId,
          message: cleanMessage,
          messageType: 'text'
        });

        const msgPayload = {
          id: Number(savedMsg.id),
          messageId: Number(savedMsg.id),
          conversationId: Number(conversationId),
          senderId: isNaN(senderId) ? senderId : Number(senderId),
          receiverId: isNaN(receiverId) ? String(receiverId) : Number(receiverId),
          messageType: 'text',
          message: savedMsg.message,
          isDelivered: false,
          isRead: false,
          createdAt: toIST(savedMsg.created_at)
        };

        // Emit message_sent to sender
        socket.emit('message_sent', msgPayload);
        if (typeof callback === 'function') callback({ success: true, data: msgPayload });

        // Deliver to receiver & conversation rooms across all key variants
        const rIdStr = String(receiverId).trim();
        const rDigits = rIdStr.replace(/\D/g, '');
        const convRoom = `conv_${conversationId}`;

        // Gather all sockets registered for receiver ID
        const activeSockets = new Set();
        [rIdStr, rDigits, `usr_${rDigits}`, `user_${rDigits}`, `partner_${rDigits}`].forEach(k => {
          if (k && onlineUsersMap.has(k)) {
            onlineUsersMap.get(k).forEach(sId => activeSockets.add(sId));
          }
        });

        io.to(convRoom).emit('receive_message', msgPayload);
        io.to(convRoom).emit('new_message', msgPayload);
        io.to(rIdStr).emit('receive_message', msgPayload);
        io.to(rIdStr).emit('new_message', msgPayload);
        if (rDigits) {
          io.to(rDigits).emit('receive_message', msgPayload);
          io.to(`usr_${rDigits}`).emit('receive_message', msgPayload);
          io.to(`user_${rDigits}`).emit('receive_message', msgPayload);
          io.to(`partner_${rDigits}`).emit('receive_message', msgPayload);
        }

        if (activeSockets.size > 0) {
          await chatService.markMessageDelivered(savedMsg.id);
          msgPayload.isDelivered = true;

          activeSockets.forEach(sId => {
            io.to(sId).emit('receive_message', msgPayload);
            io.to(sId).emit('new_message', msgPayload);
          });

          // Notify sender of delivery status
          socket.emit('message_delivered', {
            messageId: Number(savedMsg.id),
            conversationId: Number(conversationId)
          });
        }

        // Trigger chat_message push notification async in background
        setImmediate(() => {
          sendEventNotification('chat_message', {
            targetUserId: receiverId,
            sender_id: senderId,
            message: cleanMessage,
            conversation_id: conversationId
          }).catch(() => {});
        });
      } catch (err) {
        console.error("[Socket.IO Error send_message]:", err);
        const errRes = { success: false, message: "Failed to process send_message" };
        if (typeof callback === 'function') callback(errRes);
        socket.emit('error', errRes);
      }
    });

    // Handle mark_message_read
    socket.on('mark_message_read', async (data, callback) => {
      try {
        const receiverId = socket.userId;
        const { messageId } = data || {};

        if (!messageId) return;

        const updatedMsg = await chatService.markMessageRead(messageId, receiverId);
        if (updatedMsg) {
          const sIdStr = String(updatedMsg.sender_id);
          const senderSockets = onlineUsersMap.get(sIdStr);

          if (senderSockets && senderSockets.size > 0) {
            senderSockets.forEach(sId => {
              io.to(sId).emit('message_read', {
                messageId: Number(messageId),
                conversationId: Number(updatedMsg.conversation_id)
              });
            });
          }
          if (typeof callback === 'function') callback({ success: true });
        }
      } catch (err) {
        console.error("[Socket.IO Error mark_message_read]:", err);
      }
    });

    // Handle typing_start
    socket.on('typing_start', (data) => {
      const { conversationId, receiverId } = data || {};
      if (!conversationId || !receiverId) return;

      const rIdStr = String(receiverId).trim();
      const rDigits = rIdStr.replace(/\D/g, '');
      const receiverSockets = new Set();
      [rIdStr, rDigits, `usr_${rDigits}`, `user_${rDigits}`].forEach(k => {
        if (k && onlineUsersMap.has(k)) onlineUsersMap.get(k).forEach(s => receiverSockets.add(s));
      });
      receiverSockets.forEach(sId => {
        io.to(sId).emit('user_typing', {
          conversationId: Number(conversationId),
          userId: isNaN(socket.userId) ? socket.userId : Number(socket.userId)
        });
      });
    });

    // Handle typing_stop
    socket.on('typing_stop', (data) => {
      const { conversationId, receiverId } = data || {};
      if (!conversationId || !receiverId) return;

      const rIdStr = String(receiverId).trim();
      const rDigits = rIdStr.replace(/\D/g, '');
      const receiverSockets = new Set();
      [rIdStr, rDigits, `usr_${rDigits}`, `user_${rDigits}`].forEach(k => {
        if (k && onlineUsersMap.has(k)) onlineUsersMap.get(k).forEach(s => receiverSockets.add(s));
      });
      receiverSockets.forEach(sId => {
        io.to(sId).emit('user_stopped_typing', {
          conversationId: Number(conversationId),
          userId: isNaN(socket.userId) ? socket.userId : Number(socket.userId)
        });
      });
    });

    // Handle disconnect — clean up ALL key variants
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] User disconnected: ${userId} (Socket ID: ${socket.id})`);

      // Remove socketId from every key variant we registered on connect
      trackKeys.forEach(k => {
        if (!k) return;
        const sockets = onlineUsersMap.get(k);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsersMap.delete(k);
          }
        }
      });

      // Also clean up the raw userId key in case it differs from trackKeys
      const rawSockets = onlineUsersMap.get(String(userId));
      if (rawSockets) {
        rawSockets.delete(socket.id);
        if (rawSockets.size === 0) {
          onlineUsersMap.delete(String(userId));
        }
      }

      // Emit offline only if user has no remaining active sockets anywhere
      const stillOnline = Array.from(trackKeys).some(k => k && onlineUsersMap.has(k) && onlineUsersMap.get(k).size > 0);
      if (!stillOnline) {
        io.emit('user_offline', { userId: isNaN(userId) ? userId : Number(userId) });
      }
    });
  });

  return io;
}

module.exports = { initChatSocket, isUserOnline, onlineUsersMap };
