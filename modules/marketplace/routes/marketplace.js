const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const authMiddleware = require('../middleware/authMiddleware');
const Card = require('../models/Card');
const User = require('../models/User');
const Listing = require('../models/Listing');
const SpendingLog = require('../models/SpendingLog');
const PendingAction = require('../models/PendingAction');
const { notifyUser, notifyParent } = require('../services/notificationService');

// Rate limiters
const getLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
});

const postLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many marketplace transactions, please try again later.',
});

// Apply auth middleware to all routes
router.use(authMiddleware.verifyToken);

// Validation helpers
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const validatePagination = (page, limit) => {
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 20;
  return {
    page: Math.max(1, p),
    limit: Math.min(100, Math.max(1, l))
  };
};

// ===== UTILITY FUNCTIONS =====

async function logSpending(userId, amount, actionType, session = null) {
  try {
    const logData = { 
      userId, 
      amount, 
      actionType,
      timestamp: new Date()
    };
    if (session) {
      return await SpendingLog.create([logData], { session });
    }
    return await SpendingLog.create(logData);
  } catch (err) {
    console.error('[LogSpending] Error:', err.message);
  }
}

async function checkSpendingLimit(user, amount) {
  try {
    if (!user.parentalControls?.spendingLimit) return true;
    
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
    return (totalSpent + amount) <= user.parentalControls.spendingLimit;
  } catch (err) {
    console.error('[CheckSpendingLimit] Error:', err.message);
    return false; // Fail safe
  }
}

// ===== LISTINGS ENDPOINTS =====

// GET /api/marketplace/listings - Get active listings with pagination and filters
router.get('/listings', getLimiter, async (req, res) => {
  console.log('[Marketplace] Fetching listings');
  try {
    const { page, limit } = validatePagination(req.query.page, req.query.limit);
    const skip = (page - 1) * limit;

    // Build query with filters
    const query = { status: 'active' };
    
    // Price range filter
    if (req.query.minPrice || req.query.maxPrice) {
      query.salePriceDollar = {};
      if (req.query.minPrice) {
        const minPrice = parseFloat(req.query.minPrice);
        if (!isNaN(minPrice) && minPrice >= 0) {
          query.salePriceDollar.$gte = minPrice;
        }
      }
      if (req.query.maxPrice) {
        const maxPrice = parseFloat(req.query.maxPrice);
        if (!isNaN(maxPrice) && maxPrice > 0) {
          query.salePriceDollar.$lte = maxPrice;
        }
      }
    }

    // Sort options
    let sort = { createdAt: -1 }; // Default: newest first
    if (req.query.sort === 'price_asc') {
      sort = { salePriceDollar: 1 };
    } else if (req.query.sort === 'price_desc') {
      sort = { salePriceDollar: -1 };
    }

    const [listings, total] = await Promise.all([
      Listing.find(query)
        .populate('cardId', 'player_name images rarity')
        .populate('listedBy', 'username')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Listing.countDocuments(query)
    ]);

    console.log(`[Marketplace] Found ${listings.length} listings`);
    res.json({ listings, total, page, limit });
  } catch (err) {
    console.error('[Marketplace] Error fetching listings:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/marketplace/listings/:id - Get specific listing
router.get('/listings/:id', getLimiter, async (req, res) => {
  console.log('[Marketplace] Fetching listing:', req.params.id);
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid listing ID' });
    }

    const listing = await Listing.findById(req.params.id)
      .populate('cardId')
      .populate('listedBy', 'username');

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    console.log(`[Marketplace] Retrieved listing ${req.params.id}`);
    res.json(listing);
  } catch (err) {
    console.error('[Marketplace] Error fetching listing:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// FIXED: POST /api/marketplace/sell - List a card for sale with enhanced validation
router.post('/sell', postLimiter, [
  body('cardId').trim().notEmpty().withMessage('Card ID is required'),
  body('price').optional().isFloat({ min: 0.01 }).withMessage('Price must be at least $0.01'),
  body('listingPrice').optional().isInt({ min: 1 }).withMessage('Listing price must be at least 1 KidzCoin'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description too long')
], async (req, res) => {
  console.log('[Sell Card] Starting sell process for user:', req.user._id);
  console.log('[Sell Card] Request body:', req.body);
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      console.log('[Sell Card] Validation errors:', errors.array());
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user._id;
    let { cardId, price, listingPrice, description } = req.body;

    // Handle both price formats - prefer listingPrice (KidzCoin) over price (dollars)
    if (listingPrice) {
      // Convert KidzCoin to dollars (100 KidzCoin = $1)
      price = parseFloat(listingPrice) / 100;
      console.log('[Sell Card] Using KidzCoin price:', listingPrice, 'converted to dollars:', price);
    } else if (price) {
      // Use dollar price as-is
      price = parseFloat(price);
      listingPrice = Math.round(price * 100); // Convert to KidzCoin for consistency
      console.log('[Sell Card] Using dollar price:', price, 'converted to KidzCoin:', listingPrice);
    } else {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Either price or listingPrice is required' });
    }

    // Validate price bounds
    if (price < 0.01 || price > 100) {
      await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        message: 'Price must be between $0.01 and $100.00' 
      });
    }

    // Validate card ID
    if (!isValidObjectId(cardId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid card ID format' });
    }

    // Sanitize description
    const sanitizedDescription = description ? 
      sanitizeHtml(description, { allowedTags: [], allowedAttributes: {} }) : '';

    // Fetch entities with session
    const [card, user] = await Promise.all([
      Card.findById(cardId).session(session),
      User.findById(userId).session(session)
    ]);

    if (!card) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Card not found' });
    }

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log('[Sell Card] Card found:', card.player_name, 'assigned to:', card.assignedTo);
    console.log('[Sell Card] User cards count:', user.assignedCards.length);

    // Check parental controls
    if (user.parentalControls?.restrictions?.includes('no_selling')) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Selling restricted by parental controls' });
    }

    // Verify ownership - ENHANCED CHECK
    const isAdmin = user.role === 'admin' || user.role === 'master';
    const isAssignedToUser = card.assignedTo && card.assignedTo.toString() === userId.toString();
    const isInUserCards = user.assignedCards.some(id => id.toString() === cardId);
    const isInUserVault = user.vault.some(id => id.toString() === cardId);

    console.log('[Sell Card] Ownership check:', {
      isAdmin,
      isAssignedToUser,
      isInUserCards,
      isInUserVault,
      cardAssignedTo: card.assignedTo?.toString(),
      userId: userId.toString()
    });

    if (!isAssignedToUser && !isInUserCards && !isInUserVault && !isAdmin) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'You do not own this card' });
    }

    // Check if already listed
    const existingListing = await Listing.findOne({ 
      cardId, 
      status: 'active' 
    }).session(session);

    if (existingListing) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Card is already listed for sale' });
    }

    // Check if card is already marked as listed
    if (card.isListed || card.isInMarketplace) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Card is already in marketplace' });
    }

    // Check if card is in active trade
    try {
      const Trade = require('../models/Trade');
      const activeTrade = await Trade.findOne({
        $or: [
          { initiatorCards: cardId },
          { recipientCards: cardId }
        ],
        status: 'pending'
      }).session(session);

      if (activeTrade) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Card is in an active trade' });
      }
    } catch (tradeError) {
      console.warn('[Sell Card] Trade check failed (model may not exist):', tradeError.message);
    }

    // Handle parental approval if required
    if (user.parentalControls?.listingApproval === 'required' && user.parentId && !isAdmin) {
      const token = crypto.randomBytes(32).toString('hex');
      const pendingAction = await PendingAction.create([{
        userId: user._id,
        parentId: user.parentId,
        actionType: 'listing',
        details: { 
          cardId, 
          cardName: card.player_name,
          salePrice: price,
          listingPrice,
          description: sanitizedDescription
        },
        token,
        createdAt: new Date()
      }], { session });

      await notifyParent(user.parentId, user._id, 'listing', {
        cardId,
        cardName: card.player_name,
        salePrice: price,
        listingPrice,
        approvalToken: token
      }, { session });

      await session.commitTransaction();
      return res.json({ 
        success: true, 
        message: 'Listing pending parental approval',
        pendingActionId: pendingAction[0]._id
      });
    }

    // Calculate fees
    const listingFeeKidzcoin = 100;
    const listingFeeDollar = 1.0;

    // Check balance for fees (skip for admins)
    if (!isAdmin) {
      if (user.kidzcoinBalance < listingFeeKidzcoin || user.dollarBalance < listingFeeDollar) {
        await session.abortTransaction();
        return res.status(400).json({ 
          success: false, 
          message: 'Insufficient balance for listing fees',
          required: { kidzcoin: listingFeeKidzcoin, dollar: listingFeeDollar },
          current: { kidzcoin: user.kidzcoinBalance, dollar: user.dollarBalance }
        });
      }

      // Deduct fees
      user.kidzcoinBalance -= listingFeeKidzcoin;
      user.dollarBalance -= listingFeeDollar;
      console.log('[Sell Card] Deducted listing fees from user');
    }

    // Create listing
    const listing = new Listing({
      cardId,
      listedBy: userId,
      salePriceDollar: price,
      description: sanitizedDescription,
      listingFeeKidzcoin: isAdmin ? 0 : listingFeeKidzcoin,
      listingFeeDollar: isAdmin ? 0 : listingFeeDollar,
      status: 'active',
      createdAt: new Date()
    });

    // Update card with comprehensive marketplace data
    card.isListed = true;
    card.isInMarketplace = true;
    card.listingPrice = listingPrice; // Store as KidzCoin
    card.listingId = listing._id;
    card.listedBy = {
      _id: userId,
      username: user.username
    };
    card.salePrice = price; // Store as dollars
    card.saleDescription = sanitizedDescription;

    // Log activity
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          activities: {
            $each: [{
              type: 'listing',
              cardId: card._id,
              details: { 
                price, 
                listingPrice,
                listingId: listing._id,
                listingFee: { kidzcoin: isAdmin ? 0 : listingFeeKidzcoin, dollar: isAdmin ? 0 : listingFeeDollar }
              },
              timestamp: new Date()
            }],
            $slice: -100
          }
        }
      },
      { session }
    );

    // Save all changes
    await Promise.all([
      listing.save({ session }),
      card.save({ session }),
      user.save({ session })
    ]);

    // Log spending only if fees were charged
    if (!isAdmin) {
      await logSpending(user._id, listingFeeKidzcoin, 'listing_fee', session);
    }

    await session.commitTransaction();

    console.log(`[Sell Card] SUCCESS: Card ${cardId} (${card.player_name}) listed by ${user.username} for $${price} (${listingPrice} KidzCoin)`);
    
    res.json({ 
      success: true, 
      message: 'Card listed successfully',
      listing: {
        _id: listing._id,
        cardId: listing.cardId,
        price: listing.salePriceDollar,
        listingPrice: listingPrice,
        listedBy: card.listedBy,
        createdAt: listing.createdAt
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error('[Sell Card] Error:', err.message, err.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while listing card',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    session.endSession();
  }
});

// POST /api/marketplace/buy - Purchase a card with enhanced validation
router.post('/buy', postLimiter, [
  body('cardId').trim().notEmpty().withMessage('Card ID is required'),
  body('listingId').optional().trim().notEmpty().withMessage('Invalid listing ID')
], async (req, res) => {
  console.log('[Buy Card] Starting purchase process');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user._id;
    const { cardId, listingId } = req.body;

    // Validate IDs
    if (!isValidObjectId(cardId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid card ID format' });
    }

    // Find listing
    let listing;
    if (listingId && isValidObjectId(listingId)) {
      listing = await Listing.findById(listingId)
        .populate('cardId')
        .session(session);
      
      if (listing && listing.cardId._id.toString() !== cardId) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Card ID mismatch with listing' });
      }
    } else {
      listing = await Listing.findOne({ cardId, status: 'active' })
        .populate('cardId')
        .session(session);
    }

    if (!listing || listing.status !== 'active') {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'No active listing found for this card' });
    }

    const card = listing.cardId;
    const sellerId = listing.listedBy;

    // Fetch users
    const [buyer, seller] = await Promise.all([
      User.findById(userId).session(session),
      User.findById(sellerId).session(session)
    ]);

    if (!buyer || !seller) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prevent self-purchase
    if (sellerId.toString() === userId) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot purchase your own card' });
    }

    // Check parental controls
    if (buyer.parentalControls?.restrictions?.includes('no_buying')) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Buying restricted by parental controls' });
    }

    // Calculate costs
    const salePrice = listing.salePriceDollar;
    const marketplaceFee = Math.round(salePrice * 0.05 * 100) / 100; // 5% fee, rounded to cents
    const totalCostDollars = salePrice + marketplaceFee;
    const totalCostKidzcoin = Math.round(totalCostDollars * 100); // 1 dollar = 100 KidzCoin
    const sellerEarningsKidzcoin = Math.round(salePrice * 100);

    // Check spending limit
    const withinLimit = await checkSpendingLimit(buyer, totalCostKidzcoin);
    if (!withinLimit) {
      await session.abortTransaction();
      return res.status(403).json({ 
        success: false, 
        message: 'Purchase would exceed spending limit',
        limit: buyer.parentalControls.spendingLimit,
        period: buyer.parentalControls.spendingPeriod
      });
    }

    // Handle parental approval if required
    if (buyer.parentalControls?.purchaseApproval === 'required' && buyer.parentId && buyer.role !== 'admin' && buyer.role !== 'master') {
      const token = crypto.randomBytes(32).toString('hex');
      const pendingAction = await PendingAction.create([{
        userId: buyer._id,
        parentId: buyer.parentId,
        actionType: 'purchase',
        details: { 
          cardId: card._id,
          cardName: card.player_name,
          listingId: listing._id,
          salePrice,
          totalCost: totalCostKidzcoin
        },
        token,
        createdAt: new Date()
      }], { session });

      await notifyParent(buyer.parentId, buyer._id, 'purchase', {
        cardId: card._id,
        cardName: card.player_name,
        salePrice,
        totalCost: totalCostKidzcoin,
        approvalToken: token
      }, { session });

      await session.commitTransaction();
      return res.json({ 
        success: true, 
        message: 'Purchase pending parental approval',
        pendingActionId: pendingAction[0]._id
      });
    }

    // Check balance
    if (buyer.kidzcoinBalance < totalCostKidzcoin) {
      await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient KidzCoin balance',
        required: totalCostKidzcoin,
        current: buyer.kidzcoinBalance
      });
    }

    // Execute transaction
    // 1. Transfer funds
    buyer.kidzcoinBalance -= totalCostKidzcoin;
    seller.kidzcoinBalance += sellerEarningsKidzcoin;

    // 2. Transfer card ownership
    card.assignedTo = buyer._id;
    card.isListed = false;
    card.isInMarketplace = false;
    card.listingPrice = null;
    card.listingId = null;
    card.listedBy = null;
    card.salePrice = null;
    card.saleDescription = '';
    card.isInProfile = true;

    // 3. Update user card arrays
    buyer.assignedCards = buyer.assignedCards.filter(id => id.toString() !== card._id.toString());
    buyer.assignedCards.push(card._id);
    seller.assignedCards = seller.assignedCards.filter(id => id.toString() !== card._id.toString());
    seller.vault = seller.vault.filter(id => id.toString() !== card._id.toString());

    // 4. Update listing
    listing.status = 'sold';
    listing.soldAt = new Date();
    listing.soldTo = buyer._id;
    listing.finalSalePrice = salePrice;

    // 5. Log activities
    await Promise.all([
      User.updateOne(
        { _id: buyer._id },
        {
          $push: {
            activities: {
              $each: [{
                type: 'purchase',
                cardId: card._id,
                details: { 
                  salePrice, 
                  totalCost: totalCostKidzcoin,
                  marketplaceFee,
                  sellerId: seller._id,
                  listingId: listing._id
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
        { _id: seller._id },
        {
          $push: {
            activities: {
              $each: [{
                type: 'sale',
                cardId: card._id,
                details: { 
                  salePrice, 
                  earnings: sellerEarningsKidzcoin,
                  buyerId: buyer._id,
                  listingId: listing._id
                },
                timestamp: new Date()
              }],
              $slice: -100
            }
          }
        },
        { session }
      )
    ]);

    // 6. Save all changes
    await Promise.all([
      card.save({ session }),
      listing.save({ session }),
      buyer.save({ session }),
      seller.save({ session })
    ]);

    // 7. Log spending
    await logSpending(buyer._id, totalCostKidzcoin, 'purchase', session);

    // 8. Send notifications
    await Promise.all([
      notifyUser(seller._id, 'listing_sold', {
        cardId: card._id,
        cardName: card.player_name,
        salePrice,
        earnings: sellerEarningsKidzcoin,
        buyerName: buyer.username
      }, { session, caller: 'marketplace.buy' }),
      notifyUser(buyer._id, 'purchase_completed', {
        cardId: card._id,
        cardName: card.player_name,
        totalCost: totalCostKidzcoin,
        sellerName: seller.username
      }, { session, caller: 'marketplace.buy' })
    ]);

    await session.commitTransaction();

    console.log(`[Buy Card] Success: Card ${cardId} purchased by ${userId} from ${sellerId}`);
    res.json({ 
      success: true, 
      message: 'Card purchased successfully',
      transaction: {
        cardId: card._id,
        cardName: card.player_name,
        salePrice,
        marketplaceFee,
        totalCost: totalCostKidzcoin,
        newBalance: buyer.kidzcoinBalance
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error('[Buy Card] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// DELETE /api/marketplace/listings/:id - Cancel listing
router.delete('/listings/:id', postLimiter, async (req, res) => {
  console.log('[Marketplace] Cancelling listing:', req.params.id);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!isValidObjectId(req.params.id)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid listing ID' });
    }

    const listing = await Listing.findById(req.params.id).session(session);
    if (!listing) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    // Check ownership
    const userId = req.user._id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'master';
    
    if (listing.listedBy.toString() !== userId && !isAdmin) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this listing' });
    }

    // Check if already sold
    if (listing.status !== 'active') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Listing is already ${listing.status}` });
    }

    // Update listing
    listing.status = 'cancelled';
    listing.cancelledAt = new Date();

    // Update card
    const card = await Card.findById(listing.cardId).session(session);
    if (card) {
      card.isListed = false;
      card.isInMarketplace = false;
      card.listingPrice = null;
      card.listingId = null;
      card.listedBy = null;
      card.salePrice = null;
      card.saleDescription = '';
      await card.save({ session });
    }

    await listing.save({ session });
    await session.commitTransaction();

    console.log(`[Marketplace] Listing ${req.params.id} cancelled by ${userId}`);
    res.json({ success: true, message: 'Listing cancelled successfully' });

  } catch (err) {
    await session.abortTransaction();
    console.error('[Marketplace] Error cancelling listing:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// GET /api/marketplace/history - Get user's marketplace history
router.get('/history', getLimiter, async (req, res) => {
  console.log('[Marketplace] Fetching history for user:', req.user._id);
  try {
    const userId = req.user._id;
    const { page, limit } = validatePagination(req.query.page, req.query.limit);
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { listedBy: userId },
        { soldTo: userId }
      ]
    };

    const [listings, total] = await Promise.all([
      Listing.find(query)
        .populate('cardId', 'player_name images')
        .populate('listedBy', 'username')
        .populate('soldTo', 'username')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Listing.countDocuments(query)
    ]);

    console.log(`[Marketplace] Found ${listings.length} historical listings for user ${userId}`);
    res.json({ listings, total, page, limit });
  } catch (err) {
    console.error('[Marketplace] Error fetching history:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;