/**
 * Recipe Model Stub
 * Auto-generated - Replace with actual schema
 */

const mongoose = require('mongoose');

const RecipeSchema = new mongoose.Schema({
  // Add your schema fields here
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.Recipe || mongoose.model('Recipe', RecipeSchema);
