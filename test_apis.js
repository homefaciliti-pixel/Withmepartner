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

async function runTests() {
  console.log("Starting Partner API Verification Suite...");
  server = app.listen(PORT, async () => {
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
      console.assert(getBankRes.body.data.support_note.includes("me24with@gmail.com"), "Contains support email note");

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
      console.assert(saveBankRes.body.data.support_note.includes("me24with@gmail.com"), "Support note returned");

      console.log("\n13. Testing Bank Account Single Addition Restriction (Second Save Attempt)...");
      const secondSaveBankRes = await request('POST', '/partner/withdraw/bank-account', {
        account_holder_name: "Rahul Sharma",
        bank_name: "HDFC Bank",
        account_number: "99999999999",
        ifsc_code: "HDFC0001234"
      }, newAuthHeader);
      console.assert(secondSaveBankRes.status === 400, "Second save blocked with 400");
      console.assert(secondSaveBankRes.body.error_code === "BANK_ACCOUNT_LOCKED", "BANK_ACCOUNT_LOCKED code");
      console.assert(secondSaveBankRes.body.data.support_note.includes("me24with@gmail.com"), "Support note present in locked response");

      console.log("\n14. Testing Submit Withdrawal Request API (/partner/withdraw)...");
      const withdrawRes = await request('POST', '/partner/withdraw', { amount: 1000 }, newAuthHeader);
      console.assert(withdrawRes.status === 200, "Withdrawal 200");
      console.assert(withdrawRes.body.data.bank_account.bank_name === "State Bank of India", "Bank account included in withdrawal");

      console.log("\n15. Testing Delete Account API (DELETE /profile)...");
      const deleteRes = await request('DELETE', '/profile', { reason: "Testing account deletion" }, newAuthHeader);
      console.assert(deleteRes.status === 200, "Delete account 200");
      console.assert(deleteRes.body.data.user_id === newUserId, "Correct user deleted");

      console.log("\n✅ ALL PARTNER API & PERSISTENCE TESTS PASSED SUCCESSFULLY!");
      server.close();
      process.exit(0);
    } catch (err) {
      console.error("\n❌ TEST FAILED:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runTests();
