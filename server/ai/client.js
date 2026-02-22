/**
 * Unified AI Client
 * Supports both OpenAI and Google Gemini APIs
 * Automatically uses the available API key
 */

let aiClient = null;
let aiType = null;

// Initialize AI client based on USE_OPENAI flag or available API keys
function initializeAIClient() {
  const useOpenAI = process.env.USE_OPENAI === 'true';
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // If USE_OPENAI=true, prioritize OpenAI
  if (useOpenAI) {
    if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
      const OpenAI = require('openai');
      aiClient = new OpenAI({ apiKey: openaiKey });
      aiType = 'openai';
      console.log('[AI Client] Using OpenAI (USE_OPENAI=true)');
      return;
    } else {
      console.warn('[AI Client] USE_OPENAI=true but OPENAI_API_KEY not set, falling back to Gemini');
    }
  }

  // Try Gemini if USE_OPENAI=false or OpenAI not available
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    aiClient = new GoogleGenerativeAI(geminiKey);
    aiType = 'gemini';
    console.log('[AI Client] Using Google Gemini');
    return;
  }

  // Fallback: if no flag set, try OpenAI if available
  if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
    const OpenAI = require('openai');
    aiClient = new OpenAI({ apiKey: openaiKey });
    aiType = 'openai';
    console.log('[AI Client] Using OpenAI (auto-detected)');
    return;
  }

  throw new Error('No AI API key configured. Set either OPENAI_API_KEY or GEMINI_API_KEY in .env');
}

// Initialize on module load
try {
  initializeAIClient();
} catch (error) {
  console.warn('[AI Client] Initialization deferred:', error.message);
}

/**
 * Generate chat completion (works with both OpenAI and Gemini)
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {object} options - Options: { model, temperature, responseFormat }
 * @returns {Promise<string>} Response text
 */
async function generateChatCompletion(systemPrompt, userMessage, options = {}) {
  // Re-initialize if needed
  if (!aiClient) {
    initializeAIClient();
  }

  // Get model from options, env variable, or use defaults
  // OpenAI models: gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-3.5-turbo
  // Gemini models: gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash-preview, gemini-3.1-pro-preview
  const defaultModel = aiType === 'openai' 
    ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
    : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const model = options.model || defaultModel;
  const temperature = options.temperature || 0.3;
  const responseFormat = options.responseFormat === 'json_object' || options.responseFormat === true;

  if (aiType === 'openai') {
    const response = await aiClient.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: responseFormat ? { type: 'json_object' } : null,
      temperature,
    });
    return response.choices[0].message.content.trim();
  } else if (aiType === 'gemini') {
    // Gemini doesn't have separate system/user messages, combine them
    // Format: System instruction first, then user content
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    
    const geminiModel = aiClient.getGenerativeModel({ 
      model,
      generationConfig: {
        temperature,
        ...(responseFormat ? { responseMimeType: 'application/json' } : {}),
      },
    });

    try {
      const result = await geminiModel.generateContent(combinedPrompt);
      const response = await result.response;
      const text = response.text();
      
      // Gemini sometimes wraps JSON in markdown code blocks, extract if needed
      if (responseFormat && text.includes('```json')) {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          return jsonMatch[1].trim();
        }
      }
      if (responseFormat && text.includes('```')) {
        const codeMatch = text.match(/```\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          return codeMatch[1].trim();
        }
      }
      
      return text.trim();
    } catch (error) {
      // Handle rate limit errors specifically
      if (error.status === 429) {
        const retryAfter = error.errorDetails?.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay || '60';
        throw new Error(`Gemini API rate limit exceeded. Free tier limit: 20 requests/day. Please retry in ${retryAfter} seconds or upgrade your plan.`);
      }
      throw error;
    }
  } else {
    throw new Error('AI client not initialized');
  }
}

/**
 * Get the current AI type being used
 * @returns {string} 'openai' or 'gemini'
 */
function getAIType() {
  return aiType;
}

module.exports = {
  generateChatCompletion,
  getAIType,
  initializeAIClient,
};
