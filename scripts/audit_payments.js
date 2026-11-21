const { getDbPool } = require('../config/database.js');
const razorpay = require('../config/razorpay.js');

(async () => {
  try {
    const db = getDbPool();

    // Fetch all bookings and requests that claim to be paid or have a payment_id
    const [bookings] = await db.query(`
      SELECT id, booking_id, request_id, partner_id, partner_name, customer_name, is_paid, payment_status, payment_id, status, price, created_at
      FROM withme_partner_bookings
      WHERE is_paid = 1 OR payment_status = 'PAID' OR payment_id IS NOT NULL
      ORDER BY id ASC
    `);

    const [requests] = await db.query(`
      SELECT id, request_id, booking_id, partner_id, partner_name, sender_name, is_paid, payment_status, payment_id, status, price, created_at
      FROM withme_partner_requests
      WHERE is_paid = 1 OR payment_status = 'PAID' OR payment_id IS NOT NULL
      ORDER BY id ASC
    `);

    // Fetch all Razorpay payments
    let allRzpPayments = [];
    let skip = 0;
    while (true) {
      const resp = await razorpay.payments.all({ count: 100, skip });
      if (!resp.items || resp.items.length === 0) break;
      allRzpPayments.push(...resp.items);
      if (resp.items.length < 100) break;
      skip += 100;
    }

    console.log(`Fetched ${allRzpPayments.length} total payments from live Razorpay account.`);

    // Map by payment ID, booking_id in notes, payment_id in notes
    const rzpById = new Map();
    const rzpByBookingId = new Map();
    const rzpByNotePayId = new Map();

    allRzpPayments.forEach(p => {
      rzpById.set(p.id, p);
      if (p.notes) {
        if (p.notes.booking_id) rzpByBookingId.set(String(p.notes.booking_id).trim(), p);
        if (p.notes.payment_id) rzpByNotePayId.set(String(p.notes.payment_id).trim(), p);
        if (p.notes.order_id) rzpByBookingId.set(String(p.notes.order_id).trim(), p);
      }
    });

    console.log('\n=== AUDITING WITHME_PARTNER_BOOKINGS ===');
    for (const b of bookings) {
      let rzpMatch = null;
      let matchMethod = 'NONE';

      if (b.payment_id && rzpById.has(b.payment_id)) {
        rzpMatch = rzpById.get(b.payment_id);
        matchMethod = 'direct_payment_id';
      } else if (b.booking_id && rzpByBookingId.has(b.booking_id)) {
        rzpMatch = rzpByBookingId.get(b.booking_id);
        matchMethod = 'notes.booking_id';
      } else if (b.payment_id && rzpByNotePayId.has(b.payment_id)) {
        rzpMatch = rzpByNotePayId.get(b.payment_id);
        matchMethod = 'notes.payment_id';
      }

      console.log({
        id: b.id,
        booking_id: b.booking_id,
        partner_id: b.partner_id,
        customer: b.customer_name,
        db_is_paid: b.is_paid,
        db_payment_status: b.payment_status,
        db_payment_id: b.payment_id,
        matchMethod,
        rzp_payment_id: rzpMatch ? rzpMatch.id : 'NOT_FOUND',
        rzp_status: rzpMatch ? rzpMatch.status : 'NO_RECORD',
        rzp_amount: rzpMatch ? rzpMatch.amount / 100 : null,
        is_genuine_paid: Boolean(rzpMatch && rzpMatch.status === 'captured')
      });
    }

    console.log('\n=== AUDITING WITHME_PARTNER_REQUESTS ===');
    for (const r of requests) {
      let rzpMatch = null;
      let matchMethod = 'NONE';

      if (r.payment_id && rzpById.has(r.payment_id)) {
        rzpMatch = rzpById.get(r.payment_id);
        matchMethod = 'direct_payment_id';
      } else if (r.booking_id && rzpByBookingId.has(r.booking_id)) {
        rzpMatch = rzpByBookingId.get(r.booking_id);
        matchMethod = 'notes.booking_id';
      } else if (r.payment_id && rzpByNotePayId.has(r.payment_id)) {
        rzpMatch = rzpByNotePayId.get(r.payment_id);
        matchMethod = 'notes.payment_id';
      }

      console.log({
        id: r.id,
        request_id: r.request_id,
        booking_id: r.booking_id,
        partner_id: r.partner_id,
        sender: r.sender_name,
        db_is_paid: r.is_paid,
        db_payment_status: r.payment_status,
        db_payment_id: r.payment_id,
        matchMethod,
        rzp_payment_id: rzpMatch ? rzpMatch.id : 'NOT_FOUND',
        rzp_status: rzpMatch ? rzpMatch.status : 'NO_RECORD',
        rzp_amount: rzpMatch ? rzpMatch.amount / 100 : null,
        is_genuine_paid: Boolean(rzpMatch && rzpMatch.status === 'captured')
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('Audit error:', err);
    process.exit(1);
  }
})();
