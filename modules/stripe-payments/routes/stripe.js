const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const stripeService = require('../services/stripe-service');
const db = require('../database/db');
const plansConfig = require('../config/plans');
const { plans } = plansConfig;
const emailService = require('../services/email-service');

// Get subscription plans (only active, non-legacy plans)
router.get('/plans', async (req, res) => {
  try {
    // Use the getActivePlans helper to exclude legacy plans
    const planArray = plansConfig.getActivePlans();

    res.json({
      success: true,
      plans: planArray
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ success: false, error: 'Failed to get plans' });
  }
});

// Create checkout session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    const { priceId } = req.body;
    const userId = req.user.userId;

    // Get user email
    const userResult = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = await stripeService.createCheckoutSession(userId, priceId, user.email);

    if (result.success) {
      res.json({ success: true, sessionId: result.sessionId, url: result.url });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

// Get current subscription
router.get('/subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const subResult = await db.query(`
      SELECT * FROM subscriptions 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId]);

    const userResult = await db.query('SELECT subscription_tier, subscription_status FROM users WHERE id = ?', [userId]);
    const user = userResult.rows[0];

    res.json({
      success: true,
      subscription: subResult.rows[0] || null,
      plan: user?.subscription_tier || 'free',
      status: user?.subscription_status || 'active'
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, error: 'Failed to get subscription' });
  }
});

// Create portal session (manage subscription)
router.post('/create-portal-session', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await db.query('SELECT stripe_customer_id FROM users WHERE id = ?', [userId]);
    const user = userResult.rows[0];

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ success: false, error: 'No subscription found' });
    }

    const result = await stripeService.createPortalSession(user.stripe_customer_id);

    if (result.success) {
      res.json({ success: true, url: result.url });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('Create portal error:', error);
    res.status(500).json({ success: false, error: 'Failed to create portal session' });
  }
});

// Portal session endpoint (alternate name for frontend)
router.post('/portal-session', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await db.query('SELECT stripe_customer_id FROM users WHERE id = ?', [userId]);
    const user = userResult.rows[0];

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    const result = await stripeService.createPortalSession(user.stripe_customer_id);

    if (result.success) {
      res.json({ url: result.url });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Portal session error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ⚠️ NOTE: This function is NO LONGER USED by /scan-limit endpoint
// It's kept here in case other code still references it, but will be deprecated
// Helper function to get monthly scan count from api_usage (DEPRECATED - use users.scans_used instead)
async function getMonthlyScans(userId) {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  
  const usageResult = await db.query(
    `SELECT COUNT(*) as scan_count 
     FROM api_usage 
     WHERE user_id = ? 
     AND api_name IN ('claude_scan', 'claude_scan_failed')
     AND scan_source = 'platform'
     AND call_date LIKE ?`,
    [userId, `${currentMonth}%`]
  );
  
  return parseInt(usageResult.rows[0]?.scan_count || 0);
}

// Check all usage limits (scans, eBay listings, showcases, bulk)
router.get('/scan-limit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await db.query('SELECT subscription_tier, scans_used, ebay_listings_used FROM users WHERE id = ?', [userId]);
    const user = userResult.rows[0];
    
    const userTier = user?.subscription_tier || 'free';
    const scansUsed = user?.scans_used || 0;
    const ebayListingsUsed = user?.ebay_listings_used || 0;
    
    // Map tier to plan key (monthly version - limits are the same)
    const tierToPlanKey = {
      free: 'free',
      power: 'power_monthly',
      dealer: 'dealer_monthly',
      // Legacy tiers
      starter: 'starter_monthly',
      pro: 'pro_monthly',
      premium: 'premium_monthly'
    };
    
    const planKey = tierToPlanKey[userTier] || 'free';
    const planLimits = plansConfig.getLimits(planKey);
    
    const scanLimit = planLimits.scanLimit;
    const ebayListingsLimit = planLimits.ebayListingsLimit;
    const showcaseLimit = planLimits.showcaseLimit;
    const bulkScanLimit = planLimits.bulkScanLimit;
    
    const scansRemaining = Math.max(0, scanLimit - scansUsed);
    const ebayListingsRemaining = Math.max(0, ebayListingsLimit - ebayListingsUsed);

    console.log(`📊 Limits for user ${userId} (${userTier}): scans ${scansUsed}/${scanLimit}, listings ${ebayListingsUsed}/${ebayListingsLimit}`);

    res.json({
      success: true,
      plan: userTier,
      // Backwards compatible fields
      limit: scanLimit,
      used: scansUsed,
      remaining: scansRemaining,
      canScan: scansRemaining > 0,
      // New detailed fields
      scanLimit,
      scansUsed,
      scansRemaining,
      ebayListingsLimit,
      ebayListingsUsed,
      ebayListingsRemaining,
      canListOnEbay: ebayListingsRemaining > 0,
      showcaseLimit,
      bulkScanLimit
    });
  } catch (error) {
    console.error('Check scan limit error:', error);
    res.status(500).json({ success: false, error: 'Failed to check scan limit' });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = require('stripe')(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      
      // Update user subscription
      const userId = session.client_reference_id;
      const customerId = session.customer;
      const subscriptionId = session.subscription;
      
      if (userId && subscriptionId) {
        // Fetch the subscription to get the price ID
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0].price.id;
        
        // Determine plan name from price ID using our config
        const plan = plansConfig.getPlanByPriceId(priceId);
        let planTier = 'free';
        
        if (plan) {
          // Extract the tier name (starter, pro, or premium)
          planTier = plansConfig.getTierFromPlan(Object.keys(plans).find(key => plans[key].stripePriceId === priceId));
        }
        
        // Update user
        await db.query(`
          UPDATE users 
          SET subscription_tier = ?, 
              subscription_status = 'active',
              stripe_customer_id = ?,
              stripe_subscription_id = ?
          WHERE id = ?
        `, [planTier, customerId, subscriptionId, userId]);
        
        // Insert subscription record
        await db.query(`
          INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_name, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        `, [userId, customerId, subscriptionId, priceId, planTier]);
        
        console.log(`✅ User ${userId} upgraded to ${planTier}`);
      }
      break;
      
    case 'customer.subscription.deleted':
  const deletedSubscription = event.data.object;
  
  // Downgrade to free
  await db.query(`
    UPDATE users 
    SET subscription_tier = 'free',
        subscription_status = 'cancelled',
        stripe_subscription_status = 'canceled',
        subscription_end_date = NOW()
    WHERE stripe_customer_id = ?
  `, [deletedSubscription.customer]);
  
  console.log(`❌ Subscription cancelled for customer ${deletedSubscription.customer}`);
  break;
      
    case 'customer.subscription.updated':
  const updatedSubscription = event.data.object;
  const subscriptionStatus = updatedSubscription.status;
  const updatedPriceId = updatedSubscription.items.data[0].price.id;
  
  console.log(`🔄 Subscription updated for customer ${updatedSubscription.customer}, status: ${subscriptionStatus}`);
  
  // Check if subscription is past_due, unpaid, or canceled
  if (['past_due', 'unpaid', 'canceled'].includes(subscriptionStatus)) {
    // Downgrade to free tier
    await db.query(`
      UPDATE users 
      SET subscription_tier = 'free',
          subscription_status = 'cancelled',
          stripe_subscription_status = ?,
          subscription_end_date = NOW()
      WHERE stripe_customer_id = ?
    `, [subscriptionStatus, updatedSubscription.customer]);
    
    console.log(`❌ User downgraded to free due to ${subscriptionStatus} status`);
    
    // Send email notification
    try {
      const userResult = await db.query(
        'SELECT email, id FROM users WHERE stripe_customer_id = ?',
        [updatedSubscription.customer]
      );
      
      if (userResult.rows[0]) {
        const user = userResult.rows[0];
        await emailService.sendDowngradeEmail(user.email, user.id, subscriptionStatus);
        console.log(`📧 Downgrade email sent to ${user.email} (CC: huddleeco@gmail.com)`);
      }
    } catch (emailError) {
      console.error('❌ Failed to send downgrade email:', emailError.message);
    }
    
  } else {
    // Subscription is active - determine the new plan tier 
    const updatedPlan = plansConfig.getPlanByPriceId(updatedPriceId);
    let newPlanTier = 'free';
    
    if (updatedPlan) {
      for (const [key, plan] of Object.entries(plans)) {
        if (plan.stripePriceId === updatedPriceId) {
          newPlanTier = plansConfig.getTierFromPlan(key);
          break;
        }
      }
    }
    
    // Update user's plan
    await db.query(`
      UPDATE users 
      SET subscription_tier = ?,
          subscription_status = 'active',
          stripe_subscription_status = ?
      WHERE stripe_customer_id = ?
    `, [newPlanTier, subscriptionStatus, updatedSubscription.customer]);
    
    console.log(`✅ Subscription updated for customer ${updatedSubscription.customer} to ${newPlanTier}`);
  }
  break;
      
    // NEW: Handle successful monthly payments
    case 'invoice.payment_succeeded':
      const successInvoice = event.data.object;
      const successCustomerId = successInvoice.customer;
      
      console.log(`✅ Payment succeeded for customer ${successCustomerId}`);
      
      // Ensure user stays active (in case status was pending)
      await db.query(`
        UPDATE users 
        SET subscription_status = 'active'
        WHERE stripe_customer_id = ?
      `, [successCustomerId]);
      break;
      
    // NEW: Handle failed monthly payments
    case 'invoice.payment_failed':
  const failedInvoice = event.data.object;
  const failedCustomerId = failedInvoice.customer;
  
  console.log(`❌ Payment failed for customer ${failedCustomerId}`);
  
  // Mark subscription as past_due (Stripe will retry)
  await db.query(`
    UPDATE users 
    SET subscription_status = 'past_due',
        stripe_subscription_status = 'past_due'
    WHERE stripe_customer_id = ?
  `, [failedCustomerId]);
  break;
      
    default:
      console.log(`⚠️ Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// Reset scans on the 1st of each month
async function resetMonthlyScans() {
    try {
        const result = await db.query(
            'UPDATE users SET scans_used = 0'
        );
        console.log(`✅ Reset monthly scans for all users`);
    } catch (error) {
        console.error('Failed to reset monthly scans:', error);
    }
}

// Schedule monthly reset (if using node-cron)
// const cron = require('node-cron');
// cron.schedule('0 0 1 * *', resetMonthlyScans); // Run at midnight on the 1st of each month

module.exports = router;