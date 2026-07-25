/* ═══════════════════════════════════════════════════════════
   API Client — Fetch wrapper for backend endpoints
   ═══════════════════════════════════════════════════════════ */

const API = (() => {
  const BASE = window.location.origin;

  async function request(path, options = {}) {
    try {
      const url = `${BASE}${path}`;
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`API Error [${path}]:`, err);
      throw err;
    }
  }

  let socket = null;
  let tickCallbacks = [];

  function initSocket() {
    if (!window.io) return;
    
    if (socket) return socket;

    socket = window.io(BASE);

    socket.on('connect', () => {
      console.log('⚡ WebSocket connected');
    });

    socket.on('live_tick', (data) => {
      tickCallbacks.forEach(cb => cb(data));
    });

    return socket;
  }

  return {
    // Get real-time quote for a stock
    getQuote(symbol) {
      return request(`/api/quote/${encodeURIComponent(symbol)}`);
    },

    // Get historical chart data
    getChart(symbol, range = '1mo') {
      return request(`/api/chart/${encodeURIComponent(symbol)}?range=${range}`);
    },

    // Search stocks by name/symbol
    search(query) {
      return request(`/api/search?q=${encodeURIComponent(query)}`);
    },

    // Get market indices summary
    getMarketSummary() {
      return request('/api/market/summary');
    },

    // AI-powered stock analysis
    analyzeStock(symbol, stockData, apiKey) {
      return request('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ symbol, stockData, apiKey }),
      });
    },

    // AI chat
    chat(message, context = '', history = [], apiKey = null, attachments = []) {
      return request('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, context, history, apiKey, attachments }),
      });
    },

    // Configure API key
    setApiKey(apiKey) {
      return request('/api/config/apikey', {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
    },

    // ─── WebSockets ───
    initSocket,
    
    onTick(callback) {
      tickCallbacks.push(callback);
    },

    subscribe(symbol, basePrice) {
      if (socket) socket.emit('subscribe', { symbol, basePrice });
    },

    unsubscribe(symbol) {
      if (socket) socket.emit('unsubscribe', { symbol });
    }
  };
})();
