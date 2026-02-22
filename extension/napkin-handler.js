/**
 * Napkin Handler (Frontend)
 * Handles receiving and displaying Napkin SVG output
 */

/**
 * Sanitize SVG by removing script tags
 * @param {string} svg - SVG string
 * @returns {string} Sanitized SVG
 */
function sanitizeSVG(svg) {
  return svg.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/**
 * Display SVG in container
 * @param {string} svgString - SVG content
 * @param {string} containerId - Container element ID
 */
function displaySVG(svgString, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`[Napkin Handler] Container ${containerId} not found`);
    return;
  }

  // Sanitize SVG
  const sanitized = sanitizeSVG(svgString);

  // Create wrapper div
  const wrapper = document.createElement('div');
  wrapper.className = 'napkin-visual-wrapper';
  
  // Parse and modify SVG
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(sanitized, 'image/svg+xml');
  const svgElement = svgDoc.querySelector('svg');
  
  if (!svgElement) {
    wrapper.innerHTML = '<p class="error">Invalid SVG content</p>';
    container.appendChild(wrapper);
    return;
  }

  // Make SVG responsive
  svgElement.setAttribute('width', '100%');
  svgElement.setAttribute('height', 'auto');
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgElement.style.maxWidth = '100%';
  svgElement.style.height = 'auto';

  // Add pan/zoom functionality
  let isPanning = false;
  let startX, startY;
  let viewBox = svgElement.getAttribute('viewBox') || `0 0 ${svgElement.getAttribute('width') || 800} ${svgElement.getAttribute('height') || 600}`;
  let [x, y, w, h] = viewBox.split(' ').map(Number);

  svgElement.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svgElement.style.cursor = 'grab';

  svgElement.addEventListener('mousedown', (e) => {
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    svgElement.style.cursor = 'grabbing';
  });

  svgElement.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = (e.clientX - startX) * (w / svgElement.clientWidth);
    const dy = (e.clientY - startY) * (h / svgElement.clientHeight);
    x -= dx;
    y -= dy;
    svgElement.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    startX = e.clientX;
    startY = e.clientY;
  });

  svgElement.addEventListener('mouseup', () => {
    isPanning = false;
    svgElement.style.cursor = 'grab';
  });

  svgElement.addEventListener('mouseleave', () => {
    isPanning = false;
    svgElement.style.cursor = 'grab';
  });

  svgElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    const rect = svgElement.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;
    const mouseY = (e.clientY - rect.top) / rect.height;
    
    const newW = w * delta;
    const newH = h * delta;
    x = x + (w - newW) * mouseX;
    y = y + (h - newH) * mouseY;
    w = newW;
    h = newH;
    
    svgElement.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }, { passive: false });

  // Make SVG clickable for full-screen view
  svgElement.style.cursor = 'pointer';
  svgElement.onclick = () => {
    showFullScreenSVG(sanitized);
  };

  wrapper.appendChild(svgElement);

  // Add action buttons
  const actions = document.createElement('div');
  actions.className = 'napkin-actions';
  
  const viewFullBtn = document.createElement('button');
  viewFullBtn.className = 'napkin-btn napkin-btn-view';
  viewFullBtn.textContent = 'View Full Screen';
  viewFullBtn.onclick = () => {
    showFullScreenSVG(sanitized);
  };
  
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'napkin-btn napkin-btn-download';
  downloadBtn.textContent = 'Download SVG';
  downloadBtn.onclick = () => {
    const blob = new Blob([sanitized], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'paperlens-visual.svg';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'napkin-btn napkin-btn-copy';
  copyBtn.textContent = 'Copy SVG';
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(sanitized);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy SVG';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  actions.appendChild(viewFullBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(copyBtn);
  wrapper.appendChild(actions);

  // Fade in animation
  wrapper.style.opacity = '0';
  container.appendChild(wrapper);
  
  requestAnimationFrame(() => {
    wrapper.style.transition = 'opacity 400ms ease-in';
    wrapper.style.opacity = '1';
  });
}

/**
 * Show loading state
 * @param {string} containerId - Container element ID
 * @param {string} message - Optional loading message
 */
function showLoadingState(containerId, message = 'Generating...') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const skeleton = document.createElement('div');
  skeleton.className = 'napkin-loading-skeleton';
  skeleton.id = `${containerId}-loading`;
  
  const shimmer = document.createElement('div');
  shimmer.className = 'napkin-shimmer';
  skeleton.appendChild(shimmer);
  
  const text = document.createElement('div');
  text.className = 'napkin-loading-text';
  text.textContent = message;
  skeleton.appendChild(text);
  
  container.appendChild(skeleton);
}

/**
 * Remove loading state
 * @param {string} containerId - Container element ID
 */
function removeLoadingState(containerId) {
  const loading = document.getElementById(`${containerId}-loading`);
  if (loading) {
    loading.remove();
  }
}

/**
 * Show SVG in full-screen modal
 * @param {string} svgString - SVG content
 */
function showFullScreenSVG(svgString) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'paperlens-fullscreen-modal';
  modal.className = 'paperlens-fullscreen-modal';
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'paperlens-fullscreen-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    modal.remove();
    document.body.style.overflow = '';
  };
  
  // Create SVG container
  const svgContainer = document.createElement('div');
  svgContainer.className = 'paperlens-fullscreen-svg-container';
  svgContainer.innerHTML = svgString.replace(/<script[\s\S]*?<\/script>/gi, '');
  
  // Make SVG responsive in fullscreen
  const svg = svgContainer.querySelector('svg');
  if (svg) {
    svg.style.maxWidth = '100%';
    svg.style.maxHeight = '100%';
    svg.style.width = 'auto';
    svg.style.height = 'auto';
  }
  
  modal.appendChild(closeBtn);
  modal.appendChild(svgContainer);
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  
  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
  
  // Close on background click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    }
  };
}

// Export for browser context
if (typeof window !== 'undefined') {
  window.paperLensNapkinHandler = {
    displaySVG,
    showLoadingState,
    removeLoadingState,
  };
}

// Export for Node.js context
if (typeof module !== 'undefined') {
  module.exports = {
    displaySVG,
    showLoadingState,
    removeLoadingState,
  };
}
