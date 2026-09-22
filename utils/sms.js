const https = require('https');

/**
 * Send DLT SMS using SMSGATEWAYHUB API
 * @param {string} mobileNumber 10-digit mobile number
 * @param {string} otp OTP code (e.g. 5739)
 */
async function sendDltOtpSms(mobileNumber, otp) {
  const apiKey = process.env.SMS_API_KEY || process.env.APIKey || 'b395HRZTRUGZThPOeRSnVg';
  const senderId = process.env.SMS_SENDER_ID || 'HMFCLI';
  const entityId = process.env.SMS_ENTITY_ID || '1201173444411453897';
  const dltTemplateId = process.env.SMS_DLT_TEMPLATE_ID || '1207173589889308632';

  // Format DLT message text: Replace {#var#} with the generated OTP
  const messageText = `Your OTP for registering on Superhome is: ${otp}. This code is valid for the next 10 minutes. Thank You, Super Home`;

  // Clean mobile number (10 digits)
  let cleanMobile = String(mobileNumber).replace(/\D/g, '');
  if (cleanMobile.length > 10 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(-10);
  } else if (cleanMobile.length === 11 && cleanMobile.startsWith('0')) {
    cleanMobile = cleanMobile.slice(-10);
  }

  // Prepend 91 for India SMS gateway recipient format
  const recipientNumber = cleanMobile.length === 10 ? `91${cleanMobile}` : cleanMobile;

  const queryParams = new URLSearchParams({
    APIKey: apiKey,
    senderid: senderId,
    channel: '2',
    DCS: '0',
    flashsms: '0',
    number: recipientNumber,
    text: messageText,
    route: '1',
    EntityId: entityId,
    dlttemplateid: dltTemplateId
  });

  const apiUrl = `https://www.smsgatewayhub.com/api/mt/SendSMS?${queryParams.toString()}`;

  console.log(`[SMSGATEWAYHUB] Sending OTP ${otp} to ${recipientNumber}...`);

  return new Promise((resolve) => {
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log("[SMSGATEWAYHUB Response]:", parsed);
          resolve({ success: true, data: parsed });
        } catch (e) {
          console.log("[SMSGATEWAYHUB Raw Response]:", data);
          resolve({ success: true, data });
        }
      });
    }).on('error', (err) => {
      console.error("[SMSGATEWAYHUB Error]:", err.message);
      resolve({ success: false, error: err.message });
    });
  });
}

module.exports = { sendDltOtpSms };
