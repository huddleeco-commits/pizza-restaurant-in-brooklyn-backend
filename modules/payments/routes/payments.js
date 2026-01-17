const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');

// @route   GET /api/payments/config
router.get('/config', authenticate, (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLIC_KEY,
        tiers: {
            essential: { price: 0, features: ['100 listings', '10% commission'] },
            premium: { price: 999, features: ['1000 listings', '5% commission', 'Analytics'] },
            luxury: { price: 4999, features: ['Unlimited listings', '0% commission', 'AI features'] }
        }
    });
});

// @route   POST /api/payments/create-subscription
router.post('/create-subscription', authenticate, async (req, res) => {
    try {
        const { tier, paymentMethodId } = req.body;
        
        // Mock subscription for now
        res.json({
            success: true,
            subscription: {
                id: 'sub_mock_' + Date.now(),
                tier,
                status: 'active'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;