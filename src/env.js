/**
 * Environment utility for accessing environment variables
 */

/**
 * Get an environment variable with fallback
 * @param {string} key - The environment variable key
 * @param {string} fallback - The fallback value if not found
 * @returns {string} - The environment variable value or fallback
 */
export const env = (key, fallback = '') => {
  return process.env[key] || fallback;
}; 