const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// Validate transfer code (public endpoint)
router.get('/validate/:code', async (req, res) => {
  try {
    const { code } = req.params;

    console.log('🔍 Validating transfer code:', code);

    // Find card with this transfer code
    const result = await db.query(`
      SELECT 
        c.*,
        u.full_name as seller_name,
        u.email as seller_email
      FROM cards c
      JOIN users u ON c.user_id = u.id
      WHERE c.transfer_code = ?
        AND c.transfer_code_used = FALSE
        AND c.transfer_code_expires_at > NOW()
    `, [code]);

    if (result.rows.length === 0) {
      console.log('❌ Invalid or expired code');
      return res.json({ 
        success: false, 
        error: 'Invalid or expired transfer code' 
      });
    }

    const card = result.rows[0];
    console.log('✅ Valid transfer code for card:', card.id);

    // Return card info (without sensitive data)
    res.json({
      success: true,
      card: {
        id: card.id,
        player: card.player,
        year: card.year,
        set_name: card.set_name,
        card_number: card.card_number,
        parallel: card.parallel,
        front_image_url: card.front_image_url,
        is_graded: card.is_graded,
        grading_company: card.grading_company,
        grade: card.grade,
        seller: card.seller_name || 'SlabTrack User'
      }
    });

  } catch (error) {
    console.error('Validate transfer code error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to validate code' 
    });
  }
});

// Claim card with transfer code (requires authentication)
router.post('/claim/:code', authenticateToken, async (req, res) => {
  try {
    const { code } = req.params;
    const newOwnerId = req.user.userId;

    console.log('🎁 User', newOwnerId, 'claiming card with code:', code);

    // Find card with this transfer code
    const cardResult = await db.query(`
      SELECT * FROM cards 
      WHERE transfer_code = ?
        AND transfer_code_used = FALSE
        AND transfer_code_expires_at > NOW()
    `, [code]);

    if (cardResult.rows.length === 0) {
      console.log('❌ Invalid or expired code');
      return res.json({ 
        success: false, 
        error: 'Invalid or expired transfer code' 
      });
    }

    const card = cardResult.rows[0];
    const previousOwnerId = card.user_id;

    // Don't let user claim their own card
    if (previousOwnerId === newOwnerId) {
      return res.json({ 
        success: false, 
        error: 'You cannot claim your own card' 
      });
    }

    console.log('🔄 Transferring card', card.id, 'from user', previousOwnerId, 'to user', newOwnerId);

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Record ownership history
      await db.query(`
        INSERT INTO card_ownership_history 
        (card_id, previous_owner_id, new_owner_id, sale_price, transfer_method, transfer_code)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [card.id, previousOwnerId, newOwnerId, card.sold_price || null, 'transfer_code', code]);

      // Transfer ownership
      await db.query(`
        UPDATE cards 
        SET 
          user_id = ?,
          transfer_code_used = TRUE,
          listing_status = 'unlisted',
          for_sale = FALSE
        WHERE id = ?
      `, [newOwnerId, card.id]);

      // Commit transaction
      await db.query('COMMIT');

      console.log('✅ Card transferred successfully');

      res.json({
        success: true,
        message: 'Card claimed successfully!',
        card: {
          id: card.id,
          player: card.player
        }
      });

    } catch (error) {
      // Rollback on error
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Claim card error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to claim card' 
    });
  }
});

module.exports = router;