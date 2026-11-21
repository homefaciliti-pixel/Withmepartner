const jwt = require('jsonwebtoken');
const { getDbPool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'withme24_secret_key_2026';

function generateToken(partner) {
  return jwt.sign(
    {
      id: partner.id || 1,
      user_id: partner.user_id || partner.partner_id,
      partner_id: partner.partner_id || partner.user_id,
      mobile_number: partner.mobile_number,
      role: 'partner'
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 TESTING GENUINE PAID BOOKING FILTER & STRICT PARTNER ISOLATION');
  console.log('================================================================\n');

  const BASE_URL = 'http://localhost:5000';
  const partnerX = { user_id: 'usr_203', partner_id: 'usr_203', mobile_number: '9876543210', name: 'Priya Sharma' };
  const partnerY = { user_id: 'usr_102', partner_id: 'usr_102', mobile_number: '9876543211', name: 'Anjali Sharma' };

  const tokenX = generateToken(partnerX);
  const tokenY = generateToken(partnerY);

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Partner X Home Overview & Paid Bookings
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Testing Partner X (/partner/home) ---');
    const homeResX = await fetch(`${BASE_URL}/partner/home`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    const homeDataX = await homeResX.json();

    assert(homeResX.status === 200, 'Partner X GET /partner/home returns 200');
    assert(homeDataX.status === true, 'Partner X GET /partner/home status is true');
    
    // Verify all bookings in Partner X's home have is_paid = true
    const upBookingsX = homeDataX.data.upcoming_bookings || [];
    const newReqsX = homeDataX.data.new_requests || [];
    const allXItems = [...upBookingsX, ...newReqsX];
    
    const allXPaid = allXItems.every(b => b.is_paid === true && b.payment_status === 'PAID');
    assert(allXPaid, 'All items returned in Partner X home are strictly PAID (is_paid=true, payment_status=PAID)');

    // Verify all items belong to Partner X
    const allBelongToX = allXItems.every(b => String(b.partner_id) === 'usr_203');
    assert(allBelongToX, "All items returned in Partner X home strictly belong to Partner X ('usr_203')");

    // -------------------------------------------------------------------------
    // TEST 2: Strict Isolation — Partner Y Home MUST NOT Contain Partner X Bookings
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Strict Isolation: Partner Y (/partner/home) ---');
    const homeResY = await fetch(`${BASE_URL}/partner/home`, {
      headers: { Authorization: `Bearer ${tokenY}` }
    });
    const homeDataY = await homeResY.json();

    assert(homeResY.status === 200, 'Partner Y GET /partner/home returns 200');
    const upBookingsY = homeDataY.data.upcoming_bookings || [];
    const newReqsY = homeDataY.data.new_requests || [];
    const allYItems = [...upBookingsY, ...newReqsY];

    // None of Partner X's bookings (e.g. BK267890, BK629472) appear in Partner Y's account
    const hasPartnerXBooking = allYItems.some(b => ['BK267890', 'BK629472', 'BK576262', 'BK164899', 'BK927619'].includes(b.booking_id));
    assert(!hasPartnerXBooking, "Partner X's paid bookings are NEVER visible in Partner Y's home screen");

    // -------------------------------------------------------------------------
    // TEST 3: Cross-Tenant Access Block — Partner Y accessing Partner X Booking
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Cross-Tenant Access Block on Booking Details ---');
    // Partner X's genuine paid booking is BK267890
    const crossBkRes = await fetch(`${BASE_URL}/partner/bookings/BK267890`, {
      headers: { Authorization: `Bearer ${tokenY}` }
    });
    const crossBkData = await crossBkRes.json();
    assert(crossBkRes.status === 403, `Partner Y GET /partner/bookings/BK267890 blocked with 403 Forbidden (Got: ${crossBkRes.status})`);
    assert(crossBkData.error_code === 'FORBIDDEN_ACCESS', "Error code is FORBIDDEN_ACCESS");

    // Partner X can access their own booking
    const ownBkRes = await fetch(`${BASE_URL}/partner/bookings/BK267890`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    const ownBkData = await ownBkRes.json();
    assert(ownBkRes.status === 200, 'Partner X GET /partner/bookings/BK267890 returns 200 OK');
    assert(ownBkData.data && ownBkData.data.is_paid === true, 'Booking details confirm is_paid=true');
    assert(ownBkData.data && ownBkData.data.payment_id === 'pay_TtcXvIievTfSiu', 'Booking details contain verified Razorpay payment_id');

    // -------------------------------------------------------------------------
    // TEST 4: Cross-Tenant Access Block on Request Details
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Cross-Tenant Access Block on Request Details ---');
    const crossReqRes = await fetch(`${BASE_URL}/partner/requests/req_b_BK267890`, {
      headers: { Authorization: `Bearer ${tokenY}` }
    });
    const crossReqData = await crossReqRes.json();
    assert(crossReqRes.status === 403, `Partner Y GET /partner/requests/req_b_BK267890 blocked with 403 Forbidden (Got: ${crossReqRes.status})`);
    assert(crossReqData.error_code === 'FORBIDDEN_ACCESS', 'Error code is FORBIDDEN_ACCESS');

    // -------------------------------------------------------------------------
    // TEST 5: Cross-Tenant Action Block (Accept / Reject)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Cross-Tenant Action Block (Accept / Reject) ---');
    const crossActRes = await fetch(`${BASE_URL}/partner/requests/req_b_BK267890/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenY}`
      },
      body: JSON.stringify({ action: 'ACCEPT' })
    });
    const crossActData = await crossActRes.json();
    assert(crossActRes.status === 403, `Partner Y attempting to accept Partner X request blocked with 403 (Got: ${crossActRes.status})`);
    assert(crossActData.error_code === 'FORBIDDEN_ACCESS', 'Error code is FORBIDDEN_ACCESS');

    // -------------------------------------------------------------------------
    // TEST 6: Cross-Tenant Cancellation Block
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Cross-Tenant Cancellation Block ---');
    const crossCancelRes = await fetch(`${BASE_URL}/partner/bookings/BK267890/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenY}`
      },
      body: JSON.stringify({ reason: 'Malicious cancel test' })
    });
    const crossCancelData = await crossCancelRes.json();
    assert(crossCancelRes.status === 403, `Partner Y attempting to cancel Partner X booking blocked with 403 (Got: ${crossCancelRes.status})`);
    assert(crossCancelData.error_code === 'FORBIDDEN_ACCESS', 'Error code is FORBIDDEN_ACCESS');

    // -------------------------------------------------------------------------
    // TEST 7: Fake / Dummy Booking ID Fallback Removal (bk_001 / '1')
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Removal of Hardcoded Dummy Fallback (bk_001) ---');
    const dummyBkRes = await fetch(`${BASE_URL}/partner/bookings/bk_001`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    assert(dummyBkRes.status === 404, `Dummy booking bk_001 returns 404 Not Found (Got: ${dummyBkRes.status})`);

    const dummyBk1Res = await fetch(`${BASE_URL}/partner/bookings/1`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    assert(dummyBk1Res.status === 404 || dummyBk1Res.status === 403, `Dummy booking 1 returns 404 or 403 (Got: ${dummyBk1Res.status})`);

    // -------------------------------------------------------------------------
    // TEST 8: Unpaid Request Block — Unpaid Booking Detail Query
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Unpaid / Failed Booking Block ---');
    // BK969828 has status PAYMENT_FAILED in DB
    const failedBkRes = await fetch(`${BASE_URL}/partner/bookings/BK969828`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    assert(failedBkRes.status === 404, `Failed/unpaid booking BK969828 returns 404 (Got: ${failedBkRes.status})`);

    // -------------------------------------------------------------------------
    // TEST 9: Payment Verification — Reject Fake / Unverified Payment Success
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Payment Gateway Verification Security ---');
    const fakePayRes = await fetch(`${BASE_URL}/partner/payment-success`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: 'BK999999_TEST',
        request_id: 'req_test_fake',
        payment_id: 'pay_NON_EXISTENT_GATEWAY_ID_999'
      })
    });
    const fakePayData = await fakePayRes.json();
    assert(fakePayRes.status === 400, `Fake payment ID rejected with 400 Bad Request (Got: ${fakePayRes.status})`);
    assert(fakePayData.error_code === 'PAYMENT_VERIFICATION_FAILED', 'Error code is PAYMENT_VERIFICATION_FAILED');

    // -------------------------------------------------------------------------
    // TEST 10: Payment Success Missing Identifiers
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Payment Success Missing Identifiers ---');
    const emptyPayRes = await fetch(`${BASE_URL}/partner/payment-success`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert(emptyPayRes.status === 400, `Empty payment webhook payload rejected with 400 (Got: ${emptyPayRes.status})`);

    // -------------------------------------------------------------------------
    // TEST 11: Partner Bookings List Filter
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing /partner/bookings/list Filter ---');
    const bkListResX = await fetch(`${BASE_URL}/partner/bookings/list`, {
      headers: { Authorization: `Bearer ${tokenX}` }
    });
    const bkListDataX = await bkListResX.json();
    assert(bkListResX.status === 200, 'Partner X GET /partner/bookings/list returns 200');
    const bkListX = bkListDataX.bookings || [];
    assert(bkListX.length > 0, `Partner X has genuine paid bookings (Found: ${bkListX.length})`);
    assert(bkListX.every(b => b.is_paid === true && b.payment_status === 'PAID'), 'All bookings in list are strictly PAID');
    assert(bkListX.every(b => String(b.partner_id) === 'usr_203'), "All bookings strictly belong to Partner X ('usr_203')");

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (failed === 0) {
      console.log('🎉 ALL GENUINE PAID BOOKING FILTER & ISOLATION TESTS PASSED!');
      process.exit(0);
    } else {
      console.error(`❌ ${failed} TESTS FAILED.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
