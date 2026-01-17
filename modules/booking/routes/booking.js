const express = require('express');
const router = express.Router();
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Provider = require('../models/Provider');
const Practice = require('../models/Practice');

// GET all appointments (with filters)
router.get('/', async (req, res) => {
  try {
    const { practiceId, patientId, providerId, status, date, startDate, endDate } = req.query;
    
    const filters = {};
    if (practiceId) filters.practiceId = practiceId;
    if (patientId) filters.patientId = patientId;
    if (providerId) filters.providerId = providerId;
    if (status) filters.status = status;
    
    // Date filtering
    if (date) {
      const targetDate = new Date(date);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      filters.appointmentDate = { $gte: targetDate, $lt: nextDay };
    } else if (startDate && endDate) {
      filters.appointmentDate = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }
    
    const appointments = await Appointment.find(filters)
      .populate('patientId', 'firstName lastName dateOfBirth contact')
      .populate('providerId', 'firstName lastName title specialty')
      .populate('practiceId', 'practiceName')
      .sort({ appointmentDate: 1, startTime: 1 });
    
    res.json({
      success: true,
      count: appointments.length,
      data: appointments
    });
  } catch (error) {
    console.error('[Appointments Route] Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch appointments',
      details: error.message
    });
  }
});

// GET single appointment
router.get('/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patientId', 'firstName lastName dateOfBirth contact insurance medicalHistory')
      .populate('providerId', 'firstName lastName title specialty contact')
      .populate('practiceId', 'practiceName contact location')
      .populate('relatedRecords')
      .populate('relatedPrescriptions')
      .populate('relatedTreatments');
    
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    res.json({
      success: true,
      data: appointment
    });
  } catch (error) {
    console.error('[Appointments Route] Error fetching appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch appointment',
      details: error.message
    });
  }
});

// CREATE new appointment
router.post('/', async (req, res) => {
  try {
    const { practiceId, patientId, providerId, appointmentDate, startTime } = req.body;
    
    // Verify all required entities exist
    const practice = await Practice.findById(practiceId);
    if (!practice) {
      return res.status(404).json({ success: false, error: 'Practice not found' });
    }
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }
    
    const provider = await Provider.findById(providerId);
    if (!provider) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    
    // Check for scheduling conflicts
    const conflict = await Appointment.findOne({
      providerId,
      appointmentDate: new Date(appointmentDate),
      startTime,
      status: { $nin: ['cancelled', 'no-show'] }
    });
    
    if (conflict) {
      return res.status(400).json({
        success: false,
        error: 'Time slot already booked for this provider'
      });
    }
    
    const appointment = new Appointment(req.body);
    await appointment.save();
    
    // Update stats
    await patient.updateStats({ 
      nextAppointment: new Date(appointmentDate) 
    });
    await provider.updateStats({ 
      totalAppointments: await Appointment.countDocuments({ 
        providerId, 
        status: { $ne: 'cancelled' } 
      }) 
    });
    await practice.updateStats({ 
      totalAppointments: await Appointment.countDocuments({ practiceId }) 
    });
    
    console.log('[Appointments Route] Created appointment:', appointment._id);
    
    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: appointment
    });
  } catch (error) {
    console.error('[Appointments Route] Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create appointment',
      details: error.message
    });
  }
});

// UPDATE appointment
router.put('/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    console.log('[Appointments Route] Updated appointment:', appointment._id);
    
    res.json({
      success: true,
      message: 'Appointment updated successfully',
      data: appointment
    });
  } catch (error) {
    console.error('[Appointments Route] Error updating appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update appointment',
      details: error.message
    });
  }
});

// UPDATE appointment status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    await appointment.updateStatus(status);
    
    res.json({
      success: true,
      message: 'Appointment status updated',
      data: { status: appointment.status }
    });
  } catch (error) {
    console.error('[Appointments Route] Error updating status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update status',
      details: error.message
    });
  }
});

// ADD clinical notes
router.post('/:id/clinical-notes', async (req, res) => {
  try {
    const { notes, providerId } = req.body;
    
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    await appointment.addClinicalNotes(notes, providerId);
    
    res.json({
      success: true,
      message: 'Clinical notes added',
      data: appointment.clinicalNotes
    });
  } catch (error) {
    console.error('[Appointments Route] Error adding notes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add clinical notes',
      details: error.message
    });
  }
});

// RECORD vitals
router.post('/:id/vitals', async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    await appointment.recordVitals(req.body);
    
    res.json({
      success: true,
      message: 'Vitals recorded',
      data: appointment.vitals
    });
  } catch (error) {
    console.error('[Appointments Route] Error recording vitals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record vitals',
      details: error.message
    });
  }
});

// CANCEL appointment
router.post('/:id/cancel', async (req, res) => {
  try {
    const { cancelledBy, reason } = req.body;
    
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    await appointment.cancel(cancelledBy, reason);
    
    // Update patient stats
    const patient = await Patient.findById(appointment.patientId);
    if (patient) {
      await patient.updateStats({
        cancelledAppointments: (patient.stats.cancelledAppointments || 0) + 1
      });
    }
    
    res.json({
      success: true,
      message: 'Appointment cancelled',
      data: appointment
    });
  } catch (error) {
    console.error('[Appointments Route] Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel appointment',
      details: error.message
    });
  }
});

// RESCHEDULE appointment
router.post('/:id/reschedule', async (req, res) => {
  try {
    const { newDate, newStartTime, newEndTime, reason } = req.body;
    
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    // Check for conflicts at new time
    const conflict = await Appointment.findOne({
      providerId: appointment.providerId,
      appointmentDate: new Date(newDate),
      startTime: newStartTime,
      status: { $nin: ['cancelled', 'no-show'] },
      _id: { $ne: appointment._id }
    });
    
    if (conflict) {
      return res.status(400).json({
        success: false,
        error: 'New time slot already booked'
      });
    }
    
    await appointment.reschedule(newDate, newStartTime, newEndTime, reason);
    
    res.json({
      success: true,
      message: 'Appointment rescheduled',
      data: appointment
    });
  } catch (error) {
    console.error('[Appointments Route] Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reschedule appointment',
      details: error.message
    });
  }
});

// GET available time slots
router.get('/available-slots/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required'
      });
    }
    
    const provider = await Provider.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: 'Provider not found'
      });
    }
    
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days[dayOfWeek];
    
    const schedule = provider.schedule[dayName];
    
    if (!schedule.available) {
      return res.json({
        success: true,
        availableSlots: [],
        message: 'Provider not available on this day'
      });
    }
    
    // Get booked appointments
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const bookedAppointments = await Appointment.find({
      providerId,
      appointmentDate: { $gte: targetDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'no-show'] }
    }).select('startTime endTime');
    
    // Generate available slots (simplified - would need more logic for production)
    const bookedTimes = bookedAppointments.map(apt => apt.startTime);
    
    res.json({
      success: true,
      date,
      provider: provider.fullName,
      schedule: schedule,
      bookedTimes,
      message: 'Check booked times against schedule'
    });
  } catch (error) {
    console.error('[Appointments Route] Error fetching available slots:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available slots',
      details: error.message
    });
  }
});

// DELETE appointment
router.delete('/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndDelete(req.params.id);
    
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    console.log('[Appointments Route] Deleted appointment:', appointment._id);
    
    res.json({
      success: true,
      message: 'Appointment deleted successfully'
    });
  } catch (error) {
    console.error('[Appointments Route] Error deleting appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete appointment',
      details: error.message
    });
  }
});

module.exports = router;