const { getDbPool } = require('../config/database.js');
const razorpay = require('../config/razorpay.js');

(async () => {
  const db = getDbPool();

  let allRzpPayments = [];
  let skip = 0;
  while (true) {
    const resp = await razorpay.payments.all({ count: 100, skip });
    if (!resp.items || resp.items.length === 0) break;
    allRzpPayments.push(...resp.items);
    if (resp.items.length < 100) break;
    skip += 100;
  }

  // Filter ONLY captured payments with booking_id in notes
  const capturedBookingPayments = allRzpPayments.filter(p => p.status === 'captured' && p.notes && (p.notes.booking_id || p.notes.order_id));
  console.log(`Found ${capturedBookingPayments.length} captured payments with booking notes in Razorpay:`);

  for (const p of capturedBookingPayments) {
    const bookingId = p.notes.booking_id || p.notes.order_id;
    const [bRows] = await db.query('SELECT id, booking_id, partner_id, partner_name, customer_name, is_paid, payment_status, payment_id, status FROM withme_partner_bookings WHERE booking_id = ?', [bookingId]);
    const [rRows] = await db.query('SELECT id, request_id, partner_id, partner_name, sender_name, is_paid, payment_status, payment_id, status FROM withme_partner_requests WHERE booking_id = ?', [bookingId]);

    console.log({
      rzp_id: p.id,
      amount: p.amount / 100,
      booking_id: bookingId,
      notes: p.notes,
      created_at: new Date(p.created_at * 1000).toISOString(),
      in_bookings_table: bRows.length > 0 ? { partner_id: bRows[0].partner_id, is_paid: bRows[0].is_paid, payment_status: bRows[0].payment_status } : 'NOT_FOUND',
      in_requests_table: rRows.length > 0 ? { partner_id: rRows[0].partner_id, is_paid: rRows[0].is_paid, payment_status: rRows[0].payment_status } : 'NOT_FOUND'
    });
  }

  process.exit(0);
})();
