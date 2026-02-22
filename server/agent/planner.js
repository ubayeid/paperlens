/**
 * Planner
 * Uses AI (OpenAI or Gemini) to analyze content and decide what's worth visualizing
 * AI-FIRST APPROACH: Let AI judge content quality, not domain restrictions
 */

const { generateChatCompletion } = require('../ai/client');

const PLANNER_SYSTEM_PROMPT = `You are PaperLens, an intelligent content analyzer. 
You receive sections of text from ANY webpage — research 
papers, articles, blog posts, documentation, essays, 
news, Wikipedia pages, or anything else.

Your job is to decide which sections are worth 
visualizing and what kind of visual would be meaningful.

JUDGMENT CRITERIA — A section is worth visualizing if 
it contains ANY of:
- A process or sequence of steps
- A hierarchy or taxonomy of concepts  
- A comparison between multiple things
- Cause and effect relationships
- A timeline of events or phases
- A system with interconnected components
- A framework with named parts
- Data patterns or structural relationships
- An algorithm or decision logic
- Key concepts with clear relationships to each other

A section is NOT worth visualizing if it is:
- Pure narrative prose with no structure (skip)
- A list of references or citations (skip)
- Boilerplate, navigation, headers, footers (skip)
- A single sentence or very short fragment (skip)
- Pure conversational text with no concepts (skip)
- Repetitive or redundant content (skip)
- Legal disclaimers or cookie notices (skip)

IMPORTANT: Be selective but not overly restrictive.
Even a well-written blog post paragraph about a process 
or concept can produce a meaningful visual.
A ChatGPT conversation section discussing a framework 
or comparing options is worth visualizing.
A Wikipedia section explaining a system is worth it.

For each section you decide to visualize, choose:
- "flowchart": processes, pipelines, steps, algorithms
- "mindmap": concepts, themes, hierarchies, frameworks
- "timeline": chronological events, phases, stages
- "comparison": comparing items, methods, options, pros/cons

Return ONLY a JSON object:
{
  "hasVisualizableContent": true|false,
  "reason": "one sentence explaining overall assessment",
  "sections": [
    {
      "sectionId": "string",
      "heading": "string or inferred label",
      "diagramType": "flowchart|mindmap|timeline|comparison",
      "priority": 1|2,
      "skip": false,
      "skipReason": null,
      "visualizationRationale": "why this section works as a visual"
    }
  ]
}

If hasVisualizableContent is false, sections array is empty 
and reason explains why (e.g. "Page contains only 
conversational text without structural content").

Be honest. If a page genuinely has nothing worth 
visualizing, say so clearly.`;

/**
 * Create visualization plan from page data
 * @param {object} paperData - Page data from scraper
 * @returns {Promise<object>} Plan object with hasVisualizableContent, reason, and sections
 */
async function createPlan(paperData) {
  // Build context for planner with section IDs and metadata
  const sectionsText = paperData.sections.map((s, i) => {
    const metadata = [];
    if (s.hasCode) metadata.push('Contains code');
    if (s.hasTable) metadata.push('Contains table');
    if (s.hasFigure) metadata.push('Contains figure');
    
    return `Section ID: ${s.id}
Heading: "${s.heading}"
Word Count: ${s.wordCount}
Metadata: ${metadata.join(', ') || 'None'}
Text Preview: ${s.text.substring(0, 500)}...`;
  }).join('\n\n');

  const userMessage = `Document Title: ${paperData.title}
Document URL: ${paperData.url}
Total Word Count: ${paperData.totalWordCount}

Sections Found:
${sectionsText}

Analyze each section and decide which ones are worth visualizing.
Use the exact "Section ID" values provided above for each section's sectionId field.
Be honest - if nothing is worth visualizing, set hasVisualizableContent to false.`;

  try {
    const content = await generateChatCompletion(
      PLANNER_SYSTEM_PROMPT,
      userMessage,
      {
        temperature: 0.3,
        responseFormat: 'json_object',
      }
    );
    
    console.log('[Planner] Raw AI response:', content.substring(0, 500));
    
    // Clean up JSON before parsing
    let cleanedContent = content.trim();
    
    // Remove trailing commas before closing braces/brackets
    cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');
    
    // Try to extract JSON if wrapped in markdown code blocks
    if (cleanedContent.includes('```json')) {
      const jsonMatch = cleanedContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanedContent = jsonMatch[1].trim();
      }
    } else if (cleanedContent.includes('```')) {
      const codeMatch = cleanedContent.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        cleanedContent = codeMatch[1].trim();
      }
    }
    
    // Try parsing, with fallback for malformed JSON
    let parsed;
    try {
      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.warn('[Planner] JSON parse error, attempting to fix:', parseError.message);
      try {
        cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');
        cleanedContent = cleanedContent.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
        parsed = JSON.parse(cleanedContent);
      } catch (secondError) {
        console.error('[Planner] Failed to parse JSON after cleanup:', secondError.message);
        throw new Error(`Failed to parse plan JSON: ${parseError.message}`);
      }
    }

    // Extract plan data
    let hasVisualizableContent = parsed.hasVisualizableContent !== false; // Default to true if not specified
    let reason = parsed.reason || 'Content analyzed';
    let plan = parsed.sections || parsed.plan || [];
    
    // If sections is empty but we have a plan array, use it
    if (!Array.isArray(plan) && parsed.plan) {
      plan = parsed.plan;
    }
    
    // Ensure plan is an array
    if (!Array.isArray(plan)) {
      plan = [];
    }
    
    console.log(`[Planner] Parsed plan: hasVisualizableContent=${hasVisualizableContent}, sections=${plan.length}`);
    console.log(`[Planner] Reason: ${reason}`);

    // Fallback: If AI says no visualizable content but we have substantial sections,
    // create a minimal plan to let downstream evaluators/segmenters decide.
    if (!hasVisualizableContent && paperData.sections && paperData.sections.length > 0) {
      const substantialSections = paperData.sections
        .filter(s => s.wordCount >= 120)
        .sort((a, b) => b.wordCount - a.wordCount)
        .slice(0, 3);

      if (substantialSections.length > 0) {
        hasVisualizableContent = true;
        reason = 'Fallback: content may be visualizable; attempting analysis.';
        plan = substantialSections.map((s, index) => ({
          sectionId: s.id,
          heading: s.heading || `Section ${index + 1}`,
          diagramType: s.hasTable ? 'comparison' : (s.hasCode ? 'flowchart' : 'mindmap'),
          priority: index === 0 ? 1 : 2,
          skip: false,
          skipReason: null,
          visualizationRationale: 'Fallback plan based on substantial content.',
        }));
        console.log('[Planner] Fallback plan generated:', plan.map(p => p.sectionId));
      }
    }

    // Validate and enrich plan with section data
    const enrichedPlan = plan.map((item, index) => {
      // Try to find matching section from paperData
      const matchingSection = paperData.sections.find(s => 
        s.id === item.sectionId || 
        s.id === item.id ||
        (s.heading && item.heading && s.heading.toLowerCase() === item.heading.toLowerCase())
      );
      
      return {
        sectionId: matchingSection?.id || item.sectionId || item.id || paperData.sections[index]?.id || `section-${index}`,
        heading: matchingSection?.heading || item.heading || paperData.sections[index]?.heading || '',
        priority: item.priority || 2,
        skip: item.skip === true,
        skipReason: item.skipReason || null,
        visualizationRationale: item.visualizationRationale || item.reason || '',
        diagramType: item.diagramType || item.visualizationType || 'flowchart',
        // Legacy fields for compatibility
        contextBefore: item.contextBefore || '',
        contextAfter: item.contextAfter || '',
        visualizationType: item.diagramType || item.visualizationType || 'flowchart',
      };
    });
    
    // Log plan details
    enrichedPlan.forEach((item, i) => {
      console.log(`[Planner] Section ${i + 1}: ${item.heading} - skip: ${item.skip}, priority: ${item.priority}`);
    });
    
    return {
      hasVisualizableContent,
      reason,
      plan: enrichedPlan,
    };
  } catch (error) {
    console.error('[Planner] Error:', error);
    throw new Error(`Failed to create plan: ${error.message}`);
  }
}

module.exports = {
  createPlan,
};
