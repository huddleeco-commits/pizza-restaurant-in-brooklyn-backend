/**
 * Sync Service Stub
 */

module.exports = {
  syncToCalendar: async (event) => {
    console.log('🔄 Sync to calendar (stub):', event);
    return { success: true };
  },
  syncFromCalendar: async (userId) => {
    console.log('🔄 Sync from calendar (stub)');
    return [];
  }
};
