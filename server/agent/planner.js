/**
 * Planner
 * Uses AI to analyze content and decide what's worth visualizing
 * v2.1 - More inclusive criteria, better ChatGPT/conversational page support
 */

const { generateChatCompletion } = require('../ai/client');

const PLANNER_SYSTEM_PROMPT = `You are PaperLens, an intelligent content analyzer. 
You receive sections of text from ANY webpage — research 
papers, articles, blog posts, documentation, essays, 
news, Wikipedia pages, ChatGPT conversations, or anything else.

Your job is to decide which sections are worth 
visualizing and what kind of visual would be meaningful.

JUDGMENT CRITERIA — A section is worth visualizing if 
it contains ANY of:
- A process or sequence of steps (even described conversationally)
- A hierarchy or taxonomy of concepts
- A comparison between multiple things/approaches/options
- Cause and effect relationships
- A timeline of events or phases
- A system with interconnected components
- A framework with named parts
- Data patterns or structural relationships
- An algorithm or decision logic
- Key concepts with clear relationships to each other
- A list of features, properties, or attributes that can be structured
- An explanation that introduces multiple related ideas
- A ChatGPT response that explains a concept, framework, or process

IMPORTANT FOR CHATGPT/CONVERSATIONAL PAGES:
ChatGPT responses often contain valuable conceptual content that CAN be visualized:
- Any response explaining a concept with multiple parts = visualizable
- Any response comparing options or approaches = visualizable
- Any response describing a process or workflow = visualizable
- Any response listing steps, principles, or components = visualizable
- Multi-paragraph explanations of topics = often visualizable
- Technical explanations with terminology = visualizable

A section is NOT worth visualizing ONLY if it is:
- A single sentence question or acknowledgment (e.g., "Sure!", "Here's what I think:", "Let me help you with that")
- Pure greetings or meta-commentary with no content
- References, citations, or bibliography entries ONLY
- Boilerplate navigation headers/footers with no content
- Duplicate or highly repetitive content (only skip one instance)
- Very short (< 20 words) with no substantive concepts

IMPORTANT: Err on the side of including content. 
A section that MIGHT produce a useful visual should be included.
ChatGPT explanations, even if conversational, often visualize well.

For each section you decide to visualize, choose:
- "flowchart": processes, pipelines, steps, algorithms, workflows
- "mindmap": concepts, themes, hierarchies, frameworks, topic breakdowns
- "timeline": chronological events, phases, stages, history
- "comparison": comparing items, methods, options, pros/cons, differences

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
and reason explains why.

If a page has ANY meaningful content, set hasVisualizableContent to true
and include at least the most promising section.`;

/**
 * Create visualization plan from page data
 */
async function createPlan(paperData) {
  const sectionsText = paperData.sections.map((s, i) => {
    const metadata = [];
    if (s.hasCode) metadata.push('Contains code');
    if (s.hasTable) metadata.push('Contains table');
    if (s.hasFigure) metadata.push('Contains figure');

    return `Section ID: ${s.id}
Heading: "${s.heading}"
Word Count: ${s.wordCount}
Metadata: ${metadata.join(', ') || 'None'}
Text Preview: ${s.text.substring(0, 600)}...`;
  }).join('\n\n');

  const userMessage = `Document Title: ${paperData.title}
Document URL: ${paperData.url}
Total Word Count: ${paperData.totalWordCount}
Page Type: ${detectPageType(paperData.url)}

Sections Found:
${sectionsText}

Analyze each section and decide which ones are worth visualizing.
Use the exact "Section ID" values provided above for each section's sectionId field.
For ChatGPT and conversational pages, be INCLUSIVE — most substantive responses can be visualized.`;

  try {
    const content = await generateChatCompletion(
      PLANNER_SYSTEM_PROMPT,
      userMessage,
      {
        temperature: 0.2,
        responseFormat: 'json_object',
      }
    );

    console.log('[Planner] Raw AI response:', content.substring(0, 500));

    let cleanedContent = content.trim();
    cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');

    if (cleanedContent.includes('```json')) {
      const jsonMatch = cleanedContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) cleanedContent = jsonMatch[1].trim();
    } else if (cleanedContent.includes('```')) {
      const codeMatch = cleanedContent.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) cleanedContent = codeMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.warn('[Planner] JSON parse error, attempting cleanup:', parseError.message);
      try {
        cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');
        cleanedContent = cleanedContent.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
        parsed = JSON.parse(cleanedContent);
      } catch (secondError) {
        console.error('[Planner] Failed to parse JSON:', secondError.message);
        // Fallback: try to visualize anyway with basic plan
        return createFallbackPlan(paperData);
      }
    }

    const hasVisualizableContent = parsed.hasVisualizableContent === true;
    const reason = parsed.reason || (hasVisualizableContent ? 'Content can be visualized' : 'No visualizable content found');
    const sections = Array.isArray(parsed.sections) ? parsed.sections : [];

    // Validate and normalize sections
    const validSections = sections
      .filter(s => s && s.sectionId && !s.skip)
      .map(s => ({
        sectionId: s.sectionId,
        heading: s.heading || 'Section',
        diagramType: s.diagramType || 'mindmap',
        priority: s.priority || 2,
        skip: false,
        skipReason: null,
        visualizationRationale: s.visualizationRationale || '',
      }))
      .slice(0, 8); // Max 8 sections

    console.log(`[Planner] Plan: ${hasVisualizableContent}, ${validSections.length} sections`);

    return {
      hasVisualizableContent: hasVisualizableContent && validSections.length > 0,
      reason,
      sections: validSections,
    };

  } catch (error) {
    console.error('[Planner] Error:', error);
    return createFallbackPlan(paperData);
  }
}

/**
 * Detect page type from URL for better planning hints
 */
function detectPageType(url) {
  if (!url) return 'unknown';
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'ChatGPT conversation';
  if (url.includes('claude.ai')) return 'Claude conversation';
  if (url.includes('arxiv.org')) return 'research paper';
  if (url.includes('wikipedia.org')) return 'Wikipedia article';
  if (url.includes('github.com')) return 'GitHub page';
  if (url.includes('medium.com') || url.includes('substack.com')) return 'blog post';
  if (url.includes('docs.')) return 'documentation';
  return 'web page';
}

/**
 * Fallback plan when AI parsing fails — try to visualize the first few sections
 */
function createFallbackPlan(paperData) {
  console.log('[Planner] Using fallback plan');
  const validSections = (paperData.sections || [])
    .filter(s => s.wordCount > 50)
    .slice(0, 3)
    .map(s => ({
      sectionId: s.id,
      heading: s.heading || 'Section',
      diagramType: 'mindmap',
      priority: 1,
      skip: false,
      skipReason: null,
      visualizationRationale: 'Fallback: attempting visualization',
    }));

  return {
    hasVisualizableContent: validSections.length > 0,
    reason: validSections.length > 0
      ? 'Attempting to visualize page sections'
      : 'No substantial content sections found',
    sections: validSections,
  };
}

module.exports = {
  createPlan,
};
