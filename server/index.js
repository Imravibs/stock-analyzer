import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import http from 'http';
import { Server } from 'socket.io';
import { yahooClient } from './yahoo.js';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─────────────────────────────────────────────
// In-Memory Cache
// ─────────────────────────────────────────────
const cache = new Map();

function getCached(key, ttlMs) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

// Normalise symbol — append .NS for NSE if not already suffixed
function normaliseSymbol(sym) {
  sym = sym.toUpperCase().trim();
  if (sym.endsWith('.NS') || sym.endsWith('.BO')) return sym;
  return `${sym}.NS`;
}

// ─────────────────────────────────────────────
// Gemini AI Setup
// ─────────────────────────────────────────────
let ai = null;

function getAI(apiKey) {
  if (!apiKey) return null;
  if (!ai) {
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

// GET /api/quote/:symbol — Real-time quote
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const cacheKey = `quote:${symbol}`;
    const cached = getCached(cacheKey, 5 * 60 * 1000); // 5 min
    if (cached) return res.json(cached);

    const q = await yahooFinance.quote(symbol);
    if (!q) return res.status(404).json({ error: 'Symbol not found' });

    const currentPrice = q.regularMarketPrice || 0;
    const previousClose = q.regularMarketPreviousClose || currentPrice;
    const change = q.regularMarketChange || (currentPrice - previousClose);
    const changePercent = q.regularMarketChangePercent || (previousClose ? (change / previousClose) * 100 : 0);

    const response = {
      symbol: q.symbol,
      shortName: q.shortName || q.longName || q.symbol,
      currency: q.currency || 'INR',
      exchange: q.fullExchangeName || 'NSE',
      price: currentPrice,
      previousClose,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      dayHigh: q.regularMarketDayHigh || currentPrice,
      dayLow: q.regularMarketDayLow || currentPrice,
      volume: q.regularMarketVolume || 0,
      marketCap: q.marketCap || null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow || null,
      marketState: q.marketState || 'CLOSED',
      timestamp: Date.now(),
    };

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Quote error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chart/:symbol — Historical OHLCV
app.get('/api/chart/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const range = req.query.range || '1mo';
    const intervalMap = {
      '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
      '6mo': '1wk', '1y': '1wk', '5y': '1mo', 'max': '1mo',
    };
    const interval = intervalMap[range] || '1d';

    const cacheKey = `chart:${symbol}:${range}`;
    const cached = getCached(cacheKey, 15 * 60 * 1000); // 15 min
    if (cached) return res.json(cached);

    // Convert range to a valid period1 date
    const now = new Date();
    let period1 = new Date();
    if (range === '1d') period1.setDate(now.getDate() - 1);
    else if (range === '5d') period1.setDate(now.getDate() - 5);
    else if (range === '1mo') period1.setMonth(now.getMonth() - 1);
    else if (range === '3mo') period1.setMonth(now.getMonth() - 3);
    else if (range === '6mo') period1.setMonth(now.getMonth() - 6);
    else if (range === '1y') period1.setFullYear(now.getFullYear() - 1);
    else if (range === '5y') period1.setFullYear(now.getFullYear() - 5);
    else period1 = new Date('2000-01-01');

    const result = await yahooFinance.chart(symbol, {
      period1,
      interval,
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return res.status(404).json({ error: 'No chart data' });
    }

    const candles = result.quotes.map(q => ({
      time: q.date.getTime(),
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close ?? null,
      volume: q.volume ?? 0,
    })).filter(c => c.close != null);

    const response = {
      symbol: result.meta.symbol,
      currency: result.meta.currency || 'INR',
      range,
      interval,
      candles,
    };

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Chart error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search?q= — Search stocks
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);

    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = getCached(cacheKey, 60 * 60 * 1000); // 1 hour
    if (cached) return res.json(cached);

    // Fetch search results and exact symbols concurrently to guarantee we find NSE/BSE stocks
    const exactNS = `${query.toUpperCase().trim()}.NS`;
    const exactBO = `${query.toUpperCase().trim()}.BO`;

    const [searchData, exactQuotes] = await Promise.allSettled([
      yahooFinance.search(query, { quotesCount: 15, newsCount: 0 }),
      yahooFinance.quote([exactNS, exactBO], { return: 'array' })
    ]);

    let results = [];

    // 1. Add exact match quotes first (guarantees symbol searches work)
    if (exactQuotes.status === 'fulfilled' && exactQuotes.value) {
      exactQuotes.value.forEach(q => {
        if (q && q.quoteType === 'EQUITY') {
          results.push({
            symbol: q.symbol,
            shortName: q.shortName || q.longName || q.symbol,
            exchange: q.fullExchangeName || q.exchange || 'NSE',
            type: q.quoteType,
          });
        }
      });
    }

    // 2. Add fuzzy search results from Yahoo
    if (searchData.status === 'fulfilled' && searchData.value && searchData.value.quotes) {
      const searchResults = searchData.value.quotes
        .filter(q => q.quoteType === 'EQUITY' && (q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchDisp === 'NSE' || q.exchDisp === 'BSE'))
        .map(q => ({
          symbol: q.symbol,
          shortName: q.shortname || q.longname || q.symbol,
          exchange: q.exchDisp || q.exchange,
          type: q.quoteType,
        }));
      
      // Merge unique
      searchResults.forEach(sr => {
        if (!results.find(r => r.symbol === sr.symbol)) {
          results.push(sr);
        }
      });
    }

    setCache(cacheKey, results);
    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/summary — Market indices
app.get('/api/market/summary', async (req, res) => {
  try {
    const cacheKey = 'market:summary';
    const cached = getCached(cacheKey, 5 * 60 * 1000);
    if (cached) return res.json(cached);

    const indices = ['^NSEI', '^BSESN', '^NSEBANK'];
    const quotes = await yahooFinance.quote(indices, { return: 'array' });

    const response = quotes.map(q => {
      const price = q.regularMarketPrice || 0;
      const prevClose = q.regularMarketPreviousClose || price;
      const change = q.regularMarketChange || (price - prevClose);
      const changePercent = q.regularMarketChangePercent || (prevClose ? (change / prevClose) * 100 : 0);
      
      return {
        symbol: q.symbol,
        name: q.symbol === '^NSEI' ? 'NIFTY 50' : q.symbol === '^BSESN' ? 'SENSEX' : 'BANK NIFTY',
        price: parseFloat(price.toFixed(2)),
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
      };
    });

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Market summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/analyze — Gemini-powered stock analysis
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { symbol, stockData, apiKey } = req.body;
    const gemini = getAI(apiKey || process.env.GEMINI_API_KEY);
    if (!gemini) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings.' });

    const prompt = `You are an expert Indian stock market analyst. Analyze the following stock data and provide a comprehensive but concise analysis.

Stock: ${symbol}
Current Price: ₹${stockData.price}
Change: ${stockData.change > 0 ? '+' : ''}${stockData.change} (${stockData.changePercent > 0 ? '+' : ''}${stockData.changePercent}%)
Day Range: ₹${stockData.dayLow} — ₹${stockData.dayHigh}
52-Week Range: ₹${stockData.fiftyTwoWeekLow || 'N/A'} — ₹${stockData.fiftyTwoWeekHigh || 'N/A'}
Volume: ${stockData.volume?.toLocaleString('en-IN') || 'N/A'}

Technical Indicators:
${stockData.indicators ? JSON.stringify(stockData.indicators, null, 2) : 'Not available'}

Provide your analysis in this exact JSON format (no markdown, just raw JSON):
{
  "summary": "2-3 sentence overall assessment",
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": 0.0 to 1.0,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "support": price_number,
  "resistance": price_number,
  "targetPrice": price_number,
  "stopLoss": price_number,
  "timeHorizon": "Short-term (1-4 weeks)" or "Medium-term (1-3 months)" or "Long-term (3-12 months)"
}

Important: Base your analysis on the actual data provided. Be balanced and honest. Include a disclaimer that this is AI-generated analysis and not financial advice.`;

    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      contents: prompt,
    });

    let text = response.text || '';
    // Clean up markdown code fences if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try {
      const analysis = JSON.parse(text);
      res.json(analysis);
    } catch {
      // If JSON parsing fails, return raw text
      res.json({ summary: text, signal: 'HOLD', confidence: 0.5, strengths: [], risks: [], rawResponse: true });
    }
  } catch (err) {
    console.error('AI Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — Conversational AI
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, context, history, apiKey, attachments } = req.body;
    const gemini = getAI(apiKey || process.env.GEMINI_API_KEY);
    if (!gemini) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings.' });

    const systemPrompt = `You are StockPulse AI, an AI assistant specialized in Indian stock market analysis (NSE/BSE). You help users understand stocks, technical indicators, market trends, and make informed investment decisions. You can also analyze uploaded charts, read financial reports in PDF format, and read text-based datasets.

Rules:
- Always mention that your analysis is AI-generated and not financial advice
- Use ₹ for Indian Rupees
- Reference NSE/BSE specific context (market hours 9:15 AM - 3:30 PM IST, T+1 settlement, etc.)
- Be concise but thorough
- Use bullet points and structured formatting
- If you don't have real-time data, say so honestly
- When discussing stocks, use common Indian market terminology

${context ? `Current context:\n${context}` : ''}`;

    const chatHistory = (history || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Build the user message parts
    const userParts = [];
    if (message && message.trim()) {
      userParts.push({ text: message });
    } else if (attachments && attachments.length > 0) {
      userParts.push({ text: "Please analyze the attached file." });
    }

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.isText) {
          userParts.push({ text: `\n\n--- Content of ${att.name} ---\n${att.data}\n--- End of ${att.name} ---\n` });
        } else {
          userParts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data
            }
          });
        }
      }
    }

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood! I\'m StockPulse AI, your AI assistant for Indian stock market analysis. I\'ll provide analysis on NSE/BSE stocks, technical indicators, and market insights. All my analyses are AI-generated and should not be treated as financial advice. How can I help you today?' }] },
      ...chatHistory,
      { role: 'user', parts: userParts },
    ];

    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      contents,
    });

    res.json({ reply: response.text || 'I couldn\'t generate a response. Please try again.' });
  } catch (err) {
    console.error('AI Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/apikey — Store API key in environment (session only)
app.post('/api/config/apikey', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key is required' });
  // Reset the AI instance with new key
  ai = new GoogleGenAI({ apiKey });
  res.json({ success: true, message: 'API key configured for this session' });
});

// Fallback: serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// WebSocket & Yahoo Integration
// ─────────────────────────────────────────────

// Broadcast ticks from Yahoo to all connected clients
yahooClient.onTick((tickData) => {
  io.emit('live_tick', tickData);
});

io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  socket.on('subscribe', ({ symbol }) => {
    yahooClient.subscribe(symbol);
  });

  socket.on('unsubscribe', ({ symbol }) => {
    yahooClient.unsubscribe(symbol);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Stock Analyzer server running at http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
  console.log(`⚡ WebSocket server active`);
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log(`\n⚠️  Gemini API key not set. Add it to server/.env or configure in the app Settings.`);
    console.log(`   Get your free key at: https://aistudio.google.com/app/apikey\n`);
  }
});
