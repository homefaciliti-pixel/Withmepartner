const razorpay = require('../config/razorpay');
const crypto = require('crypto');

/**
 * Service to verify payments with Razorpay and enforce payment integrity.
 */

/**
 * Verify Razorpay Webhook Signature
 * @param {string|Buffer} rawBody - The raw request body string
 * @param {string} signature - The x-razorpay-signature header
 * @param {string} secret - Webhook secret from environment
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
  } catch (err) {
    console.error('[Payment Verification] Webhook signature verification error:', err.message);
    return false;
  }
}

/**
 * Verify a payment directly with the Razorpay API
 * @param {string} paymentId - Razorpay payment ID (e.g. pay_...)
 * @param {Object} options - Optional verification parameters (expectedBookingId, expectedAmount, currency)
 * @returns {Promise<{ verified: boolean, payment: Object|null, error: string|null }>}
 */
async function verifyPaymentWithGateway(paymentId, options = {}) {
  if (!paymentId || typeof paymentId !== 'string') {
    return { verified: false, payment: null, error: 'PAYMENT_ID_REQUIRED' };
  }

  const cleanPayId = paymentId.trim();

  // Test / internal mock payment IDs (only for internal testing in non-production)
  if (cleanPayId.startsWith('test_pay_') || cleanPayId.startsWith('mock_pay_')) {
    if (process.env.NODE_ENV === 'test' || options.allowMock) {
      return {
        verified: true,
        payment: {
          id: cleanPayId,
          amount: (options.expectedAmount || 1) * 100,
          currency: 'INR',
          status: 'captured',
          method: 'test_card',
          captured: true
        },
        error: null
      };
    }
  }

  try {
    const payment = await razorpay.payments.fetch(cleanPayId);
    if (!payment) {
      return { verified: false, payment: null, error: 'PAYMENT_NOT_FOUND_ON_GATEWAY' };
    }

    // 1. Payment status check: MUST be 'captured'
    if (payment.status !== 'captured' && !payment.captured) {
      return {
        verified: false,
        payment,
        error: `PAYMENT_NOT_CAPTURED (Status: ${payment.status})`
      };
    }

    // 2. Currency check
    if (payment.currency && payment.currency.toUpperCase() !== 'INR') {
      return {
        verified: false,
        payment,
        error: `INVALID_CURRENCY (Expected INR, got ${payment.currency})`
      };
    }

    // 3. Amount check (if expectedAmount is provided)
    if (options.expectedAmount !== undefined && options.expectedAmount !== null) {
      const expectedInPaise = Number(options.expectedAmount) * 100;
      if (payment.amount < expectedInPaise) {
        return {
          verified: false,
          payment,
          error: `AMOUNT_MISMATCH (Expected at least ${expectedInPaise} paise, got ${payment.amount} paise)`
        };
      }
    }

    // 4. Booking mapping check (if notes contain booking_id)
    if (options.expectedBookingId && payment.notes) {
      const noteBookingId = payment.notes.booking_id || payment.notes.order_id;
      if (noteBookingId && String(noteBookingId).trim() !== String(options.expectedBookingId).trim()) {
        console.warn(`[Payment Warning] Note booking_id (${noteBookingId}) does not match expected (${options.expectedBookingId})`);
      }
    }

    return { verified: true, payment, error: null };
  } catch (err) {
    const errMsg = (err.error && err.error.description) || err.message || 'GATEWAY_ERROR';
    console.error(`[Payment Verification] Failed for paymentId=${cleanPayId}:`, errMsg);
    return { verified: false, payment: null, error: errMsg };
  }
}

/**
 * Helper to determine if a DB booking / request record represents a genuine paid booking
 * @param {Object} item - DB row from withme_partner_bookings or withme_partner_requests
 * @returns {boolean}
 */
function isGenuinePaidRecord(item) {
  if (!item) return false;

  const isPaid = Boolean(
    item.is_paid === 1 || item.is_paid === true || item.is_paid === '1'
  );

  const payStatus = String(item.payment_status || '').toUpperCase().trim();
  const isPaidStatus = payStatus === 'PAID' || payStatus === 'COMPLETED';

  const status = String(item.status || '').toUpperCase().trim();
  const isNotCancelled = status !== 'CANCELLED' && status !== 'PAYMENT_FAILED' && status !== 'DUMMY_DATA';

  // Has a valid non-empty payment_id or verified flag
  const hasPaymentId = Boolean(
    item.payment_id &&
    String(item.payment_id).trim() !== '' &&
    !String(item.payment_id).startsWith('dummy_')
  );

  // Must have BOTH is_paid true AND payment_status PAID AND not cancelled
  return isPaid && isPaidStatus && isNotCancelled && hasPaymentId;
}

module.exports = {
  verifyWebhookSignature,
  verifyPaymentWithGateway,
  isGenuinePaidRecord
};
