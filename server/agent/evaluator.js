/**
 * Evaluator
 * Uses AI to determine if text content is worthy of visualization
 * v2.1 - More inclusive, better ChatGPT/conversational content support
 */

const { generateChatCompletion } = require('../ai/client');

const EVALUATOR_PROMPT = `You are PaperLens Content Evaluator. Your job is to analyze text content and determine if it would produce meaningful visualizations.

**EVALUATION CRITERIA:**

Content IS worthy of visualization if it contains ANY of:
- Processes, workflows, procedures, or step-by-step methods
- Concepts, theories, relationships, or abstract ideas with connections
- Systems, architectures, structures, or frameworks
- Comparisons, classifications, hierarchies, or taxonomies
- Data flows, information processing, or pipelines
- Cause-and-effect relationships
- Temporal sequences or chronological information
- Multiple related concepts or ideas
- Lists of features, properties, or attributes
- Explanations that introduce structured knowledge
- Technical or conceptual explanations with terminology
- ChatGPT/AI responses explaining topics (almost always visualizable)
- Paragraphs that introduce multiple related subtopics

Content is NOT worthy ONLY if it is:
- Single sentences with no substantive content ("Sure!", "Let me help")
- Pure navigation/UI elements (menus, buttons, links only)
- References and citations ONLY
- Very short fragments < 30 words with no concepts
- Purely repetitive content

**BIAS TOWARD INCLUSION:**
When in doubt, mark as worthy. It is better to attempt a visualization 
than to reject content that could produce a useful visual.
ChatGPT conversations almost always contain visualizable content.
Technical explanations, even conversational ones, can be visualized.

Return ONLY a JSON object:
{
  "worthy": true|false,
  "reason": "Brief explanation",
  "confidence": 0.0-1.0,
  "visualizationPotential": "high|medium|low|none"
}

Default to worthy=true for any substantive content (>50 words with concepts).`;

/**
 * Evaluate if text content is worthy of visualization
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

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  // Very short content — quick reject
  if (wordCount < 15) {
    return {
      worthy: false,
      reason: 'Content too short to create meaningful visualization',
      confidence: 0.9,
      visualizationPotential: 'none',
    };
  }

  // Medium-length content with decent word count — be very inclusive
  // Skip AI evaluation for content that's clearly substantive
  if (wordCount >= 60) {
    const hasStructure = /\b(step|first|second|third|process|method|approach|compare|versus|vs\.?|benefit|advantage|disadvantage|feature|component|part|phase|stage|because|therefore|result|example|include|consist|comprise)\b/i.test(text);
    const hasConcepts = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z]{2,})\b/.test(text);
    const hasLists = /\n[-*•]\s+|\d+\.\s+/.test(text);

    if (hasStructure || hasConcepts || hasLists) {
      console.log(`[Evaluator] Quick-approve: ${wordCount} words with structure/concepts`);
      return {
        worthy: true,
        reason: 'Content has sufficient structure and concepts for visualization',
        confidence: 0.8,
        visualizationPotential: 'medium',
      };
    }
  }

  const evaluationText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;

  const userMessage = `${context ? `Context: ${context}\n\n` : ''}Text Content (${wordCount} words):\n\n${evaluationText}${text.length > 3000 ? '\n\n[Content truncated for evaluation]' : ''}

Evaluate if this content is worth visualizing. Remember to default to worthy=true for substantive content.`;

  try {
    const content = await generateChatCompletion(
      EVALUATOR_PROMPT,
      userMessage,
      {
        temperature: 0.15,
        responseFormat: 'json_object',
      }
    );

    console.log('[Evaluator] Raw AI response:', content.substring(0, 300));

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
      console.warn('[Evaluator] JSON parse error, defaulting to worthy=true');
      // On parse error, default to worthy for better UX
      return {
        worthy: true,
        reason: 'Could not evaluate precisely; attempting visualization',
        confidence: 0.5,
        visualizationPotential: 'medium',
      };
    }

    const worthy = parsed.worthy === true;
    const reason = parsed.reason || (worthy ? 'Content appears visualizable' : 'Content not suitable');
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : (worthy ? 0.7 : 0.6);
    const visualizationPotential = parsed.visualizationPotential || (worthy ? 'medium' : 'low');

    // Override: if content is substantial (>80 words), don't reject with low confidence
    if (!worthy && wordCount >= 80 && confidence < 0.75) {
      console.log(`[Evaluator] Overriding rejection for substantial content (${wordCount} words, confidence: ${confidence})`);
      return {
        worthy: true,
        reason: 'Content is substantial enough to attempt visualization',
        confidence: 0.6,
        visualizationPotential: 'medium',
      };
    }

    console.log(`[Evaluator] Result: worthy=${worthy}, confidence=${confidence}, words=${wordCount}`);

    return { worthy, reason, confidence, visualizationPotential };

  } catch (error) {
    console.error('[Evaluator] Error:', error);
    // On error, default to worthy for better UX — don't block on evaluation errors
    return {
      worthy: true,
      reason: 'Evaluation error; attempting visualization anyway',
      confidence: 0.5,
      visualizationPotential: 'medium',
    };
  }
}

module.exports = {
  evaluateContent,
};
