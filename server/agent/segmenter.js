/**
 * Segmenter
 * Uses OpenAI to intelligently segment text content into meaningful visualizable parts
 * Works for both full papers and partial selections
 */

const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SEGMENTER_PROMPT = `You are PaperLens Segmenter. Your job is to analyze text content (which may be a full paper, a section, or a partial selection) and intelligently break it down into meaningful segments that would benefit from visualization.

**CRITICAL INSTRUCTIONS:**
1. Analyze the content to identify distinct, visualizable concepts, processes, or topics
2. Each segment should be self-contained and meaningful (100-500 words ideal)
3. Create intelligent, descriptive titles for each segment (not generic like "Section 1")
4. Focus on segments that contain:
   - Processes, workflows, or procedures
   - Concepts, theories, or relationships
   - Systems, architectures, or structures
   - Comparisons, classifications, or hierarchies
   - Data flows or information processing
5. Skip segments that are:
   - Pure lists without concepts
   - Navigation/metadata/UI elements
   - References or citations only
   - Under 50 words (too short)
6. Maximum 5-7 segments - be selective and focus on the most important visualizable content
7. If the content is very short (<500 words), it may result in just 1-2 segments
8. If the content is a single coherent topic, it may result in 1 segment

**VISUALIZATION TYPES:**
- process_flow: For methods, procedures, workflows, steps
- architecture: For system designs, structures, frameworks
- concept_map: For abstract concepts, theories, relationships
- comparison: For results, comparisons, classifications, tables
- hierarchy: For taxonomies, organizational structures, levels
- data_flow: For data processing, information flow, pipelines
- other: For other visualizable content

Return a JSON object with a "segments" array:
{
  "segments": [
    {
      "id": "segment-1",
      "title": "Intelligent descriptive title (not generic)",
      "text": "The actual text content for this segment (extracted from input)",
      "visualizationType": "process_flow|architecture|concept_map|comparison|hierarchy|data_flow|other",
      "priority": 1|2,
      "wordCount": 150
    }
  ]
}

**TITLE QUALITY:**
- Good: "Treatment Methods for Delayed Sleep-Wake Phase Disorder"
- Good: "Melatonin Administration Protocol and Timing"
- Good: "Circadian Rhythm Phase Response Curve"
- Bad: "Section 1", "Part A", "Introduction", "Content"

Be intelligent and selective. Quality over quantity.`;

/**
 * Segment text content into meaningful visualizable parts
 * @param {string} text - The text content to segment (full or partial)
 * @param {string} context - Optional context (e.g., "Full paper", "Selected section: Introduction")
 * @returns {Promise<Array>} Array of segments with titles and text
 */
async function segmentContent(text, context = '') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  if (!text || text.trim().length === 0) {
    throw new Error('Text content cannot be empty');
  }

  // Log the input text to verify we're working with the selected portion
  console.log('[Segmenter] Input text length:', text.length);
  console.log('[Segmenter] Input text preview (first 200 chars):', text.substring(0, 200));
  
  // Truncate very long content for analysis (keep first 8000 chars for segmentation analysis)
  // BUT: Use the FULL text for actual segment extraction, not just the truncated version
  const analysisText = text.length > 8000 ? text.substring(0, 8000) + '...' : text;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  const userMessage = `${context ? `Context: ${context}\n\n` : ''}Text Content (${wordCount} words):\n\n${analysisText}${text.length > 8000 ? '\n\n[Content truncated for analysis - full content will be used for segments]' : ''}

CRITICAL INSTRUCTIONS:
1. **ONLY work with the text provided above** - do NOT add content from elsewhere or infer missing context
2. Analyze ONLY this content and identify the most important visualizable segments
3. Extract the actual text for each segment from the input text above (preserve original wording exactly)
4. Create intelligent, descriptive titles that capture the essence of each segment
5. Focus on segments that would benefit from diagrams/visualizations
6. Be selective - maximum 5-7 segments, only the most important ones
7. If content is short or single-topic, return 1-2 segments
8. Ensure each segment has 100-500 words of actual content
9. **IMPORTANT**: Each segment's "text" field must contain ONLY text from the input above, nothing else`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: SEGMENTER_PROMPT,
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
    console.log('[Segmenter] Raw GPT response:', content.substring(0, 500));
    
    const parsed = JSON.parse(content);

    // Handle both {segments: [...]} and direct array formats
    let segments = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.segment || []);
    
    // If still empty, try to find any array in the response
    if (!segments || segments.length === 0) {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray(parsed[key])) {
          segments = parsed[key];
          break;
        }
      }
    }
    
    console.log(`[Segmenter] Parsed ${segments.length} segments`);

    // Validate and enrich segments
    const enrichedSegments = segments.map((seg, index) => {
      // Ensure we have actual text content
      let segmentText = seg.text || seg.content || '';
      
      // Verify that the extracted text is actually from the input text
      // If GPT extracted text that's not in our input, we need to find it in the input
      if (segmentText && segmentText.trim().length >= 50) {
        // Check if the extracted text exists in the original input
        const normalizedInput = text.toLowerCase();
        const normalizedSegment = segmentText.toLowerCase();
        
        // If the segment text is not found in the input (or is too different), 
        // it means GPT might have generated or inferred content
        if (!normalizedInput.includes(normalizedSegment.substring(0, 50))) {
          console.warn(`[Segmenter] Segment ${index + 1} text not found in input, extracting from input instead`);
          segmentText = ''; // Force re-extraction
        }
      }
      
      // If GPT didn't extract text properly, extract from original input text
      if (!segmentText || segmentText.trim().length < 50) {
        // Extract a portion from the original input text
        const words = text.split(/\s+/);
        const segmentSize = Math.min(400, Math.floor(words.length / segments.length));
        const startIdx = index * segmentSize;
        segmentText = words.slice(startIdx, startIdx + segmentSize).join(' ');
        console.log(`[Segmenter] Extracted segment ${index + 1} from input text (${segmentText.length} chars)`);
      }
      
      // Final fallback: use original text if still empty
      if (!segmentText || segmentText.trim().length < 50) {
        segmentText = text.substring(0, Math.min(500, text.length));
        console.log(`[Segmenter] Using fallback text for segment ${index + 1}`);
      }
      
      // Log the final segment text to verify it's from the input
      console.log(`[Segmenter] Segment ${index + 1} final text length: ${segmentText.length}, preview: ${segmentText.substring(0, 100)}`);

      const segWordCount = segmentText.split(/\s+/).filter(w => w.length > 0).length;

      return {
        id: seg.id || `segment-${index + 1}`,
        title: seg.title || seg.heading || `Segment ${index + 1}`,
        text: segmentText.trim(),
        visualizationType: seg.visualizationType || seg.type || 'other',
        priority: seg.priority || (index < 2 ? 1 : 2),
        wordCount: seg.wordCount || segWordCount,
      };
    });

    // Log segment details
    enrichedSegments.forEach((seg, i) => {
      console.log(`[Segmenter] Segment ${i + 1}: "${seg.title}" (${seg.wordCount} words, type: ${seg.visualizationType})`);
    });

    // If no segments found, create a single segment from the original text
    if (enrichedSegments.length === 0) {
      console.warn('[Segmenter] No segments found, creating single segment from original text');
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      return [{
        id: 'segment-1',
        title: context || 'Content Analysis',
        text: text.substring(0, 2000), // Truncate to Napkin limit
        visualizationType: 'other',
        priority: 1,
        wordCount: Math.min(wordCount, 2000),
      }];
    }

    return enrichedSegments;
  } catch (error) {
    console.error('[Segmenter] Error:', error);
    throw new Error(`Failed to segment content: ${error.message}`);
  }
}

module.exports = {
  segmentContent,
};
