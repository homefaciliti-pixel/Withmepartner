const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Store surrendered documents in-memory
const surrenderDeeds = new Map();

// 1. Get Surrender Deed Form Template / Info
router.get('/surrender-deed/template', (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      document_title: "संयुक्त बिल्डकॉन प्रा. लि. जयपुर - समर्पण कर्ता",
      fields: [
        { name: "date", type: "date", label: "दिनांक", required: true },
        { name: "surrenderor_name", type: "text", label: "समर्पण कर्ता (नाम)", required: true },
        { name: "father_name", type: "text", label: "पुत्र श्री", required: true },
        { name: "resident_address", type: "text", label: "निवासी", required: true },
        { name: "scheme_name", type: "text", label: "संयुक्त बिल्डकॉन प्रा. लि. जयपुर की योजना", required: true },
        { name: "plot_size_sqyard", type: "number", label: "वर्ग गज", required: true },
        { name: "plot_number", type: "text", label: "प्लाट संख्या", required: true },
        { name: "witness_1", type: "text", label: "गवाह 1", required: true },
        { name: "witness_2", type: "text", label: "गवाह 2", required: true }
      ]
    }
  });
});

// 2. Submit Surrender Deed Document Form
router.post('/surrender-deed', authenticateToken, (req, res) => {
  const {
    date,
    surrenderor_name,
    father_name,
    resident_address,
    scheme_name,
    plot_size_sqyard,
    plot_number,
    witness_1,
    witness_2
  } = req.body;

  if (!surrenderor_name || !scheme_name || !plot_number) {
    return res.status(400).json({
      status: false,
      message: "Surrenderor name, scheme name and plot number are required",
      error_code: "INVALID_DOCUMENT_DATA"
    });
  }

  const document_id = `surr_${Math.floor(10000 + Math.random() * 90000)}`;
  const record = {
    document_id,
    user_id: req.user.user_id,
    date: date || new Date().toISOString().split('T')[0],
    company_name: "संयुक्त बिल्डकॉन प्रा. लि. जयपुर",
    document_type: "समर्पण कर्ता",
    surrenderor_name,
    father_name,
    resident_address,
    scheme_name,
    plot_size_sqyard,
    plot_number,
    witness_1: witness_1 || "",
    witness_2: witness_2 || "",
    status: "SUBMITTED",
    submitted_at: new Date().toISOString()
  };

  surrenderDeeds.set(document_id, record);

  return res.status(201).json({
    status: true,
    message: "Surrender deed document submitted successfully",
    data: record
  });
});

// 3. Get Surrender Deed Status / Document Detail
router.get('/surrender-deed/:document_id', authenticateToken, (req, res) => {
  const { document_id } = req.params;
  const doc = surrenderDeeds.get(document_id);

  if (!doc) {
    return res.status(404).json({
      status: false,
      message: "Document not found",
      error_code: "DOCUMENT_NOT_FOUND"
    });
  }

  return res.status(200).json({
    status: true,
    message: "Success",
    data: doc
  });
});

module.exports = router;
