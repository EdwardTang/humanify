/**
 * Logger utility for consistent console output
 */

/**
 * Verbose logging configuration
 */
export const verbose = {
  enabled: false,
  log: (...args) => {
    if (verbose.enabled) {
      console.log('[verbose]', ...args);
    }
  }
}; 