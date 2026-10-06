const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const metaRoutes = require('./routes/meta');
const partnerRoutes = require('./routes/partner');
const documentRoutes = require('./routes/documents');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notification');
const { initChatSocket } = require('./sockets/chatSocket');

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.IO with existing HTTP Server
const io = initChatSocket(server);
app.set('io', io);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Register routes
app.use('/api/notification', notificationRoutes);
app.use('/notification', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/chat', chatRoutes);
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/meta', metaRoutes);
app.use('/partner', partnerRoutes);
app.use('/documents', documentRoutes);
app.use('/', authRoutes);
app.use('/', profileRoutes);
app.use('/', metaRoutes);
app.use('/', partnerRoutes);
app.get(['/privacy-policy', '/privacy'], (req, res) => {
  res.redirect('/meta/privacy-policy');
});
app.get(['/support', '/contact', '/help'], (req, res) => {
  res.redirect('/meta/support');
});
app.get(['/child-safety', '/child-safety-standards', '/child-safety-policy', '/childsafety'], (req, res) => {
  res.redirect('/meta/child-safety');
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

const { users } = require('./store/db');
const { syncAllPartnersToUserApp } = require('./services/userAppSyncService');

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Partner App API server running at http://localhost:${PORT}`);
    // Auto-sync all stored partners to User App backend on startup
    syncAllPartnersToUserApp(Array.from(users.values())).catch(err => {
      console.warn("Startup partner sync error:", err.message);
    });
  });
}

module.exports = app;
module.exports.server = server;

