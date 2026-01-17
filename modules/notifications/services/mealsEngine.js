/**
 * Meals Engine Stub
 */

module.exports = {
  planMeal: async (familyId, date, mealType) => {
    return { success: true, meal: null };
  },
  getSuggestions: async (preferences) => {
    return [];
  },
  generateShoppingList: async (meals) => {
    return [];
  }
};
