/**
 * Napkin API Client
 * Core wrapper for all Napkin API calls
 */

const NAPKIN_BASE_URL = 'https://api.napkin.ai/v1';
const NAPKIN_TOKEN = process.env.NAPKIN_TOKEN;

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Napkin API rate limit exceeded');
    this.retryAfter = retryAfter;
    this.name = 'RateLimitError';
  }
}

class AuthError extends Error {
  constructor() {
    super('Napkin API authentication failed');
    this.name = 'AuthError';
  }
}

class NapkinServerError extends Error {
  constructor(message) {
    super(message || 'Napkin API server error');
    this.name = 'NapkinServerError';
  }
}

/**
 * Create a visual request
 * @param {string} text - Text content (max 2000 chars, will be truncated)
 * @param {object} options - Options object
 * @param {string} options.styleId - Style ID (default: fetch from styles endpoint)
 * @param {string} options.language - Language code (default: "en")
 * @param {number} options.numVariations - Number of variations (default: 1)
 * @param {string[]} options.outputFormats - Output formats (default: ["svg"])
 * @param {string} options.contextBefore - Context before text
 * @param {string} options.contextAfter - Context after text
 * @returns {Promise<string>} Request ID
 */
async function createVisualRequest(text, options = {}) {
  if (!NAPKIN_TOKEN) {
    throw new AuthError('NAPKIN_TOKEN not configured');
  }

  // Truncate text to 2000 chars if needed
  const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text;
  
  if (!truncatedText || truncatedText.trim().length === 0) {
    throw new Error('Content text cannot be empty');
  }

  // Napkin API expects "content" and "format" fields
  const outputFormats = options.outputFormats || ['svg'];
  const format = Array.isArray(outputFormats) ? outputFormats[0] : outputFormats;
  
  if (!format) {
    throw new Error('Format is required');
  }

  const body = {
    content: truncatedText.trim(),  // Changed from "text" to "content"
    format: format,  // Changed from "output_formats" to "format" (single string, not array)
  };
  
  // Add optional fields only if they have values
  if (options.styleId) {
    body.style_id = options.styleId;
  }
  if (options.language) {
    body.language = options.language;
  }
  if (options.numVariations) {
    body.num_variations = options.numVariations;
  }
  if (options.contextBefore && options.contextBefore.trim()) {
    body.context_before = options.contextBefore.trim();
  }
  if (options.contextAfter && options.contextAfter.trim()) {
    body.context_after = options.contextAfter.trim();
  }
  
  console.log('[Napkin Client] Request body (content preview):', {
    content: body.content.substring(0, 100) + '...',
    format: body.format,
    contentLength: body.content.length,
  });

  try {
    const response = await fetch(`${NAPKIN_BASE_URL}/visual`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NAPKIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '60';
      throw new RateLimitError(parseInt(retryAfter));
    }

    if (response.status === 401) {
      throw new AuthError();
    }

    if (response.status === 402) {
      const errorText = await response.text();
      throw new Error(`Napkin API error: 402 - Insufficient credits. Please add credits to your Napkin account.`);
    }

    if (response.status >= 500) {
      throw new NapkinServerError(`Server error: ${response.status}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Napkin Client] API error response:', errorText);
      throw new Error(`Napkin API error: ${response.status} - ${errorText}`);
    }

    // Parse response
    const responseText = await response.text();
    console.log('[Napkin Client] Response status:', response.status);
    console.log('[Napkin Client] Response body:', responseText.substring(0, 200));
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[Napkin Client] Failed to parse JSON response:', responseText);
      throw new Error(`Invalid JSON response from Napkin API: ${responseText.substring(0, 100)}`);
    }
    
    // Try different possible field names for request ID
    const requestId = data.request_id || data.requestId || data.id || data.visual_id || data.visualId;
    
    if (!requestId) {
      console.error('[Napkin Client] No request_id found in response:', data);
      throw new Error(`No request_id in Napkin API response. Response: ${JSON.stringify(data)}`);
    }
    
    console.log('[Napkin Client] Created visual request:', requestId);
    return requestId;
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof AuthError || error instanceof NapkinServerError) {
      throw error;
    }
    throw new Error(`Failed to create visual request: ${error.message}`);
  }
}

/**
 * Get visual status
 * @param {string} requestId - Request ID from createVisualRequest
 * @returns {Promise<object>} Status object with status and generatedFiles
 */
async function getVisualStatus(requestId) {
  if (!NAPKIN_TOKEN) {
    throw new AuthError('NAPKIN_TOKEN not configured');
  }

  try {
    const response = await fetch(`${NAPKIN_BASE_URL}/visual/${requestId}/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NAPKIN_TOKEN}`,
      },
    });

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      generatedFiles: data.generated_files || [],
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new Error(`Failed to get visual status: ${error.message}`);
  }
}

/**
 * Download visual file content
 * @param {string} fileUrl - File URL from generatedFiles
 * @returns {Promise<string>} SVG content as string
 */
async function downloadVisualFile(fileUrl) {
  if (!NAPKIN_TOKEN) {
    throw new AuthError('NAPKIN_TOKEN not configured');
  }

  try {
    const response = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NAPKIN_TOKEN}`,
      },
    });

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    const svgContent = await response.text();
    return svgContent;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new Error(`Failed to download visual file: ${error.message}`);
  }
}

module.exports = {
  createVisualRequest,
  getVisualStatus,
  downloadVisualFile,
  RateLimitError,
  AuthError,
  NapkinServerError,
};
