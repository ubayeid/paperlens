/**
 * Content Script
 * Handles both agentic and manual modes
 * v2.2 - Hackathon Final: full SVG height, click-to-expand, clean headings, plan-order sorting
 */

const SERVER_URL = 'http://localhost:3000';

let sidebar = null;
let sidebarShadow = null;
let sidebarHost = null;
let isSidebarOpen = false;
let currentMode = null;
let noContentShown = false;

// Stores card IDs in the order the plan arrived so we can re-sort after async visuals land
let planOrder = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSidebarElement(id) {
  if (!sidebarShadow) return null;
  return sidebarShadow.querySelector(`#${id}`);
}

function querySidebar(selector) {
  if (!sidebarShadow) return null;
  return sidebarShadow.querySelector(selector);
}

function querySidebarAll(selector) {
  if (!sidebarShadow) return [];
  return Array.from(sidebarShadow.querySelectorAll(selector));
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

/**
 * Clean up section headings for display.
 * Strips leading section numbers like "2.1 ", "3A ", "4. ", "Section 3: " etc.
 */
function cleanHeading(heading) {
  if (!heading) return heading;
  return heading
    // "Section 3: Foo" or "section 2.1 Foo"
    .replace(/^section\s+[\d.]+[\s:\-–]*/i, '')
    // "2.1 Foo" or "3A Foo" or "4. Foo"
    .replace(/^[\d]+[A-Za-z]?\.?\d*\.?\d*[\s:\-–]+/, '')
    // lone uppercase letter prefix like "A Introduction"
    .replace(/^[A-Z]\s+(?=[A-Z])/, '')
    .trim();
}

// ─── Fullscreen modal (lives inside shadow DOM) ───────────────────────────────

/**
 * Show an SVG fullscreen inside the shadow root so it inherits z-index properly.
 */
function showCardFullscreen(svgHTML) {
  if (!sidebarShadow) return;

  // Reuse or create the modal shell
  let modal = sidebarShadow.querySelector('#pl-fullscreen-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pl-fullscreen-modal';
    sidebarShadow.appendChild(modal);
  }

  modal.innerHTML = `
    <div id="pl-fs-backdrop"></div>
    <div id="pl-fs-box">
      <button id="pl-fs-close" title="Close (Esc)">×</button>
      <div id="pl-fs-content">${svgHTML}</div>
    </div>
  `;

  // Style the modal elements directly (shadow DOM, so inline styles are safest)
  Object.assign(modal.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    animation: 'plFadeIn 0.18s ease',
  });

  const backdrop = modal.querySelector('#pl-fs-backdrop');
  Object.assign(backdrop.style, {
    position: 'absolute',
    inset: '0',
    background: 'rgba(0,0,0,0.88)',
    backdropFilter: 'blur(4px)',
  });

  const box = modal.querySelector('#pl-fs-box');
  Object.assign(box.style, {
    position: 'relative',
    background: 'white',
    borderRadius: '14px',
    padding: '28px',
    maxWidth: '90vw',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
    animation: 'plScaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
    zIndex: '1',
  });

  const closeBtn = modal.querySelector('#pl-fs-close');
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '10px',
    right: '12px',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.08)',
    border: 'none',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#333',
    zIndex: '2',
    transition: 'background 0.15s',
  });

  const content = modal.querySelector('#pl-fs-content');
  Object.assign(content.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  // Make the SVG fill the box nicely
  const svgEl = content.querySelector('svg');
  if (svgEl) {
    svgEl.style.width = 'min(80vw, 900px)';
    svgEl.style.height = 'auto';
    svgEl.style.maxHeight = '80vh';
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
  }

  // Close logic
  const close = () => { modal.style.display = 'none'; };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);

  modal.style.display = 'flex';
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Re-order rendered cards to match the original plan order so visuals
 * that arrive out of sequence don't scramble the list.
 */
function sortCardsToMatchPlan() {
  if (!planOrder.length) return;
  const container = querySidebar('#pl-cards-container');
  if (!container) return;

  const cards = querySidebarAll('.pl-card');
  cards.sort((a, b) => {
    const ai = planOrder.indexOf(a.id);
    const bi = planOrder.indexOf(b.id);
    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
  });
  cards.forEach(c => container.appendChild(c));
}

// ─── SVG injection helper (DRY) ───────────────────────────────────────────────

/**
 * Inject a cleaned SVG into a card body and wire up click-to-expand.
 */
function injectSVGIntoCard(cardBody, rawSvg) {
  const cleanSvg = rawSvg.replace(/<script[\s\S]*?<\/script>/gi, '');

  cardBody.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;

  const svgEl = cardBody.querySelector('svg');
  if (svgEl) {
    svgEl.style.width = '100%';
    svgEl.style.height = 'auto';
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
  }

  // Click-to-expand fullscreen
  const wrapper = cardBody.querySelector('.napkin-visual-wrapper');
  if (wrapper) {
    wrapper.addEventListener('click', () => showCardFullscreen(cleanSvg));
  }
}

// ─── No-content / server-down states ─────────────────────────────────────────

function showNoContentMessage(reason) {
  if (!sidebarShadow) return;
  noContentShown = true;

  const container = querySidebar('#pl-cards-container');
  if (!container) return;

  const progressArea = querySidebar('#pl-progress-area');
  if (progressArea) progressArea.style.display = 'none';

  const banner = document.getElementById('paperlens-banner');
  if (banner) banner.remove();

  container.innerHTML = `
    <div class="pl-empty-state">
      <div class="pl-empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="18" stroke="#3d3d50" stroke-width="2"/>
          <path d="M14 20 Q20 12 26 20 Q20 28 14 20Z" stroke="#6366f1" stroke-width="1.5" fill="none" opacity="0.6"/>
          <circle cx="20" cy="20" r="3" fill="#6366f1" opacity="0.8"/>
          <path d="M20 10 L20 8M20 32 L20 30M10 20 L8 20M32 20 L30 20" stroke="#3d3d50" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="pl-empty-title">Nothing to visualize here</div>
      <div class="pl-empty-reason">${escapeHtml(reason || 'This section contains narrative prose without clear structure to visualize.')}</div>

      <div class="pl-empty-tips">
        <div class="pl-tips-label">Try instead:</div>
        <div class="pl-tip-item">
          <span class="pl-tip-icon">✦</span>
          <span>Highlight a paragraph with steps, comparisons, or concepts</span>
        </div>
        <div class="pl-tip-item">
          <span class="pl-tip-icon">✦</span>
          <span>Select text that explains a process or framework</span>
        </div>
        <div class="pl-tip-item">
          <span class="pl-tip-icon">✦</span>
          <span>Try a different section of the page</span>
        </div>
      </div>

      <div class="pl-empty-actions">
        <button class="pl-retry-btn" id="pl-retry-analysis">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7C2 4.24 4.24 2 7 2C8.38 2 9.63 2.56 10.54 3.46L9 5H13V1L11.54 2.46C10.27 1.13 8.73 0 7 0C3.13 0 0 3.13 0 7H2ZM12 7C12 9.76 9.76 12 7 12C5.62 12 4.37 11.44 3.46 10.54L5 9H1V13L2.46 11.54C3.73 12.87 5.27 14 7 14C10.87 14 14 10.87 14 7H12Z" fill="currentColor"/>
          </svg>
          Retry Analysis
        </button>
        <button class="pl-highlight-tip-btn" id="pl-close-no-content">Close</button>
      </div>
    </div>
  `;

  querySidebar('#pl-retry-analysis')?.addEventListener('click', () => {
    noContentShown = false;
    closeSidebar();
    setTimeout(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'A', ctrlKey: true, shiftKey: true, bubbles: true,
      }));
    }, 300);
  });

  querySidebar('#pl-close-no-content')?.addEventListener('click', closeSidebar);
}

function showServerDownState() {
  if (!sidebarShadow) return;

  const progressArea = querySidebar('#pl-progress-area');
  if (progressArea) progressArea.style.display = 'none';

  const container = querySidebar('#pl-cards-container');
  if (!container) return;

  container.innerHTML = `
    <div class="pl-empty-state">
      <div class="pl-empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="18" stroke="#3d3d50" stroke-width="2"/>
          <path d="M20 12 L20 22" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="20" cy="28" r="1.5" fill="#ef4444"/>
        </svg>
      </div>
      <div class="pl-empty-title" style="color:#f87171;">Server not running</div>
      <div class="pl-empty-reason">PaperLens needs its local server to analyze pages.</div>

      <div class="pl-empty-tips">
        <div class="pl-tips-label">Start the server</div>
        <div class="pl-tip-item" style="font-family:monospace;background:#0d0d11;padding:8px 10px;border-radius:6px;border:1px solid #2a2a38;color:#a5b4fc;font-size:11px;display:block;word-break:break-all;">
          cd server &amp;&amp; npm start
        </div>
        <div class="pl-tip-item" style="margin-top:10px;">
          <span class="pl-tip-icon">✦</span>
          <span>Run the command above in your terminal, then click Retry below</span>
        </div>
        <div class="pl-tip-item">
          <span class="pl-tip-icon">✦</span>
          <span>Keep the terminal open while using PaperLens</span>
        </div>
      </div>

      <div class="pl-empty-actions">
        <button class="pl-retry-btn" id="pl-retry-server">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7C2 4.24 4.24 2 7 2C8.38 2 9.63 2.56 10.54 3.46L9 5H13V1L11.54 2.46C10.27 1.13 8.73 0 7 0C3.13 0 0 3.13 0 7H2ZM12 7C12 9.76 9.76 12 7 12C5.62 12 4.37 11.44 3.46 10.54L5 9H1V13L2.46 11.54C3.73 12.87 5.27 14 7 14C10.87 14 14 10.87 14 7H12Z" fill="currentColor"/>
          </svg>
          Retry
        </button>
        <button class="pl-highlight-tip-btn" id="pl-close-server-err">Close</button>
      </div>
    </div>
  `;

  querySidebar('#pl-retry-server')?.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="pl-paper-title" id="pl-paper-title" style="display:none;"></div>
      <div class="pl-empty" id="pl-empty-state" style="color:#3d3d50;font-size:12px;padding:24px 16px;text-align:center;">Scanning sections…</div>
    `;
    if (progressArea) {
      progressArea.style.display = '';
      const progressText = querySidebar('#pl-progress-text');
      if (progressText) progressText.textContent = 'Analyzing page…';
      const progressFill = querySidebar('#pl-progress-fill');
      if (progressFill) progressFill.style.width = '6%';
    }
    await triggerAgenticAnalysis();
  });

  querySidebar('#pl-close-server-err')?.addEventListener('click', closeSidebar);
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function updateProgress() {
  if (!sidebarShadow) return;

  const allCards = querySidebarAll('.pl-card');
  if (allCards.length === 0) return;

  const completedCards = querySidebarAll('.pl-card svg, .pl-card .pl-error').length;
  const percentage = Math.round((completedCards / allCards.length) * 100);

  const progressFill = querySidebar('#pl-progress-fill');
  if (progressFill) progressFill.style.width = `${Math.max(10, percentage)}%`;

  const progressText = querySidebar('#pl-progress-text');
  if (progressText && completedCards > 0) {
    progressText.textContent = `Generating visuals… ${completedCards}/${allCards.length}`;
  }
}

// ─── Error toast ──────────────────────────────────────────────────────────────

function showError(message) {
  console.error('[PaperLens] Error:', message);

  const sidebarElement = document.querySelector('#paperlens-sidebar') ||
    (sidebarHost && sidebarHost.shadowRoot && sidebarHost.shadowRoot.querySelector('#paperlens-sidebar'));
  const sidebarWidth = sidebarElement ? parseInt(getComputedStyle(sidebarHost).width) || 420 : 420;
  const isCollapsed = sidebarElement && sidebarElement.classList.contains('pl-collapsed');
  const effectiveSidebarWidth = isCollapsed ? 48 : sidebarWidth;

  const existing = document.getElementById('paperlens-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'paperlens-error-toast';

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: `${effectiveSidebarWidth + 12}px`,
    background: '#1e1014',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    color: '#f5f5f7',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    maxWidth: '300px',
    minWidth: '200px',
    zIndex: '999999',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    opacity: '0',
    transform: 'translateY(12px)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    cursor: 'pointer',
    wordWrap: 'break-word',
    lineHeight: '1.5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });

  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="color:#ef4444;flex-shrink:0;margin-top:1px;">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" stroke="currentColor"/>
          <path d="M7 4V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="7" cy="10" r="0.75" fill="currentColor"/>
        </svg>
      </div>
      <div style="flex:1;">${escapeHtml(message)}</div>
      <div style="color:#52525b;flex-shrink:0;font-size:16px;line-height:1;cursor:pointer" id="pl-toast-close">×</div>
    </div>
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('#pl-toast-close')?.addEventListener('click', dismiss);
  setTimeout(dismiss, 6000);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function getSidebarCSS() {
  return `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :host {
      all: initial;
      display: block;
    }

    @keyframes plFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    @keyframes plScaleIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes cardSlideIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    #paperlens-sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      height: 100vh;
      background: #0d0d11;
      border-left: 1px solid #1e1e28;
      z-index: 2147483647;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      box-shadow: -4px 0 32px rgba(0,0,0,0.6);
      color: #f5f5f7;
      font-size: 13px;
    }

    /* ── Header ── */
    .pl-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 18px;
      border-bottom: 1px solid #1e1e28;
      background: #0d0d11;
      flex-shrink: 0;
    }

    .pl-title {
      font-size: 13px;
      font-weight: 700;
      color: #f5f5f7;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.01em;
    }

    .pl-title-logo {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pl-badge {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #a5b4fc;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 2px 7px;
      border-radius: 20px;
      text-transform: uppercase;
    }

    .pl-header-btns {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .pl-collapse, .pl-close {
      width: 28px;
      height: 28px;
      background: transparent;
      border: 1px solid transparent;
      color: #71717a;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.15s ease;
      line-height: 1;
    }

    .pl-collapse:hover, .pl-close:hover {
      background: #1c1c24;
      color: #a1a1aa;
      border-color: #3a3a4a;
    }

    /* ── Progress ── */
    .pl-progress-area {
      padding: 10px 18px;
      border-bottom: 1px solid #1e1e28;
      background: #0f0f15;
      flex-shrink: 0;
    }

    .pl-progress-text {
      font-size: 11px;
      color: #71717a;
      margin-bottom: 6px;
      font-weight: 500;
    }

    .pl-progress-bar-bg {
      height: 3px;
      background: #1e1e28;
      border-radius: 2px;
      overflow: hidden;
    }

    .pl-progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #818cf8);
      border-radius: 2px;
      transition: width 0.4s ease;
      width: 0%;
    }

    /* ── Cards container ── */
    .pl-cards {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .pl-cards::-webkit-scrollbar { width: 5px; }
    .pl-cards::-webkit-scrollbar-track { background: transparent; }
    .pl-cards::-webkit-scrollbar-thumb { background: #2a2a38; border-radius: 3px; }
    .pl-cards::-webkit-scrollbar-thumb:hover { background: #3a3a4a; }

    /* ── Individual card ── */
    .pl-card {
      background: #111118;
      border: 1px solid #1e1e28;
      border-radius: 10px;
      overflow: visible;          /* must be visible so tall SVGs aren't clipped */
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      animation: cardSlideIn 0.25s ease forwards;
    }

    .pl-card:hover {
      border-color: #2a2a38;
    }

    .pl-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;    /* flex-start so multiline titles look right */
      padding: 10px 14px;
      gap: 8px;
    }

    .pl-card-title {
      font-size: 12px;
      font-weight: 600;
      color: #d4d4d8;
      flex: 1;
      line-height: 1.45;
      white-space: normal;        /* allow wrapping — no more ellipsis truncation */
      word-break: break-word;
    }

    .pl-card-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      padding-top: 1px;
    }

    .pl-card-type {
      font-size: 9px;
      font-weight: 600;
      color: #6366f1;
      background: rgba(99, 102, 241, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }

    .pl-card-body {
      padding: 0 14px 14px;
    }

    /* ── Loading skeleton ── */
    .pl-skeleton {
      height: 200px;              /* was 160px — taller so it hints at real diagram size */
      background: #16161e;
      border-radius: 8px;
      position: relative;
      overflow: hidden;
    }

    .pl-skeleton::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
      animation: shimmer 1.6s infinite;
    }

    /* ── Timer ── */
    .pl-timer {
      font-size: 10px;
      color: #52525b;
      font-variant-numeric: tabular-nums;
      padding: 4px 0 8px;
    }

    /* ── SVG visual wrapper ── */
    .napkin-visual-wrapper {
      background: white;
      border-radius: 8px;
      padding: 10px;
      margin-top: 6px;
      overflow: visible;          /* was hidden — was clipping tall SVGs */
      cursor: zoom-in;
      position: relative;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }

    .napkin-visual-wrapper:hover {
      box-shadow: 0 0 0 2px #6366f1, 0 4px 20px rgba(0,0,0,0.35);
      transform: translateY(-1px);
    }

    /* Expand hint icon */
    .napkin-visual-wrapper::after {
      content: '⤢';
      position: absolute;
      top: 6px;
      right: 8px;
      font-size: 14px;
      color: rgba(0,0,0,0.2);
      pointer-events: none;
      transition: color 0.15s;
      line-height: 1;
    }

    .napkin-visual-wrapper:hover::after {
      color: rgba(99, 102, 241, 0.65);
    }

    .napkin-visual-wrapper svg {
      display: block;
      width: 100% !important;
      height: auto !important;
      min-height: 160px;          /* guarantees a visible diagram area */
    }

    /* ── Error state ── */
    .pl-error {
      font-size: 11px;
      color: #f87171;
      background: rgba(239, 68, 68, 0.06);
      border: 1px solid rgba(239, 68, 68, 0.15);
      border-radius: 6px;
      padding: 10px 12px;
      line-height: 1.5;
    }

    /* ── Empty state ── */
    .pl-empty {
      text-align: center;
      padding: 32px 16px;
      color: #52525b;
      font-size: 12px;
      line-height: 1.7;
    }

    .pl-empty-state {
      padding: 28px 20px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      animation: cardSlideIn 0.3s ease forwards;
    }

    .pl-empty-icon {
      margin-bottom: 16px;
      opacity: 0.7;
    }

    .pl-empty-title {
      font-size: 14px;
      font-weight: 700;
      color: #e4e4e7;
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }

    .pl-empty-reason {
      font-size: 12px;
      color: #71717a;
      line-height: 1.6;
      margin-bottom: 20px;
      max-width: 300px;
    }

    .pl-empty-tips {
      background: #111118;
      border: 1px solid #1e1e28;
      border-radius: 10px;
      padding: 14px 16px;
      text-align: left;
      width: 100%;
      margin-bottom: 18px;
    }

    .pl-tips-label {
      font-size: 10px;
      font-weight: 700;
      color: #52525b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
    }

    .pl-tip-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #a1a1aa;
      line-height: 1.5;
    }

    .pl-tip-item:last-child { margin-bottom: 0; }

    .pl-tip-icon {
      color: #6366f1;
      flex-shrink: 0;
      font-size: 10px;
      margin-top: 2px;
    }

    .pl-empty-actions {
      display: flex;
      gap: 8px;
      width: 100%;
    }

    .pl-retry-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #a5b4fc;
      padding: 9px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .pl-retry-btn:hover {
      background: rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.5);
      color: #c7d2fe;
    }

    .pl-highlight-tip-btn {
      padding: 9px 14px;
      background: transparent;
      border: 1px solid #2a2a38;
      color: #71717a;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .pl-highlight-tip-btn:hover {
      background: #1c1c24;
      color: #a1a1aa;
      border-color: #3a3a4a;
    }

    /* ── Paper title ── */
    .pl-paper-title {
      font-size: 12px;
      font-weight: 600;
      color: #a1a1aa;
      padding: 8px 4px;
      border-bottom: 1px solid #1e1e28;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Single visual ── */
    .pl-single-visual {
      width: 100%;
      padding: 4px;
    }

    /* ── Segment ── */
    .pl-segment {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #1e1e28;
    }

    .pl-segment-heading {
      font-size: 10px;
      font-weight: 700;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }

    /* ── Selected text preview ── */
    .pl-selected-text {
      background: #111118;
      border: 1px solid #1e1e28;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }

    .pl-selected-label {
      font-size: 10px;
      font-weight: 700;
      color: #52525b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }

    .pl-selected-content {
      font-size: 12px;
      line-height: 1.6;
      color: #a1a1aa;
      max-height: 180px;
      overflow-y: auto;
    }

    /* ── Collapsed state ── */
    #paperlens-sidebar.pl-collapsed .pl-cards,
    #paperlens-sidebar.pl-collapsed .pl-progress-area {
      display: none;
    }

    #paperlens-sidebar.pl-collapsed .pl-title,
    #paperlens-sidebar.pl-collapsed .pl-badge {
      display: none;
    }

    /* ── Resize handle ── */
    .pl-resize-handle {
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      cursor: ew-resize;
      z-index: 10;
      transition: background 0.15s ease;
    }

    .pl-resize-handle:hover {
      background: rgba(99, 102, 241, 0.3);
    }
  `;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function getSidebarHTML(mode, options = {}) {
  const selectedTextSection = (mode === 'SINGLE' && options.selectedText) ? `
    <div class="pl-selected-text">
      <div class="pl-selected-label">Selected Text</div>
      <div class="pl-selected-content">${escapeHtml(options.selectedText.substring(0, 500))}${options.selectedText.length > 500 ? '…' : ''}</div>
    </div>
  ` : '';

  if (mode === 'SINGLE') {
    return `
      <div class="pl-header">
        <div class="pl-title">
          <div class="pl-title-logo">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#6366f1" stroke-width="1.5"/>
              <circle cx="8" cy="8" r="3" fill="#6366f1" opacity="0.6"/>
            </svg>
            PaperLens
          </div>
          <span class="pl-badge">Manual</span>
        </div>
        <div class="pl-header-btns">
          <button class="pl-collapse" id="pl-collapse-btn" title="Collapse">◀</button>
          <button class="pl-close" id="pl-close-btn" title="Close">×</button>
        </div>
      </div>
      <div class="pl-cards" id="pl-cards-container">
        ${selectedTextSection}
        <div class="pl-single-visual" id="pl-single-visual">
          <div class="pl-skeleton"></div>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="pl-header">
        <div class="pl-title">
          <div class="pl-title-logo">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#6366f1" stroke-width="1.5"/>
              <circle cx="8" cy="8" r="3" fill="#6366f1" opacity="0.6"/>
            </svg>
            PaperLens
          </div>
          <span class="pl-badge" id="pl-mode-badge">Agentic</span>
        </div>
        <div class="pl-header-btns">
          <button class="pl-collapse" id="pl-collapse-btn" title="Collapse">◀</button>
          <button class="pl-close" id="pl-close-btn" title="Close">×</button>
        </div>
      </div>
      <div class="pl-progress-area" id="pl-progress-area">
        <div class="pl-progress-text" id="pl-progress-text">Analyzing page…</div>
        <div class="pl-progress-bar-bg">
          <div class="pl-progress-bar-fill" id="pl-progress-fill" style="width:6%"></div>
        </div>
      </div>
      <div class="pl-cards" id="pl-cards-container">
        <div class="pl-paper-title" id="pl-paper-title" style="display:none;"></div>
        <div class="pl-empty" id="pl-empty-state" style="color:#3d3d50;font-size:12px;padding:24px 16px;text-align:center;">
          Scanning sections…
        </div>
      </div>
    `;
  }
}

// ─── Sidebar lifecycle ────────────────────────────────────────────────────────

function createSidebar(mode, options = {}) {
  const existing = document.getElementById('paperlens-host');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = 'paperlens-host';
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

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = getSidebarCSS();
  shadow.appendChild(style);

  const sidebarDiv = document.createElement('div');
  sidebarDiv.id = 'paperlens-sidebar';
  sidebarDiv.innerHTML = getSidebarHTML(mode, options);
  shadow.appendChild(sidebarDiv);

  document.body.appendChild(host);

  sidebarHost = host;
  sidebarShadow = shadow;
  sidebar = sidebarDiv;

  return shadow;
}

function applyWebpageShifting(sidebarWidth) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const minContentWidth = 720;
  const shouldOverlay = viewportWidth > 0 && (viewportWidth - sidebarWidth < minContentWidth);

  if (sidebar && !sidebar._originalStylesStored) {
    sidebar._originalStylesStored = true;
    sidebar._originalBodyMarginRight = document.body?.style.marginRight || '';
    sidebar._originalBodyPaddingRight = document.body?.style.paddingRight || '';
    sidebar._originalBodyBoxSizing = document.body?.style.boxSizing || '';
    sidebar._originalBodyOverflowX = document.body?.style.overflowX || '';
  }

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
    }
    body.paperlens-sidebar-open.paperlens-sidebar-overlay {
      padding-right: 0 !important;
    }
    html.paperlens-sidebar-open {
      overflow-x: hidden !important;
    }
  `;

  document.documentElement.style.setProperty('--paperlens-sidebar-width', `${sidebarWidth}px`);
  document.body.classList.add('paperlens-sidebar-open');
  document.documentElement.classList.add('paperlens-sidebar-open');
  document.body.classList.toggle('paperlens-sidebar-overlay', shouldOverlay);
  document.documentElement.classList.toggle('paperlens-sidebar-overlay', shouldOverlay);

  if (!shouldOverlay) {
    document.body.style.setProperty('padding-right', `${sidebarWidth}px`, 'important');
  } else {
    document.body.style.removeProperty('padding-right');
  }
  document.body.style.setProperty('box-sizing', 'border-box', 'important');
  document.body.style.setProperty('overflow-x', 'hidden', 'important');
}

function addResizeHandle(sidebarElement, hostElement) {
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pl-resize-handle';

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(hostElement).width) || 420;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  const handleMouseMove = (e) => {
    if (!isResizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.max(320, Math.min(700, startWidth + diff));
    hostElement.style.width = `${newWidth}px`;
    if (sidebar) sidebar._lastWidth = newWidth;
    applyWebpageShifting(newWidth);
  };

  const handleMouseUp = () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.userSelect = '';
    }
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  resizeHandle._cleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  try {
    sidebarElement.appendChild(resizeHandle);
    sidebarElement._resizeHandle = resizeHandle;
  } catch (error) {
    console.error('[Content] Failed to append resize handle:', error);
  }
}

function toggleSidebarCollapse() {
  if (!sidebar || !sidebarHost) return;
  sidebar._isCollapsed = !sidebar._isCollapsed;
  const collapseBtn = sidebarShadow.querySelector('#pl-collapse-btn');

  if (sidebar._isCollapsed) {
    sidebar.classList.add('pl-collapsed');
    sidebarHost.style.width = '48px';
    if (collapseBtn) collapseBtn.textContent = '▶';
    applyWebpageShifting(48);
  } else {
    sidebar.classList.remove('pl-collapsed');
    const restoredWidth = sidebar._lastWidth || 420;
    sidebarHost.style.width = `${restoredWidth}px`;
    if (collapseBtn) collapseBtn.textContent = '◀';
    applyWebpageShifting(restoredWidth);
  }
}

function closeSidebar() {
  if (sidebar && sidebar._resizeHandle && sidebar._resizeHandle._cleanup) {
    sidebar._resizeHandle._cleanup();
  }
  if (sidebar && sidebar._windowResizeHandler) {
    window.removeEventListener('resize', sidebar._windowResizeHandler);
  }
  if (sidebarHost) sidebarHost.remove();

  sidebarHost = null;
  sidebarShadow = null;
  sidebar = null;
  isSidebarOpen = false;
  currentMode = null;
  noContentShown = false;
  planOrder = [];

  document.body.classList.remove('paperlens-sidebar-open', 'paperlens-sidebar-overlay');
  document.documentElement.classList.remove('paperlens-sidebar-open', 'paperlens-sidebar-overlay');

  const closeStyleSheet = document.getElementById('paperlens-global-shift-styles');
  if (closeStyleSheet) closeStyleSheet.remove();

  if (window.paperlensMutationObserver) {
    window.paperlensMutationObserver.disconnect();
    window.paperlensMutationObserver = null;
  }

  document.body.style.removeProperty('padding-right');
  document.body.style.removeProperty('box-sizing');
  document.body.style.removeProperty('overflow-x');
}

function showSidebar(mode, options = {}) {
  const isChromePDF = window.location.protocol === 'chrome-extension:' &&
    window.location.hostname.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai');
  const isPDF = window.location.href.endsWith('.pdf') ||
    window.location.href.includes('.pdf#') ||
    document.contentType === 'application/pdf' ||
    isChromePDF;

  if (isPDF && mode === 'AGENTIC') {
    const pdfMsg = isChromePDF
      ? 'PDF files opened in Chrome\'s PDF viewer cannot be analyzed. Chrome extensions cannot access PDF content. Please find the HTML version or use a PDF-to-HTML converter.'
      : 'PDF files cannot be analyzed directly. Please use the HTML version of the document.';
    showError(pdfMsg);
    return;
  }

  if (!options.preserveSelection) {
    window.getSelection()?.removeAllRanges();
  }

  if (!document.body) {
    console.error('[Content] Cannot show sidebar: document.body is null');
    return;
  }

  isSidebarOpen = false;
  currentMode = null;
  noContentShown = false;

  currentMode = mode;
  isSidebarOpen = true;

  sidebarShadow = createSidebar(mode, options);
  sidebar = sidebarShadow.querySelector('#paperlens-sidebar');

  sidebar._lastWidth = 420;
  sidebar._isCollapsed = false;

  applyWebpageShifting(420);

  sidebar._windowResizeHandler = () => {
    const width = sidebar._isCollapsed ? 48 : (sidebar._lastWidth || 420);
    applyWebpageShifting(width);
  };
  window.addEventListener('resize', sidebar._windowResizeHandler, { passive: true });

  const closeBtn = sidebarShadow.querySelector('#pl-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  const collapseBtn = sidebarShadow.querySelector('#pl-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebarCollapse();
    });
  }

  addResizeHandle(sidebar, sidebarHost);
}

// ─── Card factory ─────────────────────────────────────────────────────────────

function createSectionCard(sectionId, heading, diagramType) {
  const card = document.createElement('div');
  card.className = 'pl-card';
  card.id = `pl-card-${sectionId}`;

  const typeLabels = {
    flowchart: 'Flow',
    mindmap: 'Mind Map',
    timeline: 'Timeline',
    comparison: 'Compare',
  };

  // Strip section numbers for a polished display title
  const displayHeading = cleanHeading(heading);

  card.innerHTML = `
    <div class="pl-card-header">
      <div class="pl-card-title" title="${escapeHtml(heading)}">${escapeHtml(displayHeading)}</div>
      <div class="pl-card-meta">
        ${diagramType ? `<span class="pl-card-type">${typeLabels[diagramType] || diagramType}</span>` : ''}
      </div>
    </div>
    <div class="pl-card-body" id="pl-body-${sectionId}">
      <div class="pl-timer" id="pl-timer-${sectionId}">Generating…</div>
      <div class="pl-skeleton"></div>
    </div>
  `;

  return card;
}

function startCardTimer(sectionId) {
  const timerEl = querySidebar(`#pl-timer-${sectionId}`);
  if (!timerEl) return null;

  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (timerEl && timerEl.parentNode) {
      timerEl.textContent = `Generating… ${elapsed}s`;
    } else {
      clearInterval(interval);
    }
  }, 1000);

  return interval;
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'TRIGGER_ANALYZE') {
    const evt = new CustomEvent('paperlens-trigger-agentic');
    document.dispatchEvent(evt);
  }

  // ── plan: skeleton cards in plan order ───────────────────────────────────────
  if (message.type === 'plan') {
    console.log('[PaperLens] plan received:', message.data?.length, 'sections');
    if (!sidebarShadow) return;

    const plan = message.data || [];
    const hasVisualizableContent = message.hasVisualizableContent !== false;
    const reason = message.reason || '';

    const emptyState = querySidebar('#pl-empty-state');
    if (emptyState) emptyState.remove();

    if (!hasVisualizableContent || plan.length === 0) {
      showNoContentMessage(reason || 'No sections suitable for visualization were found.');
      return;
    }

    const container = querySidebar('#pl-cards-container');
    if (!container) return;

    // Create cards in plan order and record that order for later sorting
    planOrder = [];
    plan.filter(p => !p.skip).forEach(planItem => {
      const card = createSectionCard(planItem.sectionId, planItem.heading, planItem.diagramType);
      container.appendChild(card);
      planOrder.push(card.id);
      const interval = startCardTimer(planItem.sectionId);
      if (interval) card.dataset.timerInterval = interval;
    });

    const banner = document.getElementById('paperlens-banner');
    if (banner) banner.remove();
  }

  // ── diagram: SVG from server ─────────────────────────────────────────────────
  if (message.type === 'diagram') {
    console.log('[PaperLens] diagram received for:', message.sectionId, 'svg length:', message.svg?.length);
    if (!sidebarShadow) return;

    const { sectionId, svg, heading } = message;

    let card = querySidebar(`#pl-card-${sectionId}`);
    let cardBody = querySidebar(`#pl-body-${sectionId}`);

    if (!card) {
      const baseId = sectionId.replace(/-segment-\d+$/, '').replace(/-\d+$/, '');
      card = querySidebar(`#pl-card-${baseId}`);
      cardBody = querySidebar(`#pl-body-${baseId}`);

      if (!card) {
        const container = querySidebar('#pl-cards-container');
        if (container) {
          const newCard = createSectionCard(sectionId, heading || sectionId, null);
          container.appendChild(newCard);
          card = newCard;
          cardBody = querySidebar(`#pl-body-${sectionId}`);
        }
      }
    }

    if (!cardBody) return;

    // Clear timer
    const timerId = card?.dataset.timerInterval;
    if (timerId) clearInterval(parseInt(timerId));
    const timerEl = cardBody.querySelector('.pl-timer') || querySidebar(`#pl-timer-${sectionId}`);
    if (timerEl) timerEl.remove();

    if (svg && svg.trim()) {
      injectSVGIntoCard(cardBody, svg);
    } else {
      cardBody.innerHTML = '<div class="pl-error">Visual unavailable for this section.</div>';
    }

    setTimeout(() => { updateProgress(); sortCardsToMatchPlan(); }, 100);
  }

  // ── section_start (alternative flow) ────────────────────────────────────────
  if (message.type === 'section_start') {
    const { sectionId, heading, diagramType } = message;
    if (!sidebarShadow) return;

    const container = querySidebar('#pl-cards-container');
    if (!container) return;

    const emptyState = querySidebar('#pl-empty-state');
    if (emptyState) emptyState.remove();

    const card = createSectionCard(sectionId, heading, diagramType);
    container.appendChild(card);
    if (!planOrder.includes(card.id)) planOrder.push(card.id);

    const interval = startCardTimer(sectionId);
    if (interval) card.dataset.timerInterval = interval;
  }

  // ── section_complete ─────────────────────────────────────────────────────────
  if (message.type === 'section_complete') {
    const { sectionId, svg } = message;
    if (!sidebarShadow) return;

    const card = querySidebar(`#pl-card-${sectionId}`);
    const cardBody = querySidebar(`#pl-body-${sectionId}`);
    if (!cardBody) return;

    const timerEl = querySidebar(`#pl-timer-${sectionId}`);
    if (timerEl) timerEl.remove();
    const timerInterval = card?.dataset.timerInterval;
    if (timerInterval) clearInterval(parseInt(timerInterval));

    if (svg && svg.trim()) {
      injectSVGIntoCard(cardBody, svg);
    } else {
      cardBody.innerHTML = '<div class="pl-error">Visual unavailable for this section.</div>';
    }

    setTimeout(() => { updateProgress(); sortCardsToMatchPlan(); }, 100);
  }

  // ── section_error ────────────────────────────────────────────────────────────
  if (message.type === 'section_error') {
    const { sectionId, message: errorMsg } = message;
    if (!sidebarShadow) return;

    const card = querySidebar(`#pl-card-${sectionId}`);
    if (card) {
      const timerEl = querySidebar(`#pl-timer-${sectionId}`);
      if (timerEl) timerEl.remove();
      const timerInterval = card.dataset.timerInterval;
      if (timerInterval) clearInterval(parseInt(timerInterval));

      const cardBody = querySidebar(`#pl-body-${sectionId}`);
      if (cardBody) {
        cardBody.innerHTML = `<div class="pl-error">${escapeHtml(errorMsg || 'Failed to generate visual')}</div>`;
      }
    }
  }

  // ── no_content ───────────────────────────────────────────────────────────────
  if (message.type === 'no_content') {
    showNoContentMessage(message.reason || 'No visualizable content found on this page');
  }

  // ── error ────────────────────────────────────────────────────────────────────
  if (message.type === 'error') {
    showError(message.message || 'An error occurred');
    const banner = document.getElementById('paperlens-banner');
    if (banner) banner.remove();
  }

  // ── AGENT_ERROR ──────────────────────────────────────────────────────────────
  if (message.type === 'AGENT_ERROR') {
    const banner = document.getElementById('paperlens-banner');
    if (banner) banner.remove();
    const isServerDown = message.message && (
      message.message.includes('Cannot connect') ||
      message.message.includes('server is not running') ||
      message.message.includes('Failed to fetch') ||
      message.message.includes('ECONNREFUSED')
    );
    if (isServerDown) {
      showServerDownState();
    } else {
      const progressArea = querySidebar('#pl-progress-area');
      if (progressArea) progressArea.style.display = 'none';
      showError(message.message || 'Analysis failed');
    }
  }

  // ── complete / AGENT_COMPLETE ────────────────────────────────────────────────
  if (message.type === 'complete' || message.type === 'AGENT_COMPLETE') {
    updateProgress();

    const banner = document.getElementById('paperlens-banner');
    if (banner) banner.remove();

    const progressText = querySidebar('#pl-progress-text');
    if (progressText) progressText.textContent = 'Analysis complete';

    const progressFill = querySidebar('#pl-progress-fill');
    if (progressFill) progressFill.style.width = '100%';

    // Fade out progress bar after 2 s
    setTimeout(() => {
      const progressArea = querySidebar('#pl-progress-area');
      if (progressArea && !noContentShown) {
        progressArea.style.transition = 'opacity 0.5s ease';
        progressArea.style.opacity = '0';
        setTimeout(() => {
          if (progressArea) progressArea.style.display = 'none';
        }, 500);
      }
    }, 2000);

    const allCards = querySidebarAll('.pl-card');
    const cardsWithVisuals = querySidebarAll('.pl-card svg');
    const cardsWithErrors = querySidebarAll('.pl-card .pl-error');

    if (!noContentShown && cardsWithVisuals.length === 0 && cardsWithErrors.length === 0 && allCards.length === 0) {
      showNoContentMessage('No visuals were generated. Try highlighting a specific section to generate a single visual.');
    }
  }
});

// ─── Agentic analysis ─────────────────────────────────────────────────────────

async function triggerAgenticAnalysis() {
  console.log('[PaperLens] triggerAgenticAnalysis started');

  const existingBanner = document.getElementById('paperlens-banner');
  if (existingBanner) existingBanner.remove();

  const banner = document.createElement('div');
  banner.id = 'paperlens-banner';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '420px',
    zIndex: '2147483646',
    background: 'linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))',
    borderBottom: '1px solid rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    padding: '10px 16px',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    letterSpacing: '0.02em',
  });
  banner.textContent = '✦ PaperLens is analyzing this page…';
  document.body.insertBefore(banner, document.body.firstChild);

  try {
    console.log('[PaperLens] Checking server health at', SERVER_URL);
    try {
      const healthRes = await fetch(`${SERVER_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      console.log('[PaperLens] Server health:', healthRes.status, healthRes.ok);
      if (!healthRes.ok) {
        banner.remove();
        showServerDownState();
        return;
      }
    } catch (healthErr) {
      console.warn('[PaperLens] Server health check failed:', healthErr.message);
      banner.remove();
      showServerDownState();
      return;
    }

    console.log('[PaperLens] Extracting page structure...');
    const paperData = window.extractPaperStructure ? window.extractPaperStructure() : null;
    if (!paperData) {
      showError('Could not extract page content.');
      banner.remove();
      return;
    }
    console.log('[PaperLens] Extracted:', paperData.sections.length, 'sections,', paperData.totalWordCount, 'words');

    if (paperData.isPDF) {
      showError('PDF files cannot be analyzed directly. Please use the HTML version.');
      banner.remove();
      return;
    }

    if (paperData.sections.length === 0) {
      banner.remove();
      showNoContentMessage('No text sections could be extracted from this page.');
      return;
    }

    const titleEl = querySidebar('#pl-paper-title');
    if (titleEl) {
      titleEl.textContent = paperData.title || 'Page Analysis';
      titleEl.style.display = 'block';
    }

    console.log('[PaperLens] Sending ANALYZE_PAPER to background...');
    chrome.runtime.sendMessage({ type: 'ANALYZE_PAPER', paperData });
    console.log('[PaperLens] ANALYZE_PAPER sent — waiting for SSE events...');

  } catch (error) {
    console.error('[PaperLens] triggerAgenticAnalysis error:', error);
    banner.remove();
    const progressArea = querySidebar('#pl-progress-area');
    if (progressArea) progressArea.style.display = 'none';
    showError('Analysis failed: ' + error.message);
  }
}

function pingBackground() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(response && (response.ok === true || response.status === 'ok'));
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// ─── Manual highlight mode ────────────────────────────────────────────────────

let ctrlAPressed = false;
let ctrlAPressTime = 0;

function handleManualHighlight() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      ctrlAPressed = true;
      ctrlAPressTime = Date.now();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (isSidebarOpen) return;

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const text = selection.toString().trim();
      if (!text || text.length < 50) return;

      const contentType = document.querySelector('meta[name="content-type"]')?.content || 'article';

      let savedRange = null;
      try {
        savedRange = selection.getRangeAt(0).cloneRange();
      } catch (e) { /* ignore */ }

      const newText = document.body ? document.body.innerText.trim() : '';
      const pageText = document.body ? document.body.innerText.trim() : '';

      if (!pageText || newText.length > pageText.length * 0.8 || newText.length > 10000 ||
          (pageText.length > 200 && newText.length === 0)) {
        if (window.getSelection) window.getSelection()?.removeAllRanges();
        showSidebar('AGENTIC');
        triggerAgenticAnalysis();
        return;
      }

      if (ctrlAPressed && Date.now() - ctrlAPressTime < 600) return;

      try {
        const range = selection.getRangeAt(0);
        showVisualizeButton(range);
      } catch (error) {
        console.error('[Content] Error showing visualize button:', error);
      }
    }, 150);
  });
}

function showVisualizeButton(range) {
  const existing = document.querySelector('.paperlens-visualize-btn');
  if (existing) existing.remove();

  const rect = range.getBoundingClientRect();
  if (!rect || rect.width === 0) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const text = selection.toString().trim();
  if (!text || text.length < 50) return;

  let savedRange = null;
  try { savedRange = selection.getRangeAt(0).cloneRange(); } catch (e) { /* ignore */ }

  const button = document.createElement('button');
  button.className = 'paperlens-visualize-btn';

  Object.assign(button.style, {
    position: 'fixed',
    top: `${Math.max(8, rect.top - 44)}px`,
    left: `${Math.min(window.innerWidth - 180, rect.left + rect.width / 2 - 80)}px`,
    zIndex: '2147483646',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: 'white',
    border: 'none',
    borderRadius: '20px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  });

  button.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="white" stroke-width="1.5"/>
      <circle cx="6" cy="6" r="2.5" fill="white" opacity="0.7"/>
    </svg>
    Visualize
  `;

  const contentType = document.querySelector('meta[name="content-type"]')?.content || 'article';

  button._cleanup = () => {
    clearTimeout(timeoutId);
    document.removeEventListener('mousedown', outsideClickHandler);
    button.remove();
  };

  const outsideClickHandler = (e) => {
    if (!button.contains(e.target)) button._cleanup?.();
  };

  document.addEventListener('mousedown', outsideClickHandler, { once: false });

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    button._cleanup?.();

    if (isSidebarOpen) return;

    showSidebar('SINGLE', { preserveSelection: true, selectedText: text });

    if (savedRange && window.getSelection) {
      setTimeout(() => {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
        } catch (e) { /* ignore */ }
      }, 100);
    }

    const containerId = 'pl-single-visual';

    try {
      chrome.runtime.sendMessage({ type: 'GENERATE', text, contentType }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Failed to generate visual');
          return;
        }

        if (!sidebarShadow) return;

        const container = querySidebar(`#${containerId}`);
        if (!container) return;

        if (response && response.segments && Array.isArray(response.segments)) {
          container.innerHTML = '';
          response.segments.forEach((segment, index) => {
            const segDiv = document.createElement('div');
            segDiv.className = 'pl-segment';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'pl-segment-heading';
            titleDiv.textContent = segment.title || `Segment ${index + 1}`;
            segDiv.appendChild(titleDiv);

            const visualDiv = document.createElement('div');
            visualDiv.className = 'napkin-visual-wrapper';

            if (segment.svg) {
              const cleanSvg = segment.svg.replace(/<script[\s\S]*?<\/script>/gi, '');
              visualDiv.innerHTML = cleanSvg;
              const svgEl = visualDiv.querySelector('svg');
              if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = 'auto'; }
              // Click-to-expand
              visualDiv.style.cursor = 'zoom-in';
              visualDiv.addEventListener('click', () => showCardFullscreen(cleanSvg));
            } else {
              visualDiv.innerHTML = '<div class="pl-error">Visual unavailable</div>';
            }

            segDiv.appendChild(visualDiv);
            container.appendChild(segDiv);
          });
        } else if (response && response.svg) {
          const cleanSvg = response.svg.replace(/<script[\s\S]*?<\/script>/gi, '');
          container.innerHTML = `<div class="napkin-visual-wrapper">${cleanSvg}</div>`;
          const svgEl = container.querySelector('svg');
          if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = 'auto'; }
          const wrapper = container.querySelector('.napkin-visual-wrapper');
          if (wrapper) {
            wrapper.style.cursor = 'zoom-in';
            wrapper.addEventListener('click', () => showCardFullscreen(cleanSvg));
          }
        } else if (response && response.error) {
          if (response.evaluationRejected) {
            const reason = response.reason || 'Content not suitable for visualization';
            showNoContentMessage(reason);
          } else {
            showError(response.error);
          }
        } else {
          showError('No visual was generated. Try selecting different text.');
        }
      });
    } catch (error) {
      showError('Failed to generate visual');
    }
  });

  document.body.appendChild(button);

  const timeoutId = setTimeout(() => {
    button._cleanup?.();
  }, 8000);
}

// ─── Agentic keyboard shortcut ────────────────────────────────────────────────

function handleAgenticMode() {
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      e.stopPropagation();

      window.getSelection()?.removeAllRanges();

      setTimeout(async () => {
        if (isSidebarOpen) return;
        showSidebar('AGENTIC');
        window.getSelection()?.removeAllRanges();
        await triggerAgenticAnalysis();
      }, 50);
    }
  });

  document.addEventListener('paperlens-trigger-agentic', async () => {
    if (isSidebarOpen) return;
    showSidebar('AGENTIC');
    await triggerAgenticAnalysis();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initializeHandlers() {
  try {
    handleManualHighlight();
    handleAgenticMode();
    console.log('[PaperLens] Initialized on:', window.location.href);
  } catch (error) {
    console.error('[PaperLens] Init error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHandlers);
} else {
  setTimeout(initializeHandlers, 100);
}
