/**
 * Card Database Lookup Stub
 */

module.exports = {
  lookupCardInDatabase: async (cardInfo) => {
    console.log('🔍 Card lookup (stub):', cardInfo);
    return { found: false, suggestions: [] };
  },
  searchCards: async (query) => {
    return [];
  }
};
