/**
 * Cache Manager
 * In-memory cache for generated visuals
 */

class Cache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Generate hash from text
   * @param {string} text - Text to hash
   * @returns {string} Hash string
   */
  hash(text) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get cached SVG
   * @param {string} text - Text key
   * @returns {string|null} Cached SVG or null
   */
  get(text) {
    const key = this.hash(text);
    return this.cache.get(key) || null;
  }

  /**
   * Set cached SVG
   * @param {string} text - Text key
   * @param {string} svg - SVG content
   */
  set(text, svg) {
    const key = this.hash(text);
    
    // Evict oldest if at max size
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, svg);
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }
}

// Export singleton instance
const cache = new Cache();

// For browser context
if (typeof window !== 'undefined') {
  window.paperLensCache = cache;
}

// For Node.js context
if (typeof module !== 'undefined') {
  module.exports = cache;
}
