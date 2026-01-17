/**
 * Stripe Service Stub
 * Replace with actual Stripe integration
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = {
  createCustomer: async (email, name) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.log('⚠️ Stripe not configured - using stub');
      return { id: 'cus_stub_' + Date.now() };
    }
    return await stripe.customers.create({ email, name });
  },
  
  createSubscription: async (customerId, priceId) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return { id: 'sub_stub_' + Date.now(), status: 'active' };
    }
    return await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }]
    });
  },
  
  cancelSubscription: async (subscriptionId) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return { id: subscriptionId, status: 'canceled' };
    }
    return await stripe.subscriptions.cancel(subscriptionId);
  },
  
  createPaymentIntent: async (amount, currency = 'usd') => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return { client_secret: 'pi_stub_secret_' + Date.now() };
    }
    return await stripe.paymentIntents.create({ amount, currency });
  }
};
