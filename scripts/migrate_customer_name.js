const mysql = require('mysql2/promise');

async function migrate() {
  const pool = mysql.createPool({
    host: 'homefaciliti.com',
    user: 'homef4fw_homefaci',
    password: 'Home1184#$%',
    database: 'homef4fw_homefaci',
    port: 3306,
    connectTimeout: 15000
  });

  try {
    // Add customer_name column to withme_partner_requests
    try {
      await pool.query('ALTER TABLE withme_partner_requests ADD COLUMN customer_name VARCHAR(150) DEFAULT NULL AFTER partner_name');
      console.log('[OK] Added customer_name to withme_partner_requests');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('[SKIP] customer_name already exists in withme_partner_requests');
      } else {
        throw e;
      }
    }

    // Backfill customer_name from sender_name where customer_name is empty
    const [result] = await pool.query(
      'UPDATE withme_partner_requests SET customer_name = sender_name WHERE (customer_name IS NULL OR customer_name = "") AND sender_name IS NOT NULL'
    );
    console.log('[OK] Backfilled customer_name from sender_name:', result.affectedRows, 'rows updated');

    // Verify
    const [cols] = await pool.query('SHOW COLUMNS FROM withme_partner_requests');
    const hasCustomerName = cols.some(c => c.Field === 'customer_name');
    const hasPartnerName = cols.some(c => c.Field === 'partner_name');
    console.log('[VERIFY] customer_name column exists:', hasCustomerName);
    console.log('[VERIFY] partner_name column exists:', hasPartnerName);
    console.log('[VERIFY] All columns:', cols.map(c => c.Field).join(', '));

    console.log('\nMIGRATION COMPLETE!');
  } finally {
    await pool.end();
  }
}

migrate().catch(e => console.error('Migration Error:', e.message, e.code));
