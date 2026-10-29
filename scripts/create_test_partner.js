const { getDbPool } = require('../config/database');

async function createPartner() {
  const db = getDbPool();
  const mobile = '1234567891';
  const partnerId = `usr_${mobile}`;
  const password = 'MySecurePass123';
  const name = 'Partner User';

  // Check if already exists
  const [existing] = await db.query(
    'SELECT * FROM withme_partners WHERE mobile_number = ? OR partner_id = ?',
    [mobile, partnerId]
  );

  if (existing.length > 0) {
    console.log('Partner already exists:', existing[0].partner_id);
    await db.query(
      `UPDATE withme_partners 
       SET password = ?, status = 'ACTIVE', is_approved = 1, is_verified = 1, locked = 0, failed_attempts = 0, profile_completed = 1 
       WHERE mobile_number = ?`,
      [password, mobile]
    );
    console.log('Updated existing partner credentials.');
  } else {
    await db.query(
      `INSERT INTO withme_partners (
        partner_id, user_id, name, full_name, email, mobile_number, phone_number, country_code,
        password, gender, dob, city, state, locality, pincode, address, profile_photo_url, image,
        photos, interests, about, availability, profile_step_pending, profile_completed,
        failed_attempts, locked, is_approved, is_verified, status, rating, total_reviews, price, currency,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, '+91',
        ?, 'Female', '2000-01-01', 'Jaipur', 'Rajasthan', 'Vaishali Nagar', '302021', 'Vaishali Nagar, Jaipur', '/uploads/photos/photo_1.jpg', '/uploads/photos/photo_1.jpg',
        '[]', '[\"Coffee\"]', '{\"interests\":[\"Coffee\"]}', '{\"availability_status\":\"Available\",\"receive_requests\":true}', NULL, 1,
        0, 0, 1, 1, 'ACTIVE', 5.0, 0, 1, 'INR',
        NOW(), NOW()
      )`,
      [partnerId, partnerId, name, name, 'partner1234567891@withme.com', mobile, mobile, password]
    );
    console.log('Successfully created partner:', partnerId, 'with mobile:', mobile);
  }

  const [partner] = await db.query('SELECT id, partner_id, user_id, mobile_number, name, status, password FROM withme_partners WHERE mobile_number = ?', [mobile]);
  console.log('Partner details:', partner[0]);
  process.exit(0);
}

createPartner().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
