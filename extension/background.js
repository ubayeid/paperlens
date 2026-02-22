/**
 * Background Service Worker
 * Handles API communication and message routing
 */

const SERVER_URL = 'http://localhost:3000';
// For local dev: const SERVER_URL = 'http://localhost:3000';

// In-memory cache: text hash -> svg string
const cache = new Map();
const MAX_CACHE_SIZE = 100;

/**
 * Generate hash from text
 * @param {string} text - Text to hash
 * @returns {string} Hash string
 */
function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Handle PING message
 */
function handlePing(sendResponse) {
  sendResponse({ status: 'ok' });
}

/**
 * Handle GENERATE message (manual mode)
 */
async function handleGenerate(message, sendResponse) {
  const { text, contentType } = message;

  // Check cache
  const cacheKey = hashText(text);
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[Background] Cache hit for generate');
    sendResponse({ svg: cached });
    return;
  }

  try {
    // Check server health first
    const serverHealthy = await checkServerHealth();
    if (!serverHealthy) {
      sendResponse({ 
        error: `Cannot connect to PaperLens server at ${SERVER_URL}. Please make sure the server is running. Start it with: cd server && npm start`
      });
      return;
    }

    // Call server
    const response = await fetch(`${SERVER_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        contentType: contentType || 'text',
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate visual';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || `Server returned ${response.status}: ${response.statusText}`;
      } catch (e) {
        errorMessage = `Server returned ${response.status}: ${response.statusText}`;
      }
      sendResponse({ error: errorMessage });
      return;
    }

    const data = await response.json();
    
    // Handle both single segment (backward compatible) and multiple segments
    if (data.segments && Array.isArray(data.segments)) {
      // Multiple segments - return all segments
      sendResponse({ segments: data.segments, count: data.count || data.segments.length });
    } else if (data.svg) {
      // Single segment (backward compatible format)
      // Cache result
      if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      cache.set(cacheKey, data.svg);
      sendResponse({ svg: data.svg, title: data.title });
    } else {
      sendResponse({ error: 'Invalid response format' });
    }
  } catch (error) {
    console.error('[Background] Generate error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Network error';
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorMessage = `Cannot connect to PaperLens server at ${SERVER_URL}. Please make sure the server is running. Start it with: cd server && npm start`;
    } else if (error.name === 'AbortError' || error.message.includes('timeout')) {
      errorMessage = 'Request timed out. The server may be slow or unresponsive.';
    } else {
      errorMessage = error.message || 'Network error';
    }
    
    sendResponse({ error: errorMessage });
  }
}

/**
 * Check if server is reachable
 */
async function checkServerHealth() {
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  } catch (error) {
    console.error('[Background] Server health check failed:', error);
    return false;
  }
}

/**
 * Handle ANALYZE_PAPER message (agentic mode)
 */
async function handleAnalyzePaper(message, tabId) {
  const { paperData } = message;

  try {
    // Check server health first
    const serverHealthy = await checkServerHealth();
    if (!serverHealthy) {
      chrome.tabs.sendMessage(tabId, {
        type: 'AGENT_ERROR',
        message: `Cannot connect to PaperLens server at ${SERVER_URL}. Please make sure the server is running. Start it with: cd server && npm start`,
      }).catch(() => {});
      return;
    }

    // Open SSE connection
    const response = await fetch(`${SERVER_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paperData }),
      signal: AbortSignal.timeout(300000), // 5 min timeout
    });

    if (!response.ok) {
      let errorMessage = 'Failed to analyze paper';
      try {
        const errorText = await response.text();
        errorMessage = errorText || `Server returned ${response.status}: ${response.statusText}`;
      } catch (e) {
        errorMessage = `Server returned ${response.status}: ${response.statusText}`;
      }
      
      chrome.tabs.sendMessage(tabId, {
        type: 'AGENT_ERROR',
        message: errorMessage,
      }).catch(() => {});
      return;
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE messages (SSE format: "data: {...}\n\n")
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || ''; // Keep incomplete chunk in buffer

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.substring(6).trim();
              if (jsonStr) {
                const data = JSON.parse(jsonStr);

                // Forward to content script
                chrome.tabs.sendMessage(tabId, data).catch(err => {
                  console.error('[Background] Error sending message to tab:', err);
                });
              }
            } catch (parseError) {
              console.error('[Background] Error parsing SSE data:', parseError, 'Line:', line);
            }
          }
        }
      }
    }

    // Send completion if not already sent
    chrome.tabs.sendMessage(tabId, { type: 'AGENT_COMPLETE' }).catch(() => {});
  } catch (error) {
    console.error('[Background] Analyze error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to analyze paper';
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorMessage = `Cannot connect to PaperLens server at ${SERVER_URL}. Please make sure the server is running. Start it with: cd server && npm start`;
    } else if (error.name === 'AbortError' || error.message.includes('timeout')) {
      errorMessage = 'Request timed out. The server may be slow or unresponsive.';
    } else {
      errorMessage = error.message || 'Failed to analyze paper';
    }
    
    chrome.tabs.sendMessage(tabId, {
      type: 'AGENT_ERROR',
      message: errorMessage,
    }).catch(() => {});
  }
}

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async responses
  let responded = false;
  const safeSendResponse = (response) => {
    if (!responded) {
      responded = true;
      sendResponse(response);
    }
  };

  if (message.type === 'PING') {
    handlePing(safeSendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'GENERATE') {
    handleGenerate(message, safeSendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'ANALYZE_PAPER') {
    const tabId = sender.tab?.id;
    if (tabId) {
      handleAnalyzePaper(message, tabId);
    }
    return false; // No response needed
  }

  return false;
});

// Command handler for Ctrl+Shift+A
chrome.commands.onCommand.addListener((command) => {
  if (command === 'analyze-page') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_ANALYZE' });
      }
    });
  }
});

console.log('[Background] PaperLens service worker loaded');
