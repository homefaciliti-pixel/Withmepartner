// Quick check: Amit's image in bookings and requests
const { getDbPool } = require('../config/database');

async function check() {
  const pool = await getDbPool();
  try {
    const [bookings] = await pool.query(
      "SELECT id, user_id, profile_image FROM withme_partner_bookings WHERE user_id IN (2305, '2305', 'usr_2305') LIMIT 5"
    );
    console.log('\nBOOKINGS WITH AMIT IMAGE:');
    if (bookings.length === 0) console.log('  (none found)');
    bookings.forEach(b => console.log(
      '  id:', b.id,
      '| user_id:', b.user_id,
      '| image:', b.profile_image ? b.profile_image.substring(0, 70) + '...' : 'NULL'
    ));

    const [requests] = await pool.query(
      "SELECT request_id, user_id, sender_avatar FROM withme_partner_requests WHERE user_id IN (2305, '2305', 'usr_2305') LIMIT 5"
    );
    console.log('\nREQUESTS WITH AMIT IMAGE:');
    if (requests.length === 0) console.log('  (none found)');
    requests.forEach(r => console.log(
      '  id:', r.request_id,
      '| user_id:', r.user_id,
      '| avatar:', r.sender_avatar ? r.sender_avatar.substring(0, 70) + '...' : 'NULL'
    ));

    console.log('\nDone.');
  } finally {
    process.exit(0);
  }
}

check().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
