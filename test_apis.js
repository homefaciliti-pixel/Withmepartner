const app = require('./server');
const http = require('http');

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
  console.log("Starting Safe Meet Verification Tests...");
  server = app.listen(PORT, async () => {
    try {
      // 1. Login
      console.log("\n1. Testing Login API (/auth/login)...");
      const loginRes = await request('POST', '/auth/login', {
        country_code: "+91",
        mobile_number: "9876543210",
        password: "MySecurePass123"
      });
      console.assert(loginRes.status === 200, "Login 200");
      const token = loginRes.body.data.access_token;
      const authHeader = { 'Authorization': `Bearer ${token}` };

      // 2. Booking Detail Check
      console.log("\n2. Testing Booking Detail API (/partner/bookings/bk_001)...");
      const bkRes = await request('GET', '/partner/bookings/bk_001', null, authHeader);
      console.assert(bkRes.status === 200, "Booking detail 200");
      console.assert(bkRes.body.data.meeting_info !== undefined, "meeting_info present");

      // 3. Start Safe Meet Save API
      console.log("\n3. Testing Start Safe Meet Save API (/partner/bookings/bk_001/start-safe-meet)...");
      const startRes = await request('POST', '/partner/bookings/bk_001/start-safe-meet', {
        start_safe_meet: true
      }, authHeader);
      console.assert(startRes.status === 200, "Start safe meet 200");
      console.assert(startRes.body.data.start_safe_meet === true, "start_safe_meet is true");

      // 4. Safe Meet Mode Settings Save API
      console.log("\n4. Testing Safe Meet Mode Save API (/partner/bookings/bk_001/safe-meet)...");
      const safeMeetRes = await request('POST', '/partner/bookings/bk_001/safe-meet', {
        location_allow: 1,
        notify_trusted_contact: 1,
        safety_check_in: 1
      }, authHeader);
      console.assert(safeMeetRes.status === 200, "Safe meet mode 200");
      console.assert(safeMeetRes.body.data.safe_meet_mode.location_allow === 1, "location_allow 1");

      console.log("\n✅ ALL SAFE MEET TESTS PASSED SUCCESSFULLY!");
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
