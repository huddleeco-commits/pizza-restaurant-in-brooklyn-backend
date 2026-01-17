/**
 * eBay OAuth Service Stub
 */

module.exports = {
  getAccessToken: async () => {
    console.log('🏷️ eBay OAuth (stub)');
    return { access_token: 'stub_token', expires_in: 7200 };
  },
  refreshToken: async (refreshToken) => {
    return { access_token: 'stub_refreshed_token' };
  },
  searchItems: async (query, options = {}) => {
    console.log('🔍 eBay search (stub):', query);
    return { items: [], total: 0 };
  },
  getItemPrice: async (itemId) => {
    return { price: 0, currency: 'USD' };
  }
};
