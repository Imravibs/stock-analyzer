// ═══════════════════════════════════════════════════════════
// routes/screens.js — Saved Screens, Public Directory, Alerts
// ═══════════════════════════════════════════════════════════

import express from 'express';
import { stmts } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// ─── GET /api/screens/public ───
router.get('/public', (req, res) => {
  try {
    const screens = stmts.getPublicScreens.all();
    res.json(screens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/screens/my ───
router.get('/my', requireAuth, (req, res) => {
  try {
    const screens = stmts.getMyScreens.all(req.userId);
    res.json(screens);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/screens/save ───
router.post('/save', requireAuth, (req, res) => {
  try {
    const { name, description, query, isPublic } = req.body;
    if (!name || !query) return res.status(400).json({ error: 'Name and query are required' });

    const result = stmts.saveScreen.run(req.userId, name, description || '', query, isPublic ? 1 : 0);
    const screen = stmts.getScreenById.get(result.lastInsertRowid);
    res.status(201).json(screen);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/screens/:id ───
router.put('/:id', requireAuth, (req, res) => {
  try {
    const { name, description, query, isPublic } = req.body;
    stmts.updateScreen.run(name, description || '', query, isPublic ? 1 : 0, req.params.id, req.userId);
    const screen = stmts.getScreenById.get(req.params.id);
    res.json(screen);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/screens/:id ───
router.delete('/:id', requireAuth, (req, res) => {
  try {
    stmts.deleteScreen.run(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/screens/:id/fork ───
router.post('/:id/fork', requireAuth, (req, res) => {
  try {
    const original = stmts.getScreenById.get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Screen not found' });
    if (!original.is_public && original.user_id !== req.userId) {
      return res.status(403).json({ error: 'Cannot fork a private screen' });
    }

    const result = stmts.forkScreen.run(
      req.userId,
      `Fork of: ${original.name}`,
      original.description,
      original.query,
      original.id
    );
    const screen = stmts.getScreenById.get(result.lastInsertRowid);
    res.status(201).json(screen);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/screens/:id/alert ───
router.post('/:id/alert', requireAuth, (req, res) => {
  try {
    stmts.subscribeAlert.run(req.userId, req.params.id);
    res.json({ success: true, message: 'Alert subscription created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/screens/:id/alert ───
router.delete('/:id/alert', requireAuth, (req, res) => {
  try {
    stmts.unsubscribeAlert.run(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/screens/:id/export.csv ───
router.get('/:id/export.csv', async (req, res) => {
  try {
    // Trigger a fresh run of the screen and return CSV
    // The client sends the query, server generates CSV
    const screen = stmts.getScreenById.get(req.params.id);
    if (!screen) return res.status(404).json({ error: 'Screen not found' });

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="${screen.name.replace(/[^a-z0-9]/gi, '_')}.csv"`);
    // Results will be sent by the caller providing universe data
    // For now return a placeholder header
    res.send('Symbol,Name,Price,PE,MarketCap,DividendYield,52WH\n');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
