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
  app_name: "WITHME24",
  effective_date: "2026-10-08",
  last_updated: "2026-10-08",
  support_email: "officalwithme24@withme24.com",
  contact_email: "officalwithme24@withme24.com",
  phone_number: "8209343434",
  website: "https://withme24.com",
  sections: [
    {
      id: 1,
      title: "1. Information We Collect",
      content: "Depending on how you use the Platform, we may collect Account Information (Full name, mobile number, email address, DOB/age, gender, profile photo, password/auth info), Profile Information (Bio, interests, preferences, profile photos, location info), Booking Information (Host info, experience details, date, time, location, participants count, status, transaction details), Location Information (To show relevant hosts/experiences & support bookings), Device and Technical Information (Device type, OS, app version, IP address, crash diagnostics)."
    },
    {
      id: 2,
      title: "2. How We Use Your Information",
      content: "We use your information to create and manage your account, authenticate identity, provide services, display profiles and experiences, process bookings, send confirmations and notifications, provide support, prevent fraud/abuse, maintain security, resolve disputes, and comply with legal requirements."
    },
    {
      id: 3,
      title: "3. Sharing of Information",
      content: "We share relevant information (Name, photo, profile info, booking details, date, time, location) with hosts/partners to facilitate bookings. We may also share data with technology/infrastructure providers, payment service providers, security providers, or law enforcement when legally required. We do not sell personal information to third parties."
    },
    {
      id: 4,
      title: "4. Payment Information",
      content: "Where payment services are used, transaction details (Transaction ID, status, amount, date, booking ref) are processed by authorized payment service providers. WITHME24 does not store complete card numbers, CVV, or sensitive credentials on its servers. (Testing environments may use a mock/static payment flow)."
    },
    {
      id: 5,
      title: "5. Communications and Notifications",
      content: "WITHME24 sends notifications for login/verification, booking requests, confirmations, updates, account security, and service announcements. Manage permissions in device settings."
    },
    {
      id: 6,
      title: "6. User-Generated Content",
      content: "Users may upload profile photos, bios, interests, and reviews. Users are responsible for ensuring content is lawful and non-infringing. We reserve the right to remove content violating terms or safety policies."
    },
    {
      id: 7,
      title: "7. Safety and Prohibited Activities",
      content: "WITHME24 is intended for legitimate social interactions. The platform prohibits human trafficking, exploitation, sexual exploitation, illegal services, criminal activity, harassment, fraud, and impersonation. Violators are subject to account suspension/termination and legal reporting."
    },
    {
      id: 8,
      title: "8. Data Security",
      content: "We use reasonable technical and organizational measures to protect personal information against unauthorized access, loss, misuse, alteration, disclosure, or destruction."
    },
    {
      id: 9,
      title: "9. Data Retention",
      content: "We retain personal information as long as necessary for service provision, record keeping, fraud prevention, dispute resolution, and legal compliance."
    },
    {
      id: 10,
      title: "10. Account Deletion",
      content: "Users may request account deletion through the app or by contacting support. Certain info may be retained for legal/security purposes."
    },
    {
      id: 11,
      title: "11. Children's Privacy",
      content: "WITHME24 is intended for users aged 18 years and above. We do not knowingly permit individuals under 18 to create or use accounts on the Platform. Underage accounts will be suspended or deleted."
    },
    {
      id: 12,
      title: "12. Third-Party Services",
      content: "We use third-party providers for hosting, authentication, notifications, analytics, payments, and security, processing data as permitted by law."
    },
    {
      id: 13,
      title: "13. Your Rights",
      content: "You have rights to access, correct, or request deletion of your personal info, or withdraw consent. Contact support to exercise rights."
    },
    {
      id: 14,
      title: "14. Changes to This Privacy Policy",
      content: "We may update this Privacy Policy from time to time. Material updates will be notified via the Platform."
    },
    {
      id: 15,
      title: "15. Contact Us",
      content: "WITHME24 | Email: officalwithme24@withme24.com | Phone: 8209343434 | Address: Jaipur, Rajasthan, India"
    }
  ],
  raw_text: `WITHME24 — Privacy Policy
Last Updated: 08 Oct 2026

WITHME24 ("we", "us", "our") operates the WITHME24 mobile application and related services (collectively, the "Platform"). WITHME24 is an experience-based platform that allows users to discover hosts and experiences, view experience details, select dates and times, and make bookings.

This Privacy Policy explains how we collect, use, store, disclose, and protect personal information when you use WITHME24.
By using WITHME24, you agree to the practices described in this Privacy Policy.

1. Information We Collect
Depending on how you use the Platform, we may collect the following information:
Account Information: Full name, Mobile number, Email address, Date of birth/age, Gender, Profile photograph, Password or authentication-related information.
Profile Information: Bio/about information, Interests, Preferences, Profile photographs, Location information.
Booking Information: Host information, Experience/event information, Booking date, Booking time, Location, Number of participants, Booking status, Transaction/payment-related information, Booking history.
Location Information: Show relevant hosts or experiences, Provide location-related information, Support booking and experience locations, Improve Platform relevance.
Device and Technical Information: Device type, Operating system, App version, IP address, Device identifiers, Crash and diagnostic information, Log information.

2. How We Use Your Information
Create and manage account, Authenticate identity, Provide services, Display profiles/experiences, Process & manage bookings, Send notifications, Customer support, Platform improvement, Fraud detection, Safety & compliance.

3. Sharing of Information
Shared with host/partner to facilitate bookings (Name, photo, profile info, booking details, date, time, location). Also shared with tech/hosting providers, payment gateways, or law enforcement when required. We do not sell personal data.

4. Payment Information
Processed by authorized payment service providers. WITHME24 receives transaction ID, status, amount, and date. Sensitive card details are not stored on our servers.

5. Communications and Notifications
Notifications sent for login/verification, booking requests, confirmations, security, and announcements.

6. User-Generated Content
Users are responsible for uploaded photos, bios, and reviews. Illegal or violating content will be removed.

7. Safety and Prohibited Activities
Strictly prohibits trafficking, exploitation, illegal services, harassment, fraud, and impersonation. Violations lead to immediate termination.

8. Data Security
Technical and organizational security measures are deployed to safeguard personal information.

9. Data Retention
Data is retained as necessary for services, legal compliance, and security.

10. Account Deletion
Account deletion can be requested in-app or via support (officalwithme24@withme24.com).

11. Children's Privacy
WITHME24 is intended for users aged 18 years and above. Underage accounts will be terminated.

12. Third-Party Services
Third-party integrations (hosting, payments, notifications, analytics) operate under strict privacy compliance.

13. Your Rights
Users have rights to access, update, correct, or delete personal data.

14. Changes to This Privacy Policy
Updates will be published with an updated effective date on the Platform.

15. Contact Us
WITHME24 | Email: officalwithme24@withme24.com | Phone: 8209343434 | Location: Jaipur, Rajasthan, India`,
  html_content: `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
      <h1 style="color: #111;">WITHME24 — Privacy Policy</h1>
      <p style="font-size: 14px; color: #666;"><strong>Last Updated:</strong> 08 Oct 2026</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      
      <p>WITHME24 ("we", "us", "our") operates the WITHME24 mobile application and related services (collectively, the "Platform"). WITHME24 is an experience-based platform that allows users to discover hosts and experiences, view experience details, select dates and times, and make bookings.</p>
      <p>This Privacy Policy explains how we collect, use, store, disclose, and protect personal information when you use WITHME24. By using WITHME24, you agree to the practices described in this Privacy Policy.</p>
      
      <h3>1. Information We Collect</h3>
      <ul>
        <li><strong>Account Information:</strong> Full name, mobile number, email address, date of birth/age, gender, profile photo.</li>
        <li><strong>Profile Information:</strong> Bio, interests, preferences, location.</li>
        <li><strong>Booking Information:</strong> Host info, experience, date, time, location, booking status, transaction info.</li>
        <li><strong>Location Information:</strong> Used to display nearby hosts and experiences.</li>
        <li><strong>Device & Technical Info:</strong> Device type, OS, IP address, app version, diagnostics.</li>
      </ul>

      <h3>2. How We Use Your Information</h3>
      <p>To create/manage accounts, process bookings, send notifications, provide support, prevent fraud, and comply with applicable laws.</p>

      <h3>3. Sharing of Information</h3>
      <p>Necessary booking details (Name, photo, time, location) are shared with the host/partner. We do not sell your personal information.</p>

      <h3>4. Payment Information</h3>
      <p>Processed securely via authorized payment gateways. WITHME24 does not store raw credit card or CVV details on its servers.</p>

      <h3>5. Communications and Notifications</h3>
      <p>Notifications are sent for login verification, booking requests, confirmations, and security alerts.</p>

      <h3>6. User-Generated Content</h3>
      <p>Users are responsible for uploaded photos and bios. Non-compliant content will be removed.</p>

      <h3>7. Safety and Prohibited Activities</h3>
      <p>Prohibits illegal services, exploitation, harassment, and fraud. Zero tolerance policy enforced with account suspension.</p>

      <h3>8. Data Security</h3>
      <p>We implement technical and organizational measures designed to protect your personal information.</p>

      <h3>9. Data Retention</h3>
      <p>Personal data is retained only as long as necessary for service delivery, legal, and security requirements.</p>

      <h3>10. Account Deletion</h3>
      <p>You can request account deletion in app settings or by emailing <a href="mailto:officalwithme24@withme24.com">officalwithme24@withme24.com</a>.</p>

      <h3>11. Children's Privacy</h3>
      <p><strong>WITHME24 is intended for users aged 18 years and above.</strong> Underage accounts will be terminated.</p>

      <h3>12. Third-Party Services</h3>
      <p>Trusted third-party services (hosting, push notifications, analytics) process data securely.</p>

      <h3>13. Your Rights</h3>
      <p>You have the right to access, edit, or delete your personal data.</p>

      <h3>14. Changes to This Privacy Policy</h3>
      <p>Updates will be posted directly on this page.</p>

      <h3>15. Contact Us</h3>
      <p><strong>WITHME24</strong><br>Email: <a href="mailto:officalwithme24@withme24.com">officalwithme24@withme24.com</a><br>Phone: 8209343434<br>Address: Jaipur, Rajasthan, India</p>
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

// Meta Support Dataset
const SUPPORT_DATA = {
  app_name: "WithMe Partner App",
  title: "Customer Support & Executive Helpdesk",
  support_email: "officalwithme24@withme24.com",
  email: "officalwithme24@withme24.com",
  contact_email: "officalwithme24@withme24.com",
  phone_number: "8209343434",
  mobile_number: "8209343434",
  helpline_number: "+91 8209343434",
  whatsapp_number: "+91 8209343434",
  working_hours: "10:00 AM - 07:00 PM (Monday to Saturday)",
  address: "Jaipur, Rajasthan, India",
  description: "If you have any questions, need to update your bank account details, or require account assistance, please contact our support executive.",
  support_note: "Please fill all the details carefully. If you need to change your account details and add new account details, please contact our support executive via Mail: officalwithme24@withme24.com or Phone: 8209343434"
};

// GET /meta/support and GET /support
router.get(['/support', '/contact', '/help'], (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Success",
    data: SUPPORT_DATA
  });
});

// Child Safety Standards Dataset
const CHILD_SAFETY_STANDARDS = {
  title: "Child Safety Standards",
  app_name: "WithMe24",
  last_updated: "September 26, 2026",
  contact_email: "officalwithme24@withme24.com",
  minimum_age: 18,
  sections: [
    {
      id: 1,
      title: "1. Adults Only",
      content: "WithMe24 is strictly intended for users who are 18 years of age or older. Users under the age of 18 are not permitted to register, create an account, or use WithMe24."
    },
    {
      id: 2,
      title: "2. Child Safety",
      content: "WithMe24 has zero tolerance for child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM). We do not permit any content, behavior, or activity that sexually exploits or endangers children."
    },
    {
      id: 3,
      title: "3. Reporting",
      content: "Users can report inappropriate or abusive content or behavior through the reporting functionality available in the WithMe24 application. Reports involving child safety are taken seriously and may result in content removal, account suspension, or account termination."
    },
    {
      id: 4,
      title: "4. Enforcement",
      content: "WithMe24 may take appropriate action against accounts that violate our safety standards, including removing content and suspending or permanently terminating accounts."
    },
    {
      id: 5,
      title: "5. Contact",
      content: "For child-safety concerns or to report suspected child sexual exploitation, please contact us at Email: officalwithme24@withme24.com. We review child-safety reports and take appropriate action in accordance with applicable laws and platform requirements."
    },
    {
      id: 6,
      title: "6. Age Restriction",
      content: "WithMe24 is an 18+ service. Individuals under 18 are not eligible to use the service."
    }
  ],
  html_content: `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
      <h1 style="color: #111;">WithMe24 — Child Safety Standards</h1>
      <p style="font-size: 14px; color: #666;"><strong>Last Updated:</strong> September 26, 2026</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <h3>1. Adults Only</h3>
      <p>WithMe24 is strictly intended for users who are <strong>18 years of age or older</strong>. Users under the age of 18 are <strong>not permitted to register, create an account, or use WithMe24</strong>.</p>
      <h3>2. Child Safety</h3>
      <p>WithMe24 has zero tolerance for child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM). We do not permit any content, behavior, or activity that sexually exploits or endangers children.</p>
      <h3>3. Reporting</h3>
      <p>Users can report inappropriate or abusive content or behavior through the reporting functionality available in the WithMe24 application. Reports involving child safety are taken seriously and may result in content removal, account suspension, or account termination.</p>
      <h3>4. Enforcement</h3>
      <p>WithMe24 may take appropriate action against accounts that violate our safety standards, including removing content and suspending or permanently terminating accounts.</p>
      <h3>5. Contact</h3>
      <p>For child-safety concerns or to report suspected child sexual exploitation, please contact us at: <a href="mailto:officalwithme24@withme24.com">officalwithme24@withme24.com</a>. We review child-safety reports and take appropriate action in accordance with applicable laws and platform requirements.</p>
      <h3>6. Age Restriction</h3>
      <p>WithMe24 is an <strong>18+ service</strong>. Individuals under 18 are not eligible to use the service.</p>
    </div>
  `
};

// GET /meta/child-safety, GET /child-safety, GET /child-safety-standards
router.get(['/child-safety', '/child-safety-standards', '/childsafety'], (req, res) => {
  if (req.query && (req.query.format === 'html' || req.query.view === 'web' || req.headers.accept?.includes('text/html'))) {
    return res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WithMe24 — Child Safety Standards</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #222; max-width: 800px; margin: 0 auto; padding: 24px; background: #fafafa; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #eaeaea; }
    h1 { color: #111; margin-top: 0; font-size: 26px; border-bottom: 2px solid #f0f0f0; padding-bottom: 12px; }
    h3 { color: #222; margin-top: 24px; font-size: 18px; }
    p { margin: 8px 0 16px; color: #444; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">18+ Only Platform</span>
    ${CHILD_SAFETY_STANDARDS.html_content}
  </div>
</body>
</html>`);
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: CHILD_SAFETY_STANDARDS
  });
});

// GET /child-safety.html web page view
router.get(['/child-safety.html', '/child-safety-page'], (req, res) => {
  return res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WithMe24 — Child Safety Standards</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #222; max-width: 800px; margin: 0 auto; padding: 24px; background: #fafafa; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #eaeaea; }
    h1 { color: #111; margin-top: 0; font-size: 26px; border-bottom: 2px solid #f0f0f0; padding-bottom: 12px; }
    h3 { color: #222; margin-top: 24px; font-size: 18px; }
    p { margin: 8px 0 16px; color: #444; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">18+ Only Platform</span>
    ${CHILD_SAFETY_STANDARDS.html_content}
  </div>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Terms & Conditions Dataset
// ─────────────────────────────────────────────────────────────────────────────
const TERMS_AND_CONDITIONS = {
  title: "Terms & Conditions",
  app_name: "WITHME24",
  effective_date: "2026-10-08",
  last_updated: "2026-10-08",
  support_email: "officalwithme24@withme24.com",
  contact_email: "officalwithme24@withme24.com",
  phone_number: "8209343434",
  website: "https://withme24.com",
  sections: [
    {
      id: 1,
      title: "1. About WITHME24",
      content: "WITHME24 is an experience-based platform that allows users to discover hosts and experiences, view experience information, select available dates and times, and make bookings. Hosts/partners may list and provide experiences through the Platform. WITHME24 provides the technology platform connecting users and hosts."
    },
    {
      id: 2,
      title: "2. Eligibility",
      content: "You must be at least 18 years old to create an account or use WITHME24. You are responsible for providing accurate information about your age and identity."
    },
    {
      id: 3,
      title: "3. Account Registration",
      content: "When creating an account, you agree to provide accurate information, provide a valid mobile number/email where required, keep your account information updated, protect your login credentials, not share your account with another person, and not impersonate another person. You are responsible for activity conducted through your account."
    },
    {
      id: 4,
      title: "4. Profile Information",
      content: "Users and hosts may create profiles containing information such as name, photograph, age, location, bio, interests, and experience information. You agree that information you provide must be accurate and must not intentionally mislead other users."
    },
    {
      id: 5,
      title: "5. Host and Experience Listings",
      content: "Hosts may provide information about their experiences, including experience title, description, location, date/time availability, pricing, participant limits, and other relevant information. Hosts are responsible for ensuring that their listings are accurate and lawful. WITHME24 may remove or restrict listings that violate these Terms or applicable law."
    },
    {
      id: 6,
      title: "6. Booking Process",
      content: "The general booking flow may include: Host/Event → Experience Details → Date/Time → Location → Participants → Booking → Payment → Confirmation. Availability and booking confirmation may depend on the information displayed at the time of booking. Users should review booking information before confirming a booking."
    },
    {
      id: 7,
      title: "7. Payment",
      content: "Where payments are enabled, users may be required to pay the applicable amount shown during the booking process. Payment status may be displayed in the application. The current version of WITHME24 may display a mock/static payment flow for testing purposes. Such mock transactions do not represent actual payments or financial transactions."
    },
    {
      id: 8,
      title: "8. Cancellation and Refunds",
      content: "Cancellation and refund eligibility, where applicable, will depend on the booking terms displayed at the time of booking. WITHME24 may establish specific cancellation/refund rules for different experiences. Any applicable refund will be processed according to the applicable policy and payment provider rules."
    },
    {
      id: 9,
      title: "9. User Conduct",
      content: "You agree not to harass, threaten, abuse, or intimidate others; create fake accounts; impersonate another person; provide fraudulent information; scam or defraud another user; upload illegal content; attempt unauthorized access to the Platform; misuse another user's personal information; circumvent Platform security; or use the Platform for unlawful purposes."
    },
    {
      id: 10,
      title: "10. Strictly Prohibited Activities",
      content: "WITHME24 strictly prohibits using the Platform to facilitate or promote: human trafficking, child exploitation, sexual exploitation, prostitution or sexual services, forced labor, criminal activities, illegal services, fraud or scams, sale or distribution of illegal goods, threats or violence, or other activities prohibited under applicable law. Any account involved in such activities may be immediately suspended or terminated. Where required by law, information may be provided to appropriate authorities."
    },
    {
      id: 11,
      title: "11. Safety",
      content: "Users are responsible for exercising reasonable judgment when interacting with other users or attending an experience. Users should meet at appropriate/public locations, follow applicable safety instructions, avoid sharing unnecessary sensitive information, report suspicious or unsafe behavior, and contact appropriate emergency services in an emergency. WITHME24 is not a replacement for emergency services or law enforcement."
    },
    {
      id: 12,
      title: "12. Reporting and Blocking",
      content: "Where these features are available, users may report or block other users or content that violates these Terms. Reports may be reviewed and appropriate action may include content removal, account restrictions, account suspension, account termination, or referral to appropriate authorities where legally required."
    },
    {
      id: 13,
      title: "13. Intellectual Property",
      content: "The WITHME24 name, logo, software, design, graphics, trademarks, and other platform materials are owned by or licensed to WITHME24 unless otherwise stated. You may not copy, reproduce, modify, distribute, or commercially exploit these materials without authorization."
    },
    {
      id: 14,
      title: "14. User Content",
      content: "You retain responsibility for content you submit to WITHME24. By submitting content, you confirm that you have the necessary rights to submit it, it does not violate applicable law, it does not infringe another person's rights, and it does not contain prohibited or abusive material. You grant WITHME24 the limited rights necessary to host, display, process, and provide the content as part of the Platform."
    },
    {
      id: 15,
      title: "15. Privacy",
      content: "Your use of WITHME24 is also governed by our Privacy Policy. The Privacy Policy explains how we collect and process personal information."
    },
    {
      id: 16,
      title: "16. Account Suspension and Termination",
      content: "WITHME24 may suspend, restrict, or terminate an account if the user violates these Terms, provides false information, engages in fraudulent activity, creates a safety risk, uses the Platform for illegal activity, abuses another user, or as required by law. Users may also request account deletion."
    },
    {
      id: 17,
      title: "17. Availability of the Platform",
      content: "We aim to keep WITHME24 available and functional, but we do not guarantee uninterrupted availability. The Platform may occasionally be unavailable because of maintenance, updates, technical issues, network problems, third-party service failures, security incidents, or events outside our reasonable control."
    },
    {
      id: 18,
      title: "18. Third-Party Services",
      content: "WITHME24 may integrate third-party services such as payment providers, hosting providers, analytics services, maps, notifications, or authentication services. Third-party services may have their own terms and privacy policies."
    },
    {
      id: 19,
      title: "19. Limitation of Liability",
      content: "To the extent permitted by applicable law, WITHME24 will not be responsible for losses resulting from circumstances beyond our reasonable control or from a user's violation of these Terms. Nothing in these Terms is intended to exclude liability that cannot legally be excluded under applicable law."
    },
    {
      id: 20,
      title: "20. Changes to These Terms",
      content: "We may update these Terms from time to time. Updated Terms will be published through the Platform or our website. Your continued use of WITHME24 after updated Terms become effective means that you accept the updated Terms, subject to applicable law."
    },
    {
      id: 21,
      title: "21. Governing Law",
      content: "These Terms shall be governed by the applicable laws of India. Any disputes shall be subject to the jurisdiction of the courts having appropriate jurisdiction, subject to applicable law."
    },
    {
      id: 22,
      title: "22. Contact Us",
      content: "WITHME24 | Email: officalwithme24@withme24.com | Phone: 8209343434 | Address: Jaipur, Rajasthan, India"
    }
  ],
  raw_text: `WITHME24 — Terms & Conditions
Last Updated: 08 Oct 2026

Welcome to WITHME24.
These Terms & Conditions ("Terms") govern your access to and use of the WITHME24 application and related services.
By creating an account or using WITHME24, you agree to these Terms.
If you do not agree with these Terms, please do not use the Platform.

1. About WITHME24
WITHME24 is an experience-based platform that allows users to discover hosts and experiences, view experience information, select available dates and times, and make bookings. Hosts/partners may list and provide experiences through the Platform. WITHME24 provides the technology platform connecting users and hosts.

2. Eligibility
You must be at least 18 years old to create an account or use WITHME24. You are responsible for providing accurate information about your age and identity.

3. Account Registration
When creating an account, you agree to: Provide accurate information, provide a valid mobile number/email where required, keep your account information updated, protect your login credentials, not share your account with another person, and not impersonate another person. You are responsible for activity conducted through your account.

4. Profile Information
Users and hosts may create profiles containing information such as: Name, Photograph, Age, Location, Bio, Interests, Experience information. You agree that information you provide must be accurate and must not intentionally mislead other users.

5. Host and Experience Listings
Hosts may provide information about their experiences, including: Experience title, Description, Location, Date/time availability, Pricing, Participant limits, Other relevant information. Hosts are responsible for ensuring listings are accurate and lawful. WITHME24 may remove or restrict listings that violate these Terms or applicable law.

6. Booking Process
The general booking flow may include: Host/Event → Experience Details → Date/Time → Location → Participants → Booking → Payment → Confirmation. Availability and booking confirmation depend on the information displayed at the time of booking.

7. Payment
Where payments are enabled, users may be required to pay the applicable amount shown during the booking process. The current version of WITHME24 may display a mock/static payment flow for testing purposes.

8. Cancellation and Refunds
Cancellation and refund eligibility will depend on the booking terms displayed at the time of booking. WITHME24 may establish specific cancellation/refund rules for different experiences.

9. User Conduct
You agree not to: harass, threaten, or intimidate others; create fake accounts; impersonate another person; provide fraudulent information; scam or defraud another user; upload illegal content; attempt unauthorized access; misuse personal information; circumvent security; or use the Platform for unlawful purposes.

10. Strictly Prohibited Activities
WITHME24 strictly prohibits: Human trafficking, child exploitation, sexual exploitation, prostitution or sexual services, forced labor, criminal activities, illegal services, fraud, sale of illegal goods, threats or violence. Violating accounts are immediately terminated. Information may be shared with authorities as required.

11. Safety
Users should exercise reasonable judgment. Meet at public locations, follow safety instructions, avoid sharing sensitive information, report suspicious behavior, and contact emergency services in emergencies.

12. Reporting and Blocking
Users may report or block violators. Action may include content removal, account restriction, suspension, termination, or legal referral.

13. Intellectual Property
The WITHME24 name, logo, software, design, and materials are owned by or licensed to WITHME24. Unauthorized copying, reproduction, or commercial exploitation is prohibited.

14. User Content
Users retain responsibility for submitted content. By submitting, you confirm you have rights, content is lawful, and does not contain prohibited material. You grant WITHME24 limited rights to host/display content on the Platform.

15. Privacy
Your use is governed by our Privacy Policy explaining how we collect and process personal information.

16. Account Suspension and Termination
Accounts may be suspended or terminated for violating Terms, fraudulent activity, safety risks, illegal activity, or as required by law. Users may also request account deletion.

17. Availability of the Platform
We aim for continuous availability but do not guarantee uninterrupted service. Downtime may occur due to maintenance, updates, technical issues, or force majeure.

18. Third-Party Services
WITHME24 may integrate third-party services (payments, hosting, analytics, maps, notifications, authentication). These have their own terms and privacy policies.

19. Limitation of Liability
To the extent permitted by law, WITHME24 is not responsible for losses from circumstances beyond reasonable control or user violations of these Terms.

20. Changes to These Terms
Terms may be updated from time to time and published through the Platform. Continued use implies acceptance.

21. Governing Law
Governed by the laws of India. Disputes subject to appropriate Indian court jurisdiction.

22. Contact Us
WITHME24 | Email: officalwithme24@withme24.com | Phone: 8209343434 | Address: Jaipur, Rajasthan, India`,
  html_content: `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333;">
      <h1 style="color: #111;">WITHME24 — Terms & Conditions</h1>
      <p style="font-size: 14px; color: #666;"><strong>Last Updated:</strong> 08 Oct 2026</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />

      <p>Welcome to WITHME24. These Terms & Conditions ("Terms") govern your access to and use of the WITHME24 application and related services. By creating an account or using WITHME24, you agree to these Terms. If you do not agree, please do not use the Platform.</p>

      <h3>1. About WITHME24</h3>
      <p>WITHME24 is an experience-based platform connecting users with hosts and experiences — allowing discovery, date/time selection, and bookings.</p>

      <h3>2. Eligibility</h3>
      <p><strong>You must be at least 18 years old</strong> to create an account or use WITHME24.</p>

      <h3>3. Account Registration</h3>
      <p>You agree to provide accurate information, keep credentials secure, and not share or impersonate accounts.</p>

      <h3>4. Profile Information</h3>
      <p>Profiles may contain name, photo, age, location, bio, interests, and experience info. All information must be accurate.</p>

      <h3>5. Host and Experience Listings</h3>
      <p>Hosts list experiences with title, description, location, pricing, and availability. Hosts must ensure listings are accurate and lawful.</p>

      <h3>6. Booking Process</h3>
      <p>Flow: Host/Event → Details → Date/Time → Location → Participants → Booking → Payment → Confirmation.</p>

      <h3>7. Payment</h3>
      <p>Users pay the amount shown during booking. The current version may use a mock/static payment flow for testing purposes.</p>

      <h3>8. Cancellation and Refunds</h3>
      <p>Cancellation/refund terms depend on the booking terms displayed. Refunds are processed per applicable policy.</p>

      <h3>9. User Conduct</h3>
      <p>Users must not harass, impersonate, defraud, upload illegal content, or misuse the Platform in any way.</p>

      <h3>10. Strictly Prohibited Activities</h3>
      <p><strong>Zero tolerance</strong> for human trafficking, child/sexual exploitation, prostitution, forced labor, fraud, illegal goods, threats, or violence. Violating accounts are immediately terminated.</p>

      <h3>11. Safety</h3>
      <p>Exercise reasonable judgment. Meet in public, follow safety instructions, report suspicious behavior, and contact emergency services when needed.</p>

      <h3>12. Reporting and Blocking</h3>
      <p>Users may report or block violators. Action includes content removal, suspension, termination, or legal referral.</p>

      <h3>13. Intellectual Property</h3>
      <p>All WITHME24 branding, software, and materials are owned/licensed. Unauthorized use is prohibited.</p>

      <h3>14. User Content</h3>
      <p>Users are responsible for submitted content. You grant WITHME24 limited display rights on the Platform.</p>

      <h3>15. Privacy</h3>
      <p>Your use is governed by our <strong>Privacy Policy</strong>.</p>

      <h3>16. Account Suspension and Termination</h3>
      <p>Accounts may be suspended for Terms violations, fraud, safety risks, illegal activity, or by legal process.</p>

      <h3>17. Availability of the Platform</h3>
      <p>We aim for continuous availability but cannot guarantee uninterrupted service.</p>

      <h3>18. Third-Party Services</h3>
      <p>Third-party integrations (payments, hosting, notifications) have their own terms and policies.</p>

      <h3>19. Limitation of Liability</h3>
      <p>WITHME24 is not liable for losses from circumstances beyond reasonable control, subject to applicable law.</p>

      <h3>20. Changes to These Terms</h3>
      <p>Updates will be published on the Platform. Continued use implies acceptance.</p>

      <h3>21. Governing Law</h3>
      <p>Governed by the laws of India. Disputes subject to appropriate Indian court jurisdiction.</p>

      <h3>22. Contact Us</h3>
      <p><strong>WITHME24</strong><br>Email: <a href="mailto:officalwithme24@withme24.com">officalwithme24@withme24.com</a><br>Phone: 8209343434<br>Address: Jaipur, Rajasthan, India</p>
    </div>
  `
};

// GET /meta/terms-and-conditions, GET /meta/terms, GET /terms-and-conditions, GET /terms
router.get(['/terms-and-conditions', '/terms', '/tnc'], (req, res) => {
  if (req.query && (req.query.format === 'html' || req.query.view === 'web' || req.headers.accept?.includes('text/html'))) {
    return res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WITHME24 — Terms & Conditions</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #222; max-width: 800px; margin: 0 auto; padding: 24px; background: #fafafa; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #eaeaea; }
    h1 { color: #111; margin-top: 0; font-size: 26px; border-bottom: 2px solid #f0f0f0; padding-bottom: 12px; }
    h3 { color: #222; margin-top: 24px; font-size: 18px; }
    p { margin: 8px 0 16px; color: #444; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">WITHME24 Legal</span>
    ${TERMS_AND_CONDITIONS.html_content}
  </div>
</body>
</html>`);
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: TERMS_AND_CONDITIONS
  });
});

module.exports = router;
