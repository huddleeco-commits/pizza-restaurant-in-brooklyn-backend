/**
 * Parallel Matcher Stub
 */

module.exports = {
  matchCards: async (cards) => {
    console.log('🔄 Parallel matching (stub)');
    return cards.map(c => ({ ...c, matched: false }));
  }
};
