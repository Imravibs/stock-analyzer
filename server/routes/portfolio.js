// ═══════════════════════════════════════════════════════════
// routes/portfolio.js — Portfolio Holdings, XIRR
// ═══════════════════════════════════════════════════════════

import express from 'express';
import { stmts } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// ─── XIRR Calculation (Newton-Raphson) ───
function xirr(cashflows) {
  // cashflows: [{ amount, date }] — negative = outflow (buy), positive = inflow (sell/current value)
  if (cashflows.length < 2) return null;

  const dates = cashflows.map(cf => new Date(cf.date).getTime());
  const amounts = cashflows.map(cf => cf.amount);
  const t0 = dates[0];

  function npv(rate) {
    return amounts.reduce((sum, amt, i) => {
      const t = (dates[i] - t0) / (365 * 24 * 3600 * 1000); // years
      return sum + amt / Math.pow(1 + rate, t);
    }, 0);
  }

  function dnpv(rate) {
    return amounts.reduce((sum, amt, i) => {
      const t = (dates[i] - t0) / (365 * 24 * 3600 * 1000);
      return sum - t * amt / Math.pow(1 + rate, t + 1);
    }, 0);
  }

  let rate = 0.1; // initial guess 10%
  for (let iter = 0; iter < 100; iter++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) break;
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-7) { rate = newRate; break; }
    rate = newRate;
  }
  return isFinite(rate) ? rate * 100 : null; // return as %
}

// ─── GET /api/portfolio ───
router.get('/', requireAuth, async (req, res) => {
  try {
    const holdings = stmts.getHoldings.all(req.userId);
    res.json(holdings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/portfolio ───
router.post('/', requireAuth, (req, res) => {
  try {
    const { symbol, quantity, avgPrice, buyDate, notes } = req.body;
    if (!symbol || !quantity || !avgPrice || !buyDate) {
      return res.status(400).json({ error: 'Symbol, quantity, avgPrice, and buyDate are required' });
    }
    const result = stmts.addHolding.run(
      req.userId,
      symbol.toUpperCase(),
      parseFloat(quantity),
      parseFloat(avgPrice),
      buyDate,
      notes || ''
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/portfolio/:id ───
router.put('/:id', requireAuth, (req, res) => {
  try {
    const { quantity, avgPrice, notes } = req.body;
    stmts.updateHolding.run(parseFloat(quantity), parseFloat(avgPrice), notes || '', req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/portfolio/:id ───
router.delete('/:id', requireAuth, (req, res) => {
  try {
    stmts.deleteHolding.run(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/portfolio/xirr ───
// Body: { cashflows: [{ amount, date }], currentValue, currentDate }
router.post('/xirr', requireAuth, (req, res) => {
  try {
    const { cashflows } = req.body;
    if (!cashflows || cashflows.length < 2) {
      return res.status(400).json({ error: 'At least 2 cashflows required' });
    }
    const rate = xirr(cashflows);
    res.json({ xirr: rate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
