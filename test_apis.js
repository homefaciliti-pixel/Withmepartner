const app = require('./server');
const http = require('http');

let server;
const PORT = 5001;
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
  console.log("Starting API Verification Tests...");
  server = app.listen(PORT, async () => {
    try {
      // Test 1: Login Success
      console.log("\n1. Testing Login API (/auth/login)...");
      const loginRes = await request('POST', '/auth/login', {
        mobile_number: "9876543210",
        password: "MySecurePass123"
      });
      console.log("Login Response Status:", loginRes.status);
      console.log("Login Data User ID:", loginRes.body.data?.user_id);
      console.assert(loginRes.status === 200, "Login should return 200");
      console.assert(loginRes.body.status === true, "Login status should be true");

      const token = loginRes.body.data.access_token;
      const authHeader = { 'Authorization': `Bearer ${token}` };

      // Test 2: Forgot Password Flow
      console.log("\n2. Testing Forgot Password Flow...");
      const fpSendRes = await request('POST', '/auth/forgot-password/send-otp', { mobile_number: "9876543210" });
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

      // Test 3: Meta Endpoints
      console.log("\n3. Testing Meta Endpoints...");
      const interestsRes = await request('GET', '/meta/interests');
      console.assert(interestsRes.status === 200 && interestsRes.body.data.interests.length > 0, "Interests 200");

      const timeSlotsRes = await request('GET', '/meta/time-slots');
      console.assert(timeSlotsRes.status === 200 && timeSlotsRes.body.data.time_slots.length > 0, "Time slots 200");

      // Test 4: About You API
      console.log("\n4. Testing About You API...");
      const aboutRes = await request('POST', '/profile/about', {
        description: "I love meeting new people and exploring the city over a good cup of coffee...",
        interests: ["Coffee", "Travel", "Music", "Photography"]
      }, authHeader);
      console.assert(aboutRes.status === 200, "About You 200");

      // Test 5: Availability & Pricing API
      console.log("\n5. Testing Availability & Pricing API...");
      const availRes = await request('POST', '/partner/availability', {
        available_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        available_time: { from: "10:00 AM", to: "09:00 PM" },
        receive_requests: true,
        pricing: [
          { interest: "Coffee", label: "Coffee / Cafe Meetups", price: 999, unit: "per session/2hrs" },
          { interest: "Travel", label: "Travel / Day Out / Trips", price: 2999, unit: "per session/24hrs" }
        ]
      }, authHeader);
      console.assert(availRes.status === 200, "Availability 200");

      const getAvailRes = await request('GET', '/partner/availability', null, authHeader);
      console.assert(getAvailRes.status === 200, "Get Availability 200");

      const patchAvailRes = await request('PATCH', '/partner/availability/receive-requests', { receive_requests: false }, authHeader);
      console.assert(patchAvailRes.status === 200 && patchAvailRes.body.data.receive_requests === false, "Patch Availability 200");

      // Test 6: Get Profile & Location
      console.log("\n6. Testing Profile & Location APIs...");
      const profRes = await request('GET', '/profile', null, authHeader);
      console.assert(profRes.status === 200 && profRes.body.data.user_id === "usr_10234", "Get Profile 200");

      const locRes = await request('PATCH', '/profile/location', { latitude: 26.9124, longitude: 75.7873 }, authHeader);
      console.assert(locRes.status === 200, "Update location 200");

      // Test 7: Aadhar Status & Photos Status
      console.log("\n7. Testing Status Endpoints...");
      const aadharStatusRes = await request('GET', '/profile/aadhar/status', null, authHeader);
      console.assert(aadharStatusRes.status === 200, "Aadhar status 200");

      const getPhotosRes = await request('GET', '/profile/photos', null, authHeader);
      console.assert(getPhotosRes.status === 200, "Get photos 200");

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
