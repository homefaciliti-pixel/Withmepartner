const { getDbPool } = require('../config/database');

async function migrate() {
  const db = getDbPool();
  try {
    const [cols] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'booking_id'`
    );
    if (cols.length === 0) {
      await db.query(`ALTER TABLE conversations ADD COLUMN booking_id VARCHAR(100) NULL, ADD INDEX idx_booking_id (booking_id)`);
      console.log('[Migration] Added booking_id to conversations');
    } else {
      console.log('[Migration] booking_id already exists in conversations');
    }

    const [msgCols] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'booking_id'`
    );
    if (msgCols.length === 0) {
      await db.query(`ALTER TABLE messages ADD COLUMN booking_id VARCHAR(100) NULL, ADD INDEX idx_msg_booking_id (booking_id)`);
      console.log('[Migration] Added booking_id to messages');
    } else {
      console.log('[Migration] booking_id already exists in messages');
    }
  } catch (err) {
    console.error('[Migration Error]:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
