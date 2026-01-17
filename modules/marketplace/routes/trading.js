const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const rateLimit = require('express-rate-limit');
const Trade = require('../models/Trade');
const User = require('../models/User');
const Card = require('../models/Card');
const Listing = require('../models/Listing');
const PendingAction = require('../models/PendingAction');
const SpendingLog = require('../models/SpendingLog');
const { notifyUser, notifyParent } = require('../services/notificationService');
const crypto = require('crypto');

// Redis client setup (optional - falls back gracefully if not available)
let redisClient = null;
try {
  if (process.env.REDIS_URL) {
    const redis = require('redis');
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.error('[Redis] Trading cache error:', err));
    redisClient.connect().catch(console.error);
    console.log('[Redis] Connected for trading cache');
  }
} catch (error) {
  console.log('[Redis] Not available, using non-cached trading operations');
}

// Enhanced rate limiters with better configuration
const getLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // Increased for better UX
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id || req.ip, // Per-user limiting
});

const postLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Increased for active traders
  message: { success: false, message: 'Too many trade requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id || req.ip,
});

// Cache helper functions
const getCacheKey = (type, identifier) => `trading:${type}:${identifier}`;

const getFromCache = async (key) => {
  if (!redisClient) return null;
  try {
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('[Cache] Get error:', error.message);
    return null;
  }
};

const setCache = async (key, data, ttl = 300) => {
  if (!redisClient) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (error) {
    console.error('[Cache] Set error:', error.message);
  }
};

const invalidateCache = async (pattern) => {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(`trading:${pattern}*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.error('[Cache] Invalidate error:', error.message);
  }
};

// Enhanced validation helpers
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const validatePagination = (page, limit) => {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  return {
    page: Math.max(1, p),
    limit: Math.min(100, Math.max(1, l))
  };
};

// Enhanced logging with correlation IDs
const logWithCorrelation = (level, message, data, req) => {
  const correlationId = req?.correlationId || 'unknown';
  const userId = req?.user?._id || 'anonymous';
  console.log(`[${level.toUpperCase()}] [${correlationId}] [User:${userId}] ${message}`, data || '');
};

// Optimized helper functions
async function logSpending(userId, amount, actionType, session = null) {
  try {
    if (!isValidObjectId(userId) || !amount || !actionType) {
      console.error('[logSpending] Invalid inputs:', { userId, amount, actionType });
      return;
    }
    
    const logData = {
      userId: new mongoose.Types.ObjectId(userId),
      amount: Number(amount),
      actionType: String(actionType),
      timestamp: new Date(),
    };
    
    if (session) {
      await SpendingLog.create([logData], { session });
    } else {
      await SpendingLog.create(logData);
    }
  } catch (err) {
    console.error('[logSpending] Error:', err.message);
  }
}

async function checkSpendingLimit(user, amount) {
  try {
    if (!user.parentalControls?.spendingLimit) return true;
    
    // Cache spending limit checks for 5 minutes
    const cacheKey = getCacheKey('spending', `${user._id}_${amount}`);
    const cached = await getFromCache(cacheKey);
    if (cached !== null) return cached;
    
    const start = new Date();
    const period = user.parentalControls.spendingPeriod || 'daily';
    
    switch (period) {
      case 'weekly':
        start.setDate(start.getDate() - 7);
        break;
      case 'monthly':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'daily':
      default:
        start.setHours(start.getHours() - 24);
    }

    const logs = await SpendingLog.aggregate([
      { $match: { userId: user._id, timestamp: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalSpent = logs[0]?.total || 0;
    const withinLimit = (totalSpent + amount) <= user.parentalControls.spendingLimit;
    
    // Cache for 5 minutes
    await setCache(cacheKey, withinLimit, 300);
    return withinLimit;
  } catch (err) {
    console.error('[checkSpendingLimit] Error:', err.message);
    return false;
  }
}

// Optimized card ownership verification
async function verifyCardOwnership(userId, cardIds, session = null) {
  try {
    const user = await User.findById(userId)
      .select('assignedCards vault')
      .session(session);
    
    if (!user) return { valid: false, error: 'User not found' };
    
    const userCards = [...user.assignedCards, ...user.vault].map(id => id.toString());
    const missingCards = cardIds.filter(cardId => !userCards.includes(cardId.toString()));
    
    if (missingCards.length > 0) {
      return { 
        valid: false, 
        error: 'User does not own all cards',
        missingCards 
      };
    }
    
    return { valid: true };
  } catch (error) {
    console.error('[verifyCardOwnership] Error:', error.message);
    return { valid: false, error: 'Verification failed' };
  }
}

// Optimized listing conflict check
async function checkListingConflicts(cardIds, session = null) {
  try {
    const activeListings = await Listing.find({ 
      cardId: { $in: cardIds }, 
      status: 'active' 
    })
    .select('cardId')
    .session(session)
    .lean();
    
    return activeListings.map(listing => listing.cardId.toString());
  } catch (error) {
    console.error('[checkListingConflicts] Error:', error.message);
    return [];
  }
}

// Enhanced middleware for correlation IDs
router.use((req, res, next) => {
  if (!req.correlationId) {
    req.correlationId = crypto.randomBytes(8).toString('hex');
  }
  next();
});

// GET /api/trading/incoming - Fetch incoming trades with enhanced caching
router.get('/incoming', getLimiter, [
  query('userId').optional().isMongoId().withMessage('Invalid user ID'),
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWithCorrelation('error', 'Validation failed for incoming trades', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.query.userId || req.user._id;
    const { page, limit } = validatePagination(req.query.page, req.query.limit);
    const skip = (page - 1) * limit;

    // Verify access
    if (userId !== req.user._id && !req.user.isAdmin && req.user.role !== 'master') {
      logWithCorrelation('warn', 'Access denied for incoming trades', { requestedUserId: userId }, req);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Check cache first
    const cacheKey = getCacheKey('incoming', `${userId}_${page}_${limit}`);
    const cached = await getFromCache(cacheKey);
    if (cached) {
      logWithCorrelation('info', 'Returning cached incoming trades', { userId, count: cached.trades.length }, req);
      return res.json(cached);
    }

    const query = { toUser: userId, status: 'pending' };
    
    // Optimized parallel queries with lean() for better performance
    const [trades, total] = await Promise.all([
      Trade.find(query)
        .populate('fromUser', 'username email')
        .populate('toUser', 'username email')
        .populate('offeredCards', 'player_name images estimatedValue')
        .populate('requestedCards', 'player_name images estimatedValue')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Trade.countDocuments(query)
    ]);

    const result = { 
      success: true,
      trades, 
      total, 
      page, 
      limit,
      pagination: {
        hasNext: skip + trades.length < total,
        hasPrev: page > 1,
        totalPages: Math.ceil(total / limit)
      }
    };

    // Cache for 2 minutes (trades change frequently)
    await setCache(cacheKey, result, 120);

    logWithCorrelation('info', 'Found incoming trades', { userId, count: trades.length }, req);
    res.json(result);
  } catch (err) {
    logWithCorrelation('error', 'Error fetching incoming trades', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/trading/outgoing - Fetch outgoing trades with enhanced caching
router.get('/outgoing', getLimiter, [
  query('userId').optional().isMongoId().withMessage('Invalid user ID'),
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWithCorrelation('error', 'Validation failed for outgoing trades', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.query.userId || req.user._id;
    const { page, limit } = validatePagination(req.query.page, req.query.limit);
    const skip = (page - 1) * limit;

    // Verify access
    if (userId !== req.user._id && !req.user.isAdmin && req.user.role !== 'master') {
      logWithCorrelation('warn', 'Access denied for outgoing trades', { requestedUserId: userId }, req);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Check cache first
    const cacheKey = getCacheKey('outgoing', `${userId}_${page}_${limit}`);
    const cached = await getFromCache(cacheKey);
    if (cached) {
      logWithCorrelation('info', 'Returning cached outgoing trades', { userId, count: cached.trades.length }, req);
      return res.json(cached);
    }

    const query = { fromUser: userId, status: 'pending' };
    
    const [trades, total] = await Promise.all([
      Trade.find(query)
        .populate('fromUser', 'username email')
        .populate('toUser', 'username email')
        .populate('offeredCards', 'player_name images estimatedValue')
        .populate('requestedCards', 'player_name images estimatedValue')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Trade.countDocuments(query)
    ]);

    const result = { 
      success: true,
      trades, 
      total, 
      page, 
      limit,
      pagination: {
        hasNext: skip + trades.length < total,
        hasPrev: page > 1,
        totalPages: Math.ceil(total / limit)
      }
    };

    // Cache for 2 minutes
    await setCache(cacheKey, result, 120);

    logWithCorrelation('info', 'Found outgoing trades', { userId, count: trades.length }, req);
    res.json(result);
  } catch (err) {
    logWithCorrelation('error', 'Error fetching outgoing trades', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/trading/:id - Fetch trade details with caching
router.get('/:id', getLimiter, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      logWithCorrelation('warn', 'Invalid trade ID format', { tradeId: req.params.id }, req);
      return res.status(400).json({ success: false, message: 'Invalid trade ID' });
    }

    // Check cache first
    const cacheKey = getCacheKey('details', req.params.id);
    const cached = await getFromCache(cacheKey);
    if (cached) {
      // Still need to verify access for cached data
      const isInvolved = cached.fromUser._id === req.user._id || cached.toUser._id === req.user._id;
      if (!isInvolved && !req.user.isAdmin && req.user.role !== 'master') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      logWithCorrelation('info', 'Returning cached trade details', { tradeId: req.params.id }, req);
      return res.json({ success: true, trade: cached });
    }

    const trade = await Trade.findById(req.params.id)
      .populate('fromUser', 'username email')
      .populate('toUser', 'username email')
      .populate('offeredCards', 'player_name images estimatedValue team position')
      .populate('requestedCards', 'player_name images estimatedValue team position')
      .lean();

    if (!trade) {
      logWithCorrelation('warn', 'Trade not found', { tradeId: req.params.id }, req);
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    // Verify access
    const isInvolved = trade.fromUser._id.toString() === req.user._id || 
                      trade.toUser._id.toString() === req.user._id;
    
    if (!isInvolved && !req.user.isAdmin && req.user.role !== 'master') {
      logWithCorrelation('warn', 'Access denied for trade details', { tradeId: req.params.id }, req);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Cache for 5 minutes (trade details don't change often)
    await setCache(cacheKey, trade, 300);

    logWithCorrelation('info', 'Retrieved trade details', { tradeId: req.params.id }, req);
    res.json({ success: true, trade });
  } catch (err) {
    logWithCorrelation('error', 'Error fetching trade details', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/trading/submit - Submit a new trade with enhanced optimizations
router.post('/submit', postLimiter, [
  body('toUserId').isMongoId().withMessage('Invalid recipient ID'),
  body('offeredCards').isArray({ min: 1, max: 10 }).withMessage('1-10 offered cards required'),
  body('offeredCards.*').isMongoId().withMessage('Invalid card ID in offered cards'),
  body('requestedCards').isArray({ min: 1, max: 10 }).withMessage('1-10 requested cards required'),
  body('requestedCards.*').isMongoId().withMessage('Invalid card ID in requested cards'),
  body('message').optional().trim().isLength({ max: 500 }).withMessage('Message too long')
], async (req, res) => {
  logWithCorrelation('info', 'Starting trade submission', null, req);
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      logWithCorrelation('error', 'Validation failed for trade submission', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { toUserId, offeredCards, requestedCards, message } = req.body;
    
    // Prevent self-trading
    if (toUserId === req.user._id) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot trade with yourself' });
    }

    // Fetch users in parallel
    const [fromUser, toUser] = await Promise.all([
      User.findById(req.user._id).session(session),
      User.findById(toUserId).session(session)
    ]);

    if (!fromUser || !toUser) {
      await session.abortTransaction();
      logWithCorrelation('error', 'User not found during trade submission', { fromUser: !!fromUser, toUser: !!toUser }, req);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check parental controls
    if (fromUser.parentalControls?.restrictions?.includes('no_trading') && fromUser.role !== 'admin' && fromUser.role !== 'master') {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Trading restricted by parental controls' });
    }

    // Optimized parallel validations
    const tradeFee = 100;
    const [
      withinLimit,
      offeredOwnership,
      requestedOwnership,
      offeredListings,
      requestedListings
    ] = await Promise.all([
      checkSpendingLimit(fromUser, tradeFee),
      verifyCardOwnership(req.user._id, offeredCards, session),
      verifyCardOwnership(toUserId, requestedCards, session),
      checkListingConflicts(offeredCards, session),
      checkListingConflicts(requestedCards, session)
    ]);

    // Validation checks
    if (!withinLimit) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Trade would exceed spending limit' });
    }

    if (!offeredOwnership.valid) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: offeredOwnership.error });
    }

    if (!requestedOwnership.valid) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: requestedOwnership.error });
    }

    if (offeredListings.length > 0) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Cannot trade cards that are listed for sale' });
    }

    if (requestedListings.length > 0) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Cannot request cards that are listed for sale' });
    }

    // Check for duplicate pending trades (optimized query)
    const existingTrade = await Trade.findOne({
      fromUser: req.user._id,
      toUser: toUserId,
      status: 'pending',
      offeredCards: { $all: offeredCards, $size: offeredCards.length },
      requestedCards: { $all: requestedCards, $size: requestedCards.length }
    }).session(session).lean();

    if (existingTrade) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Similar trade already pending' });
    }

    // Handle parental approval if required
    if (fromUser.parentalControls?.tradeApproval === 'required' && fromUser.parentId) {
      const approvalToken = crypto.randomBytes(32).toString('hex');
      
      const trade = new Trade({
        fromUser: req.user._id,
        toUser: toUserId,
        offeredCards,
        requestedCards,
        message: message ? sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} }) : '',
        status: 'pending_approval',
        approvalToken,
        isCounter: false,
        createdAt: new Date()
      });
      
      await trade.save({ session });

      await PendingAction.create([{
        userId: fromUser._id,
        parentId: fromUser.parentId,
        actionType: 'trade',
        details: { 
          tradeId: trade._id,
          toUserId, 
          toUserName: toUser.username,
          offeredCards: offeredCards.length,
          requestedCards: requestedCards.length
        },
        token: approvalToken,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }], { session });

      await Promise.all([
        notifyParent(fromUser.parentId, fromUser._id, 'trade_pending', {
          tradeId: trade._id,
          toUserName: toUser.username,
          approvalToken
        }, { session }),
        logSpending(fromUser._id, tradeFee, 'trade_pending', session)
      ]);

      await session.commitTransaction();
      
      // Invalidate caches
      await invalidateCache(`incoming:${toUserId}`);
      await invalidateCache(`outgoing:${req.user._id}`);
      
      logWithCorrelation('info', 'Trade pending parental approval', { tradeId: trade._id }, req);
      return res.json({ 
        success: true, 
        message: 'Trade pending parental approval',
        tradeId: trade._id
      });
    }

    // Create trade
    const trade = new Trade({
      fromUser: req.user._id,
      toUser: toUserId,
      offeredCards,
      requestedCards,
      message: message ? sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} }) : '',
      status: 'pending',
      isCounter: false,
      createdAt: new Date()
    });

    await trade.save({ session });

    // Parallel operations for better performance
    await Promise.all([
      logSpending(fromUser._id, tradeFee, 'trade_submitted', session),
      notifyUser(toUserId, 'trade_offer', {
        tradeId: trade._id,
        fromUserName: fromUser.username,
        offeredCount: offeredCards.length,
        requestedCount: requestedCards.length,
        message: trade.message
      }, { session, caller: 'trading.submit' })
    ]);

    await session.commitTransaction();

    // Invalidate relevant caches
    await Promise.all([
      invalidateCache(`incoming:${toUserId}`),
      invalidateCache(`outgoing:${req.user._id}`)
    ]);

    logWithCorrelation('info', 'Trade submitted successfully', { tradeId: trade._id, toUserId }, req);
    res.json({ 
      success: true, 
      message: 'Trade submitted successfully',
      tradeId: trade._id
    });

  } catch (err) {
    await session.abortTransaction();
    logWithCorrelation('error', 'Error during trade submission', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// POST /api/trading/counter - Submit a counter-offer with optimizations
router.post('/counter', postLimiter, [
  body('tradeId').isMongoId().withMessage('Invalid trade ID'),
  body('toUserId').isMongoId().withMessage('Invalid recipient ID'),
  body('offeredCards').isArray({ min: 1, max: 10 }).withMessage('1-10 offered cards required'),
  body('offeredCards.*').isMongoId().withMessage('Invalid card ID in offered cards'),
  body('requestedCards').isArray({ min: 1, max: 10 }).withMessage('1-10 requested cards required'),
  body('requestedCards.*').isMongoId().withMessage('Invalid card ID in requested cards'),
  body('message').optional().trim().isLength({ max: 500 }).withMessage('Message too long')
], async (req, res) => {
  logWithCorrelation('info', 'Starting counter-offer', null, req);
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      logWithCorrelation('error', 'Validation failed for counter-offer', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { tradeId, toUserId, offeredCards, requestedCards, message } = req.body;

    // Fetch original trade
    const originalTrade = await Trade.findById(tradeId).session(session);
    if (!originalTrade) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Original trade not found' });
    }

    // Verify user is recipient of original trade
    if (originalTrade.toUser.toString() !== req.user._id) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'You are not the recipient of this trade' });
    }

    // Verify trade is still pending
    if (originalTrade.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Original trade is no longer pending' });
    }

    // Fetch users in parallel
    const [fromUser, toUser] = await Promise.all([
      User.findById(req.user._id).session(session),
      User.findById(toUserId).session(session)
    ]);

    if (!fromUser || !toUser) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Optimized parallel validations
    const [
      offeredOwnership,
      requestedOwnership,
      offeredListings,
      requestedListings
    ] = await Promise.all([
      verifyCardOwnership(req.user._id, offeredCards, session),
      verifyCardOwnership(toUserId, requestedCards, session),
      checkListingConflicts(offeredCards, session),
      checkListingConflicts(requestedCards, session)
    ]);

    // Validation checks
    if (!offeredOwnership.valid) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: offeredOwnership.error });
    }

    if (!requestedOwnership.valid) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: requestedOwnership.error });
    }

    if (offeredListings.length > 0 || requestedListings.length > 0) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Cannot trade listed cards' });
    }

    // Create counter-offer
    const counterTrade = new Trade({
      fromUser: req.user._id,
      toUser: toUserId,
      offeredCards,
      requestedCards,
      message: message ? sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} }) : '',
      status: 'pending',
      isCounter: true,
      originalTrade: tradeId,
      createdAt: new Date()
    });

    await counterTrade.save({ session });

    // Update original trade status
    originalTrade.status = 'countered';
    originalTrade.counterTradeId = counterTrade._id;
    await originalTrade.save({ session });

    // Notify original sender
    await notifyUser(toUserId, 'trade_counter', {
      tradeId: counterTrade._id,
      originalTradeId: tradeId,
      fromUserName: fromUser.username,
      message: counterTrade.message
    }, { session, caller: 'trading.counter' });

    await session.commitTransaction();

    // Invalidate relevant caches
    await Promise.all([
      invalidateCache(`incoming:${toUserId}`),
      invalidateCache(`outgoing:${req.user._id}`),
      invalidateCache(`details:${tradeId}`)
    ]);

    logWithCorrelation('info', 'Counter-offer created successfully', { counterTradeId: counterTrade._id, originalTradeId: tradeId }, req);
    res.json({ 
      success: true, 
      message: 'Counter-offer submitted successfully',
      tradeId: counterTrade._id
    });

  } catch (err) {
    await session.abortTransaction();
    logWithCorrelation('error', 'Error during counter-offer', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// POST /api/trading/accept - Accept a trade with enhanced atomic transaction
router.post('/accept', postLimiter, [
  body('tradeId').isMongoId().withMessage('Invalid trade ID')
], async (req, res) => {
  logWithCorrelation('info', 'Starting trade acceptance', null, req);
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      logWithCorrelation('error', 'Validation failed for trade acceptance', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { tradeId } = req.body;

    // Fetch and lock trade
    const trade = await Trade.findById(tradeId).session(session);
    if (!trade) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    // Verify user is recipient
    if (trade.toUser.toString() !== req.user._id) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'You are not the recipient of this trade' });
    }

    // Check trade status
    if (trade.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Trade is ${trade.status}` });
    }

    // Fetch users
    const [fromUser, toUser] = await Promise.all([
      User.findById(trade.fromUser).session(session),
      User.findById(trade.toUser).session(session)
    ]);

    if (!fromUser || !toUser) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check parental controls
    if (toUser.parentalControls?.restrictions?.includes('no_trading') && toUser.role !== 'admin' && toUser.role !== 'master') {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Trading restricted by parental controls' });
    }

    // Handle parental approval if required
    if (toUser.parentalControls?.tradeApproval === 'required' && toUser.parentId) {
      const approvalToken = crypto.randomBytes(32).toString('hex');
      
      trade.approvalToken = approvalToken;
      trade.status = 'pending_approval';
      await trade.save({ session });

      await PendingAction.create([{
        userId: toUser._id,
        parentId: toUser.parentId,
        actionType: 'trade_accept',
        details: { 
          tradeId: tradeId,
          fromUserName: fromUser.username
        },
        token: approvalToken,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }], { session });

      await notifyParent(toUser.parentId, toUser._id, 'trade_accept_pending', {
        tradeId: trade._id,
        fromUserName: fromUser.username,
        approvalToken
      }, { session });

      await session.commitTransaction();
      
      // Invalidate caches
      await invalidateCache(`details:${tradeId}`);
      
      logWithCorrelation('info', 'Trade acceptance pending parental approval', { tradeId }, req);
      return res.json({ 
        success: true, 
        message: 'Trade acceptance pending parental approval'
      });
    }

    // Verify current card ownership (optimized parallel check)
    const [fromOwnership, toOwnership] = await Promise.all([
      verifyCardOwnership(trade.fromUser, trade.offeredCards, session),
      verifyCardOwnership(trade.toUser, trade.requestedCards, session)
    ]);

    if (!fromOwnership.valid || !toOwnership.valid) {
      trade.status = 'cancelled';
      trade.cancelReason = 'Cards no longer available';
      await trade.save({ session });
      await session.commitTransaction();
      
      await invalidateCache(`details:${tradeId}`);
      return res.status(400).json({ success: false, message: 'Some cards are no longer available' });
    }

    // Check if any cards are listed and auto-cancel listings
    const allTradeCards = [...trade.offeredCards, ...trade.requestedCards];
    const activeListings = await Listing.find({ 
      cardId: { $in: allTradeCards }, 
      status: 'active' 
    }).session(session);

    // Batch update listings and cards if any exist
    if (activeListings.length > 0) {
      const listingIds = activeListings.map(l => l._id);
      const cardIds = activeListings.map(l => l.cardId);

      await Promise.all([
        Listing.updateMany(
          { _id: { $in: listingIds } },
          { 
            $set: { 
              status: 'cancelled',
              cancelReason: 'Card traded',
              cancelledAt: new Date()
            }
          },
          { session }
        ),
        Card.updateMany(
          { _id: { $in: cardIds } },
          {
            $set: {
              isInMarketplace: false,
              isListed: false,
              listingPrice: null,
              listingId: null,
              listedBy: null
            }
          },
          { session }
        )
      ]);
    }

    // Optimized atomic card swap with batch operations
    await Promise.all([
      // Remove cards from current owners
      User.updateOne(
        { _id: trade.fromUser },
        {
          $pull: {
            assignedCards: { $in: trade.offeredCards },
            vault: { $in: trade.offeredCards }
          }
        },
        { session }
      ),
      User.updateOne(
        { _id: trade.toUser },
        {
          $pull: {
            assignedCards: { $in: trade.requestedCards },
            vault: { $in: trade.requestedCards }
          }
        },
        { session }
      )
    ]);

    // Add cards to new owners
    await Promise.all([
      User.updateOne(
        { _id: trade.fromUser },
        {
          $addToSet: {
            assignedCards: { $each: trade.requestedCards }
          }
        },
        { session }
      ),
      User.updateOne(
        { _id: trade.toUser },
        {
          $addToSet: {
            assignedCards: { $each: trade.offeredCards }
          }
        },
        { session }
      )
    ]);

    // Batch update card ownership
    await Promise.all([
      Card.updateMany(
        { _id: { $in: trade.offeredCards } },
        { 
          $set: { 
            assignedTo: trade.toUser,
            isInProfile: true,
            lastTraded: new Date()
          } 
        },
        { session }
      ),
      Card.updateMany(
        { _id: { $in: trade.requestedCards } },
        { 
          $set: { 
            assignedTo: trade.fromUser,
            isInProfile: true,
            lastTraded: new Date()
          } 
        },
        { session }
      )
    ]);

    // Update trade status
    trade.status = 'accepted';
    trade.completedAt = new Date();
    await trade.save({ session });

    // Batch activity logging and notifications
    const activityPromises = [
      User.updateOne(
        { _id: trade.fromUser },
        {
          $push: {
            activities: {
              $each: [{
                type: 'trade_completed',
                details: {
                  tradeId: trade._id,
                  otherUser: trade.toUser,
                  cardsReceived: trade.requestedCards.length,
                  cardsGiven: trade.offeredCards.length
                },
                timestamp: new Date()
              }],
              $slice: -100
            }
          }
        },
        { session }
      ),
      User.updateOne(
        { _id: trade.toUser },
        {
          $push: {
            activities: {
              $each: [{
                type: 'trade_completed',
                details: {
                  tradeId: trade._id,
                  otherUser: trade.fromUser,
                  cardsReceived: trade.offeredCards.length,
                  cardsGiven: trade.requestedCards.length
                },
                timestamp: new Date()
              }],
              $slice: -100
            }
          }
        },
        { session }
      ),
      logSpending(toUser._id, 100, 'trade_accepted', session)
    ];

    // Notification promises
    const notificationPromises = [
      notifyUser(trade.fromUser, 'trade_accepted', {
        tradeId: trade._id,
        acceptedBy: toUser.username
      }, { session, caller: 'trading.accept' }),
      notifyUser(trade.toUser, 'trade_completed', {
        tradeId: trade._id,
        tradedWith: fromUser.username
      }, { session, caller: 'trading.accept' })
    ];

    // Parent notification promises
    const parentNotificationPromises = [];
    if (fromUser.parentId) {
      parentNotificationPromises.push(
        notifyParent(fromUser.parentId, trade.fromUser, 'trade_completed', {
          tradeId: trade._id,
          otherUser: toUser.username
        }, { session })
      );
    }

    if (toUser.parentId) {
      parentNotificationPromises.push(
        notifyParent(toUser.parentId, trade.toUser, 'trade_completed', {
          tradeId: trade._id,
          otherUser: fromUser.username
        }, { session })
      );
    }

    // Execute all operations in parallel
    await Promise.all([
      ...activityPromises,
      ...notificationPromises,
      ...parentNotificationPromises
    ]);

    await session.commitTransaction();

    // Invalidate all relevant caches
    await Promise.all([
      invalidateCache(`incoming:${trade.toUser}`),
      invalidateCache(`outgoing:${trade.fromUser}`),
      invalidateCache(`details:${tradeId}`)
    ]);

    logWithCorrelation('info', 'Trade accepted successfully', { tradeId }, req);
    res.json({ 
      success: true, 
      message: 'Trade accepted successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    logWithCorrelation('error', 'Error during trade acceptance', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// POST /api/trading/reject - Reject a trade with optimizations
router.post('/reject', postLimiter, [
  body('tradeId').isMongoId().withMessage('Invalid trade ID'),
  body('reason').optional().trim().isLength({ max: 200 }).withMessage('Reason too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWithCorrelation('error', 'Validation failed for trade rejection', errors.array(), req);
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { tradeId, reason } = req.body;

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    // Verify user is recipient
    if (trade.toUser.toString() !== req.user._id) {
      return res.status(403).json({ success: false, message: 'You are not the recipient of this trade' });
    }

    // Check trade status
    if (trade.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Trade is already ${trade.status}` });
    }

    // Sanitize reason
    const sanitizedReason = reason ?
      sanitizeHtml(reason, { allowedTags: [], allowedAttributes: {} }) :
      'No reason provided';

    // Update trade
    trade.status = 'declined';
    trade.declinedAt = new Date();
    trade.declineReason = sanitizedReason;
    await trade.save();

    // Get usernames for notification
    const [fromUser, toUser] = await Promise.all([
      User.findById(trade.fromUser).select('username'),
      User.findById(trade.toUser).select('username')
    ]);

    // Send notification
    await notifyUser(trade.fromUser, 'trade_rejected', {
      tradeId: trade._id,
      rejectedBy: toUser.username,
      reason: sanitizedReason
    }, { caller: 'trading.reject' });

    // Invalidate relevant caches
    await Promise.all([
      invalidateCache(`incoming:${req.user._id}`),
      invalidateCache(`outgoing:${trade.fromUser}`),
      invalidateCache(`details:${tradeId}`)
    ]);

    logWithCorrelation('info', 'Trade rejected successfully', { tradeId, reason: sanitizedReason }, req);
    res.json({ 
      success: true, 
      message: 'Trade rejected successfully'
    });

  } catch (err) {
    logWithCorrelation('error', 'Error during trade rejection', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/trading/stats/:userId - Trading statistics with caching
router.get('/stats/:userId', getLimiter, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const userId = req.params.userId;
    
    // Verify access
    if (userId !== req.user._id && !req.user.isAdmin && req.user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Check cache first
    const cacheKey = getCacheKey('stats', userId);
    const cached = await getFromCache(cacheKey);
    if (cached) {
      return res.json({ success: true, stats: cached });
    }

    // Calculate stats
    const [completedTrades, pendingOffered, pendingReceived, totalSpending] = await Promise.all([
      Trade.countDocuments({
        $or: [{ fromUser: userId }, { toUser: userId }],
        status: 'accepted'
      }),
      Trade.countDocuments({ fromUser: userId, status: 'pending' }),
      Trade.countDocuments({ toUser: userId, status: 'pending' }),
      SpendingLog.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const stats = {
      completedTrades,
      pendingOffered,
      pendingReceived,
      totalSpent: totalSpending[0]?.total || 0,
      lastUpdated: new Date().toISOString()
    };

    // Cache for 10 minutes
    await setCache(cacheKey, stats, 600);

    logWithCorrelation('info', 'Trading statistics retrieved', { userId, stats }, req);
    res.json({ success: true, stats });

  } catch (err) {
    logWithCorrelation('error', 'Error fetching trading statistics', err.message, req);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;