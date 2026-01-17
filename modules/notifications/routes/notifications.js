const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const jwt = require('jsonwebtoken');

// Middleware to verify token
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.json({ success: false, error: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'huddle-secret-key');
        req.userId = decoded.userId || decoded.id || decoded._id;
        next();
    } catch (error) {
        res.json({ success: false, error: 'Invalid token' });
    }
};

// Get user's notifications
router.get('/', authenticate, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const skip = parseInt(req.query.skip) || 0;
        
        const notifications = await Notification.find({ recipient: req.userId })
            .populate('sender', 'username displayName avatar')
            .populate('data.postId', 'content type')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip);
        
        // Get unread count
        const unreadCount = await Notification.countDocuments({ 
            recipient: req.userId, 
            read: false 
        });
        
        res.json({
            success: true,
            notifications,
            unreadCount
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Mark notification as read
router.put('/:notificationId/read', authenticate, async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.notificationId, recipient: req.userId },
            { read: true }
        );
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Mark all as read
router.put('/read-all', authenticate, async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.userId, read: false },
            { read: true }
        );
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get unread count
router.get('/unread-count', authenticate, async (req, res) => {
    try {
        const count = await Notification.countDocuments({ 
            recipient: req.userId, 
            read: false 
        });
        
        res.json({ success: true, count });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Delete notification
router.delete('/:notificationId', authenticate, async (req, res) => {
    try {
        await Notification.findOneAndDelete({
            _id: req.params.notificationId,
            recipient: req.userId
        });
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Helper function to create notification (used by other routes)
async function createNotification(data) {
    try {
        const notification = new Notification(data);
        await notification.save();
        return notification;
    } catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
}

// Export the helper function too
router.createNotification = createNotification;

module.exports = router;