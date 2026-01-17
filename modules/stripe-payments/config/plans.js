module.exports = {
  plans: {
    // ============================================
    // NEW PLANS (Active - shown on pricing page)
    // ============================================
    
    free: {
      name: 'Free',
      price: 0,
      interval: 'month',
      scanLimit: 100,
      ebayListingsLimit: 50,
      showcaseLimit: 1,
      bulkScanLimit: 10,
      cardLimit: null,
      features: [
        '100 AI scans/month',
        '50 eBay listings/month',
        '1 public showcase',
        'Bulk scan: up to 10 cards',
        'All features included'
      ]
    },
    
    // POWER PLANS (New $9.99 tier)
    power_monthly: {
      name: 'Power',
      price: 9.99,
      interval: 'month',
      stripePriceId: 'price_1SX6ULQ20P462xlWl3x3Aazm',
      scanLimit: 500,
      ebayListingsLimit: 150,
      showcaseLimit: 3,
      bulkScanLimit: 25,
      cardLimit: null,
      features: [
        '500 AI scans/month',
        '150 eBay listings/month',
        '3 public showcases',
        'Bulk scan: up to 25 cards',
        'Priority support'
      ]
    },
    
    power_annual: {
      name: 'Power',
      price: 99.99,
      interval: 'year',
      stripePriceId: 'price_1SX6VfQ20P462xlWCNJ6k8yl',
      scanLimit: 500,
      ebayListingsLimit: 150,
      showcaseLimit: 3,
      bulkScanLimit: 25,
      cardLimit: null,
      features: [
        '500 AI scans/month',
        '150 eBay listings/month',
        '3 public showcases',
        'Bulk scan: up to 25 cards',
        'Priority support',
        'Save 17%'
      ]
    },
    
    // DEALER PLANS (New $19.99 tier)
    dealer_monthly: {
      name: 'Dealer',
      price: 19.99,
      interval: 'month',
      stripePriceId: 'price_1SX6XWQ20P462xlWr9kK6ViV',
      scanLimit: 1500,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      features: [
        '1,500 AI scans/month',
        'Unlimited eBay listings',
        'Unlimited public showcases',
        'Bulk scan: up to 100 cards',
        'Priority support'
      ]
    },
    
    dealer_annual: {
      name: 'Dealer',
      price: 199.99,
      interval: 'year',
      stripePriceId: 'price_1SX6YDQ20P462xlWKmFVGZYG',
      scanLimit: 1500,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      features: [
        '1,500 AI scans/month',
        'Unlimited eBay listings',
        'Unlimited public showcases',
        'Bulk scan: up to 100 cards',
        'Priority support',
        'Save 17%'
      ]
    },
    
    // ============================================
    // LEGACY PLANS (Hidden - for existing subscribers)
    // These users get BONUS unlimited access
    // ============================================
    
    // LEGACY STARTER PLANS
    starter_monthly: {
      name: 'Starter',
      price: 2.99,
      interval: 'month',
      stripePriceId: 'price_1SSMC5Q20P462xlWoXIXpI46',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    },
    
    starter_annual: {
      name: 'Starter',
      price: 29.99,
      interval: 'year',
      stripePriceId: 'price_1SSMCwQ20P462xlWwbms6UBm',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    },
    
    // LEGACY PRO PLANS
    pro_monthly: {
      name: 'Pro',
      price: 9.99,
      interval: 'month',
      stripePriceId: 'price_1SSMDfQ20P462xlWHT8hRT8W',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    },
    
    pro_annual: {
      name: 'Pro',
      price: 99.99,
      interval: 'year',
      stripePriceId: 'price_1SSMEKQ20P462xlWCVlEKZ5t',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    },
    
    // LEGACY PREMIUM PLANS
    premium_monthly: {
      name: 'Premium',
      price: 19.99,
      interval: 'month',
      stripePriceId: 'price_1SSMF7Q20P462xlW75jxiZUh',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    },
    
    premium_annual: {
      name: 'Premium',
      price: 199.99,
      interval: 'year',
      stripePriceId: 'price_1SSMFoQ20P462xlWsi4MYRYB',
      scanLimit: 999999,
      ebayListingsLimit: 999999,
      showcaseLimit: 999999,
      bulkScanLimit: 100,
      cardLimit: null,
      legacy: true,
      features: [
        'Legacy Plan - Unlimited Access',
        'Unlimited scans',
        'Unlimited eBay listings',
        'Unlimited showcases'
      ]
    }
  },

  // Helper to get plan by price ID
  getPlanByPriceId: function(priceId) {
    return Object.values(this.plans).find(plan => plan.stripePriceId === priceId);
  },

  // Helper to get plan tier from any plan ID
  getTierFromPlan: function(planId) {
    if (planId.includes('dealer')) return 'dealer';
    if (planId.includes('power')) return 'power';
    // Legacy mappings
    if (planId.includes('premium')) return 'dealer';
    if (planId.includes('pro')) return 'power';
    if (planId.includes('starter')) return 'starter';
    return 'free';
  },

  // Helper to get limits for a plan OR tier name
  getLimits: function(planIdOrTier) {
    // First try exact match (e.g., "dealer_monthly")
    let plan = this.plans[planIdOrTier];
    
    // If not found, try tier name match (e.g., "dealer" → "dealer_monthly")
    if (!plan) {
      const tierMappings = {
        'free': 'free',
        'power': 'power_monthly',
        'dealer': 'dealer_monthly',
        'starter': 'starter_monthly',
        'pro': 'pro_monthly',
        'premium': 'premium_monthly'
      };
      const mappedPlanId = tierMappings[planIdOrTier];
      if (mappedPlanId) {
        plan = this.plans[mappedPlanId];
      }
    }
    
    if (!plan) {
      // Return free tier limits as default
      return {
        scanLimit: 100,
        ebayListingsLimit: 50,
        showcaseLimit: 1,
        bulkScanLimit: 10
      };
    }
    return {
      scanLimit: plan.scanLimit,
      ebayListingsLimit: plan.ebayListingsLimit,
      showcaseLimit: plan.showcaseLimit,
      bulkScanLimit: plan.bulkScanLimit
    };
  },

  // Get only active (non-legacy) plans for pricing page
  getActivePlans: function() {
    return Object.entries(this.plans)
      .filter(([key, plan]) => !plan.legacy && key !== 'free')
      .map(([key, plan]) => ({
        id: key,
        ...plan
      }));
  }
};