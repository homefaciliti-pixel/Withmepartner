const app = require('./server');
const http = require('http');

let server;
const PORT = 5005;
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
  console.log("Starting Full Verification Tests (Including Surrender Deed Document APIs)...");
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

      // 2. Profile API
      console.log("\n2. Testing Profile API (/profile)...");
      const profRes = await request('GET', '/profile', null, authHeader);
      console.assert(profRes.status === 200, "Profile 200");
      console.assert(profRes.body.data.phone_disabled === true, "phone_disabled true");

      // 3. Edit Profile (Save Changes)
      console.log("\n3. Testing Save Changes Profile API (PUT /profile)...");
      const editProfRes = await request('PUT', '/profile', {
        name: "Rahul Sharma Updated",
        email: "rahul.updated@example.com"
      }, authHeader);
      console.assert(editProfRes.status === 200, "Edit Profile 200");

      // 4. Earnings Breakdown API
      console.log("\n4. Testing Earnings Breakdown API (/partner/earnings)...");
      const earningsRes = await request('GET', '/partner/earnings', null, authHeader);
      console.assert(earningsRes.status === 200, "Earnings 200");

      // 5. Surrender Deed Template API
      console.log("\n5. Testing Surrender Deed Template API (/documents/surrender-deed/template)...");
      const docTmplRes = await request('GET', '/documents/surrender-deed/template');
      console.assert(docTmplRes.status === 200, "Surrender deed template 200");
      console.assert(docTmplRes.body.data.fields.length > 0, "Template fields present");

      // 6. Submit Surrender Deed API
      console.log("\n6. Testing Submit Surrender Deed API (/documents/surrender-deed)...");
      const submitDocRes = await request('POST', '/documents/surrender-deed', {
        date: "2026-09-21",
        surrenderor_name: "Rahul Sharma",
        father_name: "Ramesh Sharma",
        resident_address: "Vaishali Nagar, Jaipur",
        scheme_name: "Green City Scheme",
        plot_size_sqyard: 200,
        plot_number: "A-104",
        witness_1: "Suresh Kumar",
        witness_2: "Vikram Singh"
      }, authHeader);
      console.assert(submitDocRes.status === 201, "Submit deed 201");
      console.assert(submitDocRes.body.data.status === "SUBMITTED", "Doc status SUBMITTED");

      console.log("\n✅ ALL TESTS PASSED SUCCESSFULLY!");
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
