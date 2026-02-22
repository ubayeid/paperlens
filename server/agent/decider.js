/**
 * Decider
 * Per-section decisions before sending to Napkin
 */

const { generateChatCompletion } = require('../ai/client');

/**
 * Process section text before sending to Napkin
 * @param {object} section - Section object from scraper
 * @returns {Promise<object>} Processed section with text and context
 */
async function processSection(section) {
  let text = section.text || '';
  let contextBefore = section.contextBefore || '';
  let contextAfter = section.contextAfter || '';

  // Validate input
  if (!text || text.trim().length === 0) {
    console.warn(`[Decider] Section ${section.id} has empty text, using heading as fallback`);
    text = section.heading || 'Section content';
  }

  console.log(`[Decider] Processing section ${section.id}: "${section.heading}", text length: ${text.length}`);

  // Handle text over 2000 chars: summarize first
  if (text.length > 2000) {
    console.log(`[Decider] Summarizing section ${section.id} (${text.length} chars)`);
    try {
      const summary = await summarizeText(text);
      text = summary + ' [content summarized]';
    } catch (error) {
      console.error(`[Decider] Summarization failed: ${error.message}`);
      // Fallback: truncate
      text = text.substring(0, 1800) + ' [content summarized]';
    }
  }

  // Handle tables: extract as structured description
  if (section.hasTable) {
    const tableDescription = extractTableDescription(section.text);
    text = `Table visualization: ${tableDescription}`;
  }

  // Handle code: prepend algorithm hint
  if (section.hasCode) {
    text = `Algorithm/Code Logic: ${text}`;
  }

  // Handle figures: include caption as contextAfter
  if (section.hasFigure && section.figureCaption) {
    contextAfter = (contextAfter ? contextAfter + ' ' : '') + `Figure caption: ${section.figureCaption}`;
  }

  // Handle mathematical content: prepend hint
  if (isMathematical(text)) {
    text = `Mathematical concept: ${text}`;
  }

  // Final validation
  if (!text || text.trim().length === 0) {
    throw new Error(`Processed text is empty for section ${section.id}`);
  }

  return {
    text: text.trim(),
    contextBefore: contextBefore.trim(),
    contextAfter: contextAfter.trim(),
  };
}

/**
 * Summarize long text using GPT-4o-mini
 * @param {string} text - Text to summarize
 * @returns {Promise<string>} Summarized text (key points)
 */
async function summarizeText(text) {
  const systemPrompt = 'You are a research paper analyzer. Summarize the following text into key points suitable for diagram generation. Keep it concise but informative. Maximum 1800 characters.';
  
  return await generateChatCompletion(
    systemPrompt,
    text,
    {
      temperature: 0.3,
    }
  );
}

/**
 * Extract table description from HTML/text
 * @param {string} text - Text containing table
 * @returns {string} Structured table description
 */
function extractTableDescription(text) {
  // Simple extraction: look for table-like patterns
  // In a real implementation, parse HTML table and describe structure
  const lines = text.split('\n').filter(line => line.trim());
  const tableLines = lines.slice(0, 10); // First 10 lines likely contain table structure
  return tableLines.join(' | ');
}

/**
 * Detect if text is primarily mathematical
 * @param {string} text - Text to check
 * @returns {boolean} True if mathematical
 */
function isMathematical(text) {
  // Simple heuristic: check for common math patterns
  const mathPatterns = [
    /\$[^$]+\$/g,           // LaTeX inline math
    /\\[\(\[][^\)\]]+\\[\)\]]/g, // LaTeX display math
    /\\begin\{equation\}/g, // LaTeX equation environment
    /\d+\s*[+\-*/=]\s*\d+/g, // Simple equations
  ];

  let mathCount = 0;
  mathPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) mathCount += matches.length;
  });

  // If more than 3 math patterns, consider it mathematical
  return mathCount > 3;
}

module.exports = {
  processSection,
};
