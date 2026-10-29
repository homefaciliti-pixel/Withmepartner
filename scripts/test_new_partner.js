const axios = require('axios');
const { getDbPool } = require('../config/database');

const API_BASE = 'http://localhost:5000';

async function testNewPartnerDashboard() {
  console.log('--- TEST 1: Logging in with new partner 1234567891 ---');
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    mobile_number: '1234567891',
    password: 'MySecurePass123'
  });

  console.log('Login success:', loginRes.data.status, 'User:', loginRes.data.partner?.name, 'ID:', loginRes.data.partner?.user_id);
  const token = loginRes.data.token || loginRes.data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  console.log('\n--- TEST 2: GET /partner/home for new partner ---');
  const homeRes = await axios.get(`${API_BASE}/partner/home`, { headers });
  console.log('Home status:', homeRes.data.status);
  console.log('New requests count:', homeRes.data.data.todays_overview.new_requests_count);
  console.log('Upcoming bookings count:', homeRes.data.data.todays_overview.upcoming_bookings_count);
  console.log('New requests array:', homeRes.data.data.new_requests);
  console.log('Upcoming bookings array:', homeRes.data.data.upcoming_bookings);

  if (homeRes.data.data.new_requests.length !== 0 || homeRes.data.data.upcoming_bookings.length !== 0) {
    throw new Error('FAILED: New partner dashboard must be clean with 0 requests and 0 bookings!');
  }
  console.log('PASSED: Dashboard is completely clean with 0 requests and 0 bookings.');

  console.log('\n--- TEST 3: GET /partner/requests for new partner ---');
  const requestsRes = await axios.get(`${API_BASE}/partner/requests`, { headers });
  console.log('Requests response:', requestsRes.data);
  if (requestsRes.data.count !== 0 || requestsRes.data.requests.length !== 0) {
    throw new Error('FAILED: /partner/requests must return 0 requests!');
  }
  console.log('PASSED: /partner/requests returns 0 requests.');

  console.log('\n--- TEST 4: Sending an incoming booking and verifying initial status ---');
  const partnerId = loginRes.data.partner.user_id;
  const testBookingId = `BK_TEST_${Date.now()}`;
  const incomingRes = await axios.post(`${API_BASE}/partner/incoming-booking`, {
    booking_id: testBookingId,
    partner_id: partnerId,
    user_id: 'usr_client_test',
    name: 'Test Customer',
    interest: 'Coffee',
    location: 'Jaipur',
    amount: 100
  });

  console.log('Incoming booking response status:', incomingRes.data.status);
  console.log('Incoming booking saved status:', incomingRes.data.data.status);
  console.log('Incoming booking is_accepted:', incomingRes.data.data.is_accepted);
  console.log('Incoming booking is_paid:', incomingRes.data.data.is_paid);
  console.log('Incoming booking payment_status:', incomingRes.data.data.payment_status);

  if (incomingRes.data.data.status !== 'PENDING' || incomingRes.data.data.is_accepted !== 0 || incomingRes.data.data.is_paid !== 0 || incomingRes.data.data.payment_status !== 'PENDING') {
    throw new Error('FAILED: Incoming booking must have status: PENDING, is_accepted: 0, is_paid: 0, payment_status: PENDING');
  }
  console.log('PASSED: Incoming booking correctly defaults to PENDING, is_accepted: 0, is_paid: 0, payment_status: PENDING');

  console.log('\n--- TEST 5: Verify partner home shows 1 pending request with UNPAID / PENDING status ---');
  const homeRes2 = await axios.get(`${API_BASE}/partner/home`, { headers });
  const pendingReq = homeRes2.data.data.new_requests[0];
  console.log('Partner Home new request:', {
    request_id: pendingReq.request_id,
    status: pendingReq.status,
    is_accepted: pendingReq.is_accepted,
    is_paid: pendingReq.is_paid,
    payment_status: pendingReq.payment_status,
    can_chat: pendingReq.can_chat,
    chat_status: pendingReq.chat_status,
    badge: pendingReq.badge
  });

  if (pendingReq.is_paid !== false || pendingReq.can_chat !== false || pendingReq.chat_status !== 'LOCKED') {
    throw new Error('FAILED: Request must have is_paid: false, can_chat: false, chat_status: LOCKED');
  }
  console.log('PASSED: Partner request has payment pending, chat locked!');

  // Cleanup test booking
  const db = getDbPool();
  await db.query('DELETE FROM withme_partner_requests WHERE booking_id = ?', [testBookingId]);
  await db.query('DELETE FROM withme_partner_bookings WHERE booking_id = ?', [testBookingId]);
  console.log('\nCleaned up test booking. Partner 1234567891 is completely fresh and clean again!');
  process.exit(0);
}

testNewPartnerDashboard().catch(err => {
  console.error('Test FAILED:', err.response?.data || err.message);
  process.exit(1);
});
