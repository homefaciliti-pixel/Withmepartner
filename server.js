const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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

// Render Ephemeral Disk Fallback: restore uploaded file from MySQL backup if missing from local disk
app.use('/uploads', async (req, res, next) => {
  const relPath = req.path.replace(/^\//, '').split('?')[0];
  const filename = path.basename(relPath);
  if (filename) {
    try {
      const { getDbPool } = require('./config/database');
      const db = getDbPool();
      if (db && typeof db.query === 'function') {
        const [rows] = await db.query('SELECT mimetype, data FROM withme_uploaded_files WHERE filename = ? LIMIT 1', [filename]);
        if (rows && rows.length > 0) {
          const fileRow = rows[0];
          try {
            const targetDir = path.join(__dirname, 'uploads', path.dirname(relPath));
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(__dirname, 'uploads', relPath), fileRow.data);
          } catch (_) {}
          res.setHeader('Content-Type', fileRow.mimetype || 'image/jpeg');
          return res.status(200).send(fileRow.data);
        }
      }
    } catch (e) {
      console.warn('[Upload DB Restore Warning]:', e.message);
    }
  }
  return res.status(404).send('Not Found');
});

// Register routes
app.use('/api/notifications', notificationRoutes);
app.use('/notifications', notificationRoutes);
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
app.get(['/terms-conditions', '/termsandconditions', '/t-and-c'], (req, res) => {
  res.redirect('/meta/terms-and-conditions');
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

const { fetchUsersFromMysql } = require('./config/database');
const { syncAllPartnersToUserApp } = require('./services/userAppSyncService');

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Partner App API server running at http://localhost:${PORT}`);
    // Auto-sync all stored partners to User App backend on startup
    fetchUsersFromMysql().then(partners => {
      if (partners && partners.length > 0) {
        syncAllPartnersToUserApp(partners).catch(err => {
          console.warn("Startup partner sync error:", err.message);
        });
      }
    }).catch(err => {
      console.warn("Startup fetch partners error:", err.message);
    });
  });
}

module.exports = app;
module.exports.server = server;

