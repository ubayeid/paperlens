/**
 * Analyze Route
 * Agentic endpoint with Server-Sent Events (SSE) streaming
 * v2.1 - Compatible with new planner returning .sections instead of .plan
 */

const express = require('express');
const { createPlan } = require('../agent/planner');
const { execute } = require('../agent/executor');

const router = express.Router();

router.post('/', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const { paperData } = req.body;

  if (!paperData || !paperData.sections) {
    send({ type: 'error', message: 'Invalid paper data' });
    res.end();
    return;
  }

  try {
    // ── Step 1: Create plan ─────────────────────────────────────────────────
    console.log('[Analyze] Creating plan...');
    let planResult;
    try {
      planResult = await createPlan(paperData);
    } catch (error) {
      if (error.message && (error.message.includes('quota') || error.message.includes('429'))) {
        send({ type: 'error', message: 'AI API quota exceeded. Please wait or check your API key.' });
        res.end();
        return;
      }
      throw error;
    }

    console.log('[Analyze] Plan result:', {
      hasVisualizableContent: planResult.hasVisualizableContent,
      reason: planResult.reason,
      sectionCount: (planResult.sections || planResult.plan || []).length,
    });

    // Support both new planner (.sections) and old planner (.plan)
    const plan = planResult.sections || planResult.plan || [];

    if (!planResult.hasVisualizableContent || plan.length === 0) {
      send({ type: 'no_content', reason: planResult.reason || 'No visualizable content found.' });
      send({ type: 'complete' });
      res.end();
      return;
    }

    // Send plan to front end so it can render skeleton cards immediately
    send({
      type: 'plan',
      data: plan,
      hasVisualizableContent: true,
      reason: planResult.reason,
    });

    // ── Step 2: Execute ─────────────────────────────────────────────────────
    const totalSections = plan.filter(p => !p.skip).length;
    console.log(`[Analyze] Executing plan: ${totalSections} sections`);

    let completedCount = 0;

    await execute(plan, paperData, (sectionId, svg, heading, error) => {
      if (error) {
        send({ type: 'section_error', sectionId, heading: heading || sectionId, message: error });
      } else if (svg) {
        send({ type: 'diagram', sectionId, svg, heading: heading || sectionId });
        completedCount++;
      }
    });

    // ── Step 3: Complete ────────────────────────────────────────────────────
    send({ type: 'complete' });
    res.end();
    console.log(`[Analyze] Done: ${completedCount}/${totalSections} visuals generated`);

  } catch (error) {
    console.error('[Analyze] Error:', error);
    send({ type: 'error', message: error.message || 'Internal server error' });
    res.end();
  }
});

module.exports = router;
