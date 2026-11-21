const { getDbPool } = require('../config/database.js');
const razorpay = require('../config/razorpay.js');

async function reconcileDatabase() {
  const db = getDbPool();
  console.log('=== STARTING SAFE PAYMENT & BOOKING RECONCILIATION ===\n');

  // 1. Mark known failed / unpaid test bookings in DB
  const failedBookingIds = ['BK969828', 'BK392214', 'BK103954', 'bk_user_999', 'req_user_999'];
  const [failRes1] = await db.query(
    `UPDATE withme_partner_bookings 
     SET is_paid = 0, payment_status = 'FAILED', status = 'PAYMENT_FAILED', updated_at = NOW() 
     WHERE booking_id IN (?)`,
    [failedBookingIds]
  );
  const [failRes2] = await db.query(
    `UPDATE withme_partner_requests 
     SET is_paid = 0, payment_status = 'FAILED', status = 'PAYMENT_FAILED', updated_at = NOW() 
     WHERE booking_id IN (?)`,
    [failedBookingIds]
  );
  console.log(`[Reconcile] Updated failed bookings: ${failRes1.affectedRows} in bookings, ${failRes2.affectedRows} in requests.`);

  // 2. Mark legacy dummy seed bookings (IDs 1-38) without payments as DUMMY_DATA
  const [dummyRes] = await db.query(
    `UPDATE withme_partner_bookings 
     SET is_paid = 0, payment_status = 'UNPAID', status = 'DUMMY_DATA', updated_at = NOW() 
     WHERE id <= 38 AND (payment_id IS NULL OR payment_id = '')`
  );
  console.log(`[Reconcile] Marked ${dummyRes.affectedRows} legacy seed rows as DUMMY_DATA.`);

  // 3. Reconcile genuine paid bookings with their confirmed Razorpay payment IDs
  const genuinePaidBookings = [
    { bookingId: 'BK267890', rzpPayId: 'pay_TtcXvIievTfSiu', partnerId: 'usr_203', partnerName: 'Priya Sharma' },
    { bookingId: 'BK629472', rzpPayId: 'pay_TtcV5jDeASj5iX', partnerId: 'usr_203', partnerName: 'Priya Sharma' },
    { bookingId: 'BK576262', rzpPayId: 'pay_TswDA069qjYza7', partnerId: 'usr_203', partnerName: 'Priya Sharma' },
    { bookingId: 'BK164899', rzpPayId: 'pay_ToX1DVgol4XcIr', partnerId: 'usr_203', partnerName: 'Priya Sharma' },
    { bookingId: 'BK927619', rzpPayId: 'pay_ToUvOmqzbmGKAk', partnerId: 'usr_203', partnerName: 'Priya Sharma' },
    { bookingId: 'BK407497', rzpPayId: 'pay_TsUxupNViagWMk', partnerId: 'usr_83631', partnerName: 'Rinku' },
    { bookingId: 'BK697432', rzpPayId: 'pay_ToCPjcr5zKqxdt', partnerId: 'usr_83631', partnerName: 'Rinku' }
  ];

  for (const item of genuinePaidBookings) {
    await db.query(
      `UPDATE withme_partner_bookings 
       SET is_paid = 1, payment_status = 'PAID', status = 'CONFIRMED', payment_id = ?, partner_id = ?, partner_name = ?, is_accepted = 1, updated_at = NOW()
       WHERE booking_id = ?`,
      [item.rzpPayId, item.partnerId, item.partnerName, item.bookingId]
    );

    await db.query(
      `UPDATE withme_partner_requests 
       SET is_paid = 1, payment_status = 'PAID', status = 'CONFIRMED', payment_id = ?, partner_id = ?, partner_name = ?, is_accepted = 1, updated_at = NOW()
       WHERE booking_id = ?`,
      [item.rzpPayId, item.partnerId, item.partnerName, item.bookingId]
    );
    console.log(`[Reconcile] Confirmed genuine paid booking ${item.bookingId} (Razorpay: ${item.rzpPayId}, Partner: ${item.partnerId})`);
  }

  // 4. Print summary of genuine paid records in DB
  const [bSummary] = await db.query(
    `SELECT booking_id, partner_id, partner_name, customer_name, is_paid, payment_status, payment_id, status 
     FROM withme_partner_bookings 
     WHERE is_paid = 1 AND payment_status = 'PAID'`
  );
  console.log('\n=== CURRENT GENUINE PAID BOOKINGS IN DB ===');
  console.table(bSummary);

  const [rSummary] = await db.query(
    `SELECT request_id, booking_id, partner_id, partner_name, sender_name, is_paid, payment_status, payment_id, status 
     FROM withme_partner_requests 
     WHERE is_paid = 1 AND payment_status = 'PAID'`
  );
  console.log('\n=== CURRENT GENUINE PAID REQUESTS IN DB ===');
  console.table(rSummary);
}

reconcileDatabase()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Reconciliation error:', err);
    process.exit(1);
  });
