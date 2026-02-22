/**
 * Health Check Route
 */

const express = require('express');

const router = express.Router();

/**
 * GET /health
 * Simple health check endpoint
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
