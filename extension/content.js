/**
 * Content Script
 * Handles both agentic and manual modes
 */

const SERVER_URL = 'http://localhost:3000';
// For local dev: const SERVER_URL = 'http://localhost:3000';

let sidebar = null;
let isSidebarOpen = false;
let currentMode = null; // 'SINGLE' or 'AGENTIC'

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
    
    // Show loading state
    const containerId = 'paperlens-single-visual';
    const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
    if (handler) {
      handler.showLoadingState(containerId);
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

        if (response && response.segments && Array.isArray(response.segments)) {
          // Multiple segments - display each one
          const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
          if (handler) {
            handler.removeLoadingState(containerId);
            
            // Clear container and add each segment
            const container = document.getElementById(containerId);
            if (container) {
              container.innerHTML = ''; // Clear loading state
              
              response.segments.forEach((segment, index) => {
                // Create a section for each segment
                const segmentDiv = document.createElement('div');
                segmentDiv.className = 'paperlens-segment';
                segmentDiv.id = `segment-${segment.segmentId || index}`;
                
                // Add title
                const titleDiv = document.createElement('div');
                titleDiv.className = 'paperlens-section-heading';
                titleDiv.textContent = segment.title || `Segment ${index + 1}`;
                segmentDiv.appendChild(titleDiv);
                
                // Add visual container
                const visualContainer = document.createElement('div');
                visualContainer.id = `visual-${segment.segmentId || index}`;
                segmentDiv.appendChild(visualContainer);
                
                container.appendChild(segmentDiv);
                
                // Display SVG
                handler.displaySVG(segment.svg, visualContainer.id);
              });
            }
          }
        } else if (response && response.svg) {
          // Single segment (backward compatible)
          const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
          if (handler) {
            handler.removeLoadingState(containerId);
            handler.displaySVG(response.svg, containerId);
          } else {
            // Fallback: direct SVG injection
            const container = document.getElementById(containerId);
            if (container) {
              container.innerHTML = response.svg.replace(/<script[\s\S]*?<\/script>/gi, '');
            }
          }
        } else if (response && response.error) {
          showError(response.error);
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
 * Show sidebar
 * @param {string} mode - 'SINGLE' or 'AGENTIC'
 * @param {object} options - Optional: { preserveSelection: boolean, selectedText: string }
 */
function showSidebar(mode, options = {}) {
  // Only clear selection if not preserving it (for manual mode)
  if (!options.preserveSelection) {
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }
  }
  
  // Always remove existing sidebar first to ensure clean state
  if (sidebar) {
    // Clean up resize observer
    if (sidebar._resizeObserver) {
      sidebar._resizeObserver.disconnect();
    }
    // Clean up resize handle listeners
    const resizeHandle = sidebar.querySelector('.paperlens-resize-handle');
    if (resizeHandle && resizeHandle._cleanup) {
      resizeHandle._cleanup();
    }
    sidebar.remove();
    sidebar = null;
  }

  // Reset state
  isSidebarOpen = false;
  currentMode = null;

  // Now create new sidebar
  currentMode = mode;
  isSidebarOpen = true;

  // Create sidebar
  sidebar = document.createElement('div');
  sidebar.id = 'paperlens-sidebar';
  sidebar.className = `paperlens-sidebar paperlens-mode-${mode.toLowerCase()}`;

  if (mode === 'SINGLE') {
    // Show selected text if provided
    const selectedTextSection = options.selectedText ? `
      <div class="paperlens-selected-text">
        <div class="paperlens-selected-text-label">Selected Text:</div>
        <div class="paperlens-selected-text-content">${escapeHtml(options.selectedText.substring(0, 500))}${options.selectedText.length > 500 ? '...' : ''}</div>
      </div>
    ` : '';
    
    sidebar.innerHTML = `
      <div class="paperlens-sidebar-header">
        <div>
          <span class="paperlens-logo">✦ PaperLens</span>
          <span class="paperlens-mode-badge">Manual</span>
        </div>
        <div class="paperlens-header-buttons">
          <button class="paperlens-collapse-btn" id="paperlens-collapse" title="Collapse sidebar">◀</button>
          <button class="paperlens-close-btn" id="paperlens-close" title="Close sidebar">×</button>
        </div>
      </div>
      <div class="paperlens-sidebar-content">
        ${selectedTextSection}
        <div id="paperlens-single-visual"></div>
      </div>
    `;
  } else if (mode === 'AGENTIC') {
    sidebar.innerHTML = `
      <div class="paperlens-sidebar-header">
        <div>
          <span class="paperlens-logo">✦ PaperLens</span>
          <span class="paperlens-mode-badge">Agentic</span>
        </div>
        <div class="paperlens-header-buttons">
          <button class="paperlens-collapse-btn" id="paperlens-collapse" title="Collapse sidebar">◀</button>
          <button class="paperlens-close-btn" id="paperlens-close" title="Close sidebar">×</button>
        </div>
      </div>
      <div class="paperlens-sidebar-content">
        <div class="paperlens-paper-title" id="paperlens-paper-title">Loading...</div>
        <div class="paperlens-progress">
          <div class="paperlens-progress-text" id="paperlens-progress-text">Analyzing...</div>
          <div class="paperlens-progress-bar">
            <div class="paperlens-progress-fill" id="paperlens-progress-fill"></div>
          </div>
        </div>
        <div class="paperlens-sections" id="paperlens-sections"></div>
      </div>
    `;
  }

  // Check if body exists (might not exist on SVG file pages)
  if (!document.body) {
    console.error('[Content] Cannot show sidebar: document.body is null');
    return;
  }

  document.body.appendChild(sidebar);

  // Prevent sidebar from being selected when user selects text on main page
  sidebar.addEventListener('mousedown', (e) => {
    // Stop selection from extending into sidebar
    e.stopPropagation();
  });
  
  sidebar.addEventListener('selectstart', (e) => {
    // Prevent text selection in sidebar (except for specific elements)
    const target = e.target;
    const isSelectable = target.closest('.paperlens-section-heading, .paperlens-paper-title, .napkin-visual-wrapper, .napkin-btn');
    if (!isSelectable) {
      e.preventDefault();
    }
  });

  // Shrink main content by adjusting body margin-right (more reliable than width)
  const sidebarWidth = parseInt(getComputedStyle(sidebar).width) || 420;
  sidebar._lastWidth = sidebarWidth; // Store initial width
  
  // Use margin-right approach which works better across different website layouts
  // This pushes content to the left without breaking layouts
  const originalBodyMarginRight = document.body.style.marginRight || '';
  const originalBodyWidth = document.body.style.width || '';
  const originalBodyOverflowX = document.body.style.overflowX || '';
  
  document.body.style.marginRight = `${sidebarWidth}px`;
  document.body.style.transition = 'margin-right 300ms ease-out';
  document.body.style.overflowX = 'hidden';
  
  // Store original values for cleanup
  sidebar._originalBodyMarginRight = originalBodyMarginRight;
  sidebar._originalBodyWidth = originalBodyWidth;
  sidebar._originalBodyOverflowX = originalBodyOverflowX;
  
  // Also try to adjust main content containers (common patterns)
  // Include more specific selectors for different websites
  const mainContainers = [
    document.querySelector('main'),
    document.querySelector('#main'),
    document.querySelector('.main'),
    document.querySelector('[role="main"]'),
    document.querySelector('article'),
    document.querySelector('.content'),
    document.querySelector('#content'),
    // ChatGPT and similar SPA patterns
    document.querySelector('[data-testid*="conversation"]'),
    document.querySelector('[class*="conversation"]'),
    document.querySelector('[class*="chat"]'),
    // Common wrapper patterns
    document.querySelector('.app'),
    document.querySelector('#app'),
    document.querySelector('.container'),
    document.querySelector('#container'),
    document.querySelector('.wrapper'),
    document.querySelector('#wrapper'),
    // Find the main scrollable container
    document.querySelector('[style*="overflow"]'),
  ].filter((el, index, self) => el !== null && self.indexOf(el) === index); // Remove duplicates
  
  mainContainers.forEach(container => {
    // Skip if container is too small (likely not the main content)
    const rect = container.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) return;
    
    const originalMarginRight = container.style.marginRight || '';
    container.style.marginRight = `${sidebarWidth}px`;
    container.style.transition = 'margin-right 300ms ease-out';
    if (!container._originalMarginRight) {
      container._originalMarginRight = originalMarginRight;
    }
  });
  
  sidebar._adjustedContainers = mainContainers;
  
  // Also try to find and adjust the viewport/root element
  // Some SPAs use a root div that needs adjustment
  const rootElements = [
    document.documentElement,
    document.querySelector('html'),
  ];
  
  rootElements.forEach(root => {
    if (root && root !== document.body) {
      const originalMarginRight = root.style.marginRight || '';
      root.style.marginRight = `${sidebarWidth}px`;
      root.style.transition = 'margin-right 300ms ease-out';
      if (!root._originalMarginRight) {
        root._originalMarginRight = originalMarginRight;
      }
    }
  });
  
  sidebar._adjustedRootElements = rootElements.filter(el => el && el !== document.body);
  
  // Listen for sidebar resize
  try {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        // Don't update if collapsed (it's intentionally small)
        if (sidebar._isCollapsed) continue;
        
        sidebar._lastWidth = newWidth; // Store for restore
        if (document.body) {
          document.body.style.marginRight = `${newWidth}px`;
        }
        // Update main containers too
        if (sidebar._adjustedContainers) {
          sidebar._adjustedContainers.forEach(container => {
            container.style.marginRight = `${newWidth}px`;
          });
        }
        // Update root elements too
        if (sidebar._adjustedRootElements) {
          sidebar._adjustedRootElements.forEach(root => {
            root.style.marginRight = `${newWidth}px`;
          });
        }
      }
    });
    
    resizeObserver.observe(sidebar);
    
    // Store observer for cleanup
    sidebar._resizeObserver = resizeObserver;
  } catch (error) {
    console.warn('[Content] ResizeObserver not supported:', error);
  }

  // Slide in animation
  requestAnimationFrame(() => {
    sidebar.style.transform = 'translateX(0)';
  });

  // Close button handler
  const closeBtn = sidebar.querySelector('#paperlens-close');
  if (closeBtn) {
    closeBtn.onclick = closeSidebar;
  }

  // Collapse/Expand button handler
  const collapseBtn = sidebar.querySelector('#paperlens-collapse');
  if (collapseBtn) {
    collapseBtn.onclick = (e) => {
      e.stopPropagation();
      toggleSidebarCollapse();
    };
  }

  // Initialize collapsed state
  sidebar._isCollapsed = false;
  
  // When collapsed, clicking anywhere on sidebar expands it
  sidebar.addEventListener('click', (e) => {
    if (sidebar._isCollapsed && !e.target.closest('.paperlens-close-btn')) {
      toggleSidebarCollapse();
    }
  });

  // Add resize handle (only if sidebar was successfully created)
  if (sidebar && sidebar.appendChild) {
    addResizeHandle(sidebar);
  }
}

/**
 * Add resize handle to sidebar
 */
function addResizeHandle(sidebarElement) {
  if (!sidebarElement || !sidebarElement.appendChild) {
    console.warn('[Content] Cannot add resize handle: sidebar element is null or invalid');
    return;
  }

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'paperlens-resize-handle';
  resizeHandle.style.position = 'absolute';
  resizeHandle.style.left = '0';
  resizeHandle.style.top = '0';
  resizeHandle.style.bottom = '0';
  resizeHandle.style.width = '4px';
  resizeHandle.style.cursor = 'ew-resize';
  resizeHandle.style.zIndex = '10000';
  resizeHandle.style.background = 'transparent';
  resizeHandle.style.transition = 'background 0.2s';
  
  resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = 'var(--accent)';
    resizeHandle.style.opacity = '0.5';
  });
  
  resizeHandle.addEventListener('mouseleave', () => {
    resizeHandle.style.background = 'transparent';
  });

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    if (!sidebarElement) return;
    isResizing = true;
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(sidebarElement).width);
    if (document.body) {
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
  });

  const handleMouseMove = (e) => {
    if (!isResizing || !sidebarElement) return;
    
    // Don't resize if collapsed
    if (sidebarElement._isCollapsed) return;
    
    const diff = startX - e.clientX; // Inverted because sidebar is on right
    const newWidth = Math.max(300, Math.min(800, startWidth + diff));
    sidebarElement.style.width = `${newWidth}px`;
    sidebarElement._lastWidth = newWidth; // Store for restore after collapse
    
    // Update body margin-right if body exists
    if (document.body) {
      document.body.style.marginRight = `${newWidth}px`;
    }
    // Update main containers too
    if (sidebarElement._adjustedContainers) {
      sidebarElement._adjustedContainers.forEach(container => {
        container.style.marginRight = `${newWidth}px`;
      });
    }
    // Update root elements too
    if (sidebarElement._adjustedRootElements) {
      sidebarElement._adjustedRootElements.forEach(root => {
        root.style.marginRight = `${newWidth}px`;
      });
    }
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

  try {
    sidebarElement.appendChild(resizeHandle);
  } catch (error) {
    console.error('[Content] Failed to append resize handle:', error);
  }
}

/**
 * Toggle sidebar collapse/expand
 */
function toggleSidebarCollapse() {
  if (!sidebar) return;
  
  sidebar._isCollapsed = !sidebar._isCollapsed;
  const collapseBtn = sidebar.querySelector('#paperlens-collapse');
  
  if (sidebar._isCollapsed) {
    // Collapse: minimize to thin strip
    sidebar.classList.add('paperlens-collapsed');
    sidebar.style.width = '40px';
    sidebar.style.minWidth = '40px';
    if (collapseBtn) {
      collapseBtn.innerHTML = '▶';
      collapseBtn.title = 'Expand sidebar';
    }
    
    // Update body margin
    if (document.body) {
      document.body.style.marginRight = '40px';
    }
    if (sidebar._adjustedContainers) {
      sidebar._adjustedContainers.forEach(container => {
        container.style.marginRight = '40px';
      });
    }
  } else {
    // Expand: restore to previous width or default
    sidebar.classList.remove('paperlens-collapsed');
    const restoredWidth = sidebar._lastWidth || 420;
    sidebar.style.width = `${restoredWidth}px`;
    sidebar.style.minWidth = '300px'; // Restore min-width
    if (collapseBtn) {
      collapseBtn.innerHTML = '◀';
      collapseBtn.title = 'Collapse sidebar';
    }
    
    // Update body margin
    if (document.body) {
      document.body.style.marginRight = `${restoredWidth}px`;
    }
    if (sidebar._adjustedContainers) {
      sidebar._adjustedContainers.forEach(container => {
        container.style.marginRight = `${restoredWidth}px`;
      });
    }
    if (sidebar._adjustedRootElements) {
      sidebar._adjustedRootElements.forEach(root => {
        root.style.marginRight = `${restoredWidth}px`;
      });
    }
  }
}

/**
 * Close sidebar
 */
function closeSidebar() {
  if (!sidebar) {
    // Ensure state is reset even if sidebar element is missing
    isSidebarOpen = false;
    currentMode = null;
    if (document.body) {
      document.body.style.marginRight = '';
      document.body.style.width = '';
      document.body.style.overflowX = '';
    }
    return;
  }

  sidebar.style.transform = 'translateX(420px)';
  
  // Restore body styles
  if (document.body) {
    document.body.style.marginRight = sidebar._originalBodyMarginRight || '';
    document.body.style.width = sidebar._originalBodyWidth || '';
    document.body.style.overflowX = sidebar._originalBodyOverflowX || '';
  }
  
  // Restore main container styles
  if (sidebar._adjustedContainers) {
    sidebar._adjustedContainers.forEach(container => {
      container.style.marginRight = container._originalMarginRight || '';
      container.style.transition = '';
    });
  }
  
  // Restore root element styles
  if (sidebar._adjustedRootElements) {
    sidebar._adjustedRootElements.forEach(root => {
      root.style.marginRight = root._originalMarginRight || '';
      root.style.transition = '';
    });
  }

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
  const container = sidebar?.querySelector('.paperlens-sidebar-content');
  if (container) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'paperlens-error';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
  }
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
            showError('PDF files are not supported. Please use the HTML version of the paper.');
            banner.remove();
            return;
          }

          // Update sidebar with paper title
          const titleEl = document.getElementById('paperlens-paper-title');
          if (titleEl) {
            titleEl.textContent = paperData.title || 'Research Paper';
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
            showError('PDF files are not supported. Please use the HTML version of the paper.');
            banner.remove();
            return;
          }

          // Update sidebar with paper title
          const titleEl = document.getElementById('paperlens-paper-title');
          if (titleEl) {
            titleEl.textContent = paperData.title || 'Research Paper';
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
    const plan = message.data || message.plan || [];
    const totalSections = plan.filter(p => !p.skip).length;
    
    const progressText = document.getElementById('paperlens-progress-text');
    if (progressText) {
      progressText.textContent = `0 / ${totalSections} sections visualized`;
    }

    // Create loading skeletons for each section
    const sectionsContainer = document.getElementById('paperlens-sections');
    if (sectionsContainer) {
      plan.filter(p => !p.skip).forEach(planItem => {
        const card = document.createElement('div');
        card.id = `paperlens-section-${planItem.sectionId}`;
        card.className = 'paperlens-section-card';
        card.innerHTML = `
          <div class="paperlens-section-header">
            <h3 class="paperlens-section-heading">${planItem.heading || planItem.sectionId}</h3>
          </div>
          <div class="paperlens-section-visual" id="paperlens-visual-${planItem.sectionId}"></div>
        `;
        sectionsContainer.appendChild(card);
        
        // Show loading state
        const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
        if (handler) {
          handler.showLoadingState(`paperlens-visual-${planItem.sectionId}`);
        }
      });
    }

    // Remove banner
    const banner = document.getElementById('paperlens-banner');
    if (banner) {
      banner.remove();
    }
  }

  if (message.type === 'diagram') {
    const { sectionId, svg, heading } = message;
    
    // Check if this is a segment ID (format: "section-X-segment-Y")
    const segmentMatch = sectionId.match(/^(.+)-segment-(\d+)$/);
    const baseSectionId = segmentMatch ? segmentMatch[1] : sectionId;
    const segmentId = segmentMatch ? segmentMatch[2] : null;
    
    // Find section card (should already exist from plan event)
    let card = document.getElementById(`paperlens-section-${baseSectionId}`);
    if (!card) {
      // Fallback: create card if it doesn't exist
      const sectionsContainer = document.getElementById('paperlens-sections');
      if (sectionsContainer) {
        card = document.createElement('div');
        card.id = `paperlens-section-${baseSectionId}`;
        card.className = 'paperlens-section-card';
        
        // Create segments container for multiple segments
        const segmentsContainer = document.createElement('div');
        segmentsContainer.className = 'paperlens-segments-container';
        segmentsContainer.id = `paperlens-segments-${baseSectionId}`;
        
        card.innerHTML = `
          <div class="paperlens-section-header">
            <h3 class="paperlens-section-heading">${heading || baseSectionId}</h3>
          </div>
        `;
        card.appendChild(segmentsContainer);
        sectionsContainer.appendChild(card);
      }
    }

    // Remove loading state and display SVG
    // napkin-handler.js defines window.paperLensNapkinHandler
    const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
    
    if (card && handler) {
      if (segmentId) {
        // This is a segment - add it to the segments container
        let segmentsContainer = card.querySelector(`#paperlens-segments-${baseSectionId}`);
        if (!segmentsContainer) {
          // Create segments container if it doesn't exist
          segmentsContainer = document.createElement('div');
          segmentsContainer.className = 'paperlens-segments-container';
          segmentsContainer.id = `paperlens-segments-${baseSectionId}`;
          card.appendChild(segmentsContainer);
        }
        
        // Check if segment visual already exists
        let segmentVisual = document.getElementById(`paperlens-visual-${sectionId}`);
        if (!segmentVisual) {
          // Create segment div
          const segmentDiv = document.createElement('div');
          segmentDiv.className = 'paperlens-segment';
          segmentDiv.id = `paperlens-segment-${sectionId}`;
          
          // Add segment title
          const segmentTitle = document.createElement('div');
          segmentTitle.className = 'paperlens-segment-heading';
          segmentTitle.textContent = heading || `Segment ${segmentId}`;
          segmentDiv.appendChild(segmentTitle);
          
          // Add visual container
          segmentVisual = document.createElement('div');
          segmentVisual.id = `paperlens-visual-${sectionId}`;
          segmentVisual.className = 'paperlens-section-visual';
          segmentDiv.appendChild(segmentVisual);
          
          segmentsContainer.appendChild(segmentDiv);
          
          // Show loading state
          handler.showLoadingState(segmentVisual.id);
        }
        
        // Display SVG
        if (svg) {
          handler.removeLoadingState(`paperlens-visual-${sectionId}`);
          handler.displaySVG(svg, `paperlens-visual-${sectionId}`);
        } else {
          const visualContainer = document.getElementById(`paperlens-visual-${sectionId}`);
          if (visualContainer) {
            visualContainer.innerHTML = '<p class="paperlens-error">Visual unavailable for this segment</p>';
          }
        }
      } else {
        // Single visual for section (backward compatible)
        handler.removeLoadingState(`paperlens-visual-${sectionId}`);
        if (svg) {
          handler.displaySVG(svg, `paperlens-visual-${sectionId}`);
        } else {
          const visualContainer = document.getElementById(`paperlens-visual-${sectionId}`);
          if (visualContainer) {
            visualContainer.innerHTML = '<p class="paperlens-error">Visual unavailable for this section</p>';
          }
        }
      }
    } else {
      // Fallback: direct SVG injection
      const visualContainer = document.getElementById(`paperlens-visual-${sectionId}`);
      if (visualContainer && svg) {
        visualContainer.innerHTML = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
      }
    }

    // Update progress
    const sectionsContainer = document.getElementById('paperlens-sections');
    if (sectionsContainer) {
      // Count completed sections (those with SVG, not loading or error)
      const allCards = sectionsContainer.querySelectorAll('.paperlens-section-card');
      const completedCards = Array.from(allCards).filter(card => {
        const visual = card.querySelector('.paperlens-section-visual');
        if (!visual) return false;
        // Has SVG content (not loading skeleton, not error)
        return visual.querySelector('svg') || visual.querySelector('.napkin-visual-wrapper');
      });
      
      const completed = completedCards.length;
      const total = allCards.length;
      const progressText = document.getElementById('paperlens-progress-text');
      const progressFill = document.getElementById('paperlens-progress-fill');
      
      if (progressText && total > 0) {
        progressText.textContent = `${completed} / ${total} sections visualized`;
      }
      if (progressFill && total > 0) {
        progressFill.style.width = `${(completed / total) * 100}%`;
      }
    }
  }

  if (message.type === 'complete') {
    const progressText = document.getElementById('paperlens-progress-text');
    if (progressText) {
      progressText.textContent = 'Analysis complete!';
    }
    const progressFill = document.getElementById('paperlens-progress-fill');
    if (progressFill) {
      progressFill.style.width = '100%';
    }
  }

  if (message.type === 'section_error') {
    const { sectionId, message: errorMsg, heading } = message;
    const card = document.getElementById(`paperlens-section-${sectionId}`);
    if (card) {
      const visualContainer = card.querySelector('.paperlens-section-visual');
      if (visualContainer) {
        const handler = window.paperLensNapkinHandler || (typeof paperLensNapkinHandler !== 'undefined' ? paperLensNapkinHandler : null);
        if (handler) {
          handler.removeLoadingState(`paperlens-visual-${sectionId}`);
        }
        visualContainer.innerHTML = `<p class="paperlens-error">Error: ${errorMsg || 'Failed to generate visual'}</p>`;
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

// Inject CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = chrome.runtime.getURL('sidebar.css');
document.head.appendChild(link);

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
