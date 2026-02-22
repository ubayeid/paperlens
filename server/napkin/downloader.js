/**
 * Napkin File Downloader
 * Downloads SVG content and serves it with caching
 */

const { downloadVisualFile } = require('./client');

// In-memory cache: fileUrl -> { svg, timestamp }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Download and serve SVG content
 * @param {string} fileUrl - File URL from Napkin API
 * @returns {Promise<string>} Sanitized SVG string
 */
async function downloadAndServeSVG(fileUrl) {
  // Check cache
  const cached = cache.get(fileUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Napkin Downloader] Cache hit for ${fileUrl}`);
    return cached.svg;
  }

  // Download from Napkin
  console.log(`[Napkin Downloader] Downloading ${fileUrl}`);
  const svgContent = await downloadVisualFile(fileUrl);

  // Sanitize SVG: remove script tags
  const sanitized = sanitizeSVG(svgContent);

  // Cache it
  cache.set(fileUrl, {
    svg: sanitized,
    timestamp: Date.now(),
  });

  // Clean old cache entries (keep last 100)
  if (cache.size > 100) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - 100);
    toDelete.forEach(([url]) => cache.delete(url));
  }

  return sanitized;
}

/**
 * Sanitize SVG content by removing script tags
 * @param {string} svg - Raw SVG string
 * @returns {string} Sanitized SVG string
 */
function sanitizeSVG(svg) {
  // Remove script tags and their content
  return svg.replace(/<script[\s\S]*?<\/script>/gi, '');
}

module.exports = {
  downloadAndServeSVG,
};
