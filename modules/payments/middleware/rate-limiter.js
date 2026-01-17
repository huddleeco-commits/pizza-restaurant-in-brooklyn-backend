/**
 * Rate Limiter Middleware
 * Auto-generated
 */

const rateLimit = require('express-rate-limit');

// Track usage per user
const usageMap = new Map();

const getRateLimitMiddleware = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
    max: options.max || 100, // limit each IP
    message: { error: 'Too many requests, please try again later' }
  });
};

const incrementUsage = async (userId, feature = 'default') => {
  const key = `${userId}:${feature}`;
  const current = usageMap.get(key) || 0;
  usageMap.set(key, current + 1);
  return current + 1;
};

const getUsage = async (userId, feature = 'default') => {
  return usageMap.get(`${userId}:${feature}`) || 0;
};

module.exports = {
  getRateLimitMiddleware,
  incrementUsage,
  getUsage,
  rateLimit: getRateLimitMiddleware()
};
