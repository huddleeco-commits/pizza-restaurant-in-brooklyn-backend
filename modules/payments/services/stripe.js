// backend/services/stripe-service.js
class StripeService {
    async createCustomer(data) {
        return { id: 'mock_customer_id' };
    }
    async createSubscription(data) {
        return { id: 'mock_subscription_id' };
    }
    async handleWebhook(req, res) {
        res.json({ received: true });
    }
}
module.exports = StripeService;
