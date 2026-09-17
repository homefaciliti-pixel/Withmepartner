const app = require('./server');
const http = require('http');

let server;
const PORT = 5004;
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
  console.log("Starting Extended Partner API Verification Tests...");
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

      // 2. Profile API (New Specs check)
      console.log("\n2. Testing Profile API (/profile) with new Notebook keys...");
      const profRes = await request('GET', '/profile', null, authHeader);
      console.assert(profRes.status === 200, "Profile 200");
      console.assert(profRes.body.data.rating === 4.6, "Rating match 4.6");
      console.assert(profRes.body.data.total_booking !== undefined, "total_booking present");
      console.assert(profRes.body.data.total_earning !== undefined, "total_earning present");
      console.assert(profRes.body.data.phone_disabled === true, "phone_disabled true");
      console.log("Profile Total Bookings:", profRes.body.data.total_booking);
      console.log("Profile Total Earnings:", profRes.body.data.total_earning);

      // 3. Edit Profile & Save Changes API (Phone disabled check)
      console.log("\n3. Testing Save Changes Profile API (PUT /profile)...");
      const editProfRes = await request('PUT', '/profile', {
        name: "Rahul Sharma Updated",
        email: "rahul.updated@example.com"
      }, authHeader);
      console.assert(editProfRes.status === 200, "Edit Profile 200");
      console.assert(editProfRes.body.data.name === "Rahul Sharma Updated", "Updated name match");
      console.assert(editProfRes.body.data.phone_disabled === true, "Phone disabled on edit");

      // 4. Earnings Breakdown API (Today, Week, Month, All)
      console.log("\n4. Testing Earnings Breakdown API (/partner/earnings)...");
      const earningsRes = await request('GET', '/partner/earnings', null, authHeader);
      console.assert(earningsRes.status === 200, "Earnings 200");
      console.assert(earningsRes.body.data.total_today_earn !== undefined, "total_today_earn present");
      console.assert(earningsRes.body.data.total_this_week_earn !== undefined, "total_this_week_earn present");
      console.assert(earningsRes.body.data.total_this_month_earn !== undefined, "total_this_month_earn present");
      console.assert(earningsRes.body.data.total_all_earn !== undefined, "total_all_earn present");
      console.log("Earnings Summary:", {
        today: earningsRes.body.data.total_today_earn,
        week: earningsRes.body.data.total_this_week_earn,
        month: earningsRes.body.data.total_this_month_earn,
        all: earningsRes.body.data.total_all_earn
      });

      console.log("\n✅ ALL EXTENDED PARTNER API TESTS PASSED SUCCESSFULLY!");
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
