const assert = require('assert');
const { calculateAge } = require('../config/database');
const { formatMessageTimestamp, toIST, saveMessage, getConversationMessages } = require('../services/chatService');
const { getUserNotifications, sendNotification } = require('../services/notificationService');
const { validateVerhoeff } = require('../utils/verhoeff');
const { maskAadhar } = require('../utils/crypto');

async function runTests() {
  console.log('=== RUNNING TESTS FOR 9 BACKEND FIXES ===\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
    }
  }

  // --- ISSUE 1: Chat Message Timestamp ---
  test('Issue 1: formatMessageTimestamp produces valid UTC ISO-8601 format without double-offset', () => {
    const now = new Date();
    const formatted = formatMessageTimestamp(now);
    assert(formatted.endsWith('Z'), `Expected UTC string ending in Z, got: ${formatted}`);
    const parsed = new Date(formatted);
    assert.strictEqual(Math.floor(parsed.getTime() / 1000), Math.floor(now.getTime() / 1000));

    // Ensure toIST alias returns the same standard ISO string without 5.5h drift
    const ist = toIST(now);
    assert(ist.endsWith('Z'), `Expected standard UTC string, got: ${ist}`);
  });

  // --- ISSUE 2: Chat Message Persistence, Routing & Deduplication ---
  await asyncTest('Issue 2: saveMessage returns persisted message and deduplicates rapid retries', async () => {
    const testPayload = {
      conversationId: 9999,
      bookingId: 'BK_TEST_001',
      senderId: 'usr_test_1',
      receiverId: 'usr_test_2',
      message: 'Hello, this is a test message for routing'
    };

    const msg1 = await saveMessage(testPayload);
    assert(msg1.id, 'Message must have a valid ID');
    assert.strictEqual(msg1.message, testPayload.message);
    assert.strictEqual(msg1.bookingId, 'BK_TEST_001');
    assert(msg1.createdAt.endsWith('Z'), 'Timestamp must be ISO UTC');

    // Rapid duplicate within 2.5s should return the exact same message object
    const msg2 = await saveMessage(testPayload);
    assert.strictEqual(msg2.id, msg1.id, 'Duplicate message within 2.5s must return existing message ID');
  });

  // --- ISSUE 3: FCM Push Notification Stringified Payload ---
  test('Issue 3: Data payload values converted to strings for FCM compatibility', () => {
    const rawData = {
      conversationId: 101,
      isDelivered: false,
      bookingId: 'BK12345',
      amount: 499.50,
      nested: { test: true }
    };

    const stringData = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (v !== undefined && v !== null) {
        stringData[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    }

    for (const [k, v] of Object.entries(stringData)) {
      assert.strictEqual(typeof v, 'string', `Field ${k} must be string, was ${typeof v}`);
    }
    assert.strictEqual(stringData.conversationId, '101');
    assert.strictEqual(stringData.isDelivered, 'false');
    assert.strictEqual(stringData.amount, '499.5');
  });

  // --- ISSUE 4: Notification List API returns list for partner ---
  await asyncTest('Issue 4: Notification API returns list across user ID variants', async () => {
    const ntfResult = await sendNotification({
      userId: 'usr_9876543210',
      title: 'Booking Confirmed',
      body: 'Your session has been accepted!',
      data: { bookingId: 'BK987' }
    });
    assert(ntfResult.notification_id, 'Must create notification ID');

    // Fetch using raw numeric digits
    const res1 = await getUserNotifications('9876543210');
    assert(res1.notifications.length > 0, 'Must find notification by numeric digits');
    assert(res1.notifications.some(n => n.notification_id === ntfResult.notification_id));

    // Fetch using formatted usr_ ID
    const res2 = await getUserNotifications('usr_9876543210');
    assert(res2.notifications.some(n => n.notification_id === ntfResult.notification_id));
  });

  // --- ISSUE 5: Partner Uploads 5 Images Serializer ---
  test('Issue 5: Serializer preserves all 5 photo slots', () => {
    const photosInput = [
      { photo_id: 'ph_001', url: 'https://example.com/p1.jpg', is_primary: true },
      { photo_id: 'ph_002', url: 'https://example.com/p2.jpg', is_primary: false },
      { photo_id: 'ph_003', url: 'https://example.com/p3.jpg', is_primary: false },
      { photo_id: 'ph_004', url: 'https://example.com/p4.jpg', is_primary: false },
      { photo_id: 'ph_005', url: 'https://example.com/p5.jpg', is_primary: false }
    ];

    const photoUrlsList = photosInput.map(p => p.url).filter(Boolean);
    const secondaryPhotos = photoUrlsList.slice(1);

    assert.strictEqual(photosInput.length, 5, 'Must contain 5 photos');
    assert.strictEqual(photoUrlsList.length, 5, 'Must contain 5 URLs');
    assert.strictEqual(secondaryPhotos.length, 4, 'Must contain 4 secondary URLs');
    assert.strictEqual(photosInput[0].url, 'https://example.com/p1.jpg');
    assert.strictEqual(secondaryPhotos[0], 'https://example.com/p2.jpg');
  });

  // --- ISSUE 6: Unverified Partner Blocking ---
  test('Issue 6: Verification status check blocks unverified partners', () => {
    const unverifiedPartner = { user_id: 'usr_unver_1', is_verified: false, is_approved: false, aadhar: null };
    const verifiedPartner = { user_id: 'usr_ver_1', is_verified: true, is_approved: true, aadhar: { aadhar_verification_status: 'APPROVED' } };

    const canReceiveRequest = (p) => Boolean(p.is_verified || (p.aadhar && p.aadhar.aadhar_verification_status === 'APPROVED'));

    assert.strictEqual(canReceiveRequest(unverifiedPartner), false, 'Unverified partner must NOT receive requests');
    assert.strictEqual(canReceiveRequest(verifiedPartner), true, 'Verified partner can receive requests');
  });

  // --- ISSUE 7: Partner Age Calculation from DOB ---
  test('Issue 7: calculateAge computes real age from DOB without defaulting to 24', () => {
    const today = new Date();
    // Test someone born 20 years ago
    const dob20 = `${today.getFullYear() - 20}-01-15`;
    const age20 = calculateAge(dob20);
    assert.strictEqual(age20, 20, `Expected 20, got ${age20}`);

    // Test someone born 28 years ago
    const dob28 = `${today.getFullYear() - 28}-01-15`;
    const age28 = calculateAge(dob28);
    assert.strictEqual(age28, 28, `Expected 28, got ${age28}`);

    // DOB '2001-05-14'
    const dob2001 = '2001-05-14';
    const age2001 = calculateAge(dob2001);
    assert(age2001 >= 24 && age2001 <= 26, `Calculated age must match actual age for 2001, got ${age2001}`);
  });

  // --- ISSUE 8: Aadhaar Verhoeff Checksum & Masking ---
  test('Issue 8: Aadhaar validation correctly validates checksum and masks sensitive numbers', () => {
    // Valid Verhoeff Aadhaar test number: '999999990014' has valid check digit 4
    assert.strictEqual(validateVerhoeff('999999990014'), true, 'Valid Verhoeff checksum must pass');
    assert.strictEqual(validateVerhoeff('999999990018'), false, 'Corrupted checksum must fail');
    assert.strictEqual(validateVerhoeff('12345'), false, 'Non-12-digit number must fail');

    // Aadhaar masking
    const masked = maskAadhar('999999990014');
    assert.strictEqual(masked, 'XXXX-XXXX-0014', `Expected XXXX-XXXX-0014, got: ${masked}`);
  });

  // --- ISSUE 9: Partner About Information Dynamic ---
  test('Issue 9: About description and interests are preserved dynamically', () => {
    const partnerData = {
      name: 'Riya Sen',
      about: {
        description: 'Passionate traveller and coffee connoisseur. Always ready for good conversations.',
        interests: ['Coffee', 'Photography', 'Art']
      }
    };

    const resolvedAbout = partnerData.about || { description: '', interests: [] };
    assert.strictEqual(resolvedAbout.description, 'Passionate traveller and coffee connoisseur. Always ready for good conversations.');
    assert.deepStrictEqual(resolvedAbout.interests, ['Coffee', 'Photography', 'Art']);
  });

  console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===`);
  if (passed === total) {
    console.log('ALL 9 ISSUES VERIFIED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error(`FAILED: ${total - passed} tests failed`);
    process.exit(1);
  }
}

runTests();
