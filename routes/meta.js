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

module.exports = router;
