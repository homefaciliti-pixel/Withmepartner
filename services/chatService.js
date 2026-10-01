const { getDbPool } = require('../config/database');
const { users, formatPhotoUrl } = require('../store/db');

// In-memory fallback stores for Chat
const memoryConversations = new Map(); // conversationId -> { id, type, created_at, updated_at }
const memoryMembers = []; // [{ id, conversation_id, user_id, joined_at }]
const memoryMessages = new Map(); // messageId -> { id, conversation_id, sender_id, receiver_id, message_type, message, is_delivered, is_read, is_deleted, created_at }
const memoryBlocks = new Set(); // "blockerId:blockedId"

let autoMessageId = 1000;
let autoConversationId = 100;

// Helper to normalize user ID string
function toUserIdStr(id) {
  if (id === null || id === undefined) return "";
  return String(id).trim();
}

/**
 * Find user details from memory store or MySQL
 */
async function findUser(userId) {
  const uId = toUserIdStr(userId);
  if (!uId) return null;

  // 1. Check in-memory store
  if (users.has(uId)) {
    return users.get(uId);
  }
  const matchMem = Array.from(users.values()).find(u =>
    toUserIdStr(u.user_id) === uId ||
    toUserIdStr(u.id) === uId ||
    toUserIdStr(u.mobile_number) === uId
  );
  if (matchMem) return matchMem;

  // 2. Check MySQL database
  try {
    const db = getDbPool();
    const [rows] = await db.query(
      `SELECT * FROM withme_partners WHERE user_id = ? OR partner_id = ? OR mobile_number = ? LIMIT 1`,
      [uId, uId, uId]
    );
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    // Ignore database connection error, fallback to memory
  }

  // 3. Fallback pseudo-user for test numeric user IDs if valid
  if (uId.length > 0) {
    return {
      user_id: uId,
      name: `User ${uId}`,
      profile_photo_url: "/uploads/photos/photo_1.jpg"
    };
  }

  return null;
}

/**
 * Check if either user has blocked the other
 */
async function isUserBlocked(user1Id, user2Id) {
  const u1 = toUserIdStr(user1Id);
  const u2 = toUserIdStr(user2Id);
  if (!u1 || !u2) return false;

  // Check memory store
  if (memoryBlocks.has(`${u1}:${u2}`) || memoryBlocks.has(`${u2}:${u1}`)) {
    return true;
  }

  // Fast MySQL check
  try {
    const db = getDbPool();
    const queryPromise = db.query(
      `SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
      [u1, u2, u2, u1]
    );
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 200));
    const [rows] = await Promise.race([queryPromise, timeoutPromise]);
    if (rows && rows.length > 0) {
      return true;
    }
  } catch (err) {
    // Ignore MySQL error
  }

  return false;
}

/**
 * Block a user
 */
async function blockUser(blockerId, blockedId) {
  const b1 = toUserIdStr(blockerId);
  const b2 = toUserIdStr(blockedId);

  if (!b1 || !b2) {
    throw new Error("Invalid blocker or blocked user ID");
  }

  if (b1 === b2) {
    throw new Error("Cannot block yourself");
  }

  // Add to memory
  memoryBlocks.add(`${b1}:${b2}`);

  // Save to MySQL
  try {
    const db = getDbPool();
    await db.query(
      `INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`,
      [b1, b2]
    );
  } catch (err) {
    // Ignore MySQL error
  }

  return { success: true, message: "User blocked successfully" };
}

/**
 * Check if a user is a member of a conversation
 */
async function isUserInConversation(conversationId, userId) {
  const convId = Number(conversationId);
  const uId = toUserIdStr(userId);

  // Memory check
  const inMem = memoryMembers.some(m => m.conversation_id === convId && toUserIdStr(m.user_id) === uId);
  if (inMem) return true;

  if (memoryConversations.has(convId)) {
    return false; // Conversation exists in memory, user is not a member
  }

  // Fast MySQL check
  try {
    const db = getDbPool();
    const queryPromise = db.query(
      `SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1`,
      [convId, uId]
    );
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 200));
    const [rows] = await Promise.race([queryPromise, timeoutPromise]);
    return rows && rows.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Find existing private conversation between two users
 */
async function findPrivateConversation(user1Id, user2Id) {
  const u1 = toUserIdStr(user1Id);
  const u2 = toUserIdStr(user2Id);

  // Check memory
  const user1Convs = memoryMembers.filter(m => toUserIdStr(m.user_id) === u1).map(m => m.conversation_id);
  const commonConvId = user1Convs.find(cId =>
    memoryMembers.some(m => m.conversation_id === cId && toUserIdStr(m.user_id) === u2)
  );

  if (commonConvId) {
    return commonConvId;
  }

  // Check MySQL
  try {
    const db = getDbPool();
    const [rows] = await db.query(
      `SELECT cm1.conversation_id
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       JOIN conversations c ON c.id = cm1.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id = ? AND c.type = 'private'
       LIMIT 1`,
      [u1, u2]
    );
    if (rows && rows.length > 0) {
      const convId = Number(rows[0].conversation_id);
      // Cache in memory
      memoryMembers.push(
        { id: memoryMembers.length + 1, conversation_id: convId, user_id: u1, joined_at: new Date().toISOString() },
        { id: memoryMembers.length + 2, conversation_id: convId, user_id: u2, joined_at: new Date().toISOString() }
      );
      return convId;
    }
  } catch (err) {
    // Ignore MySQL error
  }

  return null;
}

/**
 * Create or Get a private conversation between current user and target user
 */
async function createOrGetConversation(currentUserId, targetUserId) {
  const u1 = toUserIdStr(currentUserId);
  const u2 = toUserIdStr(targetUserId);

  if (!u2) {
    throw new Error("Target userId is required");
  }

  if (u1 === u2) {
    throw new Error("Cannot create conversation with yourself");
  }

  // Verify target user exists
  const targetUser = await findUser(u2);
  if (!targetUser) {
    throw new Error("Target user not found");
  }

  // Check blocks
  const blocked = await isUserBlocked(u1, u2);
  if (blocked) {
    throw new Error("User is blocked");
  }

  // Check if conversation already exists
  const existingConvId = await findPrivateConversation(u1, u2);
  if (existingConvId) {
    return {
      success: true,
      conversationId: Number(existingConvId)
    };
  }

  // Create new conversation
  const nowStr = new Date().toISOString();
  let newConvId = null;

  try {
    const db = getDbPool();
    const [resConv] = await db.query(
      `INSERT INTO conversations (type) VALUES ('private')`
    );
    newConvId = Number(resConv.insertId);

    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)`,
      [newConvId, u1, newConvId, u2]
    );
  } catch (err) {
    // Fallback in-memory creation if MySQL unavailable
    autoConversationId += 1;
    newConvId = autoConversationId;
  }

  memoryConversations.set(newConvId, {
    id: newConvId,
    type: 'private',
    created_at: nowStr,
    updated_at: nowStr
  });

  memoryMembers.push(
    { id: memoryMembers.length + 1, conversation_id: newConvId, user_id: u1, joined_at: nowStr },
    { id: memoryMembers.length + 2, conversation_id: newConvId, user_id: u2, joined_at: nowStr }
  );

  return {
    success: true,
    conversationId: Number(newConvId)
  };
}

/**
 * Get all conversations for a user
 */
async function getUserConversations(userId, req, isUserOnlineFn) {
  const uId = toUserIdStr(userId);
  let conversationIds = [];

  // Get from MySQL
  try {
    const db = getDbPool();
    const [rows] = await db.query(
      `SELECT conversation_id FROM conversation_members WHERE user_id = ?`,
      [uId]
    );
    if (rows && rows.length > 0) {
      conversationIds = rows.map(r => Number(r.conversation_id));
    }
  } catch (err) {
    // Ignore MySQL error
  }

  // Also combine from memory
  const memConvs = memoryMembers.filter(m => toUserIdStr(m.user_id) === uId).map(m => m.conversation_id);
  conversationIds = Array.from(new Set([...conversationIds, ...memConvs]));

  const list = [];

  for (const convId of conversationIds) {
    // Find other member
    let otherUserId = null;

    // Check memory first
    const otherMem = memoryMembers.find(m => m.conversation_id === convId && toUserIdStr(m.user_id) !== uId);
    if (otherMem) {
      otherUserId = toUserIdStr(otherMem.user_id);
    } else {
      try {
        const db = getDbPool();
        const [mRows] = await db.query(
          `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1`,
          [convId, uId]
        );
        if (mRows && mRows.length > 0) {
          otherUserId = toUserIdStr(mRows[0].user_id);
        }
      } catch (err) {
        // Ignore MySQL error
      }
    }

    if (!otherUserId) continue;

    const otherUser = await findUser(otherUserId);
    const otherUserName = otherUser ? (otherUser.name || otherUser.full_name || `User ${otherUserId}`) : `User ${otherUserId}`;
    const rawPhoto = otherUser ? (otherUser.profile_photo_url || otherUser.image || '') : '';
    const otherUserProfileImage = formatPhotoUrl(rawPhoto, req);

    // Fetch last message & unread count
    let lastMsg = null;
    let unreadCount = 0;

    // 1. MySQL fetch
    try {
      const db = getDbPool();
      const [msgRows] = await db.query(
        `SELECT * FROM messages WHERE conversation_id = ? AND is_deleted = 0 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [convId]
      );
      if (msgRows && msgRows.length > 0) {
        lastMsg = msgRows[0];
      }

      const [unreadRows] = await db.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND receiver_id = ? AND is_read = 0 AND is_deleted = 0`,
        [convId, uId]
      );
      if (unreadRows && unreadRows.length > 0) {
        unreadCount = Number(unreadRows[0].cnt);
      }
    } catch (err) {
      // Ignore MySQL error
    }

    // 2. Memory fetch comparison / fallback
    const memMsgs = Array.from(memoryMessages.values())
      .filter(m => m.conversation_id === convId && !m.is_deleted)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (memMsgs.length > 0) {
      if (!lastMsg || new Date(memMsgs[0].created_at) > new Date(lastMsg.created_at)) {
        lastMsg = memMsgs[0];
      }
    }

    const memUnread = Array.from(memoryMessages.values())
      .filter(m => m.conversation_id === convId && toUserIdStr(m.receiver_id) === uId && !m.is_read && !m.is_deleted).length;
    unreadCount = Math.max(unreadCount, memUnread);

    const isOnline = isUserOnlineFn ? isUserOnlineFn(otherUserId) : false;

    list.push({
      conversationId: convId,
      otherUserId: isNaN(otherUserId) ? otherUserId : Number(otherUserId),
      otherUserName,
      otherUserProfileImage,
      lastMessage: lastMsg ? lastMsg.message : "",
      lastMessageTime: lastMsg ? (typeof lastMsg.created_at === 'string' ? lastMsg.created_at : new Date(lastMsg.created_at).toISOString()) : new Date().toISOString(),
      unreadCount,
      isOnline
    });
  }

  // Sort latest message first
  list.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

  return {
    success: true,
    data: list
  };
}

/**
 * Get messages history for a conversation
 */
async function getConversationMessages(conversationId, userId) {
  const convId = Number(conversationId);
  const uId = toUserIdStr(userId);

  const isMember = await isUserInConversation(convId, uId);
  if (!isMember) {
    const err = new Error("Access denied: You are not a member of this conversation");
    err.statusCode = 403;
    throw err;
  }

  let dbMessages = [];

  // Fetch from MySQL
  try {
    const db = getDbPool();
    const [rows] = await db.query(
      `SELECT * FROM (
        SELECT * FROM messages WHERE conversation_id = ? AND is_deleted = 0 ORDER BY created_at DESC, id DESC LIMIT 50
       ) sub ORDER BY created_at ASC, id ASC`,
      [convId]
    );
    if (rows) dbMessages = rows;
  } catch (err) {
    // Ignore MySQL error
  }

  // Fetch from memory
  const memMsgs = Array.from(memoryMessages.values())
    .filter(m => m.conversation_id === convId && !m.is_deleted)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Merge and deduplicate by id
  const msgMap = new Map();
  dbMessages.forEach(m => msgMap.set(Number(m.id), m));
  memMsgs.forEach(m => msgMap.set(Number(m.id), m));

  const allMsgs = Array.from(msgMap.values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const formatted = allMsgs.map(m => ({
    messageId: Number(m.id),
    conversationId: Number(m.conversation_id),
    senderId: isNaN(m.sender_id) ? String(m.sender_id) : Number(m.sender_id),
    receiverId: isNaN(m.receiver_id) ? String(m.receiver_id) : Number(m.receiver_id),
    message: m.message,
    messageType: m.message_type || 'text',
    isDelivered: Boolean(m.is_delivered),
    isRead: Boolean(m.is_read),
    createdAt: typeof m.created_at === 'string' ? m.created_at : new Date(m.created_at).toISOString()
  }));

  return {
    success: true,
    data: formatted
  };
}

/**
 * Save new message to database & memory
 */
async function saveMessage({ conversationId, senderId, receiverId, message, messageType = 'text' }) {
  const convId = Number(conversationId);
  const sId = toUserIdStr(senderId);
  const rId = toUserIdStr(receiverId);
  const cleanMsg = String(message).trim();
  const nowStr = new Date().toISOString();

  autoMessageId += 1;
  const newId = autoMessageId;

  const msgObj = {
    id: newId,
    conversation_id: convId,
    sender_id: sId,
    receiver_id: rId,
    message_type: messageType,
    message: cleanMsg,
    is_delivered: 0,
    is_read: 0,
    is_deleted: 0,
    created_at: nowStr
  };

  memoryMessages.set(newId, msgObj);

  // Background MySQL insert without blocking real-time socket delivery
  (async () => {
    try {
      const db = getDbPool();
      await db.query(
        `INSERT INTO messages (conversation_id, sender_id, receiver_id, message_type, message) VALUES (?, ?, ?, ?, ?)`,
        [convId, sId, rId, messageType, cleanMsg]
      );
      await db.query(
        `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [convId]
      );
    } catch (err) {
      // Ignore MySQL connection / query error
    }
  })();

  return msgObj;
}

/**
 * Mark message as delivered
 */
async function markMessageDelivered(messageId) {
  const mId = Number(messageId);
  if (memoryMessages.has(mId)) {
    memoryMessages.get(mId).is_delivered = 1;
  }

  (async () => {
    try {
      const db = getDbPool();
      await db.query(`UPDATE messages SET is_delivered = 1 WHERE id = ?`, [mId]);
    } catch (err) {
      // Ignore MySQL error
    }
  })();
}

/**
 * Mark message as read
 */
async function markMessageRead(messageId, receiverId) {
  const mId = Number(messageId);
  const rId = toUserIdStr(receiverId);

  let targetMsg = memoryMessages.get(mId) || memoryMessages.get(String(messageId));

  if (!targetMsg) {
    targetMsg = Array.from(memoryMessages.values()).find(m => Number(m.id) === mId);
  }

  if (!targetMsg) {
    try {
      const db = getDbPool();
      const queryPromise = db.query(`SELECT * FROM messages WHERE id = ? LIMIT 1`, [mId]);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 200));
      const [rows] = await Promise.race([queryPromise, timeoutPromise]);
      if (rows && rows.length > 0) {
        targetMsg = rows[0];
      }
    } catch (err) {
      // Ignore MySQL error
    }
  }

  if (!targetMsg) return null;

  if (toUserIdStr(targetMsg.receiver_id) !== rId) {
    return null;
  }

  targetMsg.is_read = 1;
  memoryMessages.set(mId, targetMsg);
  if (targetMsg.id) memoryMessages.set(Number(targetMsg.id), targetMsg);

  (async () => {
    try {
      const db = getDbPool();
      await db.query(`UPDATE messages SET is_read = 1 WHERE id = ? AND receiver_id = ?`, [mId, rId]);
    } catch (err) {
      // Ignore MySQL error
    }
  })();

  return targetMsg;
}

/**
 * Soft delete a message
 */
async function deleteMessage(messageId, senderId) {
  const mId = Number(messageId);
  const sId = toUserIdStr(senderId);

  let msg = memoryMessages.get(mId);

  if (!msg) {
    try {
      const db = getDbPool();
      const queryPromise = db.query(`SELECT * FROM messages WHERE id = ? LIMIT 1`, [mId]);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 200));
      const [rows] = await Promise.race([queryPromise, timeoutPromise]);
      if (rows && rows.length > 0) {
        msg = rows[0];
      }
    } catch (err) {
      // Ignore MySQL error
    }
  }

  if (!msg) {
    const err = new Error("Message not found");
    err.statusCode = 404;
    throw err;
  }

  if (toUserIdStr(msg.sender_id) !== sId) {
    const err = new Error("Only the sender can delete this message");
    err.statusCode = 403;
    throw err;
  }

  msg.is_deleted = 1;
  memoryMessages.set(mId, msg);

  (async () => {
    try {
      const db = getDbPool();
      await db.query(`UPDATE messages SET is_deleted = 1 WHERE id = ? AND sender_id = ?`, [mId, sId]);
    } catch (err) {
      // Ignore MySQL error
    }
  })();

  return {
    success: true,
    message: "Message deleted successfully"
  };
}

module.exports = {
  findUser,
  isUserBlocked,
  blockUser,
  isUserInConversation,
  findPrivateConversation,
  createOrGetConversation,
  getUserConversations,
  getConversationMessages,
  saveMessage,
  markMessageDelivered,
  markMessageRead,
  deleteMessage
};
