/**
 * Popup Script
 * Handles popup UI and health check
 */

const SERVER_URL = 'http://localhost:3000';
// For local dev: const SERVER_URL = 'http://localhost:3000';

/**
 * Check server health
 */
async function checkHealth() {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      indicator.className = 'status-indicator connected';
      statusText.textContent = 'Connected';
    } else {
      throw new Error('Server error');
    }
  } catch (error) {
    indicator.className = 'status-indicator offline';
    statusText.textContent = 'Offline';
  }
}

/**
 * Handle analyze button click
 */
function handleAnalyzeClick() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      alert('No active tab found');
      return;
    }

    const tab = tabs[0];
    
    // Only block chrome:// and chrome-extension:// pages (can't inject content scripts)
    // Allow EVERYTHING else: file://, http://, https://, data://, etc.
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://')) {
      alert('PaperLens cannot run on browser system pages. Please navigate to a regular webpage.');
      return;
    }
    
    // For ALL other URLs (file://, http://, https://, data://, etc.), try to inject if needed
    // PaperLens works on ANY webpage!

    try {
      // Try to send message to content script
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_ANALYZE' });
      window.close();
    } catch (error) {
      // Content script might not be loaded, try to inject it
      // This works on ANY webpage (file://, http://, https://, etc.)
      console.log('[Popup] Content script not loaded, injecting...');
      try {
        // Inject scripts - works on all webpages
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['scraper.js', 'napkin-handler.js', 'content.js']
        });
        
        // Inject CSS
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['sidebar.css']
        });
        
        // Wait a bit for scripts to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Now try sending the message again
        await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_ANALYZE' });
        window.close();
      } catch (injectError) {
        console.error('[Popup] Failed to inject content script:', injectError);
        // More helpful error message
        if (injectError.message.includes('Cannot access')) {
          alert('PaperLens cannot access this page. Some pages (like chrome://) are restricted by the browser.');
        } else {
          alert('Failed to load PaperLens on this page. Please refresh the page and try again, or use Ctrl+Shift+A directly on the page.');
        }
      }
    }
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  
  const analyzeBtn = document.getElementById('analyze-btn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', handleAnalyzeClick);
  }
});
