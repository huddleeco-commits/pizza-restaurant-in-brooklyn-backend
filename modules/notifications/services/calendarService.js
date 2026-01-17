/**
 * Calendar Service Stub
 */

module.exports = {
  addEvent: async (event) => {
    console.log('📅 Add event (stub):', event);
    return { success: true, eventId: 'stub_' + Date.now() };
  },
  getEvents: async (userId, startDate, endDate) => {
    return [];
  },
  syncWithGoogle: async (userId) => {
    return { synced: 0 };
  }
};
