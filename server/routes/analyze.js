/**
 * Analyze Route
 * Agentic endpoint with Server-Sent Events (SSE) streaming
 */

const express = require('express');
const { createPlan } = require('../agent/planner');
const { execute } = require('../agent/executor');

const router = express.Router();

/**
 * POST /analyze
 * Analyze paper and stream results via SSE
 */
router.post('/', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  const { paperData } = req.body;

  if (!paperData || !paperData.sections) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Invalid paper data' })}\n\n`);
    res.end();
    return;
  }

  try {
    // Step 1: Create plan
    console.log('[Analyze Route] Creating plan...');
    const plan = await createPlan(paperData);

    // Send plan immediately
    res.write(`data: ${JSON.stringify({ type: 'plan', data: plan })}\n\n`);

    // Step 2: Execute plan and stream results
    console.log('[Analyze Route] Executing plan...');
    let completedCount = 0;
    const totalSections = plan.filter(p => !p.skip).length;

    await execute(plan, paperData, (sectionId, svg, heading, error) => {
      if (error) {
        // Send error event
        res.write(`data: ${JSON.stringify({
          type: 'section_error',
          sectionId,
          heading: heading || sectionId,
          message: error,
        })}\n\n`);
      } else if (svg) {
        // Send diagram event
        res.write(`data: ${JSON.stringify({
          type: 'diagram',
          sectionId,
          svg,
          heading: heading || sectionId,
        })}\n\n`);
        completedCount++;
      }
    });

    // Step 3: Send completion event
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();

    console.log(`[Analyze Route] Completed: ${completedCount}/${totalSections} sections visualized`);
  } catch (error) {
    console.error('[Analyze Route] Error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message || 'Internal server error',
    })}\n\n`);
    res.end();
  }
});

module.exports = router;
