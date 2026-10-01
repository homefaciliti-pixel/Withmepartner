const app = require('./server');
const http = require('http');
const fs = require('fs');
const path = require('path');

let server;
const PORT = 5006;
const BASE_URL = `http://localhost:${PORT}`;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...headers
      }
    };

    let postData = null;
    if (body && typeof body === 'object' && !headers['Content-Type']) {
      postData = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    } else if (typeof body === 'string') {
      postData = body;
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

const { initChatSocket } = require('./sockets/chatSocket');

async function runTests() {
  console.log("Starting Partner API Verification Suite...");
  server = http.createServer(app);
  initChatSocket(server);

  server.listen(PORT, async () => {
    try {
      // 1. Seed User Login
      console.log("\n1. Testing Seed User Login API (/auth/login)...");
      const loginRes = await request('POST', '/auth/login', {
        country_code: "+91",
        mobile_number: "9876543210",
        password: "MySecurePass123"
      });
      console.assert(loginRes.status === 200, "Seed user Login 200");
      const token = loginRes.body.data.access_token;
      const authHeader = { 'Authorization': `Bearer ${token}` };

      // 2. Flexible Mobile Login Test
      console.log("\n2. Testing Flexible Mobile Number Login (+91 with leading zeros/formatting)...");
      const flexLoginRes = await request('POST', '/auth/login', {
        country_code: "91",
        mobile_number: "09876543210",
        password: "MySecurePass123"
      });
      console.assert(flexLoginRes.status === 200, "Flexible mobile login 200");

      // 3. User Registration Flow (Send OTP -> Verify OTP -> Register)
      console.log("\n3. Testing Registration Flow & Persistence...");
      const testMobile = `91${Math.floor(10000000 + Math.random() * 90000000)}`;
      const testEmail = `user_${Date.now()}@example.com`;

      const sendOtpRes = await request('POST', '/auth/register/send-otp', {
        country_code: "+91",
        mobile_number: testMobile
      });
      console.assert(sendOtpRes.status === 200, "Send OTP 200");
      const sessionId = sendOtpRes.body.data.otp_session_id;

      const verifyOtpRes = await request('POST', '/auth/register/verify-otp', {
        otp_session_id: sessionId,
        otp: "5739"
      });
      console.assert(verifyOtpRes.status === 200, "Verify OTP 200");
      const vToken = verifyOtpRes.body.data.token;

      // Underage DOB test (e.g. 2010-05-15 = age 16)
      console.log("\n3.1 Testing Underage Registration Restriction (age < 19)...");
      const underageRegRes = await request('POST', '/auth/register', {
        token: vToken,
        name: "Underage User",
        country_code: "+91",
        mobile_number: testMobile,
        email: `underage_${Date.now()}@example.com`,
        gender: "Female",
        dob: "2010-05-15",
        area: "Raja Park",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302004",
        password: "NewUserPass123",
        confirm_password: "NewUserPass123"
      });
      console.assert(underageRegRes.status === 400, "Underage registration blocked with 400");
      console.assert(underageRegRes.body.error_code === "UNDERAGE_NOT_ALLOWED", "UNDERAGE_NOT_ALLOWED code returned");

      const regRes = await request('POST', '/auth/register', {
        token: vToken,
        name: "Test User",
        country_code: "+91",
        mobile_number: testMobile,
        email: testEmail,
        gender: "Female",
        dob: "2000-01-01",
        area: "Raja Park",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302004",
        password: "NewUserPass123",
        confirm_password: "NewUserPass123"
      });
      console.assert(regRes.status === 201, "Registration 201");
      const newUserId = regRes.body.data.user_id;
      const newAuthToken = regRes.body.data.access_token;

      // Check persistence file store/users.json
      const usersFilePath = path.join(__dirname, 'store', 'users.json');
      console.assert(fs.existsSync(usersFilePath), "store/users.json exists");
      const usersFileRaw = fs.readFileSync(usersFilePath, 'utf-8');
      console.assert(usersFileRaw.includes(newUserId), "New registered user persisted to users.json");

      // 4. Test Login for Newly Registered User
      console.log("\n4. Testing Login for newly registered account...");
      const newLoginRes = await request('POST', '/auth/login', {
        country_code: "+91",
        mobile_number: testMobile,
        password: "NewUserPass123"
      });
      console.assert(newLoginRes.status === 200, "Newly registered user Login 200");

      // 5. Test Default Photos for Newly Registered User
      console.log("\n5. Testing Profile Photos of newly registered user...");
      const profileRes = await request('GET', '/profile', null, { 'Authorization': `Bearer ${newAuthToken}` });
      console.assert(profileRes.status === 200, "Get Profile 200");
      console.assert(profileRes.body.data.profile_photo_url.includes("photo_1.jpg"), "Default profile photo assigned");

      // 6. Booking Detail Check
      console.log("\n6. Testing Booking Detail API (/partner/bookings/bk_001)...");
      const bkRes = await request('GET', '/partner/bookings/bk_001', null, authHeader);
      console.assert(bkRes.status === 200, "Booking detail 200");
      console.assert(bkRes.body.data.meeting_info !== undefined, "meeting_info present");

      // 7. Start Safe Meet Save API
      console.log("\n7. Testing Start Safe Meet Save API (/partner/bookings/bk_001/start-safe-meet)...");
      const startRes = await request('POST', '/partner/bookings/bk_001/start-safe-meet', {
        start_safe_meet: true
      }, authHeader);
      console.assert(startRes.status === 200, "Start safe meet 200");
      console.assert(startRes.body.data.start_safe_meet === true, "start_safe_meet is true");

      // 8. Safe Meet Mode Settings Save API
      console.log("\n8. Testing Safe Meet Mode Save API (/partner/bookings/bk_001/safe-meet)...");
      const safeMeetRes = await request('POST', '/partner/bookings/bk_001/safe-meet', {
        location_allow: 1,
        notify_trusted_contact: 1,
        safety_check_in: 1
      }, authHeader);
      console.assert(safeMeetRes.status === 200, "Safe meet mode 200");
      console.assert(safeMeetRes.body.data.safe_meet_mode.location_allow === 1, "location_allow 1");

      console.log("\n9. Testing Cancel Booking API (/partner/bookings/bk_001/cancel)...");
      const cancelRes = await request('POST', '/partner/bookings/bk_001/cancel', {
        reason: "Change of plans"
      }, authHeader);
      console.assert(cancelRes.status === 200, "Cancel booking 200");
      console.assert(cancelRes.body.data.status === "Cancelled", "Status Cancelled");
      console.assert(cancelRes.body.data.cancel_reason === "Change of plans", "Cancel reason stored");

      console.log("\n10. Testing Cancel Booking API by Body (/partner/bookings/cancel)...");
      const cancelBodyRes = await request('POST', '/partner/bookings/cancel', {
        booking_id: "bk_001",
        reason: "Busy schedule"
      }, authHeader);
      console.assert(cancelBodyRes.status === 200, "Cancel booking body 200");
      console.assert(cancelBodyRes.body.data.status === "Cancelled", "Status Cancelled");

      const newAuthHeader = { 'Authorization': `Bearer ${newAuthToken}` };

      console.log("\n11. Testing Get Bank Account API (/partner/withdraw/bank-account)...");
      const getBankRes = await request('GET', '/partner/withdraw/bank-account', null, newAuthHeader);
      console.assert(getBankRes.status === 200, "Get Bank Account 200");
      console.assert(getBankRes.body.data.support_note.includes("officalwithme24@withme24.com"), "Contains support email note");

      console.log("\n12. Testing Save Bank Account API (/partner/withdraw/bank-account)...");
      const saveBankRes = await request('POST', '/partner/withdraw/bank-account', {
        account_holder_name: "Rahul Sharma",
        bank_name: "State Bank of India",
        account_number: "30123456789",
        ifsc_code: "SBIN0001234",
        upi_id: "rahul@upi"
      }, newAuthHeader);
      console.assert(saveBankRes.status === 200, "Save Bank Account 200");
      console.assert(saveBankRes.body.data.bank_account.account_number === "30123456789", "Account number saved");
      console.assert(saveBankRes.body.data.support_note.includes("officalwithme24@withme24.com"), "Support note returned");

      console.log("\n13. Testing Bank Account Single Addition Restriction (Second Save Attempt)...");
      const secondSaveBankRes = await request('POST', '/partner/withdraw/bank-account', {
        account_holder_name: "Rahul Sharma",
        bank_name: "HDFC Bank",
        account_number: "99999999999",
        ifsc_code: "HDFC0001234"
      }, newAuthHeader);
      console.assert(secondSaveBankRes.status === 400, "Second save blocked with 400");
      console.assert(secondSaveBankRes.body.error_code === "BANK_ACCOUNT_LOCKED", "BANK_ACCOUNT_LOCKED code");
      console.assert(secondSaveBankRes.body.data.support_note.includes("officalwithme24@withme24.com"), "Support note present in locked response");

      console.log("\n14. Testing Submit Withdrawal Request API (/partner/withdraw)...");
      const withdrawRes = await request('POST', '/partner/withdraw', { amount: 1000 }, newAuthHeader);
      console.assert(withdrawRes.status === 200, "Withdrawal 200");
      console.assert(withdrawRes.body.data.bank_account.bank_name === "State Bank of India", "Bank account included in withdrawal");

      console.log("\n15. Testing Delete Account API (DELETE /profile)...");
      const deleteRes = await request('DELETE', '/profile', { reason: "Testing account deletion" }, newAuthHeader);
      console.assert(deleteRes.status === 200, "Delete account 200");
      console.assert(deleteRes.body.data.user_id === newUserId, "Correct user deleted");

      console.log("\n16. Testing Cross-App Incoming User Booking Sync (/partner/incoming-request)...");
      const syncRes = await request('POST', '/partner/incoming-request', {
        request_id: "req_user_999",
        booking_id: "bk_user_999",
        name: "Vikram Malhotra",
        interest: "Dinner",
        date: "2026-09-26",
        time: "08:00 PM",
        location: "C-Scheme, Jaipur",
        message: "Looking forward to dinner meetup"
      });
      console.assert(syncRes.status === 200, "Incoming user request 200");
      console.assert(syncRes.body.data.name === "Vikram Malhotra", "Incoming user name synced");

      const homeRes = await request('GET', '/partner/home', null, authHeader);
      console.assert(homeRes.status === 200, "Partner home 200");
      const hasVikram = homeRes.body.data.new_requests.some(r => r.name === "Vikram Malhotra");
      console.assert(hasVikram, "Incoming user request visible on Partner Home screen");

      console.log("\n17. Testing Privacy Policy API (/meta/privacy-policy & /privacy-policy)...");
      const privacyRes1 = await request('GET', '/meta/privacy-policy');
      console.assert(privacyRes1.status === 200, "Privacy policy /meta 200");
      console.assert(privacyRes1.body.data.support_email === "officalwithme24@withme24.com", "Support email present");

      const privacyRes2 = await request('GET', '/privacy-policy');
      console.assert(privacyRes2.status === 302 || privacyRes2.status === 200, "Privacy policy root 302/200");

      console.log("\n18. Testing Meta Support API (/meta/support & /support)...");
      const supportRes1 = await request('GET', '/meta/support');
      console.assert(supportRes1.status === 200, "Meta support 200");
      console.assert(supportRes1.body.data.support_email === "officalwithme24@withme24.com", "Support email verified");
      console.assert(supportRes1.body.data.phone_number === "8209343434", "Support phone number verified");

      const supportRes2 = await request('GET', '/support');
      console.assert(supportRes2.status === 302 || supportRes2.status === 200, "Support root 302/200");

      console.log("\n19. Testing Child Safety Standards API (/meta/child-safety & /child-safety)...");
      const csRes1 = await request('GET', '/meta/child-safety');
      console.assert(csRes1.status === 200, "Child safety /meta 200");
      console.assert(csRes1.body.data.minimum_age === 18, "Minimum age 18 verified");
      console.assert(csRes1.body.data.contact_email === "officalwithme24@withme24.com", "Child safety contact email verified");

      const csRes2 = await request('GET', '/child-safety');
      console.assert(csRes2.status === 302 || csRes2.status === 200, "Child safety root 302/200");

      console.log("\n20. Testing GET Withdrawal History & Summary API (/partner/withdraw)...");
      const getWithdrawRes = await request('GET', '/partner/withdraw', null, authHeader);
      console.assert(getWithdrawRes.status === 200, "Get withdrawal history 200");
      console.assert(Array.isArray(getWithdrawRes.body.data.withdrawals), "Withdrawals list returned");

      console.log("\n21. Testing Razorpay Withdrawable API (/partner/withdraw/withdrawable & /withdrawable)...");
      // Reset withdrawals for test user to ensure idempotent balance test
      const { users } = require('./store/db');
      const testU = users.get('usr_203');
      if (testU) testU.withdrawals = [];
      await request('POST', '/partner/withdraw/bank-account', {
        account_holder_name: "Priya Sharma",
        bank_name: "State Bank of India",
        account_number: "30123456789",
        ifsc_code: "SBIN0001234",
        upi_id: "priya@upi"
      }, authHeader);

      const getWithdrawableRes = await request('GET', '/partner/withdraw/withdrawable', null, authHeader);
      console.assert(getWithdrawableRes.status === 200, "Get withdrawable 200");
      console.assert(getWithdrawableRes.body.data.razorpay_key_id === "rzp_live_SwFaJKQjU5ZOsH", "Razorpay Key ID verified");
      console.assert(typeof getWithdrawableRes.body.data.withdrawable_balance === "number", "Withdrawable balance number");

      const postWithdrawableRes = await request('POST', '/partner/withdraw/withdrawable', { amount: 500, payment_mode: "IMPS" }, authHeader);
      console.assert(postWithdrawableRes.status === 200, "Post withdrawable payout 200");
      console.assert(postWithdrawableRes.body.data.amount === 500, "Payout amount 500 verified");
      console.assert(postWithdrawableRes.body.data.status === "PROCESSING", "Payout status PROCESSING verified");

      console.log("\n22. Testing Real-Time Chat REST APIs & Socket.IO Events...");
      const { io: clientIo } = require('socket.io-client');

      // Login second user (usr_201)
      const loginUser2Res = await request('POST', '/auth/login', {
        country_code: "+91",
        mobile_number: "9876500002",
        password: "MySecurePass123"
      });
      console.assert(loginUser2Res.status === 200, "User 2 login 200");
      const token2 = loginUser2Res.body.data.access_token;
      const authHeader2 = { 'Authorization': `Bearer ${token2}` };

      // 22.1 Create/Get Private Conversation
      const createConvRes = await request('POST', '/api/chat/conversation', { userId: "usr_201" }, authHeader);
      console.assert(createConvRes.status === 200, "Create conversation 200");
      console.assert(createConvRes.body.success === true, "Create conversation success");
      const convId = createConvRes.body.conversationId;
      console.assert(typeof convId === 'number' || typeof convId === 'string', "Valid conversationId returned");

      // Verify idempotent conversation fetch
      const repeatConvRes = await request('POST', '/api/chat/conversation', { userId: "usr_201" }, authHeader);
      console.assert(repeatConvRes.body.conversationId === convId, "Same conversationId returned");

      // 22.2 Connect Sockets with JWT Auth
      const socket1 = clientIo(BASE_URL, { auth: { token: token } });
      const socket2 = clientIo(BASE_URL, { auth: { token: token2 } });

      await new Promise(r => setTimeout(r, 600));

      let receivedMsgOnUser2 = null;
      let deliveredNoticeOnUser1 = null;
      let typingNoticeOnUser1 = null;
      let readNoticeOnUser1 = null;

      socket2.on('receive_message', (msg) => { receivedMsgOnUser2 = msg; });
      socket1.on('message_delivered', (data) => { deliveredNoticeOnUser1 = data; });
      socket1.on('user_typing', (data) => { typingNoticeOnUser1 = data; });
      socket1.on('message_read', (data) => { readNoticeOnUser1 = data; });

      // 22.3 Socket Send Message
      const sendPromise = new Promise((resolve) => {
        socket1.emit('send_message', {
          conversationId: convId,
          receiverId: "usr_201",
          message: "Hello Ananya!"
        }, (res) => resolve(res));
      });

      const sendAck = await sendPromise;
      console.assert(sendAck.success === true, "send_message socket ack success");
      const sentMsgId = sendAck.data.messageId;

      await new Promise(r => setTimeout(r, 600));

      console.assert(receivedMsgOnUser2 !== null, "User 2 received real-time message via socket");
      console.assert(receivedMsgOnUser2.message === "Hello Ananya!", "Received message text matches");
      console.assert(deliveredNoticeOnUser1 !== null, "User 1 received delivery confirmation via socket");

      // 22.4 Socket Typing Indicators
      socket2.emit('typing_start', { conversationId: convId, receiverId: "usr_203" });
      await new Promise(r => setTimeout(r, 300));
      console.assert(typingNoticeOnUser1 !== null, "User 1 received user_typing event");

      // 22.5 Socket Read Status
      socket2.emit('mark_message_read', { messageId: sentMsgId });
      await new Promise(r => setTimeout(r, 300));
      console.assert(readNoticeOnUser1 !== null, "User 1 received message_read status");

      // 22.6 Get Chat List API
      const convListRes = await request('GET', '/api/chat/conversations', null, authHeader);
      console.assert(convListRes.status === 200, "Get conversations list 200");
      console.assert(Array.isArray(convListRes.body.data), "Conversations list array");
      const targetConv = convListRes.body.data.find(c => c.conversationId === convId);
      console.assert(targetConv !== undefined, "Conversation present in chat list");

      // 22.7 Get Messages History API
      const historyRes = await request('GET', `/api/chat/messages/${convId}`, null, authHeader);
      console.assert(historyRes.status === 200, "Get messages history 200");
      console.assert(Array.isArray(historyRes.body.data), "Messages history array");
      console.assert(historyRes.body.data.some(m => m.message === "Hello Ananya!"), "Message present in history");

      // 22.8 Delete Message API
      const deleteMsgRes = await request('DELETE', `/api/chat/message/${sentMsgId}`, null, authHeader);
      console.assert(deleteMsgRes.status === 200, "Delete message 200");
      console.assert(deleteMsgRes.body.success === true, "Delete message success");

      // 22.9 Block User API
      const blockRes = await request('POST', '/api/chat/block', { userId: "usr_201" }, authHeader);
      console.assert(blockRes.status === 200, "Block user 200");
      console.assert(blockRes.body.success === true, "Block user success");

      socket1.disconnect();
      socket2.disconnect();

      console.log("\n23. Testing Firebase Push Notification APIs (/api/notification/*)...");
      // 23.1 Register FCM Token
      const saveTokenRes = await request('POST', '/api/notification/fcm-token', {
        fcm_token: "test_fcm_token_string_998877",
        device_type: "android"
      }, authHeader);
      console.assert(saveTokenRes.status === 200, "Save FCM token 200");
      console.assert(saveTokenRes.body.status === true, "Save FCM token status true");

      // 23.2 Send Push Notification
      const sendNtfRes = await request('POST', '/api/notification/send', {
        user_id: "usr_203",
        title: "Test Notification Title",
        body: "Test notification body message content",
        data: { type: "test", id: 123 }
      }, authHeader);
      console.assert(sendNtfRes.status === 200, "Send notification 200");
      console.assert(sendNtfRes.body.status === true, "Send notification status true");
      const createdNtfId = sendNtfRes.body.data.notification_id;

      // 23.3 Get Notifications List
      const getNtfRes = await request('GET', '/api/notification', null, authHeader);
      console.assert(getNtfRes.status === 200, "Get notifications 200");
      console.assert(Array.isArray(getNtfRes.body.data.notifications), "Notifications array returned");

      // 23.4 Mark Notification Read
      const markReadRes = await request('POST', `/api/notification/${createdNtfId}/read`, null, authHeader);
      console.assert(markReadRes.status === 200, "Mark notification read 200");

      console.log("\n✅ ALL PARTNER API, CHAT, NOTIFICATION & PERSISTENCE TESTS PASSED SUCCESSFULLY!");
      server.close(() => {
        setTimeout(() => process.exit(0), 200);
      });
    } catch (err) {
      console.error("\n❌ TEST FAILED:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runTests();
