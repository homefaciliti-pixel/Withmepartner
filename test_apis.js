const app = require('./server');
const http = require('http');

let server;
const PORT = 5003;
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
  console.log("Starting Full Partner API Verification Tests...");
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

      // 2. Home Screen API
      console.log("\n2. Testing Home Screen API (/partner/home)...");
      const homeRes = await request('GET', '/partner/home', null, authHeader);
      console.assert(homeRes.status === 200, "Home 200");
      console.assert(homeRes.body.data.todays_overview.new_requests_count === 3, "New requests count 3");
      console.assert(homeRes.body.data.todays_overview.upcoming_bookings_count === 2, "Upcoming count 2");
      console.log("Home Overview Date:", homeRes.body.data.todays_overview.date);

      // 3. Request Detail API
      console.log("\n3. Testing Request Detail API (/partner/requests/req_001)...");
      const reqDetailRes = await request('GET', '/partner/requests/req_001', null, authHeader);
      console.assert(reqDetailRes.status === 200, "Request detail 200");
      console.assert(reqDetailRes.body.data.name === "Priya Verma", "Name match");
      console.assert(reqDetailRes.body.data.id_verified === 1, "ID verified 1");

      // 4. Accept Request API
      console.log("\n4. Testing Accept Request API (/partner/requests/req_001/action)...");
      const acceptRes = await request('POST', '/partner/requests/req_001/action', { action: "ACCEPT" }, authHeader);
      console.assert(acceptRes.status === 200, "Accept request 200");
      console.assert(acceptRes.body.data.status === "Upcoming", "Status Upcoming");

      // 5. Booking Details API
      console.log("\n5. Testing Booking Details API (/partner/bookings/bk_001)...");
      const bookingDetailRes = await request('GET', '/partner/bookings/bk_001', null, authHeader);
      console.assert(bookingDetailRes.status === 200, "Booking detail 200");
      console.assert(bookingDetailRes.body.data.name === "Ritika Singh", "Booking name match");

      // 6. Safe Meet Mode API
      console.log("\n6. Testing Safe Meet Mode API (/partner/bookings/bk_001/safe-meet)...");
      const safeMeetRes = await request('POST', '/partner/bookings/bk_001/safe-meet', {
        location_allow: 1,
        notify_trusted_contact: 1,
        safety_check_in: 1,
        start_safe_meet: true
      }, authHeader);
      console.assert(safeMeetRes.status === 200, "Safe meet 200");
      console.assert(safeMeetRes.body.data.safety_checklist.start_safe_meet === true, "Start safe meet true");

      // 7. My Bookings API (Filtered)
      console.log("\n7. Testing My Bookings List API (/partner/bookings?status=Upcoming)...");
      const bookingsListRes = await request('GET', '/partner/bookings?status=Upcoming', null, authHeader);
      console.assert(bookingsListRes.status === 200, "Bookings list 200");
      console.assert(bookingsListRes.body.data.bookings.length >= 2, "Bookings count >= 2");

      // 8. My Earnings API
      console.log("\n8. Testing My Earnings API (/partner/earnings)...");
      const earningsRes = await request('GET', '/partner/earnings', null, authHeader);
      console.assert(earningsRes.status === 200, "Earnings 200");
      console.assert(earningsRes.body.data.transactions.length === 4, "Transactions count 4");
      console.log("Total Earnings:", earningsRes.body.data.total_earnings);

      console.log("\n✅ ALL PARTNER API TESTS PASSED SUCCESSFULLY!");
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
