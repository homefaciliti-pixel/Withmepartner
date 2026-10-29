const { getDbPool } = require('../config/database');

async function fixCustomerImages() {
  const db = getDbPool();
  console.log('Running backfill for customer images in bookings and requests...');

  const [resBk] = await db.query(`
    UPDATE withme_partner_bookings b
    JOIN users u ON (b.user_id = u.id OR u.id = REPLACE(b.user_id, 'usr_', ''))
    SET b.profile_image = COALESCE(NULLIF(u.profile_image, ''), CONCAT('https://withmeapi-userapp.onrender.com/uploads/', u.image))
    WHERE (b.profile_image IS NULL OR b.profile_image = '' OR b.profile_image LIKE '%profile.jpg%')
      AND (NULLIF(u.profile_image, '') IS NOT NULL OR NULLIF(u.image, '') IS NOT NULL)
  `);
  console.log('BOOKINGS UPDATED:', resBk.affectedRows, 'changed:', resBk.changedRows);

  const [resReq] = await db.query(`
    UPDATE withme_partner_requests r
    JOIN users u ON (r.user_id = u.id OR u.id = REPLACE(r.user_id, 'usr_', ''))
    SET r.sender_avatar = COALESCE(NULLIF(u.profile_image, ''), CONCAT('https://withmeapi-userapp.onrender.com/uploads/', u.image))
    WHERE (r.sender_avatar IS NULL OR r.sender_avatar = '' OR r.sender_avatar LIKE '%profile.jpg%')
      AND (NULLIF(u.profile_image, '') IS NOT NULL OR NULLIF(u.image, '') IS NOT NULL)
  `);
  console.log('REQUESTS UPDATED:', resReq.affectedRows, 'changed:', resReq.changedRows);

  // Check Amit rows specifically
  const [amitBks] = await db.query("SELECT booking_id, user_id, customer_name, profile_image FROM withme_partner_bookings WHERE user_id = '2305' OR customer_name LIKE '%Amit%' LIMIT 5");
  console.log('UPDATED AMIT BOOKINGS:', amitBks);

  const [amitReqs] = await db.query("SELECT request_id, user_id, sender_name, sender_avatar FROM withme_partner_requests WHERE user_id = '2305' OR sender_name LIKE '%Amit%' LIMIT 5");
  console.log('UPDATED AMIT REQUESTS:', amitReqs);

  process.exit(0);
}

fixCustomerImages().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});
