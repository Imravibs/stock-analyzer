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
import authRouter from './routes/auth.js';
import screensRouter from './routes/screens.js';
import portfolioRouter from './routes/portfolio.js';
import { detectRedFlags } from './ai/red-flag-detector.js';
import fetch from 'node-fetch';


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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Feature Routes ───
app.use('/api/auth', authRouter);
app.use('/api/screens', screensRouter);
app.use('/api/portfolio', portfolioRouter);


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
  // If we have an OpenRouter key, route requests via OpenRouter API
  const orKey = process.env.OPENROUTER_API_KEY || (apiKey && apiKey.startsWith('sk-or-') ? apiKey : null);
  if (orKey) {
    return {
      isOpenRouter: true,
      apiKey: orKey,
      models: {
        async generateContent({ model, contents }) {
          const actualModel = process.env.GEMINI_MODEL || model || 'nvidia/nemotron-4-340b-instruct';
          let promptText = '';
          if (typeof contents === 'string') {
            promptText = contents;
          } else if (Array.isArray(contents)) {
            // handle contents structure (history, user text)
            promptText = contents.map(c => {
              const role = c.role === 'model' ? 'assistant' : (c.role || 'user');
              const partsText = (c.parts || []).map(p => p.text || '').join(' ');
              return `${role.toUpperCase()}: ${partsText}`;
            }).join('\n\n');
          } else if (contents && contents.text) {
            promptText = contents.text;
          }

          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${orKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/Imravibs/stock-analyzer',
              'X-Title': 'StockPulse Analyzer'
            },
            body: JSON.stringify({
              model: actualModel,
              messages: [{ role: 'user', content: promptText }]
            })
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `OpenRouter error: ${response.statusText}`);
          }

          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || '';
          return { text };
        }
      }
    };
  }

  // Fallback to Google Gemini
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  if (!ai || ai.apiKey !== geminiKey) {
    ai = new GoogleGenAI({ apiKey: geminiKey });
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
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: contents,
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

// ─────────────────────────────────────────────
// Phase 1: Company Deep-Dive Routes
// ─────────────────────────────────────────────

// GET /api/financials/:symbol — P&L, Balance Sheet, Cash Flow (5-10 years)
app.get('/api/financials/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const cacheKey = `financials:${symbol}`;
    const cached = getCached(cacheKey, 6 * 60 * 60 * 1000); // 6 hours
    if (cached) return res.json(cached);

    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: [
        'incomeStatementHistory',
        'incomeStatementHistoryQuarterly',
        'balanceSheetHistory',
        'cashflowStatementHistory',
      ],
    });

    const annualPL = (summary.incomeStatementHistory?.incomeStatementHistory || []).map(s => ({
      date: s.endDate,
      revenue: s.totalRevenue ?? null,
      grossProfit: s.grossProfit ?? null,
      ebit: s.ebit ?? null,
      netIncome: s.netIncome ?? null,
      eps: s.basicEps ?? null,
    })).reverse();

    const quarterlyPL = (summary.incomeStatementHistoryQuarterly?.incomeStatementHistory || []).map(s => ({
      date: s.endDate,
      revenue: s.totalRevenue ?? null,
      grossProfit: s.grossProfit ?? null,
      netIncome: s.netIncome ?? null,
      eps: s.basicEps ?? null,
    })).reverse();

    const balanceSheet = (summary.balanceSheetHistory?.balanceSheetStatements || []).map(s => ({
      date: s.endDate,
      totalAssets: s.totalAssets ?? null,
      totalLiab: s.totalLiab ?? null,
      totalStockholderEquity: s.totalStockholderEquity ?? null,
      totalCurrentAssets: s.totalCurrentAssets ?? null,
      totalCurrentLiabilities: s.totalCurrentLiabilities ?? null,
      longTermDebt: s.longTermDebt ?? null,
      cash: s.cash ?? null,
    })).reverse();

    const cashFlow = (summary.cashflowStatementHistory?.cashflowStatements || []).map(s => ({
      date: s.endDate,
      operatingCashflow: s.totalCashFromOperatingActivities ?? null,
      investingCashflow: s.totalCashflowsFromInvestingActivities ?? null,
      financingCashflow: s.totalCashFromFinancingActivities ?? null,
      freeCashflow: s.freeCashFlow ?? null,
      capitalExpenditures: s.capitalExpenditures ?? null,
    })).reverse();

    const response = { annualPL, quarterlyPL, balanceSheet, cashFlow };
    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Financials error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ratios/:symbol — Key valuation & efficiency ratios
app.get('/api/ratios/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const cacheKey = `ratios:${symbol}`;
    const cached = getCached(cacheKey, 30 * 60 * 1000); // 30 min
    if (cached) return res.json(cached);

    const [summary, quote] = await Promise.all([
      yahooFinance.quoteSummary(symbol, {
        modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail'],
      }),
      yahooFinance.quote(symbol),
    ]);

    const ks = summary.defaultKeyStatistics || {};
    const fd = summary.financialData || {};
    const sd = summary.summaryDetail || {};

    const response = {
      marketCap: quote.marketCap ?? null,
      peRatio: sd.trailingPE ?? ks.forwardPE ?? null,
      pbRatio: ks.priceToBook ?? null,
      evToEbitda: ks.enterpriseToEbitda ?? null,
      bookValue: ks.bookValue ?? null,
      dividendYield: sd.dividendYield ? (sd.dividendYield * 100).toFixed(2) : null,
      roe: fd.returnOnEquity ? (fd.returnOnEquity * 100).toFixed(2) : null,
      roa: fd.returnOnAssets ? (fd.returnOnAssets * 100).toFixed(2) : null,
      debtToEquity: fd.debtToEquity ?? null,
      currentRatio: fd.currentRatio ?? null,
      quickRatio: fd.quickRatio ?? null,
      grossMargin: fd.grossMargins ? (fd.grossMargins * 100).toFixed(2) : null,
      operatingMargin: fd.operatingMargins ? (fd.operatingMargins * 100).toFixed(2) : null,
      netMargin: fd.profitMargins ? (fd.profitMargins * 100).toFixed(2) : null,
      revenueGrowth: fd.revenueGrowth ? (fd.revenueGrowth * 100).toFixed(2) : null,
      earningsGrowth: fd.earningsGrowth ? (fd.earningsGrowth * 100).toFixed(2) : null,
      beta: ks.beta ?? null,
      sharesOutstanding: ks.sharesOutstanding ?? null,
      float: ks.floatShares ?? null,
      faceValue: null,
    };

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Ratios error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/peers/:symbol — Peer / competitor stocks
app.get('/api/peers/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const cacheKey = `peers:${symbol}`;
    const cached = getCached(cacheKey, 60 * 60 * 1000); // 1 hour
    if (cached) return res.json(cached);

    // Get similar stocks from Yahoo Finance recommendations
    const recs = await yahooFinance.recommendationsBySymbol(symbol);
    const peers = (recs.recommendedSymbols || [])
      .map(r => r.symbol)
      .filter(s => s.endsWith('.NS') || s.endsWith('.BO'))
      .slice(0, 8);

    if (peers.length === 0) return res.json([]);

    const peerQuotes = await yahooFinance.quote(peers, { return: 'array' });

    const response = peerQuotes
      .filter(q => q && q.regularMarketPrice)
      .map(q => {
        const price = q.regularMarketPrice || 0;
        const prevClose = q.regularMarketPreviousClose || price;
        const change = q.regularMarketChange || (price - prevClose);
        const changePct = q.regularMarketChangePercent || (prevClose ? (change / prevClose) * 100 : 0);
        return {
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          marketCap: q.marketCap ?? null,
          peRatio: q.trailingPE ?? null,
          fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
          volume: q.regularMarketVolume ?? 0,
        };
      });

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Peers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shareholding/:symbol — Institutional & insider ownership
app.get('/api/shareholding/:symbol', async (req, res) => {
  try {
    const symbol = normaliseSymbol(req.params.symbol);
    const cacheKey = `shareholding:${symbol}`;
    const cached = getCached(cacheKey, 60 * 60 * 1000); // 1 hour
    if (cached) return res.json(cached);

    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['majorHoldersBreakdown', 'institutionOwnership', 'insiderHolders'],
    });

    const mh = summary.majorHoldersBreakdown || {};
    const inst = (summary.institutionOwnership?.ownershipList || []).slice(0, 10).map(h => ({
      name: h.organization,
      pctHeld: h.pctHeld ? (h.pctHeld * 100).toFixed(2) : null,
      shares: h.position ?? null,
      date: h.reportDate,
    }));

    const insiders = (summary.insiderHolders?.holders || []).slice(0, 5).map(h => ({
      name: h.name,
      relation: h.relation,
      shares: h.positionDirect ?? null,
      pctHeld: null,
    }));

    const response = {
      institutionsPercent: mh.institutionsPercentHeld ? (mh.institutionsPercentHeld * 100).toFixed(2) : null,
      insidersPercent: mh.insidersPercentHeld ? (mh.insidersPercentHeld * 100).toFixed(2) : null,
      institutionsFloatPercent: mh.institutionsFloatPercentHeld ? (mh.institutionsFloatPercentHeld * 100).toFixed(2) : null,
      topInstitutions: inst,
      insiders,
    };

    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Shareholding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Phase 2: Stock Screener Routes
// ─────────────────────────────────────────────

// Nifty 500 popular symbols (subset for demo)
const NIFTY500_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'SBIN', 'BAJFINANCE',
  'BHARTIARTL', 'KOTAKBANK', 'LT', 'AXISBANK', 'ITC', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA',
  'TITAN', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO', 'HCLTECH', 'TECHM', 'POWERGRID', 'NTPC',
  'ONGC', 'COALINDIA', 'GRASIM', 'JSWSTEEL', 'TATASTEEL', 'HINDALCO', 'ADANIENT', 'ADANIPORTS',
  'M&M', 'DIVISLAB', 'DRREDDY', 'CIPLA', 'HEROMOTOCO', 'BAJAJFINSV', 'BAJAJ-AUTO', 'BRITANNIA',
  'EICHERMOT', 'APOLLOHOSP', 'HDFCLIFE', 'SBILIFE', 'INDUSINDBK', 'PIDILITIND', 'NAUKRI', 'HAVELLS',
  'BERGEPAINT', 'TORNTPHARM', 'MUTHOOTFIN', 'BOSCHLTD', 'GODREJCP', 'DABUR', 'MARICO', 'COLPAL',
  'TATACONSUM', 'INDIGO', 'SIEMENS', 'ABB', 'ICICIGI', 'CHOLAFIN', 'MOTHERSON', 'GMRINFRA',
].map(s => `${s}.NS`);

// GET /api/screener/universe — Lightweight snapshot of Nifty 500 stocks
app.get('/api/screener/universe', async (req, res) => {
  try {
    const cacheKey = 'screener:universe';
    const cached = getCached(cacheKey, 15 * 60 * 1000); // 15 min
    if (cached) return res.json(cached);

    // Batch in chunks of 10 to avoid rate limits
    const CHUNK = 10;
    const results = [];
    for (let i = 0; i < NIFTY500_SYMBOLS.length; i += CHUNK) {
      const chunk = NIFTY500_SYMBOLS.slice(i, i + CHUNK);
      try {
        const quotes = await yahooFinance.quote(chunk, { return: 'array' });
        quotes.forEach(q => {
          if (!q || !q.regularMarketPrice) return;
          results.push({
            symbol: q.symbol.replace('.NS', '').replace('.BO', ''),
            name: q.shortName || q.longName || q.symbol,
            price: q.regularMarketPrice ?? 0,
            changePercent: q.regularMarketChangePercent ?? 0,
            marketCap: q.marketCap ?? null,
            peRatio: q.trailingPE ?? null,
            dividendYield: q.dividendYield ? (q.dividendYield * 100) : null,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
            volume: q.regularMarketVolume ?? 0,
            sector: q.sector ?? null,
          });
        });
      } catch (e) { /* skip failed chunk */ }
    }

    setCache(cacheKey, results);
    res.json(results);
  } catch (err) {
    console.error('Screener universe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/screener/run — Run a filter query against the universe
app.post('/api/screener/run', async (req, res) => {
  try {
    const { filters } = req.body; // [{ field, op, value }]
    const cacheKey = 'screener:universe';
    let universe = getCached(cacheKey, 15 * 60 * 1000);

    if (!universe) {
      return res.status(503).json({ error: 'Universe not loaded yet. Call /api/screener/universe first.' });
    }

    const fieldMap = {
      price: 'price', marketcap: 'marketCap', pe: 'peRatio', 'dividend yield': 'dividendYield',
      '52w high': 'fiftyTwoWeekHigh', '52w low': 'fiftyTwoWeekLow', volume: 'volume',
      change: 'changePercent',
    };

    const ops = {
      '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b,
      '<=': (a, b) => a <= b, '=': (a, b) => a === b
    };

    const results = universe.filter(stock => {
      if (!filters || filters.length === 0) return true;
      return filters.every(f => {
        const key = fieldMap[f.field?.toLowerCase()] || f.field;
        const val = stock[key];
        if (val == null) return false;
        const fn = ops[f.op];
        return fn ? fn(parseFloat(val), parseFloat(f.value)) : false;
      });
    });

    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Screener run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Red-Flag Detector & NL-to-Query Routes
// ─────────────────────────────────────────────

// POST /api/ai/red-flags
app.post('/api/ai/red-flags', async (req, res) => {
  try {
    const { symbol, ratios, financials, apiKey } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });
    const gemini = getAI(apiKey || process.env.GEMINI_API_KEY);
    const flags = await detectRedFlags(symbol, ratios, financials, gemini);
    res.json({ flags });
  } catch (err) {
    console.error('Red flags error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/nl-to-query — Natural Language → Screener DSL
app.post('/api/ai/nl-to-query', async (req, res) => {
  try {
    const { text, apiKey } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const gemini = getAI(apiKey || process.env.GEMINI_API_KEY);
    if (!gemini) return res.status(400).json({ error: 'AI key not configured' });

    const prompt = `You are a stock screener query builder for Indian equity markets.
Convert the user's natural language description into a stock screener DSL query.

Available fields (use EXACTLY as written): Price, Market Cap, PE, Dividend Yield, 52W High, 52W Low, Volume, Change, ROE, ROCE, Debt to Equity, Net Margin, Operating Margin, Revenue Growth, Earnings Growth, Beta, Book Value, Current Ratio, ROA

Operators: > < >= <= = AND OR ( )
Arithmetic on fields: field * number  (e.g. Price > 52W High * 0.85)

Rules:
- For Market Cap, use Crores × 10000000 (e.g. 1000 Cr = 10000000000)
- Output ONLY the raw DSL query string on a single line, no explanation
- If a concept cannot be expressed with available fields, omit it

Examples:
- "debt free smallcaps" → Debt to Equity < 0.1 AND Market Cap < 100000000000
- "high dividend large cap" → Dividend Yield > 3 AND Market Cap > 500000000000
- "near 52 week high momentum" → Price > 52W High * 0.9
- "undervalued quality" → PE < 20 AND ROE > 15 AND Debt to Equity < 1

User input: "${text}"

DSL:`;

    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: prompt,
    });

    const raw = (response.text || '').replace(/^DSL:/i, '').trim();
    const query = raw.split('\n')[0].trim();
    res.json({ query, original: text });
  } catch (err) {
    console.error('NL-to-query error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
