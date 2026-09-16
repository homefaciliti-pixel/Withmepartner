const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_partner_jwt_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      status: false,
      message: 'Access token required',
      error_code: 'UNAUTHORIZED'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({
        status: false,
        message: 'Invalid or expired access token',
        error_code: 'INVALID_TOKEN'
      });
    }
    req.user = user;
    next();
  });
}

function generateTokens(userId) {
  const accessToken = jwt.sign({ user_id: userId }, JWT_SECRET, { expiresIn: '1h' });
  const refreshToken = `rft_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_in: 3600
  };
}

module.exports = { authenticateToken, generateTokens, JWT_SECRET };
