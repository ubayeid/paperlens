/**
 * Executor
 * Executes Napkin visual generation from plan
 */

const { createVisualRequest } = require('../napkin/client');
const { pollUntilComplete } = require('../napkin/poller');
const { downloadAndServeSVG } = require('../napkin/downloader');
const { processSection } = require('./decider');
const { segmentContent } = require('./segmenter');
const { evaluateContent } = require('./evaluator');
const { RateLimitError } = require('../napkin/client');

// Concurrency limiter: max 3 parallel Napkin requests
class ConcurrencyLimiter {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async execute(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }
}

// Reduce concurrency to 2 to avoid rate limits
const limiter = new ConcurrencyLimiter(2);

/**
 * Execute plan and generate visuals
 * @param {Array} plan - Plan from planner
 * @param {object} paperData - Paper data from scraper
 * @param {Function} onDiagram - Callback: (sectionId, svg, heading) => void
 * @returns {Promise<void>}
 */
async function execute(plan, paperData, onDiagram) {
  console.log(`[Executor] Received plan with ${plan.length} sections`);
  
  // Filter skipped sections
  const sectionsToProcess = plan.filter(item => !item.skip);
  console.log(`[Executor] Sections to process: ${sectionsToProcess.length}`);

  if (sectionsToProcess.length === 0) {
    console.warn('[Executor] No sections to process! All sections were skipped.');
    return;
  }

  // Limit total visuals: For a whole paper, generate only 1-2 visuals total
  // Prioritize the most important sections (priority 1, then priority 2)
  const MAX_TOTAL_VISUALS = 2;
  let totalVisualsGenerated = 0;

  // Separate by priority
  const priority1 = sectionsToProcess.filter(s => s.priority === 1);
  const priority2 = sectionsToProcess.filter(s => s.priority === 2);
  console.log(`[Executor] Priority 1: ${priority1.length}, Priority 2: ${priority2.length}`);

  // Find section data from paperData
  const findSectionData = (sectionId, planItem) => {
    // Try exact match first
    let section = paperData.sections.find(s => s.id === sectionId);
    
    // Try matching by index if sectionId is like "section-0", "section-1", etc.
    if (!section) {
      const match = sectionId.match(/section-(\d+)/);
      if (match) {
        const index = parseInt(match[1]);
        section = paperData.sections[index];
      }
    }
    
    // Try matching by heading
    if (!section && planItem) {
      const heading = planItem.heading || '';
      section = paperData.sections.find(s => 
        s.heading && s.heading.toLowerCase().includes(heading.toLowerCase())
      );
    }
    
    if (!section) {
      console.warn(`[Executor] Could not find section data for ${sectionId}`);
    }
    
    return section;
  };

  // Process a single section with retry logic for rate limits
  const processSectionVisual = async (planItem, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = (retryCount + 1) * 5; // 5s, 10s, 15s

    try {
      // Early check: if we've already reached the limit, skip this section immediately
      if (totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
        console.log(`[Executor] Skipping section "${planItem.heading}" - already reached limit of ${MAX_TOTAL_VISUALS} visuals`);
        onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, `Skipped: Maximum of ${MAX_TOTAL_VISUALS} visuals reached.`);
        return;
      }

      const sectionData = findSectionData(planItem.sectionId, planItem);
      if (!sectionData) {
        console.error(`[Executor] Section ${planItem.sectionId} not found in paperData`);
        console.log(`[Executor] Available section IDs:`, paperData.sections.map(s => s.id));
        throw new Error(`Section ${planItem.sectionId} not found`);
      }
      
      console.log(`[Executor] Processing section: ${planItem.heading} (${planItem.sectionId})${retryCount > 0 ? ` [retry ${retryCount}/${maxRetries}]` : ''}`);

      // Process section through decider
      const processed = await processSection({
        ...sectionData,
        contextBefore: planItem.contextBefore,
        contextAfter: planItem.contextAfter,
      });

      // Validate processed text
      if (!processed.text || processed.text.trim().length === 0) {
        throw new Error('Processed section text is empty');
      }
      
      // Step 1: Evaluate if section content is worthy of visualization
      console.log(`[Executor] Evaluating section "${planItem.heading}"...`);
      const context = `Section: ${planItem.heading}${planItem.contextBefore ? ` (Context: ${planItem.contextBefore})` : ''}`;
      const evaluation = await evaluateContent(processed.text, context);
      
      if (!evaluation.worthy) {
        console.log(`[Executor] Section "${planItem.heading}" rejected:`, evaluation.reason);
        onDiagram(planItem.sectionId, null, planItem.heading, `Content not suitable for visualization: ${evaluation.reason}`);
        return; // Skip this section
      }
      
      console.log(`[Executor] Section "${planItem.heading}" approved (confidence: ${evaluation.confidence})`);
      
      // Step 2: Use AI to segment the section content intelligently
      console.log(`[Executor] Segmenting section "${planItem.heading}"...`);
      const segments = await segmentContent(processed.text, context);
      
      console.log(`[Executor] Section "${planItem.heading}" split into ${segments.length} segments`);

      let visualsGenerated = 0;
      let segmentsRejected = 0;
      let segmentsSkipped = 0;

      // Limit: Only generate visuals for the first 1-2 segments (most important ones)
      // This ensures we don't generate too many visuals for a single section
      const maxSegmentsPerSection = 2;
      const segmentsToProcess = segments.slice(0, maxSegmentsPerSection);
      
      if (segments.length > maxSegmentsPerSection) {
        console.log(`[Executor] Limiting to ${maxSegmentsPerSection} most important segments (out of ${segments.length} total)`);
      }

      // Step 3: Generate visuals for each segment (limited)
      for (const segment of segmentsToProcess) {
        // Check global limit: Stop if we've already generated enough visuals for the whole paper
        if (totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
          console.log(`[Executor] Reached global limit of ${MAX_TOTAL_VISUALS} visuals. Skipping remaining segments in section "${planItem.heading}".`);
          // If we generated at least one visual for this section, we're done
          // If we generated none, the fallback will handle it
          break;
        }

        try {
          // Evaluate each segment individually as well
          const segmentEvaluation = await evaluateContent(segment.text, `Segment: ${segment.title}`);
          if (!segmentEvaluation.worthy) {
            console.log(`[Executor] Segment "${segment.title}" rejected:`, segmentEvaluation.reason);
            segmentsRejected++;
            continue; // Skip this segment
          }
          
          // Truncate segment text to 2000 chars if needed (Napkin limit)
          const segmentText = segment.text.length > 2000 ? segment.text.substring(0, 2000) : segment.text;

          if (!segmentText || segmentText.trim().length < 50) {
            console.warn(`[Executor] Skipping segment "${segment.title}" - text too short`);
            segmentsSkipped++;
            continue;
          }

          // Final check before generating: if limit reached, skip this segment
          if (totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
            console.log(`[Executor] Reached global limit of ${MAX_TOTAL_VISUALS} visuals. Skipping segment "${segment.title}".`);
            break;
          }

          console.log(`[Executor] Creating visual for segment: "${segment.title}" (${segment.wordCount} words)`);

          // Create visual request
          const requestId = await createVisualRequest(segmentText.trim(), {
            contextBefore: processed.contextBefore || '',
            contextAfter: processed.contextAfter || '',
          });

          // Poll until complete
          const generatedFiles = await pollUntilComplete(requestId);

          if (!generatedFiles || generatedFiles.length === 0) {
            console.warn(`[Executor] No files generated for segment "${segment.title}"`);
            segmentsSkipped++;
            continue;
          }

          // Download SVG
          const fileUrl = generatedFiles[0].url;
          const svg = await downloadAndServeSVG(fileUrl);

          // Callback with result - use segment title as heading
          // Use combined sectionId-segmentId to uniquely identify each visual
          const combinedId = `${planItem.sectionId}-${segment.id}`;
          onDiagram(combinedId, svg, segment.title, null);
          visualsGenerated++;
          totalVisualsGenerated++;
        } catch (segmentError) {
          console.error(`[Executor] Error processing segment "${segment.title}":`, segmentError);
          // Continue with other segments even if one fails
          if (segmentError instanceof RateLimitError) {
            // If rate limited, throw to trigger retry logic
            throw segmentError;
          }
        }
      }

      // If no visuals were generated for any segment, try a single fallback visual for the whole section
      // BUT only if we haven't reached the global limit
      if (visualsGenerated === 0 && totalVisualsGenerated < MAX_TOTAL_VISUALS) {
        const fallbackText = processed.text.length > 2000
          ? processed.text.substring(0, 2000)
          : processed.text;

        if (fallbackText && fallbackText.trim().length >= 80) {
          try {
            console.log(`[Executor] Fallback visual for section: "${planItem.heading}"`);
            const requestId = await createVisualRequest(fallbackText.trim(), {
              contextBefore: processed.contextBefore || '',
              contextAfter: processed.contextAfter || '',
            });

            const generatedFiles = await pollUntilComplete(requestId);
            if (generatedFiles && generatedFiles.length > 0) {
              const fileUrl = generatedFiles[0].url;
              const svg = await downloadAndServeSVG(fileUrl);
              onDiagram(planItem.sectionId, svg, planItem.heading, null);
              visualsGenerated++;
              totalVisualsGenerated++;
            } else {
              segmentsSkipped++;
            }
          } catch (fallbackError) {
            console.error('[Executor] Fallback visual error:', fallbackError);
            if (fallbackError instanceof RateLimitError) {
              throw fallbackError;
            }
          }
        }
      } else if (visualsGenerated === 0 && totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
        console.log(`[Executor] Skipping fallback visual - reached global limit of ${MAX_TOTAL_VISUALS} visuals`);
      }

      // If still no visuals, surface an error so the UI doesn't stay in loading state
      if (visualsGenerated === 0) {
        const allRejected = segmentsRejected > 0 && (segmentsRejected + segmentsSkipped) >= segments.length;
        const reason = allRejected
          ? 'No segments were suitable for visualization.'
          : 'Failed to generate visuals for this section.';
        onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, reason);
      }
    } catch (error) {
      // Retry on rate limit errors
      if (error instanceof RateLimitError && retryCount < maxRetries) {
        const waitTime = error.retryAfter || retryDelay;
        console.log(`[Executor] Rate limit hit for ${planItem.sectionId}, retrying in ${waitTime}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        return processSectionVisual(planItem, retryCount + 1);
      }
      
      console.error(`[Executor] Error processing section ${planItem.sectionId}:`, error);
      throw error;
    }
  };

  // Process priority 1 sections in parallel (with concurrency limit)
  const priority1Promises = priority1.map(planItem =>
    limiter.execute(() => {
      // Check global limit before processing
      if (totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
        console.log(`[Executor] Reached global limit of ${MAX_TOTAL_VISUALS} visuals. Skipping section "${planItem.heading}".`);
        // Notify frontend that this section was skipped
        onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, `Skipped: Maximum of ${MAX_TOTAL_VISUALS} visuals reached.`);
        return Promise.resolve(null);
      }
      return processSectionVisual(planItem);
    })
      .catch(error => {
        // Individual section failure - send error event
        console.error(`[Executor] Section ${planItem.sectionId} failed:`, error);
        let errorMessage = error.message || 'Unknown error';
        
        // Better error messages for common cases
        if (error instanceof RateLimitError) {
          errorMessage = 'Rate limit exceeded. Please try again in a few moments.';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Visual generation timed out. Please try again.';
        }
        
        onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, errorMessage);
        return null; // Continue with other sections
      })
  );

  await Promise.all(priority1Promises);

  // Only process priority 2 sections if we haven't reached the limit
  if (totalVisualsGenerated < MAX_TOTAL_VISUALS) {
    // Process priority 2 sections in parallel
    const priority2Promises = priority2.map(planItem =>
      limiter.execute(() => {
        // Check global limit before processing
        if (totalVisualsGenerated >= MAX_TOTAL_VISUALS) {
          console.log(`[Executor] Reached global limit of ${MAX_TOTAL_VISUALS} visuals. Skipping section "${planItem.heading}".`);
          // Notify frontend that this section was skipped
          onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, `Skipped: Maximum of ${MAX_TOTAL_VISUALS} visuals reached.`);
          return Promise.resolve(null);
        }
        return processSectionVisual(planItem);
      })
        .catch(error => {
          console.error(`[Executor] Section ${planItem.sectionId} failed:`, error);
          let errorMessage = error.message || 'Unknown error';
          
          // Better error messages for common cases
          if (error instanceof RateLimitError) {
            errorMessage = 'Rate limit exceeded. Please try again in a few moments.';
          } else if (error.message.includes('timeout')) {
            errorMessage = 'Visual generation timed out. Please try again.';
          }
          
          onDiagram(planItem.sectionId, null, planItem.heading || planItem.sectionId, errorMessage);
          return null;
        })
    );

    await Promise.all(priority2Promises);
  } else {
    console.log(`[Executor] Skipping priority 2 sections - already reached limit of ${MAX_TOTAL_VISUALS} visuals`);
  }
}

module.exports = {
  execute,
};
