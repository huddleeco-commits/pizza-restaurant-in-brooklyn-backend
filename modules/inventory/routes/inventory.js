const express = require('express');
const mongoose = require('mongoose');
const { query, body, param, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const User = require('../models/User');
const Card = require('../models/Card');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Redis client for caching
const client = redis.createClient(process.env.REDIS_URL);

// Rate limiters
const getLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: (req) => req.user?.isAdmin || req.user?.role === 'master' ? 100 : 50,
 message: 'Too many requests, please try again later.',
});

const postLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: (req) => req.user?.isAdmin || req.user?.role === 'master' ? 20 : 10,
 message: 'Too many requests, please try again later.',
});

const deleteLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: (req) => req.user?.isAdmin || req.user?.role === 'master' ? 20 : 10,
 message: 'Too many requests, please try again later.',
});

// Cache middleware for inventory data
const cacheMiddleware = (keyPrefix, ttl = 180) => async (req, res, next) => {
 const cacheKey = `${keyPrefix}:${req.user._id}:${req.originalUrl}`;
 try {
   const cached = await client.get(cacheKey);
   if (cached) return res.json(JSON.parse(cached));
   
   res.sendResponse = res.json;
   res.json = async (body) => {
     await client.setEx(cacheKey, ttl, JSON.stringify(body));
     res.sendResponse(body);
   };
   next();
 } catch (err) {
   next();
 }
};

// Input validation schemas
const validateCardId = [
 param('cardId').custom(value => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid card ID format')
];

const validateInventoryQuery = [
 query('userId').optional().custom(value => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid user ID format'),
 query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
 query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
 query('sortBy').optional().isIn(['player_name', 'card_set', 'year', 'team_name', 'createdAt']).withMessage('Invalid sort field'),
 query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
 query('isInProfile').optional().isBoolean().withMessage('isInProfile must be a boolean'),
 query('isInMarketplace').optional().isBoolean().withMessage('isInMarketplace must be a boolean'),
 query('team').optional().trim().isLength({ max: 50 }).withMessage('Team name too long'),
 query('cardSet').optional().trim().isLength({ max: 100 }).withMessage('Card set name too long'),
 query('year').optional().isInt({ min: 1800, max: 2100 }).withMessage('Invalid year')
];

const validateAddCard = [
 body('cardId').custom(value => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid card ID format'),
 body('isInProfile').optional().isBoolean().withMessage('isInProfile must be a boolean')
];

const validateBulkOperation = [
 body('cardIds').isArray({ min: 1, max: 50 }).withMessage('cardIds must be an array with 1-50 items'),
 body('cardIds.*').custom(value => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid card ID format'),
 body('operation').isIn(['add', 'remove', 'updateProfile']).withMessage('Invalid operation'),
 body('isInProfile').optional().isBoolean().withMessage('isInProfile must be a boolean')
];

// Helper function to verify card ownership
const verifyCardOwnership = async (userId, cardId, session = null) => {
 const card = await Card.findById(cardId).session(session);
 if (!card) {
   throw new Error('Card not found');
 }
 if (card.assignedTo?.toString() !== userId.toString()) {
   throw new Error('Card not owned by user');
 }
 return card;
};

// Helper function to clear inventory cache
const clearInventoryCache = async (userId) => {
 try {
   const pattern = `inventory:${userId}:*`;
   const keys = await client.keys(pattern);
   if (keys.length > 0) {
     await client.del(keys);
   }
 } catch (err) {
   console.warn('[Inventory] Cache clear failed:', err.message);
 }
};

// GET /api/inventory - Get User's Inventory (Protected)
router.get('/', cacheMiddleware('inventory'), getLimiter, authMiddleware.verifyToken, validateInventoryQuery, async (req, res) => {
 try {
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
     console.log('[Inventory Get] Validation errors:', errors.array());
     return res.status(400).json({ 
       success: false,
       message: 'Validation failed', 
       errors: errors.array() 
     });
   }

   let userId = req.user._id;
   const { 
     userId: queryUserId, 
     page = 1, 
     limit = 20, 
     sortBy = 'player_name', 
     sortOrder = 'asc',
     isInProfile,
     isInMarketplace,
     team,
     cardSet,
     year
   } = req.query;

   // Support userId query parameter for admins or self
   if (queryUserId) {
     if (req.user.isAdmin || req.user.role === 'master' || queryUserId === userId.toString()) {
       userId = queryUserId;
     } else {
       console.log(`[Inventory Get] Access denied for user ${req.user._id} to fetch inventory of user ${queryUserId}`);
       return res.status(403).json({ 
         success: false,
         message: 'Access denied: Insufficient permissions' 
       });
     }
   }

   // Build filter query
   let cardFilter = {};
   if (isInProfile !== undefined) cardFilter.isInProfile = isInProfile === 'true';
   if (isInMarketplace !== undefined) cardFilter.isInMarketplace = isInMarketplace === 'true';
   if (team) cardFilter.team_name = new RegExp(sanitizeHtml(team, { allowedTags: [], allowedAttributes: {} }), 'i');
   if (cardSet) cardFilter.card_set = new RegExp(sanitizeHtml(cardSet, { allowedTags: [], allowedAttributes: {} }), 'i');
   if (year) cardFilter.year = parseInt(year);

   // Calculate pagination
   const skip = (parseInt(page) - 1) * parseInt(limit);

   // Build sort object
   const sortObj = {};
   sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

   // Get user with populated cards
   const user = await User.findById(userId).select('assignedCards username');
   if (!user) {
     console.log(`[Inventory Get] User not found: ${userId}`);
     return res.status(404).json({ 
       success: false,
       message: 'User not found' 
     });
   }

   // Get total count for pagination
   const totalCards = await Card.countDocuments({
     _id: { $in: user.assignedCards },
     assignedTo: userId,
     ...cardFilter
   });

   // Fetch paginated inventory
   const inventory = await Card.find({
     _id: { $in: user.assignedCards },
     assignedTo: userId,
     ...cardFilter
   })
   .populate('assignedTo', 'username email')
   .select('player_name card_set card_number year team_name images grading_data currentValuation isInProfile isInMarketplace assignedTo')
   .sort(sortObj)
   .skip(skip)
   .limit(parseInt(limit))
   .lean();

   // Calculate inventory statistics
   const stats = {
     totalCards,
     cardsInProfile: await Card.countDocuments({
       _id: { $in: user.assignedCards },
       assignedTo: userId,
       isInProfile: true
     }),
     cardsInMarketplace: await Card.countDocuments({
       _id: { $in: user.assignedCards },
       assignedTo: userId,
       isInMarketplace: true
     }),
     totalValue: inventory.reduce((sum, card) => sum + (card.currentValuation || 0), 0),
     cardsByTeam: await Card.aggregate([
       { $match: { _id: { $in: user.assignedCards }, assignedTo: new mongoose.Types.ObjectId(userId) } },
       { $group: { _id: '$team_name', count: { $sum: 1 } } },
       { $sort: { count: -1 } },
       { $limit: 5 }
     ]),
     cardsBySet: await Card.aggregate([
       { $match: { _id: { $in: user.assignedCards }, assignedTo: new mongoose.Types.ObjectId(userId) } },
       { $group: { _id: '$card_set', count: { $sum: 1 } } },
       { $sort: { count: -1 } },
       { $limit: 5 }
     ])
   };

   console.log(`[Inventory Get] Fetched inventory for user ${userId}: ${inventory.length}/${totalCards} cards (page ${page})`);
   
   res.json({
     success: true,
     inventory,
     pagination: {
       total: totalCards,
       page: parseInt(page),
       limit: parseInt(limit),
       totalPages: Math.ceil(totalCards / parseInt(limit))
     },
     statistics: stats,
     filters: {
       isInProfile: isInProfile || null,
       isInMarketplace: isInMarketplace || null,
       team: team || null,
       cardSet: cardSet || null,
       year: year || null,
       sortBy,
       sortOrder
     },
     owner: {
       _id: user._id,
       username: user.username
     }
   });

 } catch (error) {
   console.error(`[Inventory Get] Error fetching inventory for user ${req.user._id}:`, error.message, error.stack);
   res.status(500).json({ 
     success: false,
     message: 'Server error while fetching inventory', 
     error: error.message 
   });
 }
});

// POST /api/inventory/add - Add Card to Inventory (Protected)
router.post('/add', postLimiter, authMiddleware.verifyToken, validateAddCard, async (req, res) => {
 try {
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
     console.log('[Inventory Add] Validation errors:', errors.array());
     return res.status(400).json({ 
       success: false,
       message: 'Validation failed', 
       errors: errors.array() 
     });
   }

   const { cardId, isInProfile = false } = req.body;
   const userId = req.user._id;

   const session = await mongoose.startSession();
   session.startTransaction();

   try {
     const user = await User.findById(userId).session(session);
     if (!user) {
       console.log(`[Inventory Add] User not found: ${userId}`);
       return res.status(404).json({ 
         success: false,
         message: 'User not found' 
       });
     }

     const card = await Card.findById(cardId).session(session);
     if (!card) {
       console.log(`[Inventory Add] Card not found: ${cardId}`);
       return res.status(404).json({ 
         success: false,
         message: 'Card not found' 
       });
     }

     // Check if card is already assigned to someone else
     if (card.assignedTo && card.assignedTo.toString() !== userId.toString()) {
       console.log(`[Inventory Add] Card already assigned to another user: ${cardId}`);
       return res.status(400).json({ 
         success: false,
         message: 'Card is already assigned to another user' 
       });
     }

     // Check if card is already in user's inventory
     if (user.assignedCards.includes(cardId)) {
       console.log(`[Inventory Add] Card already in inventory: ${cardId} for user ${userId}`);
       return res.status(400).json({ 
         success: false,
         message: 'Card already exists in inventory' 
       });
     }

     // Add card to user's inventory
     user.assignedCards.push(cardId);
     card.assignedTo = userId;
     card.isInProfile = isInProfile;

     // Log activity
     user.activities.push({
       type: 'card_added',
       cardId,
       details: { isInProfile },
       timestamp: new Date()
     });

     if (user.activities.length > 50) {
       user.activities = user.activities.slice(-50);
     }

     await Promise.all([
       user.save({ session }),
       card.save({ session })
     ]);

     await session.commitTransaction();

     // Clear cache
     await clearInventoryCache(userId);

     console.log(`[Inventory Add] Added card ${cardId} to inventory for user ${userId}`);

     const updatedCard = await Card.findById(cardId)
       .populate('assignedTo', 'username email')
       .select('player_name card_set card_number year team_name images grading_data currentValuation isInProfile isInMarketplace assignedTo');

     res.json({ 
       success: true,
       message: 'Card added to inventory successfully', 
       card: updatedCard 
     });

   } catch (error) {
     await session.abortTransaction();
     throw error;
   } finally {
     session.endSession();
   }

 } catch (error) {
   console.error(`[Inventory Add] Error adding card for user ${req.user._id}:`, error.message, error.stack);
   res.status(500).json({ 
     success: false,
     message: 'Server error while adding card to inventory', 
     error: error.message 
   });
 }
});

// DELETE /api/inventory/remove/:cardId - Remove Card from Inventory (Protected)
router.delete('/remove/:cardId', deleteLimiter, authMiddleware.verifyToken, validateCardId, async (req, res) => {
 try {
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
     console.log('[Inventory Remove] Validation errors:', errors.array());
     return res.status(400).json({ 
       success: false,
       message: 'Validation failed', 
       errors: errors.array() 
     });
   }

   const { cardId } = req.params;
   const userId = req.user._id;

   const session = await mongoose.startSession();
   session.startTransaction();

   try {
     const user = await User.findById(userId).session(session);
     if (!user) {
       console.log(`[Inventory Remove] User not found: ${userId}`);
       return res.status(404).json({ 
         success: false,
         message: 'User not found' 
       });
     }

     // Verify card ownership
     await verifyCardOwnership(userId, cardId, session);

     if (!user.assignedCards.includes(cardId)) {
       console.log(`[Inventory Remove] Card not found in inventory: ${cardId} for user ${userId}`);
       return res.status(404).json({ 
         success: false,
         message: 'Card not found in inventory' 
       });
     }

     const card = await Card.findById(cardId).session(session);

     // Check if card is in marketplace
     if (card.isInMarketplace) {
       console.log(`[Inventory Remove] Cannot remove card from marketplace: ${cardId}`);
       return res.status(400).json({ 
         success: false,
         message: 'Cannot remove card that is listed in marketplace' 
       });
     }

     // Remove card from user's inventory
     user.assignedCards = user.assignedCards.filter((id) => id.toString() !== cardId);
     card.assignedTo = null;
     card.isInProfile = false;

     // Log activity
     user.activities.push({
       type: 'card_removed',
       cardId,
       details: { reason: 'manual_removal' },
       timestamp: new Date()
     });

     if (user.activities.length > 50) {
       user.activities = user.activities.slice(-50);
     }

     await Promise.all([
       user.save({ session }),
       card.save({ session })
     ]);

     await session.commitTransaction();

     // Clear cache
     await clearInventoryCache(userId);

     console.log(`[Inventory Remove] Removed card ${cardId} from inventory for user ${userId}`);

     res.json({ 
       success: true,
       message: 'Card removed from inventory successfully',
       cardId 
     });

   } catch (error) {
     await session.abortTransaction();
     throw error;
   } finally {
     session.endSession();
   }

 } catch (error) {
   console.error(`[Inventory Remove] Error removing card for user ${req.user._id}:`, error.message, error.stack);
   
   if (error.message === 'Card not found') {
     return res.status(404).json({ 
       success: false,
       message: 'Card not found' 
     });
   }
   
   if (error.message === 'Card not owned by user') {
     return res.status(403).json({ 
       success: false,
       message: 'You do not own this card' 
     });
   }

   res.status(500).json({ 
     success: false,
     message: 'Server error while removing card from inventory', 
     error: error.message 
   });
 }
});

// POST /api/inventory/bulk - Bulk operations on inventory (Protected)
router.post('/bulk', postLimiter, authMiddleware.verifyToken, validateBulkOperation, async (req, res) => {
 try {
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
     console.log('[Inventory Bulk] Validation errors:', errors.array());
     return res.status(400).json({ 
       success: false,
       message: 'Validation failed', 
       errors: errors.array() 
     });
   }

   const { cardIds, operation, isInProfile } = req.body;
   const userId = req.user._id;

   const session = await mongoose.startSession();
   session.startTransaction();

   try {
     const user = await User.findById(userId).session(session);
     if (!user) {
       console.log(`[Inventory Bulk] User not found: ${userId}`);
       return res.status(404).json({ 
         success: false,
         message: 'User not found' 
       });
     }

     let results = [];
     let successCount = 0;
     let errorCount = 0;

     for (const cardId of cardIds) {
       try {
         const card = await Card.findById(cardId).session(session);
         
         if (!card) {
           results.push({ cardId, status: 'error', message: 'Card not found' });
           errorCount++;
           continue;
         }

         switch (operation) {
           case 'add':
             if (card.assignedTo && card.assignedTo.toString() !== userId.toString()) {
               results.push({ cardId, status: 'error', message: 'Card already assigned to another user' });
               errorCount++;
               continue;
             }
             
             if (!user.assignedCards.includes(cardId)) {
               user.assignedCards.push(cardId);
               card.assignedTo = userId;
               if (isInProfile !== undefined) card.isInProfile = isInProfile;
               await card.save({ session });
               results.push({ cardId, status: 'success', message: 'Card added to inventory' });
               successCount++;
             } else {
               results.push({ cardId, status: 'skipped', message: 'Card already in inventory' });
             }
             break;

           case 'remove':
             if (card.assignedTo?.toString() !== userId.toString()) {
               results.push({ cardId, status: 'error', message: 'Card not owned by user' });
               errorCount++;
               continue;
             }

             if (card.isInMarketplace) {
               results.push({ cardId, status: 'error', message: 'Cannot remove card from marketplace' });
               errorCount++;
               continue;
             }

             if (user.assignedCards.includes(cardId)) {
               user.assignedCards = user.assignedCards.filter(id => id.toString() !== cardId);
               card.assignedTo = null;
               card.isInProfile = false;
               await card.save({ session });
               results.push({ cardId, status: 'success', message: 'Card removed from inventory' });
               successCount++;
             } else {
               results.push({ cardId, status: 'skipped', message: 'Card not in inventory' });
             }
             break;

           case 'updateProfile':
             if (card.assignedTo?.toString() !== userId.toString()) {
               results.push({ cardId, status: 'error', message: 'Card not owned by user' });
               errorCount++;
               continue;
             }

             if (isInProfile !== undefined) {
               card.isInProfile = isInProfile;
               await card.save({ session });
               results.push({ cardId, status: 'success', message: `Card profile status updated to ${isInProfile}` });
               successCount++;
             } else {
               results.push({ cardId, status: 'error', message: 'isInProfile value required' });
               errorCount++;
             }
             break;

           default:
             results.push({ cardId, status: 'error', message: 'Invalid operation' });
             errorCount++;
         }
       } catch (cardError) {
         console.error(`[Inventory Bulk] Error processing card ${cardId}:`, cardError.message);
         results.push({ cardId, status: 'error', message: cardError.message });
         errorCount++;
       }
     }

     // Log bulk activity
     user.activities.push({
       type: 'bulk_operation',
       details: { 
         operation, 
         cardCount: cardIds.length,
         successCount,
         errorCount,
         isInProfile 
       },
       timestamp: new Date()
     });

     if (user.activities.length > 50) {
       user.activities = user.activities.slice(-50);
     }

     await user.save({ session });
     await session.commitTransaction();

     // Clear cache
     await clearInventoryCache(userId);

     console.log(`[Inventory Bulk] Completed bulk ${operation} for user ${userId}: ${successCount} success, ${errorCount} errors`);

     res.json({
       success: true,
       message: `Bulk ${operation} completed`,
       summary: {
         total: cardIds.length,
         successful: successCount,
         errors: errorCount,
         operation
       },
       results
     });

   } catch (error) {
     await session.abortTransaction();
     throw error;
   } finally {
     session.endSession();
   }

 } catch (error) {
   console.error(`[Inventory Bulk] Error in bulk operation for user ${req.user._id}:`, error.message, error.stack);
   res.status(500).json({ 
     success: false,
     message: 'Server error during bulk operation', 
     error: error.message 
   });
 }
});

// PUT /api/inventory/profile/:cardId - Toggle card profile status (Protected)
router.put('/profile/:cardId', postLimiter, authMiddleware.verifyToken, [
 ...validateCardId,
 body('isInProfile').isBoolean().withMessage('isInProfile must be a boolean')
], async (req, res) => {
 try {
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
     console.log('[Inventory Profile] Validation errors:', errors.array());
     return res.status(400).json({ 
       success: false,
       message: 'Validation failed', 
       errors: errors.array() 
     });
   }

   const { cardId } = req.params;
   const { isInProfile } = req.body;
   const userId = req.user._id;

   const session = await mongoose.startSession();
   session.startTransaction();

   try {
     // Verify card ownership
     const card = await verifyCardOwnership(userId, cardId, session);

     card.isInProfile = isInProfile;
     await card.save({ session });

     // Log activity
     const user = await User.findById(userId).session(session);
     user.activities.push({
       type: 'profile_toggle',
       cardId,
       details: { isInProfile },
       timestamp: new Date()
     });

     if (user.activities.length > 50) {
       user.activities = user.activities.slice(-50);
     }

     await user.save({ session });
     await session.commitTransaction();

     // Clear cache
     await clearInventoryCache(userId);

     console.log(`[Inventory Profile] Updated profile status for card ${cardId} to ${isInProfile} for user ${userId}`);

     const updatedCard = await Card.findById(cardId)
       .populate('assignedTo', 'username email')
       .select('player_name card_set card_number year team_name images isInProfile isInMarketplace assignedTo');

     res.json({
       success: true,
       message: `Card ${isInProfile ? 'added to' : 'removed from'} profile`,
       card: updatedCard
     });

   } catch (error) {
     await session.abortTransaction();
     throw error;
   } finally {
     session.endSession();
   }

 } catch (error) {
   console.error(`[Inventory Profile] Error updating profile status for user ${req.user._id}:`, error.message, error.stack);
   
   if (error.message === 'Card not found') {
     return res.status(404).json({ 
       success: false,
       message: 'Card not found' 
     });
   }
   
   if (error.message === 'Card not owned by user') {
     return res.status(403).json({ 
       success: false,
       message: 'You do not own this card' 
     });
   }

   res.status(500).json({ 
     success: false,
     message: 'Server error while updating card profile status', 
     error: error.message 
   });
 }
});

module.exports = router;