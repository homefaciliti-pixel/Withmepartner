const express = require('express');
const router = express.Router();

// Country codes dataset with flags and ISO codes
const COUNTRY_CODES = [
  { name: "India", code: "+91", iso: "IN", flag: "🇮🇳" },
  { name: "United States", code: "+1", iso: "US", flag: "🇺🇸" },
  { name: "United Kingdom", code: "+44", iso: "GB", flag: "🇬🇧" },
  { name: "United Arab Emirates", code: "+971", iso: "AE", flag: "🇦🇪" },
  { name: "Canada", code: "+1", iso: "CA", flag: "🇨🇦" },
  { name: "Australia", code: "+61", iso: "AU", flag: "🇦🇺" },
  { name: "Saudi Arabia", code: "+966", iso: "SA", flag: "🇸🇦" },
  { name: "Qatar", code: "+974", iso: "QA", flag: "🇶🇦" },
  { name: "Singapore", code: "+65", iso: "SG", flag: "🇸🇬" },
  { name: "Germany", code: "+49", iso: "DE", flag: "🇩🇪" },
  { name: "France", code: "+33", iso: "FR", flag: "🇫🇷" },
  { name: "Japan", code: "+81", iso: "JP", flag: "🇯🇵" },
  { name: "China", code: "+86", iso: "CN", flag: "🇨🇳" },
  { name: "Russia", code: "+7", iso: "RU", flag: "🇷🇺" },
  { name: "Kuwait", code: "+965", iso: "KW", flag: "🇰🇼" },
  { name: "Oman", code: "+968", iso: "OM", flag: "🇴🇲" },
  { name: "Bahrain", code: "+973", iso: "BH", flag: "🇧🇭" },
  { name: "Nepal", code: "+977", iso: "NP", flag: "🇳🇵" },
  { name: "Bangladesh", code: "+880", iso: "BD", flag: "🇧🇩" },
  { name: "Sri Lanka", code: "+94", iso: "LK", flag: "🇱🇰" },
  { name: "Pakistan", code: "+92", iso: "PK", flag: "🇵🇰" },
  { name: "Malaysia", code: "+60", iso: "MY", flag: "🇲🇾" },
  { name: "Thailand", code: "+66", iso: "TH", flag: "🇹🇭" },
  { name: "Indonesia", code: "+62", iso: "ID", flag: "🇮🇩" },
  { name: "Philippines", code: "+63", iso: "PH", flag: "🇵🇭" },
  { name: "South Korea", code: "+82", iso: "KR", flag: "🇰🇷" },
  { name: "Italy", code: "+39", iso: "IT", flag: "🇮🇹" },
  { name: "Spain", code: "+34", iso: "ES", flag: "🇪🇸" },
  { name: "Netherlands", code: "+31", iso: "NL", flag: "🇳🇱" },
  { name: "Switzerland", code: "+41", iso: "CH", flag: "🇨🇭" },
  { name: "Sweden", code: "+46", iso: "SE", flag: "🇸🇪" },
  { name: "New Zealand", code: "+64", iso: "NZ", flag: "🇳🇿" },
  { name: "South Africa", code: "+27", iso: "ZA", flag: "🇿🇦" },
  { name: "Brazil", code: "+55", iso: "BR", flag: "🇧🇷" },
  { name: "Mexico", code: "+52", iso: "MX", flag: "🇲🇽" },
  { name: "Turkey", code: "+90", iso: "TR", flag: "🇹🇷" },
  { name: "Egypt", code: "+20", iso: "EG", flag: "🇪🇬" },
  { name: "Vietnam", code: "+84", iso: "VN", flag: "🇻🇳" }
];

// GET /meta/country-codes
router.get('/country-codes', (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      country_codes: COUNTRY_CODES
    }
  });
});

// 6.2 Meta Interests
router.get('/interests', (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      interests: [
        "Coffee",
        "Travel",
        "Music",
        "Movies",
        "Photography",
        "Events",
        "Books",
        "Fitness"
      ]
    }
  });
});

// 7.1 Meta Time Slots
router.get('/time-slots', (req, res) => {
  const time_slots = [
    "06:00 AM", "06:30 AM", "07:00 AM", "07:30 AM", "08:00 AM", "08:30 AM",
    "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
    "12:00 PM", "12:30 PM", "01:00 PM", "01:30 PM", "02:00 PM", "02:30 PM",
    "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM",
    "06:00 PM", "06:30 PM", "07:00 PM", "07:30 PM", "08:00 PM", "08:30 PM",
    "09:00 PM", "09:30 PM", "10:00 PM"
  ];

  return res.status(200).json({
    status: true,
    message: "Success",
    data: { time_slots }
  });
});

// Privacy Policy Dataset
const PRIVACY_POLICY = {
  title: "Privacy Policy",
  app_name: "WithMe Partner App",
  effective_date: "2026-01-01",
  last_updated: "2026-09-25",
  support_email: "me24with@gmail.com",
  sections: [
    {
      id: 1,
      title: "1. Information We Collect",
      content: "We collect information you provide directly to us when registering as a partner or updating your profile. This includes your full name, mobile number, date of birth (DOB for minimum 19 years age verification), email address, gender, location (city, state, area), profile photos, government ID details (Aadhar card for KYC verification), and bank account details for processing withdrawals."
    },
    {
      id: 2,
      title: "2. How We Use Your Information",
      content: "Your information is used strictly to provide, maintain, and improve WithMe Partner services. Specifically, we use your data to:\n- Verify your identity and eligibility (minimum 19 years old requirement).\n- Facilitate partner discovery and booking requests between users and partners.\n- Process earnings payout withdrawals to your designated bank account.\n- Send essential notifications, OTPs for account login, and transaction updates."
    },
    {
      id: 3,
      title: "3. Data Protection & Security",
      content: "We implement industry-standard encryption and security measures to protect your personal information and sensitive documents (such as Aadhar and Bank details) against unauthorized access, loss, or misuse. We do not sell or rent your personal data to third parties."
    },
    {
      id: 4,
      title: "4. Account Details & Modification Rights",
      content: "You have the right to view, update, or request deletion of your account at any time via profile settings. To update sensitive information such as bank account details after initial submission, please contact our support team directly at me24with@gmail.com."
    },
    {
      id: 5,
      title: "5. Contact & Support",
      content: "If you have any questions, concerns, or requests regarding this Privacy Policy or your data, please contact our executive support team at:\nEmail: me24with@gmail.com"
    }
  ],
  html_content: `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
      <h1 style="color: #111;">Privacy Policy</h1>
      <p style="font-size: 14px; color: #666;"><strong>App Name:</strong> WithMe Partner App | <strong>Last Updated:</strong> 25 Sept 2026</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <h3>1. Information We Collect</h3>
      <p>We collect information you provide directly to us when registering as a partner or updating your profile. This includes your full name, mobile number, date of birth (DOB for minimum 19 years age verification), email address, gender, location, profile photos, Aadhar card details for KYC verification, and bank account details for processing withdrawals.</p>
      <h3>2. How We Use Your Information</h3>
      <p>Your information is used strictly to provide and improve WithMe Partner services: verify identity/age eligibility (19+ years old), process bookings, send login OTPs, and process earnings withdrawal requests to your bank account.</p>
      <h3>3. Data Protection & Security</h3>
      <p>We implement industry-standard encryption to protect your personal data and sensitive KYC/Bank documents against unauthorized access. We do not sell your personal data to third parties.</p>
      <h3>4. Account Details & Modification Rights</h3>
      <p>You can update or delete your profile via app settings. If you need to change your registered bank account details, please contact our support executive at <a href="mailto:me24with@gmail.com">me24with@gmail.com</a>.</p>
      <h3>5. Contact & Support</h3>
      <p>For support or privacy inquiries, email us at <a href="mailto:me24with@gmail.com">me24with@gmail.com</a>.</p>
    </div>
  `
};

// GET /meta/privacy-policy and GET /privacy-policy
router.get(['/privacy-policy', '/privacy'], (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Success",
    data: PRIVACY_POLICY
  });
});

module.exports = router;
