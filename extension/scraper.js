/**
 * Page Scraper
 * Extracts structured content from ANY webpage
 * Generic approach - no domain-specific logic
 */

/**
 * Helper: Detect navigation/footer elements to skip
 */
function isNavigationElement(el) {
  const tag = el.tagName.toLowerCase();
  const parent = el.closest(
    'nav, header, footer, [class*="nav"], [class*="menu"], ' +
    '[class*="footer"], [class*="sidebar"], [class*="cookie"], ' +
    '[class*="banner"], [id*="nav"], [id*="footer"], ' +
    '[role="navigation"], [role="banner"], [role="contentinfo"]'
  );
  return !!parent;
}

/**
 * Helper: Infer a heading label for heading-less chunks
 */
function inferHeading(text) {
  // Use first meaningful sentence as heading
  const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 10);
  if (sentences.length > 0) {
    const firstSentence = sentences[0].trim();
    return firstSentence.slice(0, 60) + (firstSentence.length > 60 ? '...' : '');
  }
  return 'Content';
}

/**
 * Extract page structure from current page
 * Works on ANY webpage - no domain restrictions
 * @returns {object} Page data with title, sections, etc.
 */
function extractPaperStructure() {
  const url = window.location.href;
  
  // Detect PDF - Chrome's PDF viewer or direct PDF URLs
  const isChromePDF = window.location.protocol === 'chrome-extension:' && 
                      window.location.hostname.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai');
  const isPDFURL = url.endsWith('.pdf') || url.includes('.pdf#') || url.includes('.pdf?');
  const isPDFContentType = document.contentType === 'application/pdf';
  const pdfEmbed = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
  
  if (isChromePDF || isPDFURL || isPDFContentType || pdfEmbed) {
    return {
      title: document.title || 'PDF Document',
      url,
      sections: [],
      totalWordCount: 0,
      isPDF: true,
      pdfType: isChromePDF ? 'chrome-viewer' : (pdfEmbed ? 'embedded' : 'direct'),
    };
  }

  // Extract title
  let titleElement = document.querySelector('h1, .title, #title, [class*="title"], [id*="title"]');
  if (!titleElement) {
    titleElement = document.querySelector('#content h1, main h1, article h1');
  }
  const title = titleElement ? titleElement.innerText.trim() : document.title || window.location.hostname;

  // Extract sections
  const sections = [];
  
  // Strategy 1: Use explicit heading structure (h1, h2, h3, h4)
  const headings = document.querySelectorAll('h1, h2, h3, h4');
  
  if (headings.length >= 2) {
    // Page has clear heading structure — use it
    headings.forEach((heading, i) => {
      // Skip if in navigation/footer
      if (isNavigationElement(heading)) {
        return;
      }
      
      // Skip if heading is hidden
      const style = window.getComputedStyle(heading);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return;
      }
      
      const headingText = heading.innerText.trim();
      if (headingText.length < 3) return;
      
      // Find content until next heading
      const nextHeading = headings[i + 1];
      let content = '';
      let node = heading.nextElementSibling;
      
      while (node && node !== nextHeading) {
        // Skip navigation elements
        if (isNavigationElement(node)) {
          node = node.nextElementSibling;
          continue;
        }
        
        // Skip script/style/nav/header/footer tags
        if (!['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER'].includes(node.tagName)) {
          const text = node.innerText || node.textContent || '';
          if (text.trim().length > 0) {
            content += text.trim() + ' ';
          }
        }
        node = node.nextElementSibling;
      }
      
      content = content.trim();
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
      
      // Skip very short sections
      if (wordCount < 20) return;
      
      // Detect content types
      const sectionContainer = heading.nextElementSibling || heading.parentElement;
      const hasCode = !!sectionContainer?.querySelector('pre, code');
      const hasTable = !!sectionContainer?.querySelector('table');
      const hasFigure = !!sectionContainer?.querySelector('figure, img');
      const figureCaption = sectionContainer?.querySelector('figcaption, .caption')?.innerText || null;
      
      sections.push({
        id: 'section-' + i,
        heading: headingText.slice(0, 100),
        text: content.slice(0, 3000),
        wordCount,
        hasCode,
        hasTable,
        hasFigure,
        figureCaption,
      });
    });
  }
  
  // Strategy 2: No headings — split by paragraphs/blocks into chunks
  if (sections.length === 0) {
    const blockSelector = [
      'p',
      'li',
      'td',
      'div.markdown',
      'div.prose',
      'div[class*="markdown"]',
      'div[class*="prose"]',
      'div[data-message-author-role]',
      'div[data-message-id]',
      'div[role="presentation"]',
      'div[class*="content"]',
      'div[class*="text"]',
    ].join(', ');

    const isTopLevelBlock = (el) => {
      const parent = el.parentElement;
      if (!parent) return true;
      return !parent.closest(blockSelector);
    };

    const paragraphs = Array.from(document.querySelectorAll(blockSelector))
      .filter(el => {
      // Skip navigation elements
      if (isNavigationElement(el)) return false;
      
      // Skip hidden elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      
      const text = el.innerText.trim();
      if (text.length <= 100 || text.split(/\s+/).length < 20) return false;

      // Avoid nested duplicates (prefer outer markdown/prose/message blocks)
      return isTopLevelBlock(el);
    });
    
    // Group paragraphs into chunks of ~300 words
    let chunk = '';
    let chunkIndex = 0;
    
    paragraphs.forEach(p => {
      const text = p.innerText.trim();
      chunk += text + ' ';
      
      if (chunk.split(/\s+/).length >= 300) {
        const wordCount = chunk.split(/\s+/).length;
        sections.push({
          id: 'chunk-' + chunkIndex,
          heading: inferHeading(chunk),
          text: chunk.trim().slice(0, 3000),
          wordCount,
          hasCode: !!p.closest('pre, code'),
          hasTable: !!p.closest('table'),
          hasFigure: !!p.closest('figure, img'),
          figureCaption: null,
        });
        chunk = '';
        chunkIndex++;
      }
    });
    
    // Don't forget last chunk
    if (chunk.split(/\s+/).length > 50) {
      const wordCount = chunk.split(/\s+/).length;
      sections.push({
        id: 'chunk-' + chunkIndex,
        heading: inferHeading(chunk),
        text: chunk.trim().slice(0, 3000),
        wordCount,
        hasCode: false,
        hasTable: false,
        hasFigure: false,
        figureCaption: null,
      });
    }
  }
  
  // Strategy 3: <article> or <main> tag fallback
  if (sections.length === 0) {
    const mainContent = document.querySelector('article, main, [role="main"], #main-content, #content, .content');
    if (mainContent) {
      const text = mainContent.innerText.trim();
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      
      if (wordCount > 200) {
        sections.push({
          id: 'main-content',
          heading: title || 'Page Content',
          text: text.slice(0, 3000),
          wordCount,
          hasCode: !!mainContent.querySelector('pre, code'),
          hasTable: !!mainContent.querySelector('table'),
          hasFigure: !!mainContent.querySelector('figure, img'),
          figureCaption: null,
        });
      }
    }
  }
  
  // Strategy 4: Last resort - use body content
  if (sections.length === 0) {
    // Remove navigation/footer/header elements
    const bodyClone = document.body.cloneNode(true);
    const navElements = bodyClone.querySelectorAll('nav, header, footer, [class*="nav"], [class*="menu"], [class*="footer"]');
    navElements.forEach(el => el.remove());
    
    const text = bodyClone.innerText.trim();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    
    if (wordCount > 200) {
      sections.push({
        id: 'body-content',
        heading: title || 'Page Content',
        text: text.slice(0, 3000),
        wordCount,
        hasCode: !!document.body.querySelector('pre, code'),
        hasTable: !!document.body.querySelector('table'),
        hasFigure: !!document.body.querySelector('figure, img'),
        figureCaption: null,
      });
    }
  }

  const totalWordCount = sections.reduce((sum, s) => sum + s.wordCount, 0);

  return {
    title,
    url,
    sections,
    totalWordCount,
    isPDF: false,
  };
}

// For browser context
if (typeof window !== 'undefined') {
  window.extractPaperStructure = extractPaperStructure;
}

// For Node.js context (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractPaperStructure };
}
