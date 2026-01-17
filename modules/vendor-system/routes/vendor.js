const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// SHOWCASE MANAGEMENT
// ==========================================

// GET: Card to Vendor Showcase mapping (for Card Locations dashboard)
router.get('/showcases/card-mappings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    // Get all vendor showcases for this user
    const result = await db.query(`
      SELECT id, showcase_name, card_ids, theme
      FROM vendor_showcases
      WHERE user_id = $1 AND is_active = true
    `, [userId]);
    
    // Build card -> vendor showcases mapping
    // Note: vendor_showcases stores card_ids as a JSONB array
    const cardShowcaseMap = {};
    
    result.rows.forEach(showcase => {
      let cardIds = showcase.card_ids || [];
      // Handle if it's a string (shouldn't be, but just in case)
      if (typeof cardIds === 'string') {
        try { cardIds = JSON.parse(cardIds); } catch (e) { cardIds = []; }
      }
      
      cardIds.forEach(cardId => {
        if (!cardShowcaseMap[cardId]) {
          cardShowcaseMap[cardId] = [];
        }
        cardShowcaseMap[cardId].push({
          id: showcase.id,
          name: showcase.showcase_name,
          theme: showcase.theme
        });
      });
    });
    
    // Count stats
    const cardsInVendorShowcases = Object.keys(cardShowcaseMap).length;
    const cardsInMultiple = Object.values(cardShowcaseMap).filter(arr => arr.length > 1).length;
    
    res.json({
      success: true,
      cardShowcaseMap: cardShowcaseMap,
      stats: {
        totalVendorShowcases: result.rows.length,
        cardsInVendorShowcases,
        cardsInMultiple
      }
    });
    
  } catch (error) {
    console.error('Get vendor showcase card mappings error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load vendor showcase mappings' 
    });
  }
});

// Get all showcases for vendor
router.get('/showcases', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const result = await db.query(`
      SELECT 
        id, 
        showcase_name, 
        description, 
        card_ids, 
        display_settings,
        theme,
        is_active,
        created_at
      FROM vendor_showcases 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    
    // Parse card_ids from JSON
    const showcases = result.rows.map(showcase => ({
      ...showcase,
      card_ids: typeof showcase.card_ids === 'string' 
        ? JSON.parse(showcase.card_ids) 
        : showcase.card_ids
    }));
    
    res.json({ 
      success: true, 
      showcases 
    });
  } catch (error) {
    console.error('Get showcases error:', error);
    res.status(500).json({ success: false, error: 'Failed to get showcases' });
  }
});

// Create new showcase
router.post('/showcases', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { 
      showcase_name, 
      description, 
      card_ids, 
      display_settings,
      theme 
    } = req.body;
    
    if (!showcase_name || !card_ids || card_ids.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Showcase name and cards are required' 
      });
    }
    
    console.log('📦 Creating showcase:', { showcase_name, card_count: card_ids.length, userId });
    
    // Ensure proper JSON formatting for PostgreSQL JSONB columns
    const cardIdsJson = Array.isArray(card_ids) ? card_ids : JSON.parse(card_ids);
    const displaySettingsJson = typeof display_settings === 'object' ? display_settings : JSON.parse(display_settings || '{}');
    
    const result = await db.query(`
      INSERT INTO vendor_showcases 
      (user_id, showcase_name, description, card_ids, display_settings, theme)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId, 
      showcase_name, 
      description || '', 
      JSON.stringify(cardIdsJson),
      JSON.stringify(displaySettingsJson),
      theme || 'dark'
    ]);
    
    const showcase = result.rows[0];
    
    // Parse JSONB fields back to objects for response
    if (typeof showcase.card_ids === 'string') {
      try {
        showcase.card_ids = JSON.parse(showcase.card_ids);
      } catch (e) {
        showcase.card_ids = [];
      }
    }
    
    if (typeof showcase.display_settings === 'string') {
      try {
        showcase.display_settings = JSON.parse(showcase.display_settings);
      } catch (e) {
        showcase.display_settings = {};
      }
    }
    
    // AUTO-ASSIGN TO SCREEN1 IF NO SCREENS ARE CONFIGURED
    const configCheck = await db.query(
      'SELECT COUNT(*) as count FROM vendor_screen_config WHERE user_id = $1',
      [userId]
    );
    
    if (configCheck.rows[0].count === '0' || parseInt(configCheck.rows[0].count) === 0) {
      await db.query(`
        INSERT INTO vendor_screen_config (user_id, screen_identifier, showcase_id, grid_size)
        VALUES ($1, $2, $3, $4)
      `, [userId, 'screen1', showcase.id, '8x4']);
      
      console.log(`✅ Auto-assigned showcase to screen1 for user ${userId}`);
    }
    
    console.log(`✅ Created showcase "${showcase_name}" with ${showcase.card_ids.length} cards`);
    
    res.json({ 
      success: true, 
      showcase 
    });
  } catch (error) {
    console.error('❌ Create showcase error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create showcase',
      details: error.message 
    });
  }
});

// Update showcase 
router.put('/showcases/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const showcaseId = req.params.id;
    const { 
      showcase_name, 
      description, 
      card_ids, 
      display_settings,
      theme,
      is_active 
    } = req.body;
    
    // Verify ownership
    const checkResult = await db.query(
      'SELECT id FROM vendor_showcases WHERE id = $1 AND user_id = $2',
      [showcaseId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Showcase not found' 
      });
    }
    
    const result = await db.query(`
      UPDATE vendor_showcases 
      SET 
        showcase_name = $1,
        description = $2,
        card_ids = $3,
        display_settings = $4,
        theme = $5,
        is_active = $6
      WHERE id = $7 AND user_id = $8
      RETURNING *
    `, [
      showcase_name,
      description,
      JSON.stringify(card_ids),
      JSON.stringify(display_settings),
      theme,
      is_active,
      showcaseId,
      userId
    ]);
    
    const showcase = result.rows[0];
    if (typeof showcase.card_ids === 'string') {
      showcase.card_ids = JSON.parse(showcase.card_ids);
    }
    
    console.log(`✅ Updated showcase ${showcaseId}`);
    
    res.json({ 
      success: true, 
      showcase 
    });
  } catch (error) {
    console.error('Update showcase error:', error);
    res.status(500).json({ success: false, error: 'Failed to update showcase' });
  }
});

// Delete showcase
router.delete('/showcases/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const showcaseId = req.params.id;
    
    // Verify ownership
    const checkResult = await db.query(
      'SELECT id FROM vendor_showcases WHERE id = $1 AND user_id = $2',
      [showcaseId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Showcase not found' 
      });
    }
    
    await db.query(
      'DELETE FROM vendor_showcases WHERE id = $1 AND user_id = $2',
      [showcaseId, userId]
    );
    
    console.log(`✅ Deleted showcase ${showcaseId}`);
    
    res.json({ 
      success: true, 
      message: 'Showcase deleted' 
    });
  } catch (error) {
    console.error('Delete showcase error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete showcase' });
  }
});

// ==========================================
// SCREEN CONFIGURATION
// ==========================================

// Get screen configuration
router.get('/screen-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const result = await db.query(`
      SELECT 
        sc.id,
        sc.screen_identifier,
        sc.showcase_id,
        sc.grid_size,
        vs.showcase_name
      FROM vendor_screen_config sc
      LEFT JOIN vendor_showcases vs ON sc.showcase_id = vs.id
      WHERE sc.user_id = $1
      ORDER BY sc.screen_identifier
    `, [userId]);
    
    res.json({ success: true, config: result.rows });
  } catch (error) {
    console.error('Get screen config error:', error);
    res.status(500).json({ success: false, error: 'Failed to get screen config' });
  }
});

// Update screen configuration
router.post('/screen-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { screens } = req.body; // Now screens is an array
    
    console.log('💾 Saving screen config for user:', userId);
    console.log('📺 Screens:', JSON.stringify(screens, null, 2));
    
    if (!Array.isArray(screens) || screens.length === 0) {
      return res.status(400).json({ success: false, error: 'Screens array required' });
    }
    
    // Delete all existing configs for this user
    await db.query('DELETE FROM vendor_screen_config WHERE user_id = $1', [userId]);
    
    // Insert all new configs
    for (const screen of screens) {
      if (!screen.screen_identifier) continue;
      
      await db.query(`
  INSERT INTO vendor_screen_config 
  (user_id, screen_identifier, showcase_id, grid_size)
  VALUES ($1, $2, $3, $4)
`, [
  userId,
  screen.screen_identifier,
  screen.showcase_id || null,
  screen.grid_size || '6x4'
]);
    }
    
    console.log('✅ Screen config saved successfully');
    res.json({ success: true, message: `${screens.length} screens configured` });
  } catch (error) {
    console.error('❌ Screen config save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save screen config' });
  }
});

// ==========================================
// PUBLIC DISPLAY ENDPOINTS (NO AUTH)
// ==========================================

// Get showcase for display
router.get('/display/:screenId', async (req, res) => {
  try {
    const { screenId } = req.params;
    const { userId } = req.query;
    const requestedGrid = req.query.grid;
    
    console.log('🎥 Display request:', { screenId, userId, requestedGrid });
    
    if (!userId) {
      console.log('❌ No userId provided');
      return res.status(400).json({ 
        success: false, 
        error: 'User ID required' 
      });
    }
    
    // Get showcase assigned to this screen
    console.log('📋 Looking up screen config for user', userId, 'screen', screenId);
    const configResult = await db.query(`
      SELECT showcase_id, grid_size 
      FROM vendor_screen_config 
      WHERE user_id = $1 AND screen_identifier = $2
    `, [userId, screenId]);
    
    console.log('📋 Config query result:', configResult.rows);
    
    // If no config exists, try to find the user's first active showcase
    if (configResult.rows.length === 0) {
      console.log('⚠️ No screen config found, looking for user showcases...');
      
      const showcaseResult = await db.query(`
        SELECT * FROM vendor_showcases 
        WHERE user_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]);
      
      if (showcaseResult.rows.length > 0) {
        const showcase = showcaseResult.rows[0];
        const gridSize = requestedGrid || '8x4';
        
        console.log('✅ Using first active showcase:', showcase.id);
        
        // Auto-create the screen config for future use
        await db.query(`
          INSERT INTO vendor_screen_config (user_id, screen_identifier, showcase_id, grid_size)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, screen_identifier) 
          DO UPDATE SET showcase_id = $3, grid_size = $4
        `, [userId, screenId, showcase.id, gridSize]);
        
        // Get cards for this showcase
        let cardIds;
        try {
          cardIds = typeof showcase.card_ids === 'string' 
            ? JSON.parse(showcase.card_ids) 
            : showcase.card_ids;
        } catch (parseError) {
          cardIds = [];
        }
        
        if (!cardIds || cardIds.length === 0) {
          return res.json({ 
            success: true, 
            showcase: { ...showcase, card_ids: [] },
            cards: [],
            gridSize
          });
        }
        
        const cardsResult = await db.query(`
          SELECT 
            id, player, year, set_name, card_number, parallel, team, sport,
            front_image_url, back_image_url, front_image_thumb, back_image_thumb,
            is_graded, grading_company, grade, cert_number,
            is_autographed, numbered, serial_number, numbered_to,
            asking_price, ebay_avg, ebay_low, ebay_high,
            listing_status,
            case_status, removed_at, removed_by, case_location,
            sportscardspro_raw, sportscardspro_psa7, sportscardspro_psa8, 
            sportscardspro_psa9, sportscardspro_psa10, sportscardspro_bgs10, 
            sportscardspro_cgc10, sportscardspro_sgc10, sportscardspro_sales_volume
          FROM cards 
          WHERE id = ANY($1) AND user_id = $2
          AND listing_status != 'sold'
          ORDER BY 
            CASE WHEN is_graded THEN 0 ELSE 1 END,
            CAST(grade AS DECIMAL) DESC NULLS LAST
        `, [cardIds, userId]);
        
        return res.json({ 
          success: true, 
          showcase: { ...showcase, card_ids: cardIds },
          cards: cardsResult.rows,
          gridSize
        });
      } else {
        console.log('⚠️ User has no showcases');
        return res.json({ 
          success: false,
          error: 'No showcases configured for this vendor',
          cards: [],
          gridSize: requestedGrid || '8x4'
        });
      }
    }
    
    // Config exists, use it
    const showcaseId = configResult.rows[0].showcase_id;
    const gridSize = requestedGrid || configResult.rows[0].grid_size || '8x4';
    console.log('📦 Found showcase ID:', showcaseId, 'Grid:', gridSize);
    
    if (!showcaseId) {
      console.log('❌ showcase_id is null');
      return res.json({ 
        success: false, 
        error: 'No showcase assigned to this screen' 
      });
    }
    
    // Get showcase details
    console.log('📦 Fetching showcase details for ID:', showcaseId);
    const showcaseResult = await db.query(`
      SELECT * FROM vendor_showcases 
      WHERE id = $1 AND user_id = $2
    `, [showcaseId, userId]);
    
    if (showcaseResult.rows.length === 0) {
      console.log('❌ Showcase not found in database');
      return res.json({ 
        success: false, 
        error: 'Showcase not found' 
      });
    }
    
    const showcase = showcaseResult.rows[0];
    
    let cardIds;
    try {
      cardIds = typeof showcase.card_ids === 'string' 
        ? JSON.parse(showcase.card_ids) 
        : showcase.card_ids;
    } catch (parseError) {
      console.error('❌ Error parsing card_ids:', parseError);
      return res.status(500).json({ 
        success: false, 
        error: 'Invalid card data' 
      });
    }
    
    // Get cards for this showcase
    if (!cardIds || cardIds.length === 0) {
      console.log('⚠️ No cards in showcase');
      return res.json({ 
        success: true, 
        showcase: { ...showcase, card_ids: [] },
        cards: [],
        gridSize
      });
    }
    
    console.log('🃏 Fetching', cardIds.length, 'cards...');
    const cardsResult = await db.query(`
      SELECT 
        id, player, year, set_name, card_number, parallel, team, sport,
        front_image_url, back_image_url, front_image_thumb, back_image_thumb,
        is_graded, grading_company, grade, cert_number,
        is_autographed, numbered, serial_number, numbered_to,
        asking_price, ebay_avg, ebay_low, ebay_high,
        listing_status,
        case_status, removed_at, removed_by, case_location,
        sportscardspro_raw, sportscardspro_psa7, sportscardspro_psa8, 
        sportscardspro_psa9, sportscardspro_psa10, sportscardspro_bgs10, 
        sportscardspro_cgc10, sportscardspro_sgc10, sportscardspro_sales_volume
      FROM cards 
      WHERE id = ANY($1) AND user_id = $2
      AND listing_status != 'sold'
      ORDER BY 
        CASE WHEN is_graded THEN 0 ELSE 1 END,
        CAST(grade AS DECIMAL) DESC NULLS LAST
    `, [cardIds, userId]);
    
    console.log('🃏 Found', cardsResult.rows.length, 'cards');
    console.log('✅ Returning showcase data with grid size:', gridSize);
    
    res.json({ 
      success: true, 
      showcase: { ...showcase, card_ids: cardIds },
      cards: cardsResult.rows,
      gridSize
    });
    
  } catch (error) {
    console.error('❌ Get display showcase error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load showcase',
      details: error.message 
    });
  }
});

// Get vendor info for display header (public)
router.get('/info/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await db.query(`
      SELECT 
        full_name,
        vendor_profile
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vendor not found' 
      });
    }
    
    const user = result.rows[0];
    const profile = user.vendor_profile || {};
    
    res.json({ 
      success: true, 
      vendor: {
        name: user.full_name,
        businessName: profile.businessName || user.full_name,
        boothNumber: profile.boothNumber || '',
        bio: profile.bio || '',
        specialties: profile.specialties || [],
        acceptedPayments: profile.acceptedPayments || ['cash']
      }
    });
  } catch (error) {
    console.error('Get vendor info error:', error);
    res.status(500).json({ success: false, error: 'Failed to get vendor info' });
  }
});

// ==========================================
// TABLET CONFIGURATION
// ==========================================

// Get all tablet configs for vendor
router.get('/tablet-configs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const result = await db.query(`
      SELECT 
        id,
        device_identifier,
        device_name,
        showcase_id,
        is_active,
        last_seen,
        created_at
      FROM vendor_tablet_configs 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    
    res.json({ 
      success: true, 
      tablets: result.rows 
    });
  } catch (error) {
    console.error('Get tablet configs error:', error);
    res.status(500).json({ success: false, error: 'Failed to get tablet configs' });
  }
});

// Create or update tablet config
router.post('/tablet-config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { 
      device_identifier, 
      device_name, 
      showcase_id 
    } = req.body;
    
    if (!device_identifier || !showcase_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Device identifier and showcase ID are required' 
      });
    }
    
    console.log('📱 Saving tablet config:', { device_identifier, device_name, showcase_id, userId });
    
    const result = await db.query(`
      INSERT INTO vendor_tablet_configs 
      (user_id, device_identifier, device_name, showcase_id, is_active, last_seen)
      VALUES ($1, $2, $3, $4, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, device_identifier) 
      DO UPDATE SET 
        device_name = $3,
        showcase_id = $4,
        is_active = TRUE,
        last_seen = CURRENT_TIMESTAMP
      RETURNING *
    `, [userId, device_identifier, device_name, showcase_id]);
    
    console.log('✅ Tablet config saved');
    
    res.json({ 
      success: true, 
      tablet: result.rows[0] 
    });
  } catch (error) {
    console.error('❌ Save tablet config error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save tablet config',
      details: error.message 
    });
  }
});

// Delete tablet config
router.delete('/tablet-config/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const tabletId = req.params.id;
    
    await db.query(
      'DELETE FROM vendor_tablet_configs WHERE id = $1 AND user_id = $2',
      [tabletId, userId]
    );
    
    console.log(`✅ Deleted tablet config ${tabletId}`);
    
    res.json({ 
      success: true, 
      message: 'Tablet config deleted' 
    });
  } catch (error) {
    console.error('Delete tablet config error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete tablet config' });
  }
});

module.exports = router;