const assert = require('assert');
const jwt = require('jsonwebtoken');
const {
  submitAadhaarExtraction,
  getTaskStatus,
  evaluateExtractionResult
} = require('../services/idfyService');
const { findPartnerByIdFromMysql, updatePartnerInMysql, getDbPool } = require('../config/database');

const BASE_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'withme_jwt_secret_key_prod_2026_super_secure';

async function runIdfyTests() {
  console.log('================================================================');
  console.log('🧪 TESTING IDFY AADHAAR VERIFICATION INTEGRATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition, msg) {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}: ${msg || 'Assertion failed'}`);
      failed++;
    }
  }

  // --- 1. Service Layer Tests ---
  console.log('--- 1. Testing IDfy Service Task Creation ---');
  const taskRes = await submitAadhaarExtraction({
    frontDocument: 'https://placehold.co/600x400.png',
    backDocument: 'https://placehold.co/600x400.png'
  });
  report('IDfy Task Creation HTTP 202', taskRes.success === true, JSON.stringify(taskRes));
  report('IDfy Request ID Generated', Boolean(taskRes.request_id), `request_id: ${taskRes.request_id}`);

  // --- 2. Polling IDfy Task Status ---
  console.log('\n--- 2. Testing IDfy Task Polling ---');
  if (taskRes.request_id) {
    const pollRes = await getTaskStatus(taskRes.request_id);
    report('IDfy Status Polling HTTP 200', pollRes.success === true, JSON.stringify(pollRes));
    report('IDfy Task State Known', ['in_progress', 'completed', 'failed'].includes(pollRes.status), `status: ${pollRes.status}`);
  }

  // --- 3. Result Evaluation Logic ---
  console.log('\n--- 3. Testing Evaluation Logic ---');
  const mockCompletedTask = {
    status: 'completed',
    result: {
      extraction_output: {
        id_number: 'XXXX XXXX 0014',
        name_on_card: 'Priya Sharma',
        date_of_birth: '1995-05-15',
        gender: 'Female',
        address: 'Delhi, India'
      }
    }
  };
  const evalApproved = evaluateExtractionResult(mockCompletedTask, '999999990014');
  report('Approved on Matching Last 4 Digits', evalApproved.isVerified === true && evalApproved.status === 'APPROVED');

  const evalMismatch = evaluateExtractionResult(mockCompletedTask, '999999999999');
  report('Rejected on Mismatched Digits', evalMismatch.isVerified === false && evalMismatch.status === 'REJECTED');

  const mockFailedTask = { status: 'failed', error: 'INVALID_IMAGE', message: 'Image is non compliant' };
  const evalFailed = evaluateExtractionResult(mockFailedTask, '999999990014');
  report('Rejected on IDfy Extraction Failure', evalFailed.status === 'REJECTED');

  // --- 4. API Endpoint Integration ---
  console.log('\n--- 4. Testing /profile/aadhar and /profile/aadhar/status ---');
  const testUserId = 'usr_idfy_test_' + Date.now();
  const testMobile = '99' + String(Date.now()).slice(-8);
  const token = jwt.sign({ user_id: testUserId, role: 'partner', mobile_number: testMobile }, JWT_SECRET, { expiresIn: '1h' });

  // Clean / setup test user
  const db = getDbPool();
  await db.query(`
    INSERT INTO withme_partners (user_id, partner_id, name, mobile_number, status, created_at, updated_at)
    VALUES (?, ?, 'IDfy Tester', ?, 'ACTIVE', NOW(), NOW())
  `, [testUserId, testUserId, testMobile]);

  // Submit valid Aadhaar via API with images
  const submitRes = await fetch(`${BASE_URL}/profile/aadhar`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      aadhar_number: '999999990014',
      aadhar_front: 'https://placehold.co/600x400.png',
      aadhar_back: 'https://placehold.co/600x400.png'
    })
  });

  const submitData = await submitRes.json();
  report('POST /profile/aadhar Status 200', submitRes.status === 200);
  report('Submission Status is PENDING', submitData.data && submitData.data.aadhar_verification_status === 'PENDING');
  report('IDfy Request ID Tracked in Submission', Boolean(submitData.data && submitData.data.idfy_request_id));

  // Query GET /profile/aadhar/status
  const statusRes = await fetch(`${BASE_URL}/profile/aadhar/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const statusData = await statusRes.json();
  report('GET /profile/aadhar/status Status 200', statusRes.status === 200);
  report('Status Data Returns Current Verification State', Boolean(statusData.data && statusData.data.aadhar_verification_status));

  // --- 5. Webhook Callback Processing ---
  console.log('\n--- 5. Testing IDfy Webhook Callback ---');
  const webhookRequestId = submitData.data ? submitData.data.idfy_request_id : 'sample_req_id';
  const webhookPayload = [{
    action: 'extract',
    status: 'completed',
    request_id: webhookRequestId,
    group_id: `usr_${testUserId}`,
    result: {
      extraction_output: {
        id_number: 'XXXX XXXX 0014',
        name_on_card: 'IDfy Tester'
      }
    }
  }];

  const webhookRes = await fetch(`${BASE_URL}/profile/aadhar/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload)
  });
  const webhookData = await webhookRes.json();
  console.log('Webhook Response Debug:', webhookRes.status, webhookData);
  report('Webhook Endpoint Returns 200', webhookRes.status === 200, `Got: ${webhookRes.status}`);
  report('Webhook Processed Flag True', webhookData.status === true, JSON.stringify(webhookData));

  // Verify DB state updated by webhook
  const updatedPartner = await findPartnerByIdFromMysql(testUserId);
  report('Partner Verified after Webhook Approval', updatedPartner.is_verified === true && updatedPartner.is_approved === true);
  report('Aadhaar Status is APPROVED', updatedPartner.aadhar && updatedPartner.aadhar.aadhar_verification_status === 'APPROVED');

  // Cleanup
  await db.query('DELETE FROM withme_partners WHERE user_id = ?', [testUserId]);

  console.log('\n================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL IDFY AADHAAR VERIFICATION TESTS PASSED!\n');
    process.exit(0);
  }
}

runIdfyTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
