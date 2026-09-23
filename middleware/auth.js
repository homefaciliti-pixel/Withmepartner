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

  jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, user) => {
    if (err) {
      return res.status(401).json({
        status: false,
        message: 'Invalid access token',
        error_code: 'INVALID_TOKEN'
      });
    }
    req.user = user;
    next();
  });
}

function generateTokens(userId) {
  const accessToken = jwt.sign({ user_id: userId }, JWT_SECRET);
  return {
    access_token: accessToken
  };
}

module.exports = { authenticateToken, generateTokens, JWT_SECRET };
