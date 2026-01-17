/**
 * FamCoin Engine Stub
 */

module.exports = {
  getBalance: async (userId) => {
    return { balance: 0, pending: 0 };
  },
  transfer: async (fromId, toId, amount) => {
    console.log('💰 FamCoin transfer (stub):', amount);
    return { success: true, newBalance: 0 };
  },
  earn: async (userId, amount, reason) => {
    return { success: true, earned: amount };
  }
};
