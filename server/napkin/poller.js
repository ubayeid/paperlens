/**
 * Napkin Status Poller
 * Handles async polling until visual generation completes
 */

const { getVisualStatus } = require('./client');

class TimeoutError extends Error {
  constructor() {
    super('Visual generation timed out');
    this.name = 'TimeoutError';
  }
}

class NapkinFailedError extends Error {
  constructor() {
    super('Visual generation failed');
    this.name = 'NapkinFailedError';
  }
}

/**
 * Poll until visual generation completes
 * @param {string} requestId - Request ID from createVisualRequest
 * @param {object} options - Polling options
 * @param {number} options.initialInterval - Initial poll interval in ms (default: 2000)
 * @param {number} options.maxInterval - Maximum poll interval in ms (default: 10000)
 * @param {number} options.timeout - Total timeout in ms (default: 60000)
 * @returns {Promise<Array>} Generated files array
 */
async function pollUntilComplete(requestId, options = {}) {
  const initialInterval = options.initialInterval || 2000;
  const maxInterval = options.maxInterval || 10000;
  const timeout = options.timeout || 60000;

  const startTime = Date.now();
  let currentInterval = initialInterval;
  let pollAttempt = 0;

  while (true) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) {
      throw new TimeoutError();
    }

    pollAttempt++;
    console.log(`[Napkin Poller] Poll attempt ${pollAttempt} for request ${requestId}`);

    try {
      const { status, generatedFiles } = await getVisualStatus(requestId);

      if (status === 'completed') {
        console.log(`[Napkin Poller] Request ${requestId} completed after ${elapsed}ms`);
        return generatedFiles;
      }

      if (status === 'failed') {
        throw new NapkinFailedError();
      }

      // Still pending or processing
      if (status === 'pending' || status === 'processing') {
        // Exponential backoff
        await sleep(currentInterval);
        currentInterval = Math.min(currentInterval * 1.5, maxInterval);
        continue;
      }

      // Unknown status
      console.warn(`[Napkin Poller] Unknown status: ${status}`);
      await sleep(currentInterval);
      currentInterval = Math.min(currentInterval * 1.5, maxInterval);
    } catch (error) {
      if (error instanceof NapkinFailedError) {
        throw error;
      }
      // Network error or other - retry with backoff
      console.error(`[Napkin Poller] Error polling: ${error.message}`);
      await sleep(currentInterval);
      currentInterval = Math.min(currentInterval * 1.5, maxInterval);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  pollUntilComplete,
  TimeoutError,
  NapkinFailedError,
};
