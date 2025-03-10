/**
 * Numbers utility for parsing and formatting numbers
 */

/**
 * Parse a string to a number with a fallback value
 * @param {string|number} value - The value to parse
 * @param {number} defaultValue - Default value if parsing fails
 * @returns {number} - The parsed number or default value
 */
export function parseNumber(value, defaultValue = 0) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
} 