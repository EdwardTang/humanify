/**
 * Projects utility for managing project metadata
 */

/**
 * Get the active project
 * @returns {Promise<Object|null>} - The active project or null if not found
 */
export const getActiveProject = async () => {
  // In a real implementation, this would get the active project from storage
  return {
    id: 'default',
    name: 'Default Project',
    description: 'The default project'
  };
};

/**
 * Get a project by ID
 * @param {string} projectId - The project ID
 * @returns {Promise<Object|null>} - The project or null if not found
 */
export const getProjectById = async (projectId) => {
  // In a real implementation, this would get the project from storage
  return {
    id: projectId,
    name: `Project ${projectId}`,
    description: `Project with ID ${projectId}`
  };
}; 