/**
 * Content Script
 * Handles both agentic and manual modes
 */

const SERVER_URL = 'http://localhost:3000';
// For local dev: const SERVER_URL = 'http://localhost:3000';

let sidebar = null;
let sidebarShadow = null; // Shadow root for sidebar (CRITICAL for CSS isolation)
let sidebarHost = null; // Host element in main DOM
let isSidebarOpen = false;
let currentMode = null; // 'SINGLE' or 'AGENTIC'

/**
 * Helper: Get element from shadow root
 */
function getSidebarElement(id) {
  if (!sidebarShadow) return null;
  return sidebarShadow.querySelector(`#${id}`);
}

/**
 * Helper: Query selector in shadow root
 */
function querySidebar(selector) {
  if (!sidebarShadow) return null;
  return sidebarShadow.querySelector(selector);
}

/**
 * Helper: Query selector all in shadow root
 */
function querySidebarAll(selector) {
  if (!sidebarShadow) return [];
  return Array.from(sidebarShadow.querySelectorAll(selector));
}

/**
 * Show "no content" message in sidebar
 */
function showNoContentMessage(reason) {
  if (!sidebarShadow) return;
  
  const container = querySidebar('#pl-cards-container');
  if (!container) return;
  
  // Hide progress area
  const progressArea = querySidebar('#pl-progress-area');
  if (progressArea) {
    progressArea.style.display = 'none';
  }
  
  container.innerHTML = `
    <div style="padding:24px 16px; text-align:center; 
                color:#8888aa; font-size:13px; 
                line-height:1.6;">
      <div style="font-size:28px; margin-bottom:12px;">
        🤔
      </div>
      <div style="color:#e8e8f0; font-weight:600; 
                  margin-bottom:8px; font-size:14px;">
        Nothing worth visualizing here
      </div>
      <div style="margin-bottom:16px;">
        ${escapeHtml(reason)}
      </div>
      <div style="font-size:11px; color:#555577; 
                  border-top:1px solid #2a2a3e; 
                  padding-top:12px;">
        Try highlighting a specific section<br>
        to generate a single visual instead.
      </div>
    </div>
  `;
}

/**
 * Update progress bar based on completed visualizations
 */
function updateProgress() {
  if (!sidebarShadow) return;
  
  const cardsContainer = querySidebar('#pl-cards-container');
  if (!cardsContainer) return;

  // Count completed visuals
  // A card is "completed" if:
  // 1. It has SVG in the main card body, OR
  // 2. It has at least one segment with SVG
  const allCards = querySidebarAll('.pl-card');
  let completed = 0;
  
  allCards.forEach(card => {
    let hasVisual = false;
    
    // Check main card body
    const cardBody = card.querySelector('.pl-card-body');
    if (cardBody) {
      if (cardBody.querySelector('svg') || cardBody.querySelector('.pl-error')) {
        hasVisual = true;
      }
    }
    
    // Check segments
    if (!hasVisual) {
      const segmentsContainer = card.querySelector('.pl-segments-container');
      if (segmentsContainer) {
        const segments = segmentsContainer.querySelectorAll('.pl-segment');
        for (const segment of segments) {
          if (segment.querySelector('svg') || segment.querySelector('.pl-error')) {
            hasVisual = true;
            break;
          }
        }
      }
    }
    
    if (hasVisual) {
      completed++;
    }
  });

  const total = allCards.length;
  
  // Update progress text and fill
  const progressText = querySidebar('#pl-progress-text');
  const progressFill = querySidebar('#pl-progress-fill');
  const progressArea = querySidebar('#pl-progress-area');
  
  if (progressArea && total > 0) {
    progressArea.style.display = 'block';
  }
  
  if (progressText && total > 0) {
    progressText.textContent = completed === total 
      ? `Analysis complete! ${total} sections visualized`
      : `${completed} / ${total} sections visualized`;
  }
  
  if (progressFill && total > 0) {
    const percentage = Math.round((completed / total) * 100);
    progressFill.style.width = `${percentage}%`;
  }
  
  console.log('[Content] Progress updated:', { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Ping background service worker to wake it up
 * @returns {Promise<boolean>} True if ping successful
 */
async function pingBackground() {
  for (let i = 0; i < 3; i++) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PING' });
      if (response && response.status === 'ok') {
        return true;
      }
    } catch (error) {
      console.log(`[Content] Ping attempt ${i + 1} failed:`, error);
    }
    if (i < 2) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return false;
}

/**
 * Detect content type from selection
 * @param {string} text - Selected text
 * @returns {string} Content type: 'code', 'table', or 'text'
 */
function detectContentType(text) {
  // Check for code patterns
  if (text.match(/^\s*(function|class|const|let|var|import|export|def |\w+\s*\([^)]*\)\s*\{)/m)) {
    return 'code';
  }
  
  // Check for table patterns
  if (text.match(/\|\s*.+\s*\|/m) || text.split('\n').filter(l => l.includes('\t')).length > 3) {
    return 'table';
  }
  
  return 'text';
}

/**
 * Show floating visualize button
 * @param {Range} range - Text selection range
 */
function showVisualizeButton(range) {
  console.log('[Content] showVisualizeButton called');
  
  if (!range) {
    console.error('[Content] Invalid range provided to showVisualizeButton');
    return;
  }
  
  // Remove existing button
  const existing = document.getElementById('paperlens-visualize-btn');
  if (existing) {
    existing.remove();
  }
  
  // Verify document.body exists
  if (!document.body) {
    console.error('[Content] document.body is null, cannot show button');
    return;
  }

  // Store the range for position updates
  const button = document.createElement('button');
  button.id = 'paperlens-visualize-btn';
  button.className = 'paperlens-floating-btn';
  button.textContent = '✦ Visualize';
  button.style.position = 'fixed';
  button.style.zIndex = '10000';
  button.style.pointerEvents = 'auto';
  
  // Function to update button position based on selection
  const updateButtonPosition = () => {
    try {
      // Check if range is still valid
      if (!range) {
        if (button._cleanup) button._cleanup();
        if (button._selectionChangeHandler) {
          document.removeEventListener('selectionchange', button._selectionChangeHandler);
        }
        button.remove();
        return;
      }
      
      // Check if range is collapsed (no selection)
      if (range.collapsed) {
        return; // Don't remove, just don't update position
      }
      
      const rect = range.getBoundingClientRect();
      
      // Only show button if selection is visible in viewport
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Check if selection is visible (at least partially)
      const isVisible = !(rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth);
      
      if (!isVisible && (rect.width === 0 && rect.height === 0)) {
        // Selection is completely out of view, hide button but don't remove it
        button.style.display = 'none';
        return;
      }
      
      // Show button if it was hidden
      button.style.display = 'block';
      
      // Position button to the right of selection, or below if not enough space
      const spaceOnRight = viewportWidth - rect.right;
      const buttonWidth = 120; // Approximate button width
      
      if (spaceOnRight > buttonWidth + 20) {
        // Position to the right
        button.style.left = `${rect.right + 10}px`;
        button.style.top = `${rect.top}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
      } else {
        // Position below selection
        button.style.left = `${rect.left}px`;
        button.style.top = `${rect.bottom + 10}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
      }
    } catch (error) {
      // Range might be invalid, remove button
      console.log('[Content] Error updating button position:', error);
      if (button._cleanup) button._cleanup();
      if (button._selectionChangeHandler) {
        document.removeEventListener('selectionchange', button._selectionChangeHandler);
      }
      button.remove();
    }
  };
  
  // Initial position
  updateButtonPosition();
  
  // Update position on scroll and resize
  const scrollHandler = () => updateButtonPosition();
  const resizeHandler = () => updateButtonPosition();
  
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', resizeHandler, { passive: true });
  
  // Store cleanup function
  button._cleanup = () => {
    window.removeEventListener('scroll', scrollHandler);
    window.removeEventListener('resize', resizeHandler);
  };

  button.onclick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Cleanup handlers before removing button
    if (button._cleanup) {
      button._cleanup();
    }
    if (button._selectionChangeHandler) {
      document.removeEventListener('selectionchange', button._selectionChangeHandler);
    }
    
    button.remove();
    
    // Get text from the range - this should be ONLY the selected text
    const text = range.toString().trim();
    
    // Debug logging
    console.log('[Content] Visualize button clicked');
    console.log('[Content] Selected text length:', text.length);
    console.log('[Content] Selected text preview:', text.substring(0, 100));
    
    if (text.length < 15) {
      console.warn('[Content] Selected text too short:', text.length);
      return;
    }

    const contentType = detectContentType(text);
    
    // Store the selection range to keep it highlighted
    const selection = window.getSelection();
    let savedRange = null;
    if (selection.rangeCount > 0) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
    
    // Add visual highlight to selected text
    let highlightSpan = null;
    if (savedRange) {
      try {
        highlightSpan = document.createElement('span');
        highlightSpan.className = 'paperlens-selection-highlight';
        highlightSpan.style.backgroundColor = 'rgba(124, 92, 191, 0.3)'; // Accent color with transparency
        highlightSpan.style.padding = '2px 0';
        highlightSpan.style.borderRadius = '2px';
        savedRange.surroundContents(highlightSpan);
      } catch (error) {
        // If surroundContents fails (e.g., range spans multiple elements), try a different approach
        console.log('[Content] Could not highlight selection:', error);
        // Fallback: just keep the native selection
      }
    }
    
    // Ping background first
    const pinged = await pingBackground();
    if (!pinged) {
      // Remove highlight if ping failed
      if (highlightSpan) {
        const parent = highlightSpan.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(highlightSpan.textContent), highlightSpan);
          parent.normalize();
        }
      }
      alert('PaperLens service unavailable. Please try again.');
      return;
    }

    // Show sidebar in SINGLE mode, preserving selection and showing selected text
    showSidebar('SINGLE', { 
      preserveSelection: true, 
      selectedText: text 
    });
    
    // Restore selection after sidebar is created to keep it highlighted
    if (savedRange && window.getSelection && !highlightSpan) {
      setTimeout(() => {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
        } catch (error) {
          console.log('[Content] Could not restore selection:', error);
        }
      }, 100);
    }
    
    // Store highlight span reference for cleanup when sidebar closes
    if (highlightSpan && sidebar) {
      sidebar._highlightSpan = highlightSpan;
    }
    
    // Show loading state in shadow root
    const containerId = 'pl-single-visual';
    if (sidebarShadow) {
      const container = querySidebar(`#${containerId}`);
      if (container) {
        container.innerHTML = '<div class="pl-skeleton"></div>';
      }
    }

    // Send generate request
    try {
      // Verify we're sending the correct text (not full page)
      console.log('[Content] Sending generate request with text length:', text.length);
      console.log('[Content] Text preview (first 200 chars):', text.substring(0, 200));
      
      chrome.runtime.sendMessage({
        type: 'GENERATE',
        text,
        contentType,
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Content] Error:', chrome.runtime.lastError);
          showError('Failed to generate visual');
          return;
        }

        if (!sidebarShadow) {
          console.error('[Content] Sidebar shadow root not available for rendering');
          return;
        }

        const container = querySidebar(`#${containerId}`);
        if (!container) {
          console.error('[Content] Single visual container not found');
          return;
        }

        if (response && response.segments && Array.isArray(response.segments)) {
          // Multiple segments - display each one
          container.innerHTML = '';
          
          response.segments.forEach((segment, index) => {
            const segmentDiv = document.createElement('div');
            segmentDiv.className = 'pl-segment';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'pl-segment-heading';
            titleDiv.textContent = segment.title || `Segment ${index + 1}`;
            segmentDiv.appendChild(titleDiv);
            
            const visualDiv = document.createElement('div');
            visualDiv.className = 'napkin-visual-wrapper';
            
            if (segment.svg) {
              const cleanSvg = segment.svg.replace(/<script[\s\S]*?<\/script>/gi, '');
              visualDiv.innerHTML = cleanSvg;
              const svgEl = visualDiv.querySelector('svg');
              if (svgEl) {
                svgEl.style.width = '100%';
                svgEl.style.height = 'auto';
              }
            } else {
              visualDiv.innerHTML = '<div class="pl-error">Visual unavailable</div>';
            }
            
            segmentDiv.appendChild(visualDiv);
            container.appendChild(segmentDiv);
          });
        } else if (response && response.svg) {
          // Single segment (backward compatible)
          const container = querySidebar(`#${containerId}`);
          if (container) {
            const cleanSvg = response.svg.replace(/<script[\s\S]*?<\/script>/gi, '');
            container.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;
            const svgEl = container.querySelector('svg');
            if (svgEl) {
              svgEl.style.width = '100%';
              svgEl.style.height = 'auto';
            }
          }
        } else if (response && response.error) {
          // Handle evaluation rejection with user-friendly message
          if (response.evaluationRejected) {
            const reason = response.reason || 'Content not suitable for visualization';
            const potential = response.visualizationPotential || 'low';
            showError(`Content evaluation: ${reason}. Visualization potential: ${potential}. Try selecting text with processes, concepts, relationships, or structured information.`);
          } else {
            showError(response.error);
          }
        }
      });
    } catch (error) {
      console.error('[Content] Error sending message:', error);
      showError('Failed to generate visual');
    }
  };

  // Ensure document.body exists before appending
  if (!document.body) {
    console.error('[Content] Cannot append button: document.body is null');
    // Try again after a short delay
    setTimeout(() => {
      if (document.body) {
        document.body.appendChild(button);
        console.log('[Content] Button appended after delay');
      } else {
        console.error('[Content] Still cannot append button: document.body is null');
      }
    }, 100);
    return;
  }
  
  try {
    document.body.appendChild(button);
    console.log('[Content] Visualize button appended successfully');
  } catch (error) {
    console.error('[Content] Error appending button:', error);
  }

  // Remove button after 10 seconds or when selection changes
  const timeoutId = setTimeout(() => {
    if (button._cleanup) button._cleanup();
    button.remove();
  }, 10000);
  
  // Remove button when selection changes
  const selectionChangeHandler = () => {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.getRangeAt(0) !== range) {
      clearTimeout(timeoutId);
      if (button._cleanup) button._cleanup();
      button.remove();
      document.removeEventListener('selectionchange', selectionChangeHandler);
    }
  };
  
  document.addEventListener('selectionchange', selectionChangeHandler);
  
  // Store selection change handler for cleanup
  button._selectionChangeHandler = selectionChangeHandler;
}

/**
 * Get sidebar CSS (for Shadow DOM injection)
 * All CSS is isolated inside shadow root - host page CSS cannot interfere
 */
function getSidebarCSS() {
  return `
    /* Reset everything inside shadow DOM */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Roboto', sans-serif;
    }

    #paperlens-sidebar {
      width: 420px;
      height: 100vh;
      background: #0d0d11;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-left: 1px solid #25252a;
      box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      color: #e8e8f0;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Header */
    .pl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
      width: 100%;
      background: rgba(13, 13, 17, 0.95);
      backdrop-filter: blur(20px);
    }

    .pl-title {
      font-size: 15px;
      font-weight: 600;
      color: #f5f5f7;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pl-title::before {
      content: '✦';
      color: #6366f1;
      font-size: 16px;
    }

    .pl-badge {
      font-size: 10px;
      background: rgba(99, 102, 241, 0.1);
      color: #a5b4fc;
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.05em;
      font-weight: 600;
      text-transform: uppercase;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .pl-close, .pl-collapse {
      background: none;
      border: none;
      color: #71717a;
      cursor: pointer;
      font-size: 18px;
      padding: 4px 8px;
      border-radius: 4px;
      line-height: 1;
      transition: all 150ms ease;
    }
    .pl-close:hover, .pl-collapse:hover { 
      background: #16161b; 
      color: #f5f5f7; 
    }
    .pl-collapse {
      font-size: 14px;
    }

    /* Progress area */
    .pl-progress-area {
      padding: 10px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
      width: 100%;
      background: #16161b;
    }

    .pl-progress-text {
      font-size: 12px;
      color: #a1a1aa;
      margin-bottom: 6px;
    }

    .pl-progress-bar-bg {
      width: 100%;
      height: 3px;
      background: #25252a;
      border-radius: 2px;
      overflow: hidden;
    }

    .pl-progress-bar-fill {
      height: 3px;
      background: linear-gradient(90deg, #6366f1, #818cf8);
      border-radius: 2px;
      transition: width 0.4s ease;
      width: 0%;
    }

    /* Cards container */
    .pl-cards {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      min-width: 0;
    }

    /* Individual card */
    .pl-card {
      width: 100%;
      min-width: 0;
      background: #16161b;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      overflow: visible;
      flex-shrink: 0;
      animation: fadeUp 0.4s ease-out;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .pl-card-header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      width: 100%;
    }

    .pl-card-title {
      font-size: 13px;
      font-weight: 600;
      color: #f5f5f7;
      white-space: normal;
      overflow: visible;
      word-wrap: break-word;
      word-break: normal;
      flex: 1;
      min-width: 0;
      line-height: 1.4;
    }

    /* Card body - where SVG goes */
    .pl-card-body {
      width: 100%;
      min-width: 0;
      min-height: 160px;
      padding: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }

    /* SVG from Napkin - make it responsive */
    .pl-card-body svg {
      width: 100% !important;
      height: auto !important;
      max-width: 100% !important;
      display: block;
    }

    /* Loading skeleton */
    .pl-skeleton {
      width: 100%;
      height: 160px;
      background: linear-gradient(
        90deg, 
        #16161b 0%, 
        #2d2d33 50%, 
        #16161b 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 4px;
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    /* Loading timer text */
    .pl-loading-text {
      font-size: 11px;
      color: #71717a;
      text-align: center;
      margin-top: 8px;
    }

    /* Error card */
    .pl-error {
      padding: 12px;
      font-size: 12px;
      color: #ef4444;
      text-align: center;
    }

    /* Empty state */
    .pl-empty {
      text-align: center;
      padding: 40px 20px;
      color: #71717a;
      font-size: 13px;
      line-height: 1.6;
    }

    /* Scrollbar styling */
    .pl-cards::-webkit-scrollbar { width: 4px; }
    .pl-cards::-webkit-scrollbar-track { background: transparent; }
    .pl-cards::-webkit-scrollbar-thumb { 
      background: #25252a; 
      border-radius: 2px; 
    }
    .pl-cards::-webkit-scrollbar-thumb:hover {
      background: #2d2d33;
    }

    /* Slide in animation */
    #paperlens-sidebar {
      animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateX(420px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    /* Paper title */
    .pl-paper-title {
      padding: 12px 16px;
      margin-bottom: 12px;
      background: #16161b;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 15px;
      font-weight: 600;
      color: #f5f5f7;
      line-height: 1.5;
      word-wrap: break-word;
      word-break: normal;
      white-space: normal;
    }

    /* Selected text display */
    .pl-selected-text {
      padding: 12px 16px;
      margin-bottom: 12px;
      background: #16161b;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .pl-selected-label {
      font-size: 10px;
      font-weight: 600;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
    }

    .pl-selected-content {
      font-size: 12px;
      line-height: 1.6;
      color: #a1a1aa;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }

    /* Single visual container */
    .pl-single-visual {
      width: 100%;
      min-width: 0;
      padding: 12px;
    }

    /* Segment container */
    .pl-segments-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      min-width: 0;
      padding: 12px;
    }

    .pl-segment {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      width: 100%;
      min-width: 0;
    }

    .pl-segment-heading {
      font-size: 11px;
      font-weight: 600;
      color: #a1a1aa;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      word-wrap: break-word;
      word-break: normal;
      white-space: normal;
    }

    .pl-segment-visual {
      width: 100%;
      min-width: 0;
    }

    /* Napkin visual wrapper */
    .napkin-visual-wrapper {
      margin-top: 8px;
      border-radius: 8px;
      overflow: visible;
      background: white;
      padding: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      width: 100%;
      min-width: 0;
    }

    .napkin-visual-wrapper svg {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 4px;
    }

    /* Collapsed state */
    #paperlens-sidebar.pl-collapsed {
      width: 48px;
    }
    #paperlens-sidebar.pl-collapsed .pl-cards,
    #paperlens-sidebar.pl-collapsed .pl-progress-area {
      display: none;
    }
    #paperlens-sidebar.pl-collapsed .pl-title,
    #paperlens-sidebar.pl-collapsed .pl-badge {
      display: none;
    }
  `;
}

/**
 * Get sidebar HTML structure
 */
function getSidebarHTML(mode, options = {}) {
  const selectedTextSection = (mode === 'SINGLE' && options.selectedText) ? `
    <div class="pl-selected-text">
      <div class="pl-selected-label">Selected Text:</div>
      <div class="pl-selected-content">${escapeHtml(options.selectedText.substring(0, 500))}${options.selectedText.length > 500 ? '...' : ''}</div>
    </div>
  ` : '';

  if (mode === 'SINGLE') {
    return `
      <div class="pl-header">
        <div class="pl-title">
          PaperLens
          <span class="pl-badge">Manual</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="pl-collapse" id="pl-collapse-btn">◀</button>
          <button class="pl-close" id="pl-close-btn">×</button>
        </div>
      </div>
      <div class="pl-cards" id="pl-cards-container">
        ${selectedTextSection}
        <div class="pl-single-visual" id="pl-single-visual"></div>
      </div>
    `;
  } else {
    return `
      <div class="pl-header">
        <div class="pl-title">
          PaperLens
          <span class="pl-badge" id="pl-mode-badge">AGENTIC</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="pl-collapse" id="pl-collapse-btn">◀</button>
          <button class="pl-close" id="pl-close-btn">×</button>
        </div>
      </div>
      <div class="pl-progress-area" id="pl-progress-area" style="display:none;">
        <div class="pl-progress-text" id="pl-progress-text">Analyzing...</div>
        <div class="pl-progress-bar-bg">
          <div class="pl-progress-bar-fill" id="pl-progress-fill"></div>
        </div>
      </div>
      <div class="pl-cards" id="pl-cards-container">
        <div class="pl-paper-title" id="pl-paper-title" style="display:none;">Loading...</div>
        <div class="pl-empty" id="pl-empty-state">
          Highlight text and click Visualize,<br>
          or press Ctrl+Shift+A to analyze the full page.
        </div>
      </div>
    `;
  }
}

/**
 * Create sidebar using Shadow DOM (CRITICAL for CSS isolation)
 */
function createSidebar(mode, options = {}) {
  // Remove existing sidebar if present
  const existing = document.getElementById('paperlens-host');
  if (existing) {
    existing.remove();
  }
  
  // Reset body margin
  document.body.style.marginRight = '';
  document.body.style.transition = '';

  // Create host element
  const host = document.createElement('div');
  host.id = 'paperlens-host';
  
  // CRITICAL: These styles go on the HOST element in the main DOM
  // They must be set via JS style property, not a stylesheet
  host.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    right: 0 !important;
    width: 420px !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    display: block !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    box-sizing: border-box !important;
  `;

  // Attach Shadow DOM - 'open' mode for debugging
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject all sidebar CSS inside the shadow root
  // Shadow DOM is FULLY ISOLATED from host page CSS
  const style = document.createElement('style');
  style.textContent = getSidebarCSS();
  shadow.appendChild(style);

  // Create sidebar inner HTML inside shadow root
  const sidebarDiv = document.createElement('div');
  sidebarDiv.id = 'paperlens-sidebar';
  sidebarDiv.innerHTML = getSidebarHTML(mode, options);
  shadow.appendChild(sidebarDiv);

  document.body.appendChild(host);

  // Push body content left
  document.body.style.marginRight = '420px';
  document.body.style.transition = 'margin-right 0.3s ease';
  document.body.style.boxSizing = 'border-box';

  // Store references
  sidebarHost = host;
  sidebarShadow = shadow;
  sidebar = sidebarDiv;

  return shadow; // return shadow root for later DOM access
}

/**
 * Show sidebar
 * @param {string} mode - 'SINGLE' or 'AGENTIC'
 * @param {object} options - Optional: { preserveSelection: boolean, selectedText: string }
 */
function showSidebar(mode, options = {}) {
  // Detect PDF (only restriction - PDFs can't be analyzed)
  const isChromePDF = window.location.protocol === 'chrome-extension:' && 
                      window.location.hostname.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai');
  const isPDF = window.location.href.endsWith('.pdf') || 
                window.location.href.includes('.pdf#') ||
                document.contentType === 'application/pdf' ||
                isChromePDF;
  
  // Check if we're on a PDF page (Chrome's PDF viewer)
  if (isPDF && mode === 'AGENTIC') {
    const pdfMsg = isChromePDF 
      ? 'PDF files opened in Chrome\'s PDF viewer cannot be analyzed. Chrome extensions cannot access PDF content. Please find the HTML version or use a PDF-to-HTML converter.'
      : 'PDF files cannot be analyzed directly. Please use the HTML version of the document.';
    showError(pdfMsg);
    return;
  }
  
  // Only clear selection if not preserving it (for manual mode)
  if (!options.preserveSelection) {
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }
  }
  
  // Check if body exists (might not exist on SVG file pages)
  if (!document.body) {
    console.error('[Content] Cannot show sidebar: document.body is null');
    return;
  }

  // Reset state
  isSidebarOpen = false;
  currentMode = null;

  // Now create new sidebar using Shadow DOM
  currentMode = mode;
  isSidebarOpen = true;

  // Create sidebar with Shadow DOM (CRITICAL for CSS isolation)
  sidebarShadow = createSidebar(mode, options);
  sidebar = sidebarShadow.querySelector('#paperlens-sidebar');
  
  // Store initial width
  sidebar._lastWidth = 420;
  sidebar._isCollapsed = false;
  
  // Apply webpage shifting (same universal approach as before)
  const sidebarWidth = 420;
  applyWebpageShifting(sidebarWidth);

  // Re-apply shifting on window resize for responsive behavior
  sidebar._windowResizeHandler = () => {
    const width = sidebar._isCollapsed ? 48 : (sidebar._lastWidth || 420);
    applyWebpageShifting(width);
  };
  window.addEventListener('resize', sidebar._windowResizeHandler, { passive: true });

  // Close button handler (use shadow root)
  const closeBtn = sidebarShadow.querySelector('#pl-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSidebar);
  }

  // Collapse/Expand button handler (use shadow root)
  const collapseBtn = sidebarShadow.querySelector('#pl-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebarCollapse();
    });
  }
  
  // Add resize handle for left-right resizing
  addResizeHandle(sidebar, sidebarHost);
}

/**
 * Apply webpage shifting (universal approach)
 */
function applyWebpageShifting(sidebarWidth) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const minContentWidth = 720;
  const shouldOverlay = viewportWidth > 0 && (viewportWidth - sidebarWidth < minContentWidth);

  // Store original inline styles once for restoration
  if (sidebar && !sidebar._originalStylesStored) {
    sidebar._originalStylesStored = true;
    sidebar._originalBodyMarginRight = document.body?.style.marginRight || '';
    sidebar._originalBodyWidth = document.body?.style.width || '';
    sidebar._originalBodyMaxWidth = document.body?.style.maxWidth || '';
    sidebar._originalBodyOverflowX = document.body?.style.overflowX || '';
    sidebar._originalBodyBoxSizing = document.body?.style.boxSizing || '';
    sidebar._originalBodyPaddingRight = document.body?.style.paddingRight || '';

    sidebar._originalHtmlMarginRight = document.documentElement?.style.marginRight || '';
    sidebar._originalHtmlWidth = document.documentElement?.style.width || '';
    sidebar._originalHtmlMaxWidth = document.documentElement?.style.maxWidth || '';
    sidebar._originalHtmlOverflowX = document.documentElement?.style.overflowX || '';
    sidebar._originalHtmlBoxSizing = document.documentElement?.style.boxSizing || '';
    sidebar._originalHtmlPaddingRight = document.documentElement?.style.paddingRight || '';
  }

  // Update or create stylesheet
  let styleSheet = document.getElementById('paperlens-global-shift-styles');
  if (!styleSheet) {
    styleSheet = document.createElement('style');
    styleSheet.id = 'paperlens-global-shift-styles';
    document.head.appendChild(styleSheet);
  }
  
  styleSheet.textContent = `
    body.paperlens-sidebar-open {
      padding-right: var(--paperlens-sidebar-width) !important;
      box-sizing: border-box !important;
      overflow-x: hidden !important;
      scrollbar-gutter: stable;
    }
    body.paperlens-sidebar-open.paperlens-sidebar-overlay {
      padding-right: 0 !important;
    }
    html.paperlens-sidebar-open {
      padding-right: var(--paperlens-sidebar-width) !important;
      overflow-x: hidden !important;
      scrollbar-gutter: stable;
    }
    html.paperlens-sidebar-open.paperlens-sidebar-overlay {
      padding-right: 0 !important;
    }
  `;
  
  document.documentElement.style.setProperty('--paperlens-sidebar-width', `${sidebarWidth}px`);
  document.body.classList.add('paperlens-sidebar-open');
  document.documentElement.classList.add('paperlens-sidebar-open');
  document.body.classList.toggle('paperlens-sidebar-overlay', shouldOverlay);
  document.documentElement.classList.toggle('paperlens-sidebar-overlay', shouldOverlay);
  
  document.body.style.setProperty('padding-right', shouldOverlay ? '0px' : `${sidebarWidth}px`, 'important');
  document.body.style.setProperty('box-sizing', 'border-box', 'important');
  document.body.style.setProperty('overflow-x', 'hidden', 'important');
  
  document.documentElement.style.setProperty('padding-right', shouldOverlay ? '0px' : `${sidebarWidth}px`, 'important');
  document.documentElement.style.setProperty('overflow-x', 'hidden', 'important');
}

/**
 * Add resize handle to sidebar (Shadow DOM version)
 */
function addResizeHandle(sidebarElement, hostElement) {
  if (!sidebarElement || !hostElement) {
    console.warn('[Content] Cannot add resize handle: sidebar or host element is null');
    return;
  }

  // Create resize handle inside shadow root
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
    z-index: 10000;
    background: transparent;
    transition: background 0.2s;
  `;
  
  resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = '#6366f1';
    resizeHandle.style.opacity = '0.5';
  });
  
  resizeHandle.addEventListener('mouseleave', () => {
    resizeHandle.style.background = 'transparent';
    resizeHandle.style.opacity = '1';
  });

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    if (!hostElement) return;
    isResizing = true;
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(hostElement).width) || 420;
    if (document.body) {
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    e.stopPropagation();
  });

  const handleMouseMove = (e) => {
    if (!isResizing || !hostElement) return;
    
    // Don't resize if collapsed
    if (sidebarElement._isCollapsed) return;
    
    const diff = startX - e.clientX; // Inverted because sidebar is on right
    const newWidth = Math.max(300, Math.min(800, startWidth + diff));
    
    // Update host element width (this controls the sidebar width)
    hostElement.style.width = `${newWidth}px`;
    sidebarElement._lastWidth = newWidth;
    
    // Update webpage shifting
    applyWebpageShifting(newWidth);
  };

  const handleMouseUp = () => {
    if (isResizing) {
      isResizing = false;
      if (document.body) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Store cleanup function
  resizeHandle._cleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Append to sidebar element (inside shadow root)
  try {
    sidebarElement.appendChild(resizeHandle);
    sidebarElement._resizeHandle = resizeHandle;
  } catch (error) {
    console.error('[Content] Failed to append resize handle:', error);
  }
}

/**
 * Toggle sidebar collapse/expand
 */
function toggleSidebarCollapse() {
  if (!sidebar || !sidebarHost) return;
  
  sidebar._isCollapsed = !sidebar._isCollapsed;
  const collapseBtn = sidebarShadow.querySelector('#pl-collapse-btn');
  
  if (sidebar._isCollapsed) {
    sidebar.classList.add('pl-collapsed');
    sidebarHost.style.width = '48px';
    if (collapseBtn) {
      collapseBtn.textContent = '▶';
    }
    applyWebpageShifting(48);
  } else {
    sidebar.classList.remove('pl-collapsed');
    const restoredWidth = sidebar._lastWidth || 420;
    sidebarHost.style.width = `${restoredWidth}px`;
    if (collapseBtn) {
      collapseBtn.textContent = '◀';
    }
    applyWebpageShifting(restoredWidth);
  }
}

/**
 * Close sidebar
 */
function closeSidebar() {
  // Clean up resize handle
  if (sidebar && sidebar._resizeHandle && sidebar._resizeHandle._cleanup) {
    sidebar._resizeHandle._cleanup();
  }

  if (sidebar && sidebar._windowResizeHandler) {
    window.removeEventListener('resize', sidebar._windowResizeHandler);
    sidebar._windowResizeHandler = null;
  }
  
  if (sidebarHost) {
    sidebarHost.remove();
  }
  
  sidebarHost = null;
  sidebarShadow = null;
  sidebar = null;
  isSidebarOpen = false;
  currentMode = null;
  
  // Remove CSS classes and stylesheet
  document.body.classList.remove('paperlens-sidebar-open');
  document.documentElement.classList.remove('paperlens-sidebar-open');
  document.body.classList.remove('paperlens-sidebar-overlay');
  document.documentElement.classList.remove('paperlens-sidebar-overlay');
  const closeStyleSheet = document.getElementById('paperlens-global-shift-styles');
  if (closeStyleSheet) {
    closeStyleSheet.remove();
  }
  
  // Disconnect mutation observer
  if (window.paperlensMutationObserver) {
    window.paperlensMutationObserver.disconnect();
    window.paperlensMutationObserver = null;
  }
  
  // Restore body styles
  if (document.body) {
    // Remove inline styles set via setProperty
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('width');
    document.body.style.removeProperty('max-width');
    document.body.style.removeProperty('box-sizing');
    document.body.style.removeProperty('overflow-x');
    
    // Restore original values if they existed
    if (sidebar._originalBodyMarginRight) document.body.style.marginRight = sidebar._originalBodyMarginRight;
    if (sidebar._originalBodyPaddingRight) document.body.style.paddingRight = sidebar._originalBodyPaddingRight;
    if (sidebar._originalBodyWidth) document.body.style.width = sidebar._originalBodyWidth;
    if (sidebar._originalBodyMaxWidth) document.body.style.maxWidth = sidebar._originalBodyMaxWidth;
    if (sidebar._originalBodyOverflowX) document.body.style.overflowX = sidebar._originalBodyOverflowX;
    if (sidebar._originalBodyBoxSizing) document.body.style.boxSizing = sidebar._originalBodyBoxSizing;
  }
  
  // Restore html styles
  if (document.documentElement) {
    document.documentElement.style.removeProperty('margin-right');
    document.documentElement.style.removeProperty('padding-right');
    document.documentElement.style.removeProperty('width');
    document.documentElement.style.removeProperty('max-width');
    document.documentElement.style.removeProperty('overflow-x');
    
    if (sidebar._originalHtmlMarginRight) document.documentElement.style.marginRight = sidebar._originalHtmlMarginRight;
    if (sidebar._originalHtmlPaddingRight) document.documentElement.style.paddingRight = sidebar._originalHtmlPaddingRight;
    if (sidebar._originalHtmlWidth) document.documentElement.style.width = sidebar._originalHtmlWidth;
    if (sidebar._originalHtmlMaxWidth) document.documentElement.style.maxWidth = sidebar._originalHtmlMaxWidth;
    if (sidebar._originalHtmlOverflowX) document.documentElement.style.overflowX = sidebar._originalHtmlOverflowX;
    if (sidebar._originalHtmlBoxSizing) document.documentElement.style.boxSizing = sidebar._originalHtmlBoxSizing;
    document.documentElement.style.removeProperty('--paperlens-sidebar-width');
  }
  
  // CSS injection handles container restoration automatically via class removal
  // No need to manually restore containers

  setTimeout(() => {
    if (sidebar) {
      // Remove highlight if it exists
      if (sidebar._highlightSpan) {
        try {
          const highlightSpan = sidebar._highlightSpan;
          const parent = highlightSpan.parentNode;
          if (parent) {
            // Replace highlight span with its text content
            const textNode = document.createTextNode(highlightSpan.textContent);
            parent.replaceChild(textNode, highlightSpan);
            parent.normalize();
          }
        } catch (error) {
          console.log('[Content] Error removing highlight:', error);
        }
      }
      
      // Clean up resize observer
      if (sidebar._resizeObserver) {
        sidebar._resizeObserver.disconnect();
        sidebar._resizeObserver = null;
      }
      // Clean up resize handle listeners
      const resizeHandle = sidebar.querySelector('.paperlens-resize-handle');
      if (resizeHandle && resizeHandle._cleanup) {
        resizeHandle._cleanup();
      }
      sidebar.remove();
      sidebar = null;
    }
    // Always reset state
    isSidebarOpen = false;
    currentMode = null;
  }, 300);
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  console.log('[Content] showError called with message:', message);
  
  // Remove any existing error toast
  const existingToast = document.getElementById('paperlens-error-toast');
  if (existingToast) {
    console.log('[Content] Removing existing error toast');
    existingToast.remove();
  }
  
  // Calculate sidebar width dynamically
  const sidebarElement = document.getElementById('paperlens-sidebar');
  const sidebarWidth = sidebarElement ? parseInt(getComputedStyle(sidebarElement).width) || 420 : 420;
  const isCollapsed = sidebarElement && sidebarElement.classList.contains('paperlens-collapsed');
  const effectiveSidebarWidth = isCollapsed ? 40 : sidebarWidth;
  
  console.log('[Content] Sidebar width:', sidebarWidth, 'Collapsed:', isCollapsed, 'Effective width:', effectiveSidebarWidth);
  
  // Create error toast
  const toast = document.createElement('div');
  toast.id = 'paperlens-error-toast';
  toast.className = 'paperlens-error-toast';
  toast.textContent = message;
  
  // Apply ALL styles inline to ensure they work (override any conflicting styles)
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: `${effectiveSidebarWidth}px`,
    background: '#2a1a1a',
    border: '1px solid #cf6679',
    color: '#e8e8f0',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    maxWidth: '280px',
    minWidth: '200px',
    zIndex: '999999',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    opacity: '0',
    transform: 'translateY(20px)',
    transition: 'opacity 0.3s ease, transform 0.3s ease, right 0.3s ease',
    cursor: 'pointer',
    wordWrap: 'break-word',
    wordBreak: 'break-word',
    lineHeight: '1.4',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Roboto", sans-serif',
    pointerEvents: 'auto',
    display: 'block',
    visibility: 'visible',
    boxSizing: 'border-box',
  });
  
  // Append to body
  if (!document.body) {
    console.error('[Content] Cannot show error toast: document.body is null');
    return;
  }
  
  document.body.appendChild(toast);
  console.log('[Content] Error toast appended to body, right position:', toast.style.right);
  
  // Force a reflow to ensure styles are applied
  toast.offsetHeight;
  
  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
      console.log('[Content] Error toast animated in, opacity:', toast.style.opacity);
    });
  });
  
  // Update position when sidebar resizes
  const updateToastPosition = () => {
    const currentSidebar = document.getElementById('paperlens-sidebar');
    if (currentSidebar && toast.parentNode) {
      const currentWidth = parseInt(getComputedStyle(currentSidebar).width) || 420;
      const currentCollapsed = currentSidebar.classList.contains('paperlens-collapsed');
      const currentEffectiveWidth = currentCollapsed ? 40 : currentWidth;
      toast.style.right = `${currentEffectiveWidth}px`;
      console.log('[Content] Toast position updated, right:', toast.style.right);
    }
  };
  
  // Listen for sidebar resize
  if (sidebarElement) {
    const resizeObserver = new ResizeObserver(updateToastPosition);
    resizeObserver.observe(sidebarElement);
    toast._resizeObserver = resizeObserver;
  }
  
  // Also listen for collapse/expand
  if (sidebarElement) {
    const collapseObserver = new MutationObserver(() => {
      updateToastPosition();
    });
    collapseObserver.observe(sidebarElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    toast._collapseObserver = collapseObserver;
  }
  
  // Auto-dismiss after 5 seconds
  const dismissTimeout = setTimeout(() => {
    console.log('[Content] Auto-dismissing error toast after 5 seconds');
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (toast._resizeObserver) {
        toast._resizeObserver.disconnect();
      }
      if (toast._collapseObserver) {
        toast._collapseObserver.disconnect();
      }
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 5000);
  
  // Also allow manual dismiss on click
  toast.addEventListener('click', () => {
    console.log('[Content] Error toast clicked, dismissing');
    clearTimeout(dismissTimeout);
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (toast._resizeObserver) {
        toast._resizeObserver.disconnect();
      }
      if (toast._collapseObserver) {
        toast._collapseObserver.disconnect();
      }
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  });
  
  // Hover effect
  toast.addEventListener('mouseenter', () => {
    toast.style.background = '#331f1f';
  });
  toast.addEventListener('mouseleave', () => {
    toast.style.background = '#2a1a1a';
  });
  
  // Log final state
  setTimeout(() => {
    const rect = toast.getBoundingClientRect();
    console.log('[Content] Error toast final state:', {
      visible: toast.offsetParent !== null,
      right: toast.style.right,
      bottom: toast.style.bottom,
      opacity: toast.style.opacity,
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
    });
  }, 100);
}

/**
 * Handle manual highlight mode
 */
function handleManualHighlight() {
  console.log('[Content] Setting up manual highlight handler');
  
  let selectionTimeout = null;
  let ctrlAPressed = false;
  let ctrlAPressTime = 0;
  
  // Track Ctrl+A keypress to distinguish from manual large selections
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
      ctrlAPressed = true;
      ctrlAPressTime = Date.now();
      // Reset after 500ms - if user doesn't press Ctrl+Shift+A, allow manual selection
      setTimeout(() => {
        if (Date.now() - ctrlAPressTime > 400) {
          ctrlAPressed = false;
        }
      }, 500);
    }
  });
  
  // Use a single event listener that checks state each time
  document.addEventListener('mouseup', (e) => {
    console.log('[Content] Mouseup event detected');
    // Don't show button if sidebar is open or if click was in sidebar
    if (isSidebarOpen) {
      console.log('[Content] Sidebar is open, skipping visualize button');
      return;
    }
    
    // Don't show button if click was inside sidebar
    if (e.target.closest('#paperlens-sidebar')) {
      console.log('[Content] Click was inside sidebar, skipping');
      return;
    }

    // Clear any existing timeout and visualize button
    if (selectionTimeout) {
      clearTimeout(selectionTimeout);
    }
    
    // Remove any existing visualize button when starting a new selection
    const existingBtn = document.getElementById('paperlens-visualize-btn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const selection = window.getSelection();
    if (!selection) {
      console.log('[Content] No selection object available');
      return;
    }
    
    const text = selection.toString().trim();
    console.log('[Content] Selection detected, text length:', text.length);

    // Only process if there's actual selected text
    if (text.length === 0) {
      console.log('[Content] No text selected');
      return;
    }

    // Check if Ctrl+A was just pressed (within last 200ms)
    const wasCtrlA = ctrlAPressed && (Date.now() - ctrlAPressTime < 200);
    
    // Wait a bit to check if Ctrl+Shift+A was pressed (Ctrl+Shift+A handler runs first)
    selectionTimeout = setTimeout(() => {
      // Check again if sidebar opened during delay
      if (isSidebarOpen) {
        return;
      }

      const newSelection = window.getSelection();
      if (!newSelection || newSelection.rangeCount === 0) {
        return;
      }

      const newText = newSelection.toString().trim();
      
      // If no text selected, don't show button
      if (newText.length === 0) {
        return;
      }

      // Exclude sidebar content from selection check
      const sidebar = document.getElementById('paperlens-sidebar');
      if (sidebar) {
        const sidebarText = sidebar.innerText.trim();
        // If selection includes sidebar text, it's not a valid selection
        if (sidebarText && newText.includes(sidebarText) && newText.length > sidebarText.length * 0.5) {
          return;
        }
      }

      // Check if selection is in sidebar
      try {
        const range = newSelection.getRangeAt(0);
        const sidebarElement = document.getElementById('paperlens-sidebar');
        if (sidebarElement && sidebarElement.contains(range.commonAncestorContainer)) {
          return; // Selection is in sidebar, ignore
        }
      } catch (error) {
        // Range might be invalid
        return;
      }

      // Only suppress if it was actually Ctrl+A (keyboard shortcut)
      // For ALL mouse-based selections (small or large), show the visualize button
      if (wasCtrlA) {
        // This was Ctrl+A - don't show visualize button, let Ctrl+Shift+A handle it if needed
        ctrlAPressed = false; // Reset flag
        return;
      }

      // For ANY manual selection (mouse drag) >= 15 chars, show visualize button
      // Works for ANY selection size - small portions, large portions, full page manual selection
      if (newText.length >= 15) {
        try {
          const range = newSelection.getRangeAt(0);
          if (!range) {
            console.error('[Content] No range available from selection');
            return;
          }
          
          console.log('[Content] Showing visualize button for selection:', {
            textLength: newText.length,
            textPreview: newText.substring(0, 50),
            rangeValid: !!range,
            url: window.location.href,
            site: window.location.hostname,
            protocol: window.location.protocol
          });
          
          showVisualizeButton(range);
        } catch (error) {
          console.error('[Content] Error showing visualize button:', error);
          console.error('[Content] Error stack:', error.stack);
          console.error('[Content] Error stack:', error.stack);
        }
      } else {
        console.log('[Content] Selection too short:', newText.length, '(minimum: 15)');
      }
    }, 150); // Delay to let Ctrl+Shift+A handler run first
  });
  
  console.log('[Content] Manual highlight handler setup complete');
}

/**
 * Handle agentic mode (Ctrl+Shift+A)
 */
function handleAgenticMode() {
  document.addEventListener('keydown', async (e) => {
    // Check for Ctrl+Shift+A (or Cmd+Shift+A on Mac)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      e.stopPropagation();

      // Clear selection immediately to prevent it from interfering
      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          sel.removeAllRanges();
        }
      }

      // Wait a bit for any pending selection events to complete
      setTimeout(async () => {
        // Don't trigger if sidebar is already open (user might be typing in sidebar)
        if (isSidebarOpen) {
          return;
        }

        // Agentic mode - analyze entire page/paper
        // Always trigger on Ctrl+Shift+A regardless of selection
        showSidebar('AGENTIC');

        // Clear selection before showing sidebar
        if (window.getSelection) {
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            sel.removeAllRanges();
          }
        }

        // Show banner
        const banner = document.createElement('div');
        banner.id = 'paperlens-banner';
        banner.className = 'paperlens-banner';
        banner.textContent = '✦ PaperLens is analyzing this paper...';
        document.body.insertBefore(banner, document.body.firstChild);

        // Extract paper structure
        // Note: scraper.js defines window.extractPaperStructure()
        try {
          const paperData = window.extractPaperStructure ? window.extractPaperStructure() : extractPaperStructure();

          if (paperData.isPDF) {
            const pdfMsg = paperData.pdfType === 'chrome-viewer' 
              ? 'PDF files opened in Chrome\'s PDF viewer cannot be analyzed. Chrome extensions cannot access PDF content. Please find the HTML version or use a PDF-to-HTML converter.'
              : 'PDF files cannot be analyzed directly. Please use the HTML version of the document.';
            showError(pdfMsg);
            banner.remove();
            return;
          }

          // Update sidebar with paper title
          const titleEl = querySidebar('#pl-paper-title');
          if (titleEl) {
            titleEl.textContent = paperData.title || 'Research Paper';
            titleEl.style.display = 'block';
          }

          // Ping background
          const pinged = await pingBackground();
          if (!pinged) {
            showError('PaperLens service unavailable. Please try again.');
            banner.remove();
            return;
          }

          // Send analyze request
          try {
            chrome.runtime.sendMessage({
              type: 'ANALYZE_PAPER',
              paperData,
            });
          } catch (error) {
            console.error('[Content] Error sending analyze message:', error);
            showError('Failed to analyze paper');
            banner.remove();
          }
        } catch (error) {
          console.error('[Content] Error extracting paper:', error);
          showError('Failed to extract paper structure: ' + error.message);
          banner.remove();
        }
      }, 300);
    }
  });
}

/**
 * Handle messages from background script and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle TRIGGER_ANALYZE from popup
  if (message.type === 'TRIGGER_ANALYZE') {
    // Trigger the agentic mode directly (same as Ctrl+Shift+A)
    (async () => {
      // Don't trigger if sidebar is already open
      if (isSidebarOpen) {
        sendResponse({ success: false, message: 'Sidebar already open' });
        return;
      }

      // Clear selection when triggered from popup
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          selection.removeAllRanges();
        }
      }

      const selection = window.getSelection();
      const text = selection.toString().trim();
      const pageText = document.body ? document.body.innerText.trim() : '';

      // Check if selection covers >80% of page or trigger anyway (including empty selection on large pages)
      // Works on ANY webpage - no restrictions
      // PaperLens can analyze any content: research papers, ChatGPT conversations, 
      // search results, blog posts, articles, etc.
      if (!pageText || text.length > pageText.length * 0.8 || text.length > 10000 || (pageText.length > 200 && text.length === 0)) {
        // Clear selection before showing sidebar
        if (window.getSelection) {
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            sel.removeAllRanges();
          }
        }

        // Agentic mode - analyze entire page/paper
        showSidebar('AGENTIC');

        // Show banner
        const banner = document.createElement('div');
        banner.id = 'paperlens-banner';
        banner.className = 'paperlens-banner';
        banner.textContent = '✦ PaperLens is analyzing this paper...';
        document.body.insertBefore(banner, document.body.firstChild);

        // Extract paper structure
        try {
          const paperData = window.extractPaperStructure ? window.extractPaperStructure() : extractPaperStructure();

          if (paperData.isPDF) {
            const pdfMsg = paperData.pdfType === 'chrome-viewer' 
              ? 'PDF files opened in Chrome\'s PDF viewer cannot be analyzed. Chrome extensions cannot access PDF content. Please find the HTML version or use a PDF-to-HTML converter.'
              : 'PDF files cannot be analyzed directly. Please use the HTML version of the document.';
            showError(pdfMsg);
            banner.remove();
            return;
          }

          // Update sidebar with paper title
          const titleEl = querySidebar('#pl-paper-title');
          if (titleEl) {
            titleEl.textContent = paperData.title || 'Research Paper';
            titleEl.style.display = 'block';
          }

          // Ping background
          const pinged = await pingBackground();
          if (!pinged) {
            showError('PaperLens service unavailable. Please try again.');
            banner.remove();
            return;
          }

          // Send analyze request
          try {
            chrome.runtime.sendMessage({
              type: 'ANALYZE_PAPER',
              paperData,
            });
          } catch (error) {
            console.error('[Content] Error sending analyze message:', error);
            showError('Failed to analyze paper');
            banner.remove();
          }
        } catch (error) {
          console.error('[Content] Error extracting paper:', error);
          showError('Failed to extract paper structure: ' + error.message);
          banner.remove();
        }
      }
    })();
    sendResponse({ success: true });
    return true;
  }
  if (message.type === 'plan') {
    if (!sidebarShadow) {
      console.error('[Content] Plan received but sidebar shadow root not available');
      return;
    }
    
    const plan = message.data || message.plan || [];
    const hasVisualizableContent = message.hasVisualizableContent !== false;
    const reason = message.reason || '';
    const totalSections = plan.filter(p => !p.skip).length;
    
    console.log('[Content] Plan received:', {
      hasVisualizableContent,
      reason,
      totalSections,
      planItems: plan.map(p => ({ sectionId: p.sectionId, heading: p.heading, skip: p.skip })),
    });
    
    // Remove empty state
    const emptyState = querySidebar('#pl-empty-state');
    if (emptyState) {
      emptyState.remove();
    }
    
    // If no visualizable content, show message
    if (!hasVisualizableContent || totalSections === 0) {
      showNoContentMessage(reason || 'No visualizable content found on this page');
      return;
    }
    
    const progressText = querySidebar('#pl-progress-text');
    const progressArea = querySidebar('#pl-progress-area');
    if (progressText && totalSections > 0) {
      progressText.textContent = `0 / ${totalSections} sections visualized`;
    }
    if (progressArea && totalSections > 0) {
      progressArea.style.display = 'block';
    }

    // Create loading cards for each section
    const cardsContainer = querySidebar('#pl-cards-container');
    if (cardsContainer) {
      plan.filter(p => !p.skip).forEach(planItem => {
        console.log('[Content] Creating card for plan item:', planItem.sectionId, planItem.heading);
        
        const card = document.createElement('div');
        card.className = 'pl-card';
        card.id = `pl-card-${planItem.sectionId}`;
        
        const cardHeader = document.createElement('div');
        cardHeader.className = 'pl-card-header';
        
        const cardTitle = document.createElement('div');
        cardTitle.className = 'pl-card-title';
        cardTitle.textContent = planItem.heading || planItem.sectionId;
        cardHeader.appendChild(cardTitle);
        
        const cardBody = document.createElement('div');
        cardBody.className = 'pl-card-body';
        cardBody.id = `pl-body-${planItem.sectionId}`;
        
        // Loading skeleton
        const skeleton = document.createElement('div');
        skeleton.className = 'pl-skeleton';
        cardBody.appendChild(skeleton);
        
        const loadingText = document.createElement('div');
        loadingText.className = 'pl-loading-text';
        loadingText.id = `pl-timer-${planItem.sectionId}`;
        loadingText.textContent = 'Generating... 0s';
        cardBody.appendChild(loadingText);
        
        card.appendChild(cardHeader);
        card.appendChild(cardBody);
        cardsContainer.appendChild(card);
        
        console.log('[Content] Card created with ID:', card.id);
        
        // Start elapsed timer
        let secs = 0;
        const timerInterval = setInterval(() => {
          secs++;
          const timerEl = querySidebar(`#pl-timer-${planItem.sectionId}`);
          if (timerEl) {
            timerEl.textContent = `Generating... ${secs}s`;
          } else {
            clearInterval(timerInterval);
          }
        }, 1000);
        card.dataset.timerInterval = timerInterval;
      });
    }

    // Remove banner
    const banner = document.getElementById('paperlens-banner');
    if (banner) {
      banner.remove();
    }
  }

  if (message.type === 'diagram') {
    if (!sidebarShadow) {
      console.error('[Content] Diagram received but sidebar shadow root not available');
      return;
    }
    
    const { sectionId, svg, heading } = message;
    
    console.log('[Content] Diagram received for section:', sectionId, {
      hasSvg: !!svg,
      svgLength: svg ? svg.length : 0,
      heading: heading || 'N/A',
    });
    
    // Parse section ID
    // Segment IDs come from executor as: `${planItem.sectionId}-${segment.id}`
    // Where segment.id is like "segment-1" or "segment-0"
    // So full ID is like: "section-0-segment-1" or "chunk-0-segment-1"
    let baseSectionId = sectionId;
    let segmentIdNum = null;
    let isSegment = false;
    
    // Pattern: anything-segment-number (e.g., "section-0-segment-1", "chunk-0-segment-1")
    const segmentMatch = sectionId.match(/^(.+?)-segment-(\d+)$/);
    if (segmentMatch) {
      baseSectionId = segmentMatch[1];
      segmentIdNum = segmentMatch[2];
      isSegment = true;
      console.log('[Content] Detected segment:', { baseSectionId, segmentIdNum, fullId: sectionId });
    }
    
    // Find card in shadow root - try exact match first
    let card = querySidebar(`#pl-card-${baseSectionId}`);
    
    // If not found, try searching all cards
    if (!card) {
      console.log('[Content] Card not found with exact ID, searching all cards...');
      const allCards = querySidebarAll('.pl-card');
      console.log('[Content] Available cards:', allCards.map(c => c.id));
      
      // Try to find by matching section ID patterns
      for (const existingCard of allCards) {
        const cardId = existingCard.id.replace(/^pl-card-/, '');
        // Check if baseSectionId matches or is contained in card ID
        if (cardId === baseSectionId || 
            baseSectionId.includes(cardId) || 
            cardId.includes(baseSectionId)) {
          card = existingCard;
          console.log('[Content] Found matching card by pattern:', card.id);
          break;
        }
      }
    }
    
    if (!card) {
      console.error('[Content] Card not found for baseSectionId:', baseSectionId);
      console.error('[Content] All available cards:', querySidebarAll('.pl-card').map(c => c.id));
      return;
    }
    
    console.log('[Content] Found card:', card.id, 'isSegment:', isSegment);
    
    if (isSegment) {
      // This is a segment - create segment container if it doesn't exist
      let segmentsContainer = card.querySelector('.pl-segments-container');
      if (!segmentsContainer) {
        console.log('[Content] Creating segments container for card:', card.id);
        segmentsContainer = document.createElement('div');
        segmentsContainer.className = 'pl-segments-container';
        segmentsContainer.id = `pl-segments-${baseSectionId}`;
        
        // Clear the main card body first (remove loading skeleton and timer)
        const mainCardBody = card.querySelector(`#pl-body-${baseSectionId}`);
        if (mainCardBody) {
          // Clear loading state
          mainCardBody.innerHTML = '';
        }
        
        // Clear timer if it exists
        const timerEl = querySidebar(`#pl-timer-${baseSectionId}`);
        if (timerEl) {
          timerEl.remove();
        }
        const timerInterval = card.dataset.timerInterval;
        if (timerInterval) {
          clearInterval(parseInt(timerInterval));
        }
        
        card.appendChild(segmentsContainer);
      }
      
      // Check if this segment already exists (avoid duplicates)
      const existingSegment = card.querySelector(`#pl-segment-${sectionId}`);
      if (existingSegment) {
        console.log('[Content] Segment already exists, updating:', sectionId);
        const existingVisual = existingSegment.querySelector('.pl-segment-visual');
        if (existingVisual && svg && svg.trim()) {
          const cleanSvg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
          existingVisual.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;
          const svgEl = existingVisual.querySelector('svg');
          if (svgEl) {
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
          }
        }
        setTimeout(updateProgress, 100);
        return;
      }
      
      // Create new segment div
      const segmentDiv = document.createElement('div');
      segmentDiv.className = 'pl-segment';
      segmentDiv.id = `pl-segment-${sectionId}`;
      
      // Add segment heading
      const segmentHeading = document.createElement('div');
      segmentHeading.className = 'pl-segment-heading';
      segmentHeading.textContent = heading || `Segment ${segmentIdNum}`;
      segmentDiv.appendChild(segmentHeading);
      
      // Add visual container
      const segmentVisual = document.createElement('div');
      segmentVisual.className = 'pl-segment-visual';
      segmentVisual.id = `pl-visual-${sectionId}`;
      
      // Render SVG in segment
      if (svg && svg.trim()) {
        const cleanSvg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
        segmentVisual.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;
        const svgEl = segmentVisual.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
        }
        console.log('[Content] Segment SVG rendered:', sectionId, 'SVG length:', cleanSvg.length);
      } else {
        segmentVisual.innerHTML = '<div class="pl-error">Visual unavailable for this segment.</div>';
        console.warn('[Content] Segment has no SVG:', sectionId);
      }
      
      segmentDiv.appendChild(segmentVisual);
      segmentsContainer.appendChild(segmentDiv);
      
      console.log('[Content] Segment visual rendered:', sectionId);
    } else {
      // This is a main section visual (not a segment)
      const cardBody = card.querySelector(`#pl-body-${baseSectionId}`);
      if (!cardBody) {
        console.error('[Content] Card body not found:', `pl-body-${baseSectionId}`);
        return;
      }
      
      // Clear loading skeleton and timer
      const timerEl = querySidebar(`#pl-timer-${baseSectionId}`);
      if (timerEl) {
        timerEl.remove();
      }
      const timerInterval = card.dataset.timerInterval;
      if (timerInterval) {
        clearInterval(parseInt(timerInterval));
      }
      
      // Render SVG
      if (svg && svg.trim()) {
        // Sanitize SVG
        const cleanSvg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
        cardBody.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;
        
        // Make SVG responsive
        const svgEl = cardBody.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
        }
      } else {
        cardBody.innerHTML = '<div class="pl-error">Visual unavailable for this section.</div>';
      }
      
      console.log('[Content] Main section visual rendered:', baseSectionId);
    }
    
    // Update progress
    setTimeout(updateProgress, 100);
  }

  if (message.type === 'no_content') {
    console.log('[Content] No visualizable content message received:', message.reason);
    showNoContentMessage(message.reason || 'No visualizable content found on this page');
  }

  if (message.type === 'complete' || message.type === 'AGENT_COMPLETE') {
    console.log('[Content] Analysis complete message received');
    
    // Final progress update
    updateProgress();
    
    const progressText = querySidebar('#pl-progress-text');
    if (progressText) {
      progressText.textContent = 'Analysis complete!';
    }
    
    const progressFill = querySidebar('#pl-progress-fill');
    if (progressFill) {
      progressFill.style.width = '100%';
    }
    
    // Check if any visuals or errors were rendered
    const allCards = querySidebarAll('.pl-card');
    // Include visuals rendered in segments and main card bodies
    const cardsWithVisuals = querySidebarAll('.pl-card svg');
    const cardsWithErrors = querySidebarAll('.pl-card .pl-error');
    if (cardsWithVisuals.length === 0 && cardsWithErrors.length === 0 && allCards.length > 0) {
      console.warn('[Content] No visuals rendered despite completion.');
      showNoContentMessage('No visuals were generated for this page. Try highlighting a smaller section or retrying.');
    }
  }

  if (message.type === 'section_error') {
    const { sectionId, message: errorMsg } = message;
    const card = querySidebar(`#pl-card-${sectionId}`);
    if (card) {
      const timerEl = querySidebar(`#pl-timer-${sectionId}`);
      if (timerEl) {
        timerEl.remove();
      }
      const timerInterval = card.dataset.timerInterval;
      if (timerInterval) {
        clearInterval(parseInt(timerInterval));
      }
      const cardBody = card.querySelector(`#pl-body-${sectionId}`);
      if (cardBody) {
        cardBody.innerHTML = `<div class="pl-error">Error: ${errorMsg || 'Failed to generate visual'}</div>`;
      }
    }
  }

  if (message.type === 'error') {
    showError(message.message || 'An error occurred');
    const banner = document.getElementById('paperlens-banner');
    if (banner) {
      banner.remove();
    }
  }
});

// Note: CSS is now injected inside Shadow DOM, so we don't need to inject sidebar.css globally
// The sidebar.css file is kept for reference but not used

// Initialize handlers - ensure they work on ALL pages
// Wait for DOM to be ready if needed
function initializeHandlers() {
  try {
    console.log('[Content] Initializing PaperLens handlers on:', window.location.href);
    console.log('[Content] Document ready state:', document.readyState);
    console.log('[Content] Document body exists:', !!document.body);
    
    handleManualHighlight();
    handleAgenticMode();
    
    console.log('[Content] Handlers initialized successfully');
  } catch (error) {
    console.error('[Content] Error initializing handlers:', error);
    console.error('[Content] Error stack:', error.stack);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHandlers);
} else {
  // DOM already ready, but wait a bit to ensure everything is loaded
  setTimeout(initializeHandlers, 100);
}
