// ═══════════════════════════════════════════════════════════
// routes/auth.js — JWT Authentication Routes
// ═══════════════════════════════════════════════════════════

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { stmts } from '../db.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'stockpulse-dev-secret-change-in-production';
const JWT_EXPIRES = '30d';

// ─── Middleware: Verify JWT ───
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = auth.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.userPlan = payload.plan || 'free';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── POST /api/auth/register ───
router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = stmts.getUserByEmail.get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = stmts.createUser.run(email.toLowerCase().trim(), name.trim(), hash);

    const user = stmts.getUserById.get(result.lastInsertRowid);
    const token = jwt.sign({ sub: user.id, plan: user.plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── POST /api/auth/login ───
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    stmts.updateLastLogin.run(user.id);
    const token = jwt.sign({ sub: user.id, plan: user.plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const { password_hash, ...safeUser } = user;

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── GET /api/auth/me ───
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = stmts.getUserById.get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auth/watchlist ───
router.get('/watchlist', requireAuth, (req, res) => {
  const items = stmts.getWatchlist.all(req.userId);
  res.json(items.map(i => i.symbol));
});

// ─── POST /api/auth/watchlist ───
router.post('/watchlist', requireAuth, (req, res) => {
  const { symbol, action } = req.body; // action: 'add' | 'remove'
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  if (action === 'remove') {
    stmts.removeFromWatchlist.run(req.userId, symbol.toUpperCase());
  } else {
    stmts.addToWatchlist.run(req.userId, symbol.toUpperCase());
  }
  res.json({ success: true });
});

// ─── GET/POST /api/auth/notebook/:symbol ───
router.get('/notebook/:symbol', requireAuth, (req, res) => {
  const note = stmts.getNote.get(req.userId, req.params.symbol.toUpperCase());
  res.json({ content: note?.content || '', updated_at: note?.updated_at });
});

router.post('/notebook/:symbol', requireAuth, (req, res) => {
  const { content } = req.body;
  stmts.upsertNote.run(req.userId, req.params.symbol.toUpperCase(), content || '');
  res.json({ success: true });
});

export default router;
