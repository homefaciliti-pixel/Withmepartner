const { getDbPool } = require('../config/database.js');
const db = getDbPool();

(async () => {
  try {
    console.log('=== INSPECTING BOOKINGS & REQUESTS ===\n');

    // 1. Check all rows in withme_partner_bookings
    const [allBookings] = await db.query(`
      SELECT id, booking_id, request_id, user_id, partner_id, partner_name, customer_name,
             price, status, is_accepted, is_paid, payment_status, payment_id, created_at
      FROM withme_partner_bookings
      ORDER BY id ASC
    `);
    console.log(`Total rows in withme_partner_bookings: ${allBookings.length}`);
    console.table(allBookings);

    // 2. Check all rows in withme_partner_requests
    const [allRequests] = await db.query(`
      SELECT id, request_id, booking_id, user_id, partner_id, partner_name, sender_name,
             price, status, is_accepted, is_paid, payment_status, payment_id, created_at
      FROM withme_partner_requests
      ORDER BY id ASC
    `);
    console.log(`\nTotal rows in withme_partner_requests: ${allRequests.length}`);
    console.table(allRequests);

    // 3. Check node_orders or orders table for payment records
    try {
      const [orders] = await db.query(`SELECT id, order_number, user_id, partner_id, grand_total, order_status, payment_status, payment_method, razorpay_payment_id, created_at FROM node_orders ORDER BY id DESC LIMIT 20`);
      console.log(`\nRecent node_orders (${orders.length}):`);
      console.table(orders);
    } catch (e) {
      console.log('node_orders check failed:', e.message);
    }

    try {
      const [mainOrders] = await db.query(`SELECT id, user_id, total_amount, status, payment_status, transaction_id, created_at FROM orders ORDER BY id DESC LIMIT 20`);
      console.log(`\nRecent orders (${mainOrders.length}):`);
      console.table(mainOrders);
    } catch (e) {
      console.log('orders check failed:', e.message);
    }

    process.exit(0);
  } catch (err) {
    console.error('Inspection error:', err);
    process.exit(1);
  }
})();
