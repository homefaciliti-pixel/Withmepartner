const { getDbPool } = require('../config/database');

async function cleanup() {
  const db = getDbPool();

  console.log('--- Cleaning up dummy/test requests and bookings ---');

  // 1. Delete from withme_partner_requests
  const [res1] = await db.query(`
    DELETE FROM withme_partner_requests 
    WHERE partner_id = '' 
       OR partner_id IS NULL 
       OR partner_id = '101' 
       OR user_id LIKE '%mock%' 
       OR user_id = 'usr_998877'
  `);
  console.log('Deleted from withme_partner_requests:', res1.affectedRows);

  // 2. Delete from partner_requests
  try {
    const [res2] = await db.query(`
      DELETE FROM partner_requests 
      WHERE partner_id = '' 
         OR partner_id IS NULL 
         OR partner_id = '101' 
         OR receiver_id = '101' 
         OR sender_id = 'usr_998877'
    `);
    console.log('Deleted from partner_requests:', res2.affectedRows);
  } catch (e) {
    console.log('partner_requests error:', e.message);
  }

  // 3. Delete from withme_partner_bookings
  const [res3] = await db.query(`
    DELETE FROM withme_partner_bookings 
    WHERE partner_id = '' 
       OR partner_id IS NULL 
       OR partner_id = '101' 
       OR user_id LIKE '%mock%' 
       OR user_id = 'usr_998877'
  `);
  console.log('Deleted from withme_partner_bookings:', res3.affectedRows);

  // 4. Delete from partner_bookings
  try {
    const [res4] = await db.query(`
      DELETE FROM partner_bookings 
      WHERE partner_id = '' 
         OR partner_id IS NULL 
         OR partner_id = '101' 
         OR user_id LIKE '%mock%' 
         OR user_id = 'usr_998877'
    `);
    console.log('Deleted from partner_bookings:', res4.affectedRows);
  } catch (e) {
    console.log('partner_bookings error:', e.message);
  }

  // 5. Clean BK_TEST
  await db.query(`DELETE FROM withme_partner_requests WHERE booking_id LIKE '%BK_TEST%'`);
  await db.query(`DELETE FROM withme_partner_bookings WHERE booking_id LIKE '%BK_TEST%'`);

  // 5. Also execute user's exact suggested cleanup condition:
  // DELETE FROM partner_requests WHERE status = 'CONFIRMED' AND user_id LIKE '%mock%' OR user_id = 'usr_201';
  // (Note: user_id = 'usr_201' requests if test/mock)
  try {
    const [res5] = await db.query(`
      DELETE FROM withme_partner_requests 
      WHERE (status = 'CONFIRMED' AND user_id LIKE '%mock%') 
         OR (user_id = 'usr_201' AND partner_id = '101')
    `);
    console.log('Deleted extra test requests from withme_partner_requests:', res5.affectedRows);
  } catch (e) {
    console.log(e.message);
  }

  console.log('Cleanup completed successfully.');
  process.exit(0);
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
