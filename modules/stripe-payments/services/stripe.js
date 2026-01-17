const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const stripeService = {
  // Create checkout session for subscription
  createCheckoutSession: async (userId, priceId, userEmail) => {
    try {
      const session = await stripe.checkout.sessions.create({
        customer_email: userEmail,
        client_reference_id: userId.toString(),
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pricing`,
        metadata: {
          userId: userId.toString(),
        },
      });

      return { success: true, sessionId: session.id, url: session.url };
    } catch (error) {
      console.error('Stripe checkout error:', error);
      return { success: false, error: error.message };
    }
  },

  // Create customer portal session (manage subscription)
  createPortalSession: async (customerId) => {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
      });

      return { success: true, url: session.url };
    } catch (error) {
      console.error('Stripe portal error:', error);
      return { success: false, error: error.message };
    }
  },

  // Get subscription details
  getSubscription: async (subscriptionId) => {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return { success: true, subscription };
    } catch (error) {
      console.error('Get subscription error:', error);
      return { success: false, error: error.message };
    }
  },

  // Cancel subscription
  cancelSubscription: async (subscriptionId) => {
    try {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      return { success: true, subscription };
    } catch (error) {
      console.error('Cancel subscription error:', error);
      return { success: false, error: error.message };
    }
  },
};

module.exports = stripeService;