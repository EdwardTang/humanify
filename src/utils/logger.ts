/**
 * 详细日志工具
 */
export const verbose = {
  enabled: false,
  log: function(...args: any[]) {
    if (this.enabled) {
      console.log('[VERBOSE]', ...args);
    }
  },
  error: function(...args: any[]) {
    if (this.enabled) {
      console.error('[VERBOSE ERROR]', ...args);
    }
  },
  warn: function(...args: any[]) {
    if (this.enabled) {
      console.warn('[VERBOSE WARN]', ...args);
    }
  },
  debug: function(...args: any[]) {
    if (this.enabled) {
      console.debug('[VERBOSE DEBUG]', ...args);
    }
  }
}; 