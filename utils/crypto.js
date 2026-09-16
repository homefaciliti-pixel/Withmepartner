const crypto = require('crypto');

const SECRET_KEY = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'partner_app_secret_key_32bytes_len!!').digest();
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function maskAadhar(numStr) {
  if (!numStr || numStr.length < 4) return 'XXXX-XXXX-XXXX';
  const clean = numStr.replace(/\D/g, '');
  if (clean.length !== 12) return 'XXXX-XXXX-XXXX';
  const last4 = clean.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

module.exports = { encrypt, decrypt, maskAadhar };
