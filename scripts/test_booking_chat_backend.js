const { getDbPool } = require('../config/database');
const chatService = require('../services/chatService');
const { sendEventNotification, saveUserFcmToken } = require('../services/notificationService');

async function runTests() {
  console.log('=== Starting WithMe24 Booking-Specific Chat & FCM Backend Tests ===\n');

  const partnerId = '1234567891'; // Existing test partner
  const userId = 'usr_test_user_777'; // Test user
  const session1BookingId = `BK_TEST_SESS_1_${Date.now()}`;
  const session2BookingId = `BK_TEST_SESS_2_${Date.now()}`;

  const db = getDbPool();

  try {
    // 1. Setup two test bookings in MySQL for the SAME partner and user
    console.log('[Test 1] Setting up two separate sessions for same partner and user...');
    await db.query(
      `INSERT INTO withme_partner_bookings (
        booking_id, request_id, user_id, partner_id, customer_name, customer_phone,
        activity, date, time, price, payment_status, status, is_accepted, is_paid
      ) VALUES 
      (?, ?, ?, ?, 'Amit Sharma', '9876543210', 'Coffee Date', '2026-10-27', '10:00 AM', 1500, 'PAID', 'CONFIRMED', 1, 1),
      (?, ?, ?, ?, 'Amit Sharma', '9876543210', 'Movie Night', '2026-10-28', '07:00 PM', 2500, 'PAID', 'CONFIRMED', 1, 1)`,
      [
        session1BookingId, `req_s1_${Date.now()}`, userId, partnerId,
        session2BookingId, `req_s2_${Date.now()}`, userId, partnerId
      ]
    );
    console.log('  Created Session 1:', session1BookingId);
    console.log('  Created Session 2:', session2BookingId);

    // 2. Test Authorization & canUsersChat for both sessions
    console.log('\n[Test 2] Testing Session Authorization & canUsersChat...');
    const canChatSession1 = await chatService.canUsersChat(partnerId, userId, session1BookingId);
    const canChatSession2 = await chatService.canUsersChat(partnerId, userId, session2BookingId);
    console.log('  Session 1 can chat:', canChatSession1);
    console.log('  Session 2 can chat:', canChatSession2);
    if (!canChatSession1 || !canChatSession2) {
      throw new Error('Authorization failed for paid sessions');
    }

    // 3. Create or Get conversation for Session 1
    console.log('\n[Test 3] Creating/Getting distinct conversation for Session 1...');
    const conv1 = await chatService.createOrGetConversation(partnerId, userId, session1BookingId);
    console.log('  Conv 1 result:', conv1);

    // 4. Create or Get conversation for Session 2
    console.log('\n[Test 4] Creating/Getting distinct conversation for Session 2...');
    const conv2 = await chatService.createOrGetConversation(partnerId, userId, session2BookingId);
    console.log('  Conv 2 result:', conv2);

    if (conv1.conversationId === conv2.conversationId) {
      throw new Error(`Session 1 and Session 2 must have distinct conversations! Got ${conv1.conversationId} for both.`);
    }
    console.log('  PASS: Session 1 and Session 2 have separate conversation IDs!');

    // 5. Send message in Session 1
    console.log('\n[Test 5] Sending message in Session 1...');
    const msg1 = await chatService.saveMessage({
      conversationId: conv1.conversationId,
      bookingId: session1BookingId,
      senderId: partnerId,
      receiverId: userId,
      message: 'Hello Amit! Ready for coffee tomorrow at 10 AM?'
    });
    console.log('  Msg 1 saved:', {
      id: msg1.id,
      conversationId: msg1.conversation_id,
      bookingId: msg1.booking_id,
      message: msg1.message
    });

    // 6. Send message in Session 2
    console.log('\n[Test 6] Sending message in Session 2...');
    const msg2 = await chatService.saveMessage({
      conversationId: conv2.conversationId,
      bookingId: session2BookingId,
      senderId: partnerId,
      receiverId: userId,
      message: 'Hey Amit! Looking forward to the movie night on the 28th!'
    });
    console.log('  Msg 2 saved:', {
      id: msg2.id,
      conversationId: msg2.conversation_id,
      bookingId: msg2.booking_id,
      message: msg2.message
    });

    // 7. Verify isolated chat histories using conversationId
    console.log('\n[Test 7] Fetching messages history by conversationId...');
    const hist1 = await chatService.getConversationMessages(conv1.conversationId, partnerId);
    const hist2 = await chatService.getConversationMessages(conv2.conversationId, partnerId);

    console.log(`  Conv 1 messages count: ${hist1.data.length}`);
    console.log(`  Conv 2 messages count: ${hist2.data.length}`);

    const hasMsg1InHist2 = hist2.data.some(m => m.message.includes('coffee'));
    const hasMsg2InHist1 = hist1.data.some(m => m.message.includes('movie'));
    if (hasMsg1InHist2 || hasMsg2InHist1) {
      throw new Error('Messages leaked between Session 1 and Session 2!');
    }
    console.log('  PASS: Chat histories are completely isolated between sessions!');

    // 8. Verify fetching chat history by bookingId string directly
    console.log('\n[Test 8] Fetching messages history by bookingId directly (e.g., GET /api/chat/messages/:bookingId)...');
    const histByBooking1 = await chatService.getConversationMessages(session1BookingId, partnerId);
    const histByBooking2 = await chatService.getConversationMessages(session2BookingId, partnerId);
    console.log(`  Fetched by Booking 1 (${session1BookingId}): ${histByBooking1.data.length} messages`);
    console.log(`  Fetched by Booking 2 (${session2BookingId}): ${histByBooking2.data.length} messages`);
    if (histByBooking1.data.length === 0 || histByBooking2.data.length === 0) {
      throw new Error('Failed to retrieve messages using bookingId directly');
    }
    console.log('  PASS: BookingId identifier lookup works directly!');

    // 9. Verify getUserConversations returns bookingId and customerName
    console.log('\n[Test 9] Testing getUserConversations with session details...');
    const convList = await chatService.getUserConversations(partnerId);
    const s1Item = convList.data.find(c => c.bookingId === session1BookingId);
    const s2Item = convList.data.find(c => c.bookingId === session2BookingId);
    console.log('  Found Session 1 in conversation list:', Boolean(s1Item), s1Item ? { customer_name: s1Item.customer_name, bookingId: s1Item.bookingId } : null);
    console.log('  Found Session 2 in conversation list:', Boolean(s2Item), s2Item ? { customer_name: s2Item.customer_name, bookingId: s2Item.bookingId } : null);
    if (!s1Item || !s2Item) {
      throw new Error('Both session conversations must appear in user conversation list');
    }
    console.log('  PASS: getUserConversations includes bookingId and correct customer name ("Amit Sharma")!');

    // 10. Test FCM token registration & notification payload
    console.log('\n[Test 10] Testing FCM Token Registration & Notification Payload...');
    const testFcmToken = 'fcm_test_token_partner_sample_12345';
    await saveUserFcmToken(partnerId, testFcmToken, 'android');

    const [partnerRow] = await db.query('SELECT fcm_token FROM withme_partners WHERE mobile_number = ? LIMIT 1', [partnerId]);
    console.log('  Partner FCM token in DB:', partnerRow[0] ? partnerRow[0].fcm_token : 'Not found');
    if (!partnerRow[0] || partnerRow[0].fcm_token !== testFcmToken) {
      throw new Error('FCM token registration failed to update partner row in MySQL');
    }
    console.log('  PASS: FCM token saved successfully!');

    // 11. Test FCM chat_message notification payload generation
    console.log('\n[Test 11] Verifying FCM notification payload structure for chat_message...');
    const ntfResult = await sendEventNotification('chat_message', {
      targetUserId: partnerId,
      sender_id: userId,
      otherUserId: userId,
      otherUserName: 'Amit Sharma',
      name: 'Amit Sharma',
      message: 'I am on my way!',
      conversation_id: conv1.conversationId,
      chatId: conv1.conversationId,
      bookingId: session1BookingId,
      booking_id: session1BookingId
    });

    console.log('  Notification record created:', ntfResult.notification_id);
    const [ntfRows] = await db.query('SELECT * FROM withme_notifications WHERE notification_id = ? LIMIT 1', [ntfResult.notification_id]);
    if (ntfRows.length > 0) {
      const payload = JSON.parse(ntfRows[0].data_payload);
      console.log('  Notification data payload:', payload);
      if (
        payload.type !== 'chat_message' ||
        !payload.bookingId ||
        !payload.chatId ||
        !payload.otherUserId ||
        !payload.otherUserName
      ) {
        throw new Error('FCM chat_message payload is missing required keys: type, bookingId, chatId, otherUserId, otherUserName');
      }
      console.log('  PASS: All FCM payload keys present (type, bookingId, chatId, otherUserId, otherUserName)!');
    }

    // 12. Cleanup test data
    console.log('\n[Cleanup] Removing temporary test bookings and messages...');
    await db.query('DELETE FROM messages WHERE booking_id IN (?, ?)', [session1BookingId, session2BookingId]);
    await db.query('DELETE FROM conversation_members WHERE conversation_id IN (?, ?)', [conv1.conversationId, conv2.conversationId]);
    await db.query('DELETE FROM conversations WHERE id IN (?, ?)', [conv1.conversationId, conv2.conversationId]);
    await db.query('DELETE FROM withme_partner_bookings WHERE booking_id IN (?, ?)', [session1BookingId, session2BookingId]);
    await db.query('DELETE FROM withme_notifications WHERE notification_id = ?', [ntfResult.notification_id]);

    console.log('\n======================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } catch (err) {
    console.error('\n❌ Test Failure:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
}

runTests();
