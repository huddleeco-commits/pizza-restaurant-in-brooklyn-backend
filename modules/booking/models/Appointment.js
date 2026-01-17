/**
 * Appointment Model Stub
 * Auto-generated - Replace with actual schema
 */

const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  // Add your schema fields here
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', AppointmentSchema);
