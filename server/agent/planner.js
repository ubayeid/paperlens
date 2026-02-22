/**
 * Planner
 * Uses GPT-4o-mini to analyze paper structure and create visualization plan
 */

const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PLANNER_PROMPT = `You are PaperLens Planner. Your job is to intelligently identify which sections of a document would benefit MOST from visualization.

CRITICAL: Only visualize sections that have VISUAL VALUE. Skip everything else.

**ALWAYS SKIP (set skip: true):**
- References/Bibliography
- Acknowledgements  
- Author information/Affiliations
- Navigation menus
- Saved searches
- Table of contents
- Footer/Header content
- Copyright notices
- Publication metadata
- Generic UI elements
- Sections under 50 words
- Purely list-based content with no concepts

**HIGH VISUAL VALUE (priority 1) - Visualize these:**
- Abstract/Summary (if substantial, >100 words)
- Methods/Methodology (processes, workflows, architectures)
- Results/Findings (data, comparisons, relationships)
- System Architecture/Design
- Algorithms/Procedures
- Experimental Setup
- Key Concepts/Theories (if complex enough to benefit from diagrams)

**MODERATE VISUAL VALUE (priority 2) - Consider these:**
- Introduction (only if it explains complex concepts or relationships)
- Discussion (only if it compares results or explains relationships)
- Background/Theoretical Framework (if it involves systems or processes)

**INTELLIGENT SELECTION RULES:**
1. A section must have SUBSTANTIAL CONTENT (at least 100-150 words) to be worth visualizing
2. A section must contain CONCEPTS, PROCESSES, RELATIONSHIPS, or SYSTEMS - not just facts or lists
3. Skip sections that are purely descriptive text with no visualizable elements
4. Skip sections that are navigation, metadata, or UI elements
5. Maximum 5-6 visualizations total - be VERY selective
6. If a section heading suggests it's not content (e.g., "Your saved search", "Affiliations"), skip it

**VISUALIZATION TYPES:**
- process_flow: For methods, procedures, workflows
- architecture: For system designs, structures
- concept_map: For abstract concepts, theories
- comparison: For results, comparisons, classifications
- hierarchy: For taxonomies, organizational structures
- data_flow: For data processing, information flow
- other: For other visualizable content

Return a JSON object with a "plan" array:
{
  "plan": [
    {
      "sectionId": "string",
      "heading": "string",
      "priority": 1|2,
      "skip": true|false,
      "skipReason": "why skipped (if skip=true)",
      "contextBefore": "string",
      "contextAfter": "string",
      "visualizationType": "process_flow|architecture|concept_map|comparison|hierarchy|data_flow|other"
    }
  ]
}

Be EXTREMELY selective. Only visualize sections where a diagram would genuinely help understanding. Quality over quantity.`;

/**
 * Create visualization plan from paper data
 * @param {object} paperData - Paper data from scraper
 * @returns {Promise<Array>} Plan array with section decisions
 */
async function createPlan(paperData) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // Build context for planner with section IDs and metadata
  const sectionsText = paperData.sections.map((s, i) => {
    // Include metadata to help planner make intelligent decisions
    const metadata = [];
    if (s.hasCode) metadata.push('Contains code');
    if (s.hasTable) metadata.push('Contains table');
    if (s.hasFigure) metadata.push('Contains figure');
    
    return `Section ID: ${s.id}\nHeading: "${s.heading}"\nWord Count: ${s.wordCount}\nMetadata: ${metadata.join(', ') || 'None'}\nText Preview: ${s.text.substring(0, 400)}...`;
  }).join('\n\n');

  const userMessage = `Document Title: ${paperData.title}\nDocument URL: ${paperData.url}\nTotal Word Count: ${paperData.totalWordCount}\n\nSections Found:\n${sectionsText}\n\nCRITICAL INSTRUCTIONS:
1. Analyze each section heading CAREFULLY - skip navigation, metadata, UI elements
2. Only visualize sections with SUBSTANTIAL CONTENT (100+ words) AND visualizable concepts
3. Skip: "Your saved search", "Affiliations", "References", "Navigation", etc.
4. Focus on: Methods, Results, Concepts, Processes, Systems, Architectures
5. Use the exact "Section ID" values provided above for each section's sectionId field.
6. Be VERY selective - maximum 5-6 visualizations, only for sections that truly benefit from diagrams.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: PLANNER_PROMPT,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0].message.content.trim();
    console.log('[Planner] Raw GPT response:', content.substring(0, 500));
    
    const parsed = JSON.parse(content);

    // Handle both {plan: [...]} and direct array formats
    let plan = Array.isArray(parsed) ? parsed : (parsed.plan || parsed.sections || []);
    
    // If still empty, try to find any array in the response
    if (!plan || plan.length === 0) {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray(parsed[key])) {
          plan = parsed[key];
          break;
        }
      }
    }
    
    console.log(`[Planner] Parsed plan: ${plan.length} sections`);
    console.log(`[Planner] Sections to visualize: ${plan.filter(p => !p.skip).length}`);

    // Validate and enrich plan with section data
    // Match plan items to actual sections by ID or heading
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
        skip: item.skip === true, // Explicitly convert to boolean
        skipReason: item.skipReason || null,
        contextBefore: item.contextBefore || '',
        contextAfter: item.contextAfter || '',
        visualizationType: item.visualizationType || 'other',
      };
    });
    
    // Log plan details
    enrichedPlan.forEach((item, i) => {
      console.log(`[Planner] Section ${i + 1}: ${item.heading} - skip: ${item.skip}, priority: ${item.priority}`);
    });
    
    // Intelligent fallback: only un-skip sections that are actually useful
    const skippedCount = enrichedPlan.filter(p => p.skip).length;
    const nonSkipped = enrichedPlan.filter(p => !p.skip).length;
    
    // If all sections skipped, find the best candidates to un-skip
    if (skippedCount === enrichedPlan.length && enrichedPlan.length > 0) {
      console.warn('[Planner] All sections were skipped! Finding best candidates...');
      
      // Look for sections with substantial content and meaningful headings
      const candidates = enrichedPlan
        .map((item, idx) => {
          const section = paperData.sections.find(s => s.id === item.sectionId);
          return {
            item,
            section,
            wordCount: section?.wordCount || 0,
            index: idx
          };
        })
        .filter(c => {
          // Must have substantial content
          if (c.wordCount < 100) return false;
          
          // Skip obvious non-content headings
          const heading = (c.item.heading || '').toLowerCase();
          const skipPatterns = [
            'saved search', 'affiliations', 'navigation', 'menu', 'references',
            'acknowledgements', 'copyright', 'footer', 'header', 'breadcrumb'
          ];
          if (skipPatterns.some(p => heading.includes(p))) return false;
          
          return true;
        })
        .sort((a, b) => b.wordCount - a.wordCount) // Sort by word count
        .slice(0, 3); // Take top 3
      
      candidates.forEach(c => {
        c.item.skip = false;
        c.item.priority = 1;
      });
      
      if (candidates.length === 0) {
        console.warn('[Planner] No suitable candidates found. Using first substantial section as fallback.');
        // Last resort: un-skip first section with >100 words
        for (const item of enrichedPlan) {
          const section = paperData.sections.find(s => s.id === item.sectionId);
          if (section && section.wordCount > 100) {
            item.skip = false;
            item.priority = 2;
            break;
          }
        }
      }
    }
    
    // Final check: ensure we have at least 1-2 visualizations if content exists
    const finalNonSkipped = enrichedPlan.filter(p => !p.skip).length;
    if (finalNonSkipped === 0 && paperData.totalWordCount > 500) {
      console.warn(`[Planner] No sections selected but document has ${paperData.totalWordCount} words. Finding best section...`);
      // Find the section with most content that's not obviously navigation
      let bestSection = null;
      let maxWords = 0;
      
      for (const item of enrichedPlan) {
        const section = paperData.sections.find(s => s.id === item.sectionId);
        if (section && section.wordCount > maxWords) {
          const heading = (item.heading || '').toLowerCase();
          const skipPatterns = ['saved search', 'affiliations', 'navigation', 'menu'];
          if (!skipPatterns.some(p => heading.includes(p))) {
            bestSection = item;
            maxWords = section.wordCount;
          }
        }
      }
      
      if (bestSection && maxWords > 150) {
        bestSection.skip = false;
        bestSection.priority = 1;
      }
    }
    
    return enrichedPlan;
  } catch (error) {
    console.error('[Planner] Error:', error);
    throw new Error(`Failed to create plan: ${error.message}`);
  }
}

module.exports = {
  createPlan,
};
