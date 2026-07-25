import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/*
  Yahoo Finance Polling Client
  Provides a WebSocket-like interface for the rest of the application,
  but internally batches symbols and polls Yahoo Finance every 5 seconds
  to avoid rate limits and IP bans.
*/

class YahooClient {
  constructor() {
    this.subscriptions = new Set();
    this.onTickCallback = null;
    this.intervalId = null;
    this.POLL_INTERVAL_MS = 5000; // 5 seconds
  }

  onTick(callback) {
    this.onTickCallback = callback;
  }

  subscribe(symbol) {
    const normSymbol = symbol.toUpperCase().trim();
    this.subscriptions.add(normSymbol);
    console.log(`[YahooClient] Subscribed to ${normSymbol}`);
    
    // Start polling if not already started
    if (!this.intervalId) {
      this.startPolling();
    }
    
    // Fetch an immediate quote for this new symbol so the UI updates instantly
    this.fetchQuotes([normSymbol]);
  }

  unsubscribe(symbol) {
    const normSymbol = symbol.toUpperCase().trim();
    this.subscriptions.delete(normSymbol);
    console.log(`[YahooClient] Unsubscribed from ${normSymbol}`);
    
    if (this.subscriptions.size === 0 && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log(`[YahooClient] Stopped polling (no subscriptions)`);
    }
  }

  startPolling() {
    console.log(`[YahooClient] Started polling every ${this.POLL_INTERVAL_MS}ms`);
    this.intervalId = setInterval(() => {
      if (this.subscriptions.size > 0) {
        this.fetchQuotes(Array.from(this.subscriptions));
      }
    }, this.POLL_INTERVAL_MS);
  }

  async fetchQuotes(symbols) {
    if (!symbols || symbols.length === 0) return;
    try {
      // Fetch quotes in batch. suppressNotFound prevents errors if a symbol is invalid.
      const quotes = await yahooFinance.quote(symbols, { return: 'array' });
      
      if (this.onTickCallback) {
        for (const q of quotes) {
          if (q && q.symbol && q.regularMarketPrice) {
            this.onTickCallback({
              symbol: q.symbol,
              price: parseFloat(q.regularMarketPrice.toFixed(2)),
              timestamp: Date.now(),
              type: 'live_tick'
            });
          }
        }
      }
    } catch (err) {
      console.error('[YahooClient] Bulk quote fetch error:', err.message);
    }
  }
}

export const yahooClient = new YahooClient();
