/**
 * Paper Scraper
 * Extracts structured data from research papers
 */

/**
 * Extract paper structure from current page
 * @returns {object} Paper data with title, sections, etc.
 */
function extractPaperStructure() {
  const url = window.location.href;
  
  // Detect PDF (only if URL ends with .pdf - some sites serve PDFs without .pdf extension)
  if (url.endsWith('.pdf') || url.includes('.pdf#')) {
    return {
      title: document.title || 'PDF Document',
      url,
      sections: [],
      totalWordCount: 0,
      isPDF: true,
    };
  }
  
  // Check if page is actually a PDF (some sites embed PDFs)
  const pdfEmbed = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
  if (pdfEmbed) {
    return {
      title: document.title || 'PDF Document',
      url,
      sections: [],
      totalWordCount: 0,
      isPDF: true,
    };
  }

  // Detect arXiv HTML (ar5iv or arxiv HTML) or PubMed
  const isArXiv = url.includes('arxiv.org') || url.includes('ar5iv.org');
  const isPubMed = url.includes('pubmed.ncbi.nlm.nih.gov') || url.includes('pubmed.gov');
  
  // Extract title
  // Wikipedia-specific: title is usually in h1#firstHeading or .mw-page-title
  let titleElement = document.querySelector('h1#firstHeading, h1.mw-page-title, h1, .title, #title, [class*="title"]');
  
  // If no title found, try Wikipedia's specific structure
  if (!titleElement) {
    titleElement = document.querySelector('#content h1, main h1, article h1');
  }
  
  const title = titleElement ? titleElement.innerText.trim() : document.title;

  // Extract sections
  const sections = [];
  
  // Find main content area - works on ANY website
  // Try site-specific selectors first, then fall back to generic
  let mainContent = document.body;
  
  // Wikipedia-specific: Use the main content container
  const isWikipedia = url.includes('wikipedia.org');
  if (isWikipedia) {
    // Wikipedia's main article content is in #mw-content-text or .mw-parser-output
    const wikiContent = document.querySelector('#mw-content-text .mw-parser-output') || 
                        document.querySelector('#mw-content-text') ||
                        document.querySelector('.mw-parser-output');
    if (wikiContent) {
      mainContent = wikiContent;
      console.log('[Scraper] Found Wikipedia content area:', wikiContent.id || wikiContent.className);
    }
  }
  
  // Try common content selectors (works for most sites)
  if (mainContent === document.body) {
    const contentSelectors = [
      'main',
      'article', 
      '#main-content',
      '#content',
      '.content',
      '.main-content',
      '.article-page',
      '#mw-content-text', // Wikipedia (fallback)
      '.mw-parser-output', // Wikipedia (fallback)
      '.article-body', // Common article sites
      '.post-content', // Blog sites
      '.entry-content', // WordPress
      '[role="main"]'
    ];
    
    for (const selector of contentSelectors) {
      const found = document.querySelector(selector);
      if (found && found.innerText.trim().length > 100) {
        mainContent = found;
        break;
      }
    }
  }
  
  // If no specific content area found, use body (works for any page)
  if (!mainContent || mainContent === document.body) {
    mainContent = document.body;
  }
  
  // Get all headings
  const headings = mainContent.querySelectorAll('h1, h2, h3, h4, h5');
  
  // Filter out navigation/table of contents headings and non-content sections
  const filteredHeadings = Array.from(headings).filter(h => {
    // Wikipedia-specific: More aggressive filtering
    if (isWikipedia) {
      // Skip if in Wikipedia's navigation structures
      const wikiNavSelectors = [
        'nav', '#mw-navigation', '#mw-head', '#mw-panel', 
        '.mw-jump-link', '.mw-jump', '.mw-editsection',
        '.mw-heading', '.toc', '#toc', '.sidebar',
        'header', 'footer', '.vector-menu', '.vector-dropdown',
        '.mw-wiki-logo', '.mw-logo', '.mw-indicators'
      ];
      const parent = h.closest(wikiNavSelectors.join(', '));
      if (parent) {
        console.log('[Scraper] Skipping Wikipedia navigation heading:', h.innerText.trim());
        return false;
      }
      
      // Skip if heading is outside the main content area
      if (mainContent !== document.body && !mainContent.contains(h)) {
        console.log('[Scraper] Skipping heading outside main content:', h.innerText.trim());
        return false;
      }
      
      // Skip Wikipedia-specific navigation headings
      const headingText = h.innerText.trim().toLowerCase();
      const wikiSkipPatterns = [
        'contents', 'navigation menu', 'jump to', 'references', 
        'external links', 'see also', 'notes', 'works cited',
        'further reading', 'bibliography', 'edit section',
        'main menu', 'search', 'donate', 'create account', 'log in',
        'hide', 'toggle', 'show', 'collapse'
      ];
      if (wikiSkipPatterns.some(pattern => headingText.includes(pattern))) {
        console.log('[Scraper] Skipping Wikipedia navigation pattern:', headingText);
        return false;
      }
    }
    
    // Skip if in navigation, TOC, sidebar, footer, header (generic)
    const parent = h.closest('nav, .toc, .sidebar, #toc, .mw-jump-link, footer, header, .navigation, .menu');
    if (parent) return false;
    
    // Skip if heading is hidden or in a hidden container
    const style = window.getComputedStyle(h);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    
    // PubMed-specific: Skip common non-content sections
    if (isPubMed) {
      const headingText = h.innerText.trim().toLowerCase();
      const skipPatterns = [
        'your saved search', 'saved searches', 'saved items',
        'affiliations', 'author information', 'correspondence',
        'navigation', 'menu', 'breadcrumb',
        'related articles', 'similar articles',
        'publication types', 'mesh terms',
        'share', 'cite', 'download', 'export',
        'full text links', 'free full text', 'full text sources',
        'other literature sources', 'linkout'
      ];
      if (skipPatterns.some(pattern => headingText.includes(pattern))) {
        return false;
      }
      
      // Also check if heading is in a navigation/sidebar container
      const isInNav = h.closest('.sidebar, .navigation, nav, .secondary-content, .supplementary-data');
      if (isInNav) {
        return false;
      }
    }
    
    return true;
  });
  
  filteredHeadings.forEach((heading, index) => {
    const headingText = heading.innerText.trim();
    
    // Skip if empty or very short
    if (headingText.length < 3) return;
    
    // Wikipedia-specific: More aggressive filtering
    if (isWikipedia) {
      // Skip Wikipedia-specific navigation patterns
      const wikiSkipPatterns = [
        'contents', 'navigation menu', 'jump to', 'references', 
        'external links', 'see also', 'notes', 'works cited',
        'further reading', 'bibliography', 'edit section',
        'main menu', 'search', 'donate', 'create account', 'log in',
        'hide', 'toggle', 'show', 'collapse', 'view source',
        'talk', 'edit', 'article', 'discussion'
      ];
      if (wikiSkipPatterns.some(pattern => headingText.toLowerCase().includes(pattern))) {
        console.log('[Scraper] Skipping Wikipedia navigation heading:', headingText);
        return;
      }
      
      // Skip if heading text looks like navigation (contains common nav words)
      if (headingText.match(/^(Jump|Main|Search|Donate|Create|Log|Contents|Navigation)/i)) {
        console.log('[Scraper] Skipping Wikipedia navigation pattern:', headingText);
        return;
      }
    }
    
    // Skip common navigation headings (Wikipedia and other sites)
    const skipPatterns = ['Contents', 'Navigation menu', 'Jump to', 'References', 'External links', 'See also'];
    if (skipPatterns.some(pattern => headingText.includes(pattern))) {
      return;
    }
    
    // Skip if heading is in a skip list (common across all sites)
    const commonSkipPatterns = [
      'table of contents', 'toc', 'navigation', 'menu', 'sidebar',
      'footer', 'header', 'breadcrumb', 'skip to', 'jump to'
    ];
    if (commonSkipPatterns.some(pattern => headingText.toLowerCase().includes(pattern))) {
      return;
    }
    
    // Find the section content - Wikipedia sections are usually in divs after headings
    let sectionContent = '';
    
    // Wikipedia-specific: Skip edit links and navigation elements
    if (isWikipedia) {
      // Skip if heading is an edit link or navigation element
      const headingParent = heading.parentElement;
      if (headingParent && (headingParent.classList.contains('mw-editsection') || 
                            headingParent.classList.contains('mw-heading') ||
                            headingParent.querySelector('.mw-editsection'))) {
        // This is likely a Wikipedia edit section link, skip it
        return;
      }
    }
    
    // Method 1: Look for next sibling div or content container
    let current = heading.nextElementSibling;
    while (current) {
      // Stop at next heading
      if (current.tagName.match(/^H[1-6]$/)) {
        break;
      }
      
      // Wikipedia: Skip navigation and edit sections
      if (isWikipedia) {
        const isNavElement = current.classList.contains('mw-editsection') ||
                            current.classList.contains('mw-jump-link') ||
                            current.classList.contains('mw-heading') ||
                            current.id === 'toc' ||
                            current.classList.contains('toc') ||
                            current.querySelector('.mw-editsection, .mw-jump-link, nav');
        if (isNavElement) {
          current = current.nextElementSibling;
          continue;
        }
        
        // Skip if outside main content area
        if (mainContent !== document.body && !mainContent.contains(current)) {
          break; // Stop if we've left the main content area
        }
      }
      
      // PubMed: content is often in divs with specific classes
      if (isPubMed) {
        // Skip navigation/sidebar divs
        const isNavDiv = current.classList.contains('sidebar') || 
                         current.classList.contains('navigation') ||
                         current.id === 'sidebar' ||
                         current.querySelector('nav');
        if (isNavDiv) {
          current = current.nextElementSibling;
          continue;
        }
      }
      
      // Collect content from various element types
      if (current.tagName === 'DIV' || current.tagName === 'P' || 
          current.tagName === 'UL' || current.tagName === 'OL' ||
          current.tagName === 'SECTION' || current.tagName === 'ARTICLE') {
        const text = current.innerText.trim();
        if (text.length > 0) {
          sectionContent += text + ' ';
        }
      }
      
      current = current.nextElementSibling;
    }
    
    // Method 2: If no content found, try finding the parent section
    if (!sectionContent.trim()) {
      // Wikipedia: headings are often followed by a div containing the section
      const nextDiv = heading.nextElementSibling;
      if (nextDiv && nextDiv.tagName === 'DIV') {
        sectionContent = nextDiv.innerText.trim();
      } else {
        // Fallback: get all text until next heading
        let node = heading.nextSibling;
        while (node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName.match(/^H[1-6]$/)) break;
            sectionContent += node.innerText + ' ';
          } else if (node.nodeType === Node.TEXT_NODE) {
            sectionContent += node.textContent + ' ';
          }
          node = node.nextSibling;
        }
      }
    }
    
    // Method 3: Use parent container approach (fallback)
    if (!sectionContent.trim() && heading.parentElement) {
      const parent = heading.parentElement;
      const allText = parent.innerText;
      const headingIndex = allText.indexOf(headingText);
      if (headingIndex !== -1) {
        const nextHeading = filteredHeadings.find(h => 
          h !== heading && 
          allText.indexOf(h.innerText.trim()) > headingIndex
        );
        if (nextHeading) {
          const nextIndex = allText.indexOf(nextHeading.innerText.trim());
          sectionContent = allText.substring(headingIndex + headingText.length, nextIndex);
        } else {
          sectionContent = allText.substring(headingIndex + headingText.length);
        }
      }
    }
    
    sectionContent = sectionContent.trim();
    
    // Wikipedia-specific: Clean up section content
    if (isWikipedia) {
      // Remove common Wikipedia navigation text patterns
      sectionContent = sectionContent
        .replace(/Jump to content.*?Main menu/gi, '')
        .replace(/Search.*?Donate.*?Create account.*?Log in/gi, '')
        .replace(/Contents hide.*?\(Top\)/gi, '')
        .replace(/Toggle.*?subsection/gi, '')
        .replace(/\[edit\]/gi, '')
        .replace(/\[show\]/gi, '')
        .trim();
    }
    
    const wordCount = sectionContent.split(/\s+/).filter(w => w.length > 0).length;
    
    // Skip very short sections (increased threshold for Wikipedia to filter out nav)
    const minWords = isWikipedia ? 30 : 10;
    if (wordCount < minWords) {
      console.log('[Scraper] Skipping short section:', headingText, `(${wordCount} words)`);
      return;
    }
    
    // Detect content types
    const sectionContainer = heading.nextElementSibling || heading.parentElement;
    const hasCode = !!sectionContainer?.querySelector('pre, code');
    const hasTable = !!sectionContainer?.querySelector('table');
    const hasFigure = !!sectionContainer?.querySelector('figure, img, .thumb');
    const figureCaption = sectionContainer?.querySelector('figcaption, .thumbcaption')?.innerText || null;
    
    sections.push({
      id: `section-${index}`,
      heading: headingText,
      text: sectionContent,
      wordCount,
      hasCode,
      hasTable,
      hasFigure,
      figureCaption,
    });
  });

  // If no sections found, try to extract from main content area
  if (sections.length === 0) {
    // Use mainContent instead of document.body to avoid navigation
    const mainText = mainContent.innerText.trim();
    
    // Wikipedia: Clean up navigation text
    let cleanedText = mainText;
    if (isWikipedia) {
      cleanedText = mainText
        .replace(/Jump to content.*?Main menu/gi, '')
        .replace(/Search.*?Donate.*?Create account.*?Log in/gi, '')
        .replace(/Contents hide.*?\(Top\)/gi, '')
        .replace(/Toggle.*?subsection/gi, '')
        .replace(/\[edit\]/gi, '')
        .trim();
    }
    
    const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
    
    // Only add if substantial content
    if (wordCount > 50) {
      sections.push({
        id: 'section-0',
        heading: title || 'Content',
        text: cleanedText,
        wordCount,
        hasCode: !!mainContent.querySelector('pre, code'),
        hasTable: !!mainContent.querySelector('table'),
        hasFigure: !!mainContent.querySelector('figure, img'),
        figureCaption: null,
      });
    }
  }

  // Extract abstract if available (PubMed-specific)
  if (isPubMed) {
    // PubMed: abstract is usually in #abstract or .abstract
    const abstractElement = document.querySelector('#abstract, .abstract, [data-abstract-id]');
    if (abstractElement) {
      const abstractText = abstractElement.innerText.trim();
      const abstractWordCount = abstractText.split(/\s+/).filter(w => w.length > 0).length;
      
      // Only add if substantial and not already found
      if (abstractWordCount > 50 && !sections.find(s => s.heading.toLowerCase().includes('abstract'))) {
        sections.unshift({
          id: 'section-abstract',
          heading: 'Abstract',
          text: abstractText,
          wordCount: abstractWordCount,
          hasCode: false,
          hasTable: !!abstractElement.querySelector('table'),
          hasFigure: !!abstractElement.querySelector('figure, img'),
          figureCaption: null,
        });
      }
    }
  } else {
    // Generic abstract extraction
    const abstractElement = document.querySelector('#abstract, .abstract, [class*="abstract"]');
    if (abstractElement && !sections.find(s => s.heading.toLowerCase().includes('abstract'))) {
      const abstractText = abstractElement.innerText.trim();
      const abstractWordCount = abstractText.split(/\s+/).filter(w => w.length > 0).length;
      if (abstractWordCount > 50) {
        sections.unshift({
          id: 'section-abstract',
          heading: 'Abstract',
          text: abstractText,
          wordCount: abstractWordCount,
          hasCode: false,
          hasTable: false,
          hasFigure: false,
          figureCaption: null,
        });
      }
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
