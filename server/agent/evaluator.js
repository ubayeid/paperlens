/**
 * Evaluator
 * Uses AI to determine if text content is worthy of visualization
 * Rejects vague, unhelpful, or non-visualizable content
 */

const { generateChatCompletion } = require('../ai/client');

const EVALUATOR_PROMPT = `You are PaperLens Content Evaluator. Your job is to analyze text content and determine if it would produce meaningful, fruitful visualizations.

**EVALUATION CRITERIA:**

Content IS worthy of visualization if it contains:
- Processes, workflows, procedures, or step-by-step methods
- Concepts, theories, relationships, or abstract ideas with clear connections
- Systems, architectures, structures, or frameworks
- Comparisons, classifications, hierarchies, or taxonomies
- Data flows, information processing, or pipelines
- Cause-and-effect relationships
- Temporal sequences or chronological information
- Spatial relationships or structures
- Quantitative comparisons or data patterns
- Clear conceptual relationships between entities

Content is NOT worthy of visualization if it is:
- Pure lists without conceptual relationships (shopping lists, simple bullet points)
- Navigation/metadata/UI elements (menu items, buttons, links)
- References, citations, or bibliography entries only
- Very short snippets (< 50 words) without substantial content
- Vague, abstract statements without concrete concepts
- Pure narrative/storytelling without structural elements
- Simple questions or single sentences
- Repetitive or redundant content
- Pure code without explanatory context
- Random text fragments without coherence

**QUALITY THRESHOLD:**
The content must have enough substance and structure to create a visualization that would be MORE helpful than just reading the text. If visualization wouldn't add value, reject it.

Return ONLY a JSON object:
{
  "worthy": true|false,
  "reason": "Brief explanation of why it is or isn't worthy",
  "confidence": 0.0-1.0,
  "visualizationPotential": "high|medium|low|none"
}

Be strict - only approve content that will produce genuinely useful visualizations.`;

/**
 * Evaluate if text content is worthy of visualization
 * @param {string} text - The text content to evaluate
 * @param {string} context - Optional context (e.g., "Selected text", "Section: Introduction")
 * @returns {Promise<object>} Evaluation result: { worthy: boolean, reason: string, confidence: number, visualizationPotential: string }
 */
async function evaluateContent(text, context = '') {
  if (!text || text.trim().length === 0) {
    return {
      worthy: false,
      reason: 'Text content is empty',
      confidence: 1.0,
      visualizationPotential: 'none',
    };
  }

  // Truncate very long content for evaluation (keep first 3000 chars)
  const evaluationText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  // Very short content is likely not worthy
  if (wordCount < 30) {
    return {
      worthy: false,
      reason: 'Content too short to create meaningful visualization',
      confidence: 0.9,
      visualizationPotential: 'none',
    };
  }

  const userMessage = `${context ? `Context: ${context}\n\n` : ''}Text Content (${wordCount} words):\n\n${evaluationText}${text.length > 3000 ? '\n\n[Content truncated for evaluation]' : ''}

Evaluate this content and determine if it would produce a meaningful, fruitful visualization. Be strict - only approve if visualization would add genuine value.`;

  try {
    const content = await generateChatCompletion(
      EVALUATOR_PROMPT,
      userMessage,
      {
        temperature: 0.2, // Lower temperature for more consistent evaluation
        responseFormat: 'json_object',
      }
    );

    console.log('[Evaluator] Raw AI response:', content.substring(0, 500));

    // Clean up JSON before parsing
    let cleanedContent = content.trim();
    
    // Remove trailing commas
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

    let parsed;
    try {
      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.warn('[Evaluator] JSON parse error, attempting to fix:', parseError.message);
      // Try to fix common JSON issues
      try {
        cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, '$1');
        cleanedContent = cleanedContent.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
        parsed = JSON.parse(cleanedContent);
      } catch (secondError) {
        console.error('[Evaluator] Failed to parse JSON after cleanup:', secondError.message);
        // Fallback: be conservative and reject if we can't parse
        return {
          worthy: false,
          reason: 'Unable to evaluate content quality',
          confidence: 0.5,
          visualizationPotential: 'unknown',
        };
      }
    }

    // Validate response structure
    const worthy = parsed.worthy === true;
    const reason = parsed.reason || (worthy ? 'Content appears visualizable' : 'Content does not meet visualization criteria');
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : (worthy ? 0.7 : 0.6);
    const visualizationPotential = parsed.visualizationPotential || (worthy ? 'medium' : 'low');

    console.log(`[Evaluator] Evaluation result:`, {
      worthy,
      reason,
      confidence,
      visualizationPotential,
      wordCount,
    });

    return {
      worthy,
      reason,
      confidence,
      visualizationPotential,
    };
  } catch (error) {
    console.error('[Evaluator] Error:', error);
    // On error, be conservative - reject to avoid wasting API credits
    return {
      worthy: false,
      reason: `Evaluation error: ${error.message}`,
      confidence: 0.5,
      visualizationPotential: 'unknown',
    };
  }
}

module.exports = {
  evaluateContent,
};
