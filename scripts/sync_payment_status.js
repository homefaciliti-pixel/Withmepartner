const mysql = require('mysql2/promise');

async function sync() {
  const pool = mysql.createPool({
    host: 'homefaciliti.com',
    user: 'homef4fw_homefaci',
    password: 'Home1184#$%',
    database: 'homef4fw_homefaci',
    port: 3306,
    connectTimeout: 15000
  });

  try {
    // 1. Update withme_partner_requests where booking is already paid in withme_partner_bookings
    const [res1] = await pool.query(`
      UPDATE withme_partner_requests r
      JOIN withme_partner_bookings b ON r.booking_id = b.booking_id
      SET r.is_paid = 1, r.payment_status = 'PAID', r.status = 'CONFIRMED', r.is_accepted = 1, r.updated_at = NOW()
      WHERE (b.is_paid = 1 OR b.payment_status = 'PAID')
    `);
    console.log('[OK] Synced requests from paid bookings:', res1.affectedRows);

    // 2. Also sync partner_id to any payment request rows where partner_id was empty
    const [res2] = await pool.query(`
      UPDATE withme_partner_requests r1
      JOIN withme_partner_requests r2 ON r1.booking_id = r2.booking_id
      SET r1.partner_id = r2.partner_id
      WHERE (r1.partner_id IS NULL OR r1.partner_id = '') AND (r2.partner_id IS NOT NULL AND r2.partner_id != '')
    `);
    console.log('[OK] Synced partner_id to payment requests:', res2.affectedRows);

    // 3. Check BK927619
    const [rows] = await pool.query("SELECT request_id, booking_id, partner_id, status, payment_status, is_paid FROM withme_partner_requests WHERE booking_id = 'BK927619'");
    console.log('[VERIFY] Updated BK927619 requests:');
    console.table(rows);
  } finally {
    await pool.end();
  }
}

sync().catch(e => console.error(e));
