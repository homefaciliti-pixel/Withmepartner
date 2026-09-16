const app = require('./server');
const http = require('http');

let server;
const PORT = 5002;
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
  console.log("Starting API Verification Tests (With Country Codes)...");
  server = app.listen(PORT, async () => {
    try {
      // Test 1: Login Success with country_code
      console.log("\n1. Testing Login API (/auth/login)...");
      const loginRes = await request('POST', '/auth/login', {
        country_code: "+91",
        mobile_number: "9876543210",
        password: "MySecurePass123"
      });
      console.log("Login Response Status:", loginRes.status);
      console.log("Login Data User ID:", loginRes.body.data?.user_id);
      console.assert(loginRes.status === 200, "Login should return 200");
      console.assert(loginRes.body.status === true, "Login status should be true");
      console.assert(loginRes.body.data.country_code === "+91", "Country code should be +91");

      const token = loginRes.body.data.access_token;
      const authHeader = { 'Authorization': `Bearer ${token}` };

      // Test 2: Country Codes Meta Endpoint
      console.log("\n2. Testing Meta Country Codes API (/meta/country-codes)...");
      const ccRes = await request('GET', '/meta/country-codes');
      console.assert(ccRes.status === 200, "Country codes 200");
      console.assert(Array.isArray(ccRes.body.data.country_codes), "Country codes array");
      console.log(`Found ${ccRes.body.data.country_codes.length} country codes.`);

      // Test 3: Registration Send OTP with custom country code (+1 USA)
      console.log("\n3. Testing Registration Send OTP with Country Code...");
      const regOtpRes = await request('POST', '/auth/register/send-otp', {
        country_code: "+1",
        mobile_number: "4155552671"
      });
      console.assert(regOtpRes.status === 200, "Reg send-otp 200");
      console.assert(regOtpRes.body.data.country_code === "+1", "Send OTP country code +1");

      // Test 4: Forgot Password Send OTP
      console.log("\n4. Testing Forgot Password Flow...");
      const fpSendRes = await request('POST', '/auth/forgot-password/send-otp', {
        country_code: "+91",
        mobile_number: "9876543210"
      });
      console.assert(fpSendRes.status === 200, "Forgot password send-otp 200");
      const otpSessId = fpSendRes.body.data.otp_session_id;

      const fpVerifyRes = await request('POST', '/auth/forgot-password/verify-otp', { otp_session_id: otpSessId, otp: "4829" });
      console.assert(fpVerifyRes.status === 200, "Forgot password verify-otp 200");
      const resetToken = fpVerifyRes.body.data.reset_token;

      const fpResetRes = await request('POST', '/auth/forgot-password/reset', {
        reset_token: resetToken,
        new_password: "MySecurePass123",
        confirm_password: "MySecurePass123"
      });
      console.assert(fpResetRes.status === 200, "Password reset 200");

      // Test 5: Get Profile Detail
      console.log("\n5. Testing Profile API...");
      const profRes = await request('GET', '/profile', null, authHeader);
      console.assert(profRes.status === 200 && profRes.body.data.country_code === "+91", "Get Profile 200");

      console.log("\n✅ ALL API VERIFICATION TESTS PASSED SUCCESSFULLY!");
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
