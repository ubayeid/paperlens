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
const server = app.listen(PORT, () => {
  console.log(`[Server] PaperLens API running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  
  // Validate environment variables
  if (!process.env.NAPKIN_TOKEN) {
    console.warn('[Server] WARNING: NAPKIN_TOKEN not set');
  }
  const useOpenAI = process.env.USE_OPENAI === 'true';
  const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
  const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here';
  
  if (!hasOpenAI && !hasGemini) {
    console.warn('[Server] WARNING: Neither OPENAI_API_KEY nor GEMINI_API_KEY is set');
    console.warn('[Server] Set at least one AI API key in .env file');
  } else {
    const { getAIType } = require('./ai/client');
    try {
      const aiType = getAIType();
      const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const currentModel = aiType === 'openai' ? openaiModel : geminiModel;
      
      if (useOpenAI) {
        if (hasOpenAI) {
          console.log(`[Server] USE_OPENAI=true → Using OpenAI API (Model: ${currentModel})`);
        } else {
          console.warn('[Server] USE_OPENAI=true but OPENAI_API_KEY not set, will fall back to Gemini');
        }
      } else {
        if (hasGemini) {
          console.log(`[Server] USE_OPENAI=false → Using Gemini API (Model: ${currentModel})`);
        } else if (hasOpenAI) {
          console.log(`[Server] USE_OPENAI not set, auto-detected OpenAI API (Model: ${currentModel})`);
        }
      }
    } catch (error) {
      console.warn('[Server] Could not determine AI model:', error.message);
    }
  }
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] ERROR: Port ${PORT} is already in use`);
    console.error(`[Server] Another process is using port ${PORT}. Please:`);
    console.error(`[Server] 1. Stop the other process, or`);
    console.error(`[Server] 2. Set a different PORT in your .env file`);
    process.exit(1);
  } else {
    console.error('[Server] Error:', err);
    process.exit(1);
  }
});

module.exports = app;
