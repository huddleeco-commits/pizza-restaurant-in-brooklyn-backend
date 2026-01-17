// Backend Routes: Sales History & Show Reports
// File: backend/routes/vendor-sales-shows.routes.js

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const axios = require('axios');

// ========================================
// SALES HISTORY ENDPOINTS
// ========================================

// Mark card as SOLD 
router.post('/sales/mark-sold', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      card_id,
      sale_price,
      sale_method,
      customer_name,
      customer_email,
      show_report_id,
      notes
    } = req.body;

    // Get the card data before we update it
    const cardResult = await db.query(
      'SELECT * FROM cards WHERE id = $1 AND user_id = $2',
      [card_id, userId]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Card not found' });
    }

    const card = cardResult.rows[0];

    // Calculate time in showcase (if we have created_at)
    let timeInShowcase = null;
    if (card.created_at) {
      const now = new Date();
      const created = new Date(card.created_at);
      timeInShowcase = Math.floor((now - created) / 1000 / 60); // minutes
    }

    // Insert into sales history
    const salesResult = await db.query(`
      INSERT INTO card_sales_history (
        user_id, card_id, show_report_id, showcase_id,
        card_data, sale_price, sale_method,
        customer_name, customer_email,
        time_in_showcase_minutes, notes, sold_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *
    `, [
      userId,
      card_id,
      show_report_id || null,
      card.showcase_id || null,
      JSON.stringify(card), // Store full card snapshot
      sale_price || card.asking_price || 0,
      sale_method || 'cash',
      customer_name || null,
      customer_email || null,
      timeInShowcase,
      notes || null
    ]);

    // Update card status to SOLD
    await db.query(
      'UPDATE cards SET listing_status = $1 WHERE id = $2',
      ['sold', card_id]
    );

    // If this sale is part of an active show, update the show stats
    if (show_report_id) {
      await db.query(`
        UPDATE show_reports 
        SET cards_sold = cards_sold + 1,
            total_sales = total_sales + $1,
            updated_at = NOW()
        WHERE id = $2 AND user_id = $3
      `, [sale_price || card.asking_price || 0, show_report_id, userId]);
    }

    res.json({
      success: true,
      sale: salesResult.rows[0],
      message: 'Card marked as sold'
    });

  } catch (error) {
    console.error('Error marking card as sold:', error);
    res.status(500).json({ success: false, error: 'Failed to mark card as sold' });
  }
});

// Get sales history
router.get('/sales/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { show_id, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        s.*,
        sr.show_name,
        sr.show_date
      FROM card_sales_history s
      LEFT JOIN show_reports sr ON s.show_report_id = sr.id
      WHERE s.user_id = $1
    `;
    const params = [userId];

    if (show_id) {
      query += ` AND s.show_report_id = $${params.length + 1}`;
      params.push(show_id);
    }

    query += ` ORDER BY s.sold_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM card_sales_history WHERE user_id = $1' + (show_id ? ' AND show_report_id = $2' : ''),
      show_id ? [userId, show_id] : [userId]
    );

    res.json({
      success: true,
      sales: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching sales history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sales history' });
  }
});

// Get sales summary stats
router.get('/sales/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30d' } = req.query; // '7d', '30d', '90d', 'all'

    let dateFilter = '';
    if (period !== 'all') {
      const days = parseInt(period);
      dateFilter = `AND sold_at >= NOW() - INTERVAL '${days} days'`;
    }

    const result = await db.query(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(sale_price), 0) as total_revenue,
        COALESCE(AVG(sale_price), 0) as avg_sale_price,
        COALESCE(MAX(sale_price), 0) as highest_sale,
        COALESCE(MIN(sale_price), 0) as lowest_sale
      FROM card_sales_history
      WHERE user_id = $1 ${dateFilter}
    `, [userId]);

    res.json({
      success: true,
      summary: result.rows[0]
    });

  } catch (error) {
    console.error('Error fetching sales summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sales summary' });
  }
});

// ========================================
// SHOW REPORTS ENDPOINTS
// ========================================

// Create new show report
router.post('/shows/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      show_name,
      show_date,
      show_location,
      showcase_id
    } = req.body;

    // Get current showcase inventory
    const showcase = await db.query(
      'SELECT * FROM vendor_showcases WHERE id = $1 AND user_id = $2',
      [showcase_id, userId]
    );

    if (showcase.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Showcase not found' });
    }

    const showcaseData = showcase.rows[0];
    const cardIds = showcaseData.card_ids || [];

    // Get all cards in showcase
    const cardsResult = await db.query(
      'SELECT * FROM cards WHERE id = ANY($1) AND user_id = $2 AND listing_status != $3',
      [cardIds, userId, 'sold']
    );

    const startingInventory = cardsResult.rows;

    // Create show report
    const reportResult = await db.query(`
      INSERT INTO show_reports (
        user_id, showcase_id, show_name, show_date, show_location,
        status, starting_inventory, cards_started, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [
      userId,
      showcase_id,
      show_name,
      show_date,
      show_location || null,
      'active',
      JSON.stringify(startingInventory),
      startingInventory.length
    ]);

    res.json({
      success: true,
      report: reportResult.rows[0],
      message: 'Show report created'
    });

  } catch (error) {
    console.error('Error creating show report:', error);
    res.status(500).json({ success: false, error: 'Failed to create show report' });
  }
});

// Take mid-show snapshot
router.post('/shows/:id/snapshot', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const showId = req.params.id;
    const { notes } = req.body;

    // Get show report
    const reportResult = await db.query(
      'SELECT * FROM show_reports WHERE id = $1 AND user_id = $2',
      [showId, userId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Show report not found' });
    }

    const report = reportResult.rows[0];
    const showcaseId = report.showcase_id;

    // Get current showcase inventory
    const showcase = await db.query(
      'SELECT card_ids FROM vendor_showcases WHERE id = $1',
      [showcaseId]
    );

    const cardIds = showcase.rows[0]?.card_ids || [];

    // Get current cards
    const cardsResult = await db.query(
      'SELECT * FROM cards WHERE id = ANY($1) AND user_id = $2 AND listing_status != $3',
      [cardIds, userId, 'sold']
    );

    const currentInventory = cardsResult.rows;

    // Add snapshot to existing snapshots array
    const existingSnapshots = report.mid_show_snapshots || [];
    const newSnapshot = {
      timestamp: new Date().toISOString(),
      cards: currentInventory,
      notes: notes || null,
      cards_count: currentInventory.length
    };
    existingSnapshots.push(newSnapshot);

    // Update report
    await db.query(
      'UPDATE show_reports SET mid_show_snapshots = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(existingSnapshots), showId]
    );

    res.json({
      success: true,
      snapshot: newSnapshot,
      message: 'Snapshot saved'
    });

  } catch (error) {
    console.error('Error taking snapshot:', error);
    res.status(500).json({ success: false, error: 'Failed to take snapshot' });
  }
});

// End show and finalize report
router.post('/shows/:id/end', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const showId = req.params.id;

    // Get show report
    const reportResult = await db.query(
      'SELECT * FROM show_reports WHERE id = $1 AND user_id = $2',
      [showId, userId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Show report not found' });
    }

    const report = reportResult.rows[0];
    const showcaseId = report.showcase_id;

    // Get ending inventory
    const showcase = await db.query(
      'SELECT card_ids FROM vendor_showcases WHERE id = $1',
      [showcaseId]
    );

    const cardIds = showcase.rows[0]?.card_ids || [];

    const cardsResult = await db.query(
      'SELECT * FROM cards WHERE id = ANY($1) AND user_id = $2 AND listing_status != $3',
      [cardIds, userId, 'sold']
    );

    const endingInventory = cardsResult.rows;

    // Update show report
    await db.query(`
      UPDATE show_reports 
      SET status = 'completed',
          ending_inventory = $1,
          ended_at = NOW(),
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(endingInventory), showId]);

    res.json({
      success: true,
      message: 'Show ended',
      cards_remaining: endingInventory.length
    });

  } catch (error) {
    console.error('Error ending show:', error);
    res.status(500).json({ success: false, error: 'Failed to end show' });
  }
});

// Get all show reports
router.get('/shows', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM show_reports WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY show_date DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      reports: result.rows
    });

  } catch (error) {
    console.error('Error fetching show reports:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch show reports' });
  }
});

// Get single show report with details
router.get('/shows/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const showId = req.params.id;

    const reportResult = await db.query(
      'SELECT * FROM show_reports WHERE id = $1 AND user_id = $2',
      [showId, userId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Show report not found' });
    }

    const report = reportResult.rows[0];

    // Get sales for this show
    const salesResult = await db.query(
      'SELECT * FROM card_sales_history WHERE show_report_id = $1 ORDER BY sold_at ASC',
      [showId]
    );

    res.json({
      success: true,
      report: report,
      sales: salesResult.rows
    });

  } catch (error) {
    console.error('Error fetching show report:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch show report' });
  }
});

// ========================================
// EXCEL EXPORT
// ========================================

// Export show report to Excel with images
router.get('/shows/:id/export', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const showId = req.params.id;

    // Get show report with all data
    const reportResult = await db.query(
      'SELECT * FROM show_reports WHERE id = $1 AND user_id = $2',
      [showId, userId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Show report not found' });
    }

    const report = reportResult.rows[0];

    // Get sales for this show
    const salesResult = await db.query(
      'SELECT * FROM card_sales_history WHERE show_report_id = $1 ORDER BY sold_at ASC',
      [showId]
    );

    const sales = salesResult.rows;

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SlabTrack';
    workbook.created = new Date();

    // ========================================
    // SHEET 1: Show Summary
    // ========================================
    const summarySheet = workbook.addWorksheet('Show Summary');
    summarySheet.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 40 }
    ];

    summarySheet.addRows([
      { label: 'Show Name:', value: report.show_name },
      { label: 'Date:', value: new Date(report.show_date).toLocaleDateString() },
      { label: 'Location:', value: report.show_location || 'N/A' },
      { label: '', value: '' },
      { label: 'Starting Inventory:', value: report.cards_started },
      { label: 'Cards Sold:', value: report.cards_sold },
      { label: 'Cards Remaining:', value: report.cards_started - report.cards_sold },
      { label: 'Total Sales:', value: `$${parseFloat(report.total_sales || 0).toFixed(2)}` },
      { label: '', value: '' },
      { label: 'QR Scans:', value: report.qr_scans || 0 },
      { label: 'Card Views:', value: report.card_views || 0 },
      { label: 'Cart Adds:', value: report.cart_adds || 0 },
      { label: 'Checkouts:', value: report.checkouts || 0 },
    ]);

    // Bold the labels
    summarySheet.getColumn('label').font = { bold: true };

    // ========================================
    // SHEET 2: Starting Inventory
    // ========================================
    const startingSheet = workbook.addWorksheet('Starting Inventory');
    startingSheet.columns = [
      { key: 'image', width: 15, header: 'IMAGE' },
      { key: 'player', width: 25, header: 'PLAYER' },
      { key: 'year', width: 10, header: 'YEAR' },
      { key: 'set', width: 25, header: 'SET' },
      { key: 'number', width: 12, header: 'CARD #' },
      { key: 'grade', width: 15, header: 'GRADE' },
      { key: 'price', width: 12, header: 'ASKING PRICE' }
    ];

    const startingInventory = report.starting_inventory || [];
    
    for (let i = 0; i < startingInventory.length; i++) {
      const card = startingInventory[i];
      const rowIndex = i + 2; // +2 because row 1 is header
      
      startingSheet.addRow({
        image: '',
        player: card.player,
        year: card.year,
        set: card.set_name,
        number: card.card_number,
        grade: card.is_graded ? `${card.grading_company} ${card.grade}` : 'Raw',
        price: card.asking_price ? `$${parseFloat(card.asking_price).toFixed(2)}` : 'N/A'
      });

      // Add image if available
      if (card.front_image_url) {
        try {
          const imageResponse = await axios.get(card.front_image_url, { responseType: 'arraybuffer' });
          const imageId = workbook.addImage({
            buffer: imageResponse.data,
            extension: 'jpeg'
          });
          
          startingSheet.addImage(imageId, {
            tl: { col: 0, row: rowIndex - 1 },
            br: { col: 1, row: rowIndex },
            editAs: 'oneCell'
          });
          
          startingSheet.getRow(rowIndex).height = 80;
        } catch (err) {
          console.error('Failed to add image:', err.message);
        }
      }
    }

    // Header formatting
    startingSheet.getRow(1).font = { bold: true };
    startingSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6366F1' }
    };
    startingSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // ========================================
    // SHEET 3: Cards Sold
    // ========================================
    const salesSheet = workbook.addWorksheet('Cards Sold');
    salesSheet.columns = [
      { key: 'image', width: 15, header: 'IMAGE' },
      { key: 'player', width: 25, header: 'PLAYER' },
      { key: 'year', width: 10, header: 'YEAR' },
      { key: 'set', width: 25, header: 'SET' },
      { key: 'grade', width: 15, header: 'GRADE' },
      { key: 'price', width: 12, header: 'SALE PRICE' },
      { key: 'time', width: 18, header: 'SOLD AT' },
      { key: 'customer', width: 20, header: 'CUSTOMER' }
    ];

    for (let i = 0; i < sales.length; i++) {
      const sale = sales[i];
      const card = sale.card_data;
      const rowIndex = i + 2;
      
      salesSheet.addRow({
        image: '',
        player: card.player,
        year: card.year,
        set: card.set_name,
        grade: card.is_graded ? `${card.grading_company} ${card.grade}` : 'Raw',
        price: `$${parseFloat(sale.sale_price).toFixed(2)}`,
        time: new Date(sale.sold_at).toLocaleString(),
        customer: sale.customer_name || 'N/A'
      });

      // Add image
      if (card.front_image_url) {
        try {
          const imageResponse = await axios.get(card.front_image_url, { responseType: 'arraybuffer' });
          const imageId = workbook.addImage({
            buffer: imageResponse.data,
            extension: 'jpeg'
          });
          
          salesSheet.addImage(imageId, {
            tl: { col: 0, row: rowIndex - 1 },
            br: { col: 1, row: rowIndex },
            editAs: 'oneCell'
          });
          
          salesSheet.getRow(rowIndex).height = 80;
        } catch (err) {
          console.error('Failed to add image:', err.message);
        }
      }
    }

    // Header formatting
    salesSheet.getRow(1).font = { bold: true };
    salesSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF10B981' }
    };
    salesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // ========================================
    // SHEET 4: Ending Inventory
    // ========================================
    const endingSheet = workbook.addWorksheet('Ending Inventory');
    endingSheet.columns = [
      { key: 'image', width: 15, header: 'IMAGE' },
      { key: 'player', width: 25, header: 'PLAYER' },
      { key: 'year', width: 10, header: 'YEAR' },
      { key: 'set', width: 25, header: 'SET' },
      { key: 'number', width: 12, header: 'CARD #' },
      { key: 'grade', width: 15, header: 'GRADE' },
      { key: 'price', width: 12, header: 'ASKING PRICE' }
    ];

    const endingInventory = report.ending_inventory || [];
    
    for (let i = 0; i < endingInventory.length; i++) {
      const card = endingInventory[i];
      const rowIndex = i + 2;
      
      endingSheet.addRow({
        image: '',
        player: card.player,
        year: card.year,
        set: card.set_name,
        number: card.card_number,
        grade: card.is_graded ? `${card.grading_company} ${card.grade}` : 'Raw',
        price: card.asking_price ? `$${parseFloat(card.asking_price).toFixed(2)}` : 'N/A'
      });

      // Add image
      if (card.front_image_url) {
        try {
          const imageResponse = await axios.get(card.front_image_url, { responseType: 'arraybuffer' });
          const imageId = workbook.addImage({
            buffer: imageResponse.data,
            extension: 'jpeg'
          });
          
          endingSheet.addImage(imageId, {
            tl: { col: 0, row: rowIndex - 1 },
            br: { col: 1, row: rowIndex },
            editAs: 'oneCell'
          });
          
          endingSheet.getRow(rowIndex).height = 80;
        } catch (err) {
          console.error('Failed to add image:', err.message);
        }
      }
    }

    // Header formatting
    endingSheet.getRow(1).font = { bold: true };
    endingSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEF4444' }
    };
    endingSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // ========================================
    // SEND FILE
    // ========================================
    const fileName = `${report.show_name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error exporting show report:', error);
    res.status(500).json({ success: false, error: 'Failed to export show report' });
  }
});

// ========================================
// ANALYTICS SUMMARY (for Live Show tab)
// ========================================

// Get analytics summary for today's activity
router.get('/analytics/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'today' } = req.query;

    // For now, return zeros - can enhance later with real analytics
    const summary = {
      qr_scans: 0,
      card_views: 0,
      cart_adds: 0,
      checkouts: 0,
      cards_out: 0,
      cards_removed_today: 0,
      cards_returned_today: 0,
      nfc_taps: 0
    };

    // TODO: Get real analytics from vendor_analytics table
    // This is a stub to prevent 404 errors

    res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics summary' });
  }
});

// Get cards currently out of case (for Live Show alerts)
router.get('/analytics/cards-out', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get cards with case_status = 'out_for_viewing'
    const result = await db.query(`
      SELECT 
        c.*,
        EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 60 as minutes_out
      FROM cards c
      WHERE c.user_id = $1 
        AND c.case_status = 'out_for_viewing'
        AND c.listing_status != 'sold'
      ORDER BY c.updated_at DESC
    `, [userId]);

    res.json({
      success: true,
      cards: result.rows
    });

  } catch (error) {
    console.error('Error fetching cards out:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cards out' });
  }
});

// ============================================
// UNSELL CARD - Restore to Active Status
// ============================================
router.post('/sales/unsell/:cardId', authenticateToken, async (req, res) => {
  const vendorId = req.user.userId || req.user.id;
  const { cardId } = req.params;
  const { showcase_id } = req.body; // Optional: which showcase to restore to

  try {
    // Verify card belongs to user
    const cardCheck = await db.query(
      'SELECT * FROM cards WHERE id = $1 AND user_id = $2',
      [cardId, vendorId]
    );

    if (cardCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Card not found' });
    }

    const card = cardCheck.rows[0];

    // Restore card to active status
    await db.query(
      `UPDATE cards 
       SET listing_status = $1,
           sold_price = NULL,
           sold_date = NULL,
           buyer_name = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      ['listed', cardId]
    );

    // Delete from card_sales_history (NOT sales_history!)
    await db.query(
      'DELETE FROM card_sales_history WHERE card_id = $1 AND user_id = $2',
      [cardId, vendorId]
    );

    // If showcase_id provided, add card back to that showcase
    if (showcase_id) {
      const showcaseResult = await db.query(
        'SELECT card_ids FROM vendor_showcases WHERE id = $1 AND user_id = $2',
        [showcase_id, vendorId]
      );

      if (showcaseResult.rows.length > 0) {
        let cardIds = [];
        try {
          cardIds = typeof showcaseResult.rows[0].card_ids === 'string'
            ? JSON.parse(showcaseResult.rows[0].card_ids)
            : showcaseResult.rows[0].card_ids;
        } catch (e) {
          cardIds = [];
        }

        // Add card if not already in showcase
        if (!cardIds.includes(parseInt(cardId))) {
          cardIds.push(parseInt(cardId));
          
          await db.query(
            'UPDATE vendor_showcases SET card_ids = $1 WHERE id = $2',
            [JSON.stringify(cardIds), showcase_id]
          );

          console.log(`📦 Card ${cardId} restored to showcase ${showcase_id}`);
        }
      }
    }

    console.log(`🔄 Card ${cardId} unsold and restored to active`);

    res.json({
      success: true,
      message: showcase_id 
        ? 'Card restored to active status and added back to showcase'
        : 'Card restored to active status'
    });

  } catch (error) {
    console.error('❌ Unsell card error:', error);
    res.status(500).json({ success: false, error: 'Failed to unsell card' });
  }
});

// ============================================
// CLEAR ALL SALES DATA (Testing/Show Reset)
// ============================================
router.delete('/sales/clear-all', authenticateToken, async (req, res) => {
  const vendorId = req.user.userId || req.user.id;
  const { confirm_text } = req.body;

  // Safety check - require confirmation
  if (confirm_text !== 'DELETE ALL SALES') {
    return res.status(400).json({ 
      success: false,
      error: 'Confirmation required',
      message: 'Must send { confirm_text: "DELETE ALL SALES" }'
    });
  }

  try {
    // Get all sold cards
    const soldCards = await db.query(
      'SELECT id FROM cards WHERE user_id = $1 AND listing_status = $2',
      [vendorId, 'sold']
    );

    const soldCardIds = soldCards.rows.map(c => c.id);

    if (soldCardIds.length > 0) {
      // Restore all sold cards to active
      await db.query(
        `UPDATE cards 
         SET listing_status = $1,
             sold_price = NULL,
             sold_date = NULL,
             buyer_name = NULL,
             updated_at = NOW()
         WHERE user_id = $2 AND listing_status = $3`,
        ['listed', vendorId, 'sold']
      );

      console.log(`🔄 Restored ${soldCardIds.length} cards to active`);
    }

    // Delete all card_sales_history (NOT sales_history!)
    const salesResult = await db.query(
      'DELETE FROM card_sales_history WHERE user_id = $1 RETURNING id',
      [vendorId]
    );

    // Reset all show reports to pending
    await db.query(
      `UPDATE show_reports 
       SET status = $1,
           cards_sold = 0,
           total_sales = 0
       WHERE user_id = $2 AND status = $3`,
      ['pending', vendorId, 'active']
    );

    console.log(`🧹 CLEARED ALL DATA:
      - ${soldCardIds.length} cards restored
      - ${salesResult.rows.length} sales history deleted
      - Shows reset to pending`);

    res.json({
      success: true,
      message: 'All sales data cleared',
      cleared: {
        cards_restored: soldCardIds.length,
        sales_history_deleted: salesResult.rows.length
      }
    });

  } catch (error) {
    console.error('❌ Clear sales error:', error);
    res.status(500).json({ success: false, error: 'Failed to clear sales data', details: error.message });
  }
});

// ============================================
// CLEAR ACTIVE SHOW DATA ONLY
// ============================================
router.delete('/shows/:showId/clear-sales', authenticateToken, async (req, res) => {
  const vendorId = req.user.userId || req.user.id;
  const { showId } = req.params;

  try {
    // Verify show ownership
    const showCheck = await db.query(
      'SELECT * FROM vendor_shows WHERE id = $1 AND vendor_id = $2',
      [showId, vendorId]
    );

    if (showCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Show not found' });
    }

    // Get card IDs from show_sales
    const showSalesResult = await db.query(
      'SELECT card_id FROM show_sales WHERE show_id = $1',
      [showId]
    );

    const cardIds = showSalesResult.rows.map(s => s.card_id);

    // Delete show_sales records
    await db.query(
      'DELETE FROM show_sales WHERE show_id = $1',
      [showId]
    );

    // Optionally restore cards (you can remove this if you don't want to)
    if (cardIds.length > 0) {
      await db.query(
        `UPDATE cards 
         SET listing_status = $1,
             sold_price = NULL,
             sold_date = NULL
         WHERE id = ANY($2)`,
        ['active', cardIds]
      );

      // Also delete from sales_history
      await db.query(
        'DELETE FROM sales_history WHERE card_id = ANY($1) AND user_id = $2',
        [cardIds, vendorId]
      );
    }

    console.log(`🧹 Cleared ${cardIds.length} sales from show ${showId}`);

    res.json({
      success: true,
      message: 'Show sales cleared',
      cards_restored: cardIds.length
    });

  } catch (error) {
    console.error('❌ Clear show sales error:', error);
    res.status(500).json({ error: 'Failed to clear show sales' });
  }
});

module.exports = router;