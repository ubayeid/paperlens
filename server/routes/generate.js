/**
 * Generate Route
 * Single diagram endpoint for manual mode
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createVisualRequest, RateLimitError, AuthError, NapkinServerError } = require('../napkin/client');
const { pollUntilComplete, TimeoutError } = require('../napkin/poller');
const { downloadAndServeSVG } = require('../napkin/downloader');
const { segmentContent } = require('../agent/segmenter');

const router = express.Router();

// Rate limit: 10 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Select style ID based on content type
 * @param {string} contentType - Content type: "code", "table", or "text"
 * @returns {string} Style ID
 */
function selectStyleId(contentType) {
  // Hardcoded style IDs - update these after checking docs.napkin.ai/styles
  // For now, using placeholder values that should work
  const styles = {
    code: 'technical',      // Formal/technical style for code
    table: 'minimal',        // Clean minimal style for tables
    text: 'default',         // Default style for text
  };
  return styles[contentType] || styles.text;
}

/**
 * POST /generate
 * Generate visuals from text (may return multiple segments)
 */
router.post('/', limiter, async (req, res) => {
  try {
    const { text, contentType, contextBefore, contextAfter } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Log received text to verify it's the selected portion, not full page
    console.log('[Generate Route] Received text length:', text.length);
    console.log('[Generate Route] Text preview (first 200 chars):', text.substring(0, 200));
    
    // Step 1: Use OpenAI to segment the content intelligently
    console.log('[Generate Route] Segmenting content...');
    const context = contextBefore || contextAfter ? `Selected content (context: ${contextBefore || ''} ... ${contextAfter || ''})` : 'Selected content';
    const segments = await segmentContent(text, context);
    
    console.log(`[Generate Route] Created ${segments.length} segments`);

    // Step 2: Generate visuals for each segment
    const results = [];
    const styleId = selectStyleId(contentType || 'text');

    for (const segment of segments) {
      try {
        // Truncate segment text to 2000 chars if needed (Napkin limit)
        const truncatedText = segment.text.length > 2000 ? segment.text.substring(0, 2000) : segment.text;

        if (!truncatedText || truncatedText.trim().length < 50) {
          console.warn(`[Generate Route] Skipping segment "${segment.title}" - text too short`);
          continue;
        }

        console.log(`[Generate Route] Generating visual for segment: "${segment.title}"`);

        // Create visual request
        const requestId = await createVisualRequest(truncatedText, {
          styleId,
          contextBefore: contextBefore || '',
          contextAfter: contextAfter || '',
        });

        // Poll until complete
        const generatedFiles = await pollUntilComplete(requestId);

        if (!generatedFiles || generatedFiles.length === 0) {
          console.warn(`[Generate Route] No files generated for segment "${segment.title}"`);
          continue;
        }

        // Download the SVG file
        const fileUrl = generatedFiles[0].url;
        const svg = await downloadAndServeSVG(fileUrl);

        results.push({
          segmentId: segment.id,
          title: segment.title,
          svg,
          requestId,
          visualizationType: segment.visualizationType,
        });
      } catch (segmentError) {
        console.error(`[Generate Route] Error processing segment "${segment.title}":`, segmentError);
        // Continue with other segments even if one fails
        if (segmentError instanceof RateLimitError) {
          // If rate limited, stop processing remaining segments
          throw segmentError;
        }
      }
    }

    // Return results (may be single or multiple segments)
    if (results.length === 0) {
      return res.status(500).json({ error: 'No visuals generated from segments' });
    }

    // If single segment, return in original format for backward compatibility
    if (results.length === 1) {
      res.json({
        svg: results[0].svg,
        requestId: results[0].requestId,
        title: results[0].title,
      });
    } else {
      // Multiple segments - return array
      res.json({
        segments: results,
        count: results.length,
      });
    }
  } catch (error) {
    console.error('[Generate Route] Error:', error);

    if (error instanceof RateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after: error.retryAfter,
      });
    }

    if (error instanceof TimeoutError) {
      return res.status(504).json({
        error: 'Visual generation timed out, please try again',
      });
    }

    if (error instanceof AuthError) {
      return res.status(500).json({
        error: 'Napkin API authentication failed',
      });
    }

    if (error instanceof NapkinServerError) {
      return res.status(500).json({
        error: 'Napkin API server error',
      });
    }

    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

module.exports = router;
