/**
 * Page Scraper
 * Extracts structured content from ANY webpage
 * v2.1 - Better ChatGPT/conversational page support
 */

/**
 * Helper: Detect navigation/footer elements to skip
 */
function isNavigationElement(el) {
  const parent = el.closest(
    'nav, header, footer, [class*="nav"], [class*="menu"], ' +
    '[class*="footer"], [class*="cookie"], ' +
    '[class*="banner"], [id*="nav"], [id*="footer"], ' +
    '[role="navigation"], [role="banner"], [role="contentinfo"]'
  );
  return !!parent;
}

/**
 * Helper: Infer a heading label for heading-less chunks
 */
function inferHeading(text) {
  const sentences = text.split(/[.!?\n]/).filter(s => s.trim().length > 10);
  if (sentences.length > 0) {
    const firstSentence = sentences[0].trim();
    return firstSentence.slice(0, 60) + (firstSentence.length > 60 ? '…' : '');
  }
  return 'Content';
}

/**
 * Extract ChatGPT conversation structure
 * Returns well-structured sections from AI assistant messages
 */
function extractChatGPTStructure(url) {
  const sections = [];

  // ChatGPT message containers
  const messageSelectors = [
    '[data-message-author-role="assistant"]',
    '[class*="assistant"]',
    '.markdown',
    '[class*="markdown"]',
    '[class*="prose"]',
    // Fallback: any substantial content block
    'div[class*="content"]',
  ];

  let messages = [];
  for (const sel of messageSelectors) {
    const found = Array.from(document.querySelectorAll(sel));
    if (found.length > 0) {
      messages = found;
      break;
    }
  }

  // If no specific assistant messages found, get all message-like blocks
  if (messages.length === 0) {
    // Try generic article/main content
    const mainContent = document.querySelector('main, article, [role="main"]');
    if (mainContent) {
      // Split by horizontal rules or large blocks
      const blocks = Array.from(mainContent.children).filter(el => {
        const text = el.innerText?.trim() || '';
        return text.length > 100;
      });
      messages = blocks;
    }
  }

  messages.forEach((el, i) => {
    // Skip user messages (short, question-like)
    const text = el.innerText?.trim() || '';
    if (!text || text.length < 80) return;
    if (isNavigationElement(el)) return;

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 30) return;

    // Check for structural indicators to infer heading
    const firstLine = text.split('\n')[0].trim();
    const heading = firstLine.length > 5 && firstLine.length < 120
      ? firstLine.slice(0, 80)
      : inferHeading(text);

    sections.push({
      id: `msg-${i}`,
      heading,
      text: text.slice(0, 3000),
      wordCount,
      hasCode: !!el.querySelector('pre, code'),
      hasTable: !!el.querySelector('table'),
      hasFigure: !!el.querySelector('figure, img'),
      figureCaption: el.querySelector('figcaption')?.innerText || null,
    });
  });

  return sections;
}

/**
 * Extract page structure from current page
 */
function extractPaperStructure() {
  const url = window.location.href;

  // Detect PDF
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
  const title = titleElement
    ? titleElement.innerText.trim()
    : document.title || window.location.hostname;

  const sections = [];
  const isChatGPT = url.includes('chatgpt.com') || url.includes('chat.openai.com');
  const isClaude = url.includes('claude.ai');
  const isConversational = isChatGPT || isClaude;

  // === ChatGPT/Conversational page special handling ===
  if (isConversational) {
    const chatSections = extractChatGPTStructure(url);
    if (chatSections.length > 0) {
      const totalWordCount = chatSections.reduce((sum, s) => sum + s.wordCount, 0);
      return { title, url, sections: chatSections, totalWordCount, isPDF: false };
    }
  }

  // === Strategy 1: Use explicit heading structure ===
  const headings = document.querySelectorAll('h1, h2, h3, h4');

  if (headings.length >= 2) {
    headings.forEach((heading, i) => {
      if (isNavigationElement(heading)) return;

      const style = window.getComputedStyle(heading);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const headingText = heading.innerText.trim();
      if (headingText.length < 3) return;

      const nextHeading = headings[i + 1];
      let content = '';
      let node = heading.nextElementSibling;

      while (node && node !== nextHeading) {
        if (isNavigationElement(node)) {
          node = node.nextElementSibling;
          continue;
        }
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
      if (wordCount < 20) return;

      const sectionContainer = heading.nextElementSibling || heading.parentElement;
      sections.push({
        id: 'section-' + i,
        heading: headingText.slice(0, 100),
        text: content.slice(0, 3000),
        wordCount,
        hasCode: !!sectionContainer?.querySelector('pre, code'),
        hasTable: !!sectionContainer?.querySelector('table'),
        hasFigure: !!sectionContainer?.querySelector('figure, img'),
        figureCaption: sectionContainer?.querySelector('figcaption, .caption')?.innerText || null,
      });
    });
  }

  // === Strategy 2: Paragraph/block chunking ===
  if (sections.length === 0) {
    const blockSelectors = [
      'div[data-message-author-role]',
      'div[data-message-id]',
      '[class*="message"]',
      '[class*="markdown"]',
      '[class*="prose"]',
      'p',
      'li',
      'td',
      'div[class*="content"]',
      'div[class*="text"]',
    ].join(', ');

    const seenTexts = new Set();

    const blocks = Array.from(document.querySelectorAll(blockSelectors))
      .filter(el => {
        if (isNavigationElement(el)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const text = el.innerText?.trim() || '';
        if (text.length <= 80) return false;
        if (text.split(/\s+/).length < 15) return false;
        // Dedup
        const key = text.slice(0, 100);
        if (seenTexts.has(key)) return false;
        seenTexts.add(key);
        return true;
      });

    let chunk = '';
    let chunkIndex = 0;

    blocks.forEach(el => {
      const text = el.innerText?.trim() || '';
      chunk += text + ' ';

      if (chunk.split(/\s+/).length >= 300) {
        const wordCount = chunk.split(/\s+/).length;
        sections.push({
          id: 'chunk-' + chunkIndex,
          heading: inferHeading(chunk),
          text: chunk.trim().slice(0, 3000),
          wordCount,
          hasCode: !!el.closest('pre, code'),
          hasTable: !!el.closest('table'),
          hasFigure: false,
          figureCaption: null,
        });
        chunk = '';
        chunkIndex++;
      }
    });

    // Remaining chunk
    if (chunk.split(/\s+/).filter(w => w.length > 0).length > 50) {
      sections.push({
        id: 'chunk-' + chunkIndex,
        heading: inferHeading(chunk),
        text: chunk.trim().slice(0, 3000),
        wordCount: chunk.split(/\s+/).filter(w => w.length > 0).length,
        hasCode: false,
        hasTable: false,
        hasFigure: false,
        figureCaption: null,
      });
    }
  }

  // === Strategy 3: article/main tag fallback ===
  if (sections.length === 0) {
    const mainContent = document.querySelector('article, main, [role="main"], #main-content, #content, .content');
    if (mainContent) {
      const text = mainContent.innerText.trim();
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

      if (wordCount > 100) {
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

  // === Strategy 4: Body fallback ===
  if (sections.length === 0) {
    const bodyClone = document.body.cloneNode(true);
    const navEls = bodyClone.querySelectorAll('nav, header, footer, [class*="nav"], [class*="menu"], [class*="footer"], script, style');
    navEls.forEach(el => el.remove());

    const text = bodyClone.innerText.trim();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    if (wordCount > 100) {
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

// Browser context
if (typeof window !== 'undefined') {
  window.extractPaperStructure = extractPaperStructure;
}

// Node.js context
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractPaperStructure };
}
