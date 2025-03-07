// pkgroll configuration
export default {
  // Configure rollup options
  rollup: {
    // Complete warning suppression for clean build output
    onwarn() {
      // Suppress all warnings
      return;
    }
  }
}; 