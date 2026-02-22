/**
 * PaperLens Server
 * Main server entry point
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const generateRoute = require('./routes/generate');
const analyzeRoute = require('./routes/analyze');
const healthRoute = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/generate', generateRoute);
app.use('/analyze', analyzeRoute);
app.use('/health', healthRoute);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'PaperLens API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      generate: '/generate',
      analyze: '/analyze',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] PaperLens API running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  
  // Validate environment variables
  if (!process.env.NAPKIN_TOKEN) {
    console.warn('[Server] WARNING: NAPKIN_TOKEN not set');
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[Server] WARNING: OPENAI_API_KEY not set');
  }
});

module.exports = app;
