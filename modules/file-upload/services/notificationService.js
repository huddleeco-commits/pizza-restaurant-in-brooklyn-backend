/**
 * Notification Service Stub
 */

module.exports = {
  notifyUser: async (userId, message, type = 'info') => {
    console.log(`📢 Notify user ${userId}: ${message}`);
    return { success: true };
  },
  notifyParent: async (childId, message) => {
    console.log(`📢 Notify parent of ${childId}: ${message}`);
    return { success: true };
  }
};
