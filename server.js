const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const metaRoutes = require('./routes/meta');
const partnerRoutes = require('./routes/partner');
const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Register routes
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/meta', metaRoutes);
app.use('/partner', partnerRoutes);
app.use('/documents', documentRoutes);
app.get(['/privacy-policy', '/privacy'], (req, res) => {
  res.redirect('/meta/privacy-policy');
});

// Root route
app.get('/', (req, res) => {
  res.json({
    status: true,
    message: "Partner App API Server is running",
    version: "1.0.0"
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: `Endpoint ${req.method} ${req.url} not found`,
    error_code: "NOT_FOUND"
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Internal Server Error:", err);
  res.status(500).json({
    status: false,
    message: err.message || "Internal server error",
    error_code: "INTERNAL_SERVER_ERROR"
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Partner App API server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
