const Razorpay = require('razorpay');

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_SwFaJKQjU5ZOsH',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'JY4Uup8xp2k1AvXXE2ezOje2'
});

module.exports = razorpayInstance;
