import WebSocket from 'ws';
import { GrowwAPI, LiveFeedSubscriptionType } from 'growwapi';

/*
  Groww API Client Manager
  Handles authentication and WebSocket streams for real-time market data.
  Now powered by the official 'growwapi' Node SDK!
*/

class GrowwClient {
  constructor() {
    this.apiKey = null;
    this.apiSecret = null;
    this.groww = null;
    this.isConnected = false;
    this.subscriptions = new Map(); // Map normSymbol -> subscription object or 'simulated'
    this.onTickCallback = null;
    
    // For demonstration/fallback when no real keys are provided
    this.simulators = new Map();
  }

  setCredentials(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    // growwapi SDK reads these from process.env internally
    process.env.GROWW_API_KEY = apiKey;
    process.env.GROWW_API_SECRET = apiSecret;
    if (apiKey && apiSecret) {
      this.groww = new GrowwAPI();
    }
  }

  onTick(callback) {
    this.onTickCallback = callback;
  }

  async authenticate() {
    if (!this.apiKey || !this.apiSecret) return false;
    
    try {
      console.log('[Groww] Authenticating and connecting to real WebSocket stream...');
      // By calling connect, growwapi internally fetches the TOTP and connects
      await this.groww.liveFeed.connect();
      this.isConnected = true;
      console.log('[Groww] WebSocket connected to real Groww stream!');
      this.resubscribeAll();
      return true;
    } catch (error) {
      console.error('[Groww] Authentication/Connection failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async subscribe(symbol, basePrice = 1000) {
    const normSymbol = symbol.replace('.NS', '').replace('.BO', '');
    
    if (this.isConnected) {
      try {
        // Find the exchange token for the symbol from Groww's instrument list
        const instructions = await this.groww.instructions.getFilteredInstructions({ tradingSymbol: normSymbol });
        
        if (instructions && instructions.length > 0) {
          const exchangeToken = instructions[0].exchangeToken;
          
          const sub = await this.groww.liveFeed.subscribe(LiveFeedSubscriptionType.Price, exchangeToken);
          if (sub) {
            sub.consume((data) => {
              if (this.onTickCallback && data && data.priceData) {
                this.onTickCallback({
                  symbol: `${normSymbol}.NS`,
                  price: parseFloat(data.priceData.price),
                  timestamp: Date.now(),
                  type: 'live_tick'
                });
              }
            });
            this.subscriptions.set(normSymbol, sub);
            console.log(`[Groww] Subscribed to real live feed for ${normSymbol}`);
          }
        } else {
          console.error(`[Groww] Could not find instructions/exchangeToken for ${normSymbol}`);
          // Fallback to simulation if token is missing
          this.fallbackSimulation(normSymbol, basePrice);
        }
      } catch (err) {
        console.error(`[Groww] Error subscribing to ${normSymbol}:`, err.message);
        this.fallbackSimulation(normSymbol, basePrice);
      }
    } else {
      // Start simulation if no real websocket
      this.fallbackSimulation(normSymbol, basePrice);
    }
  }
  
  fallbackSimulation(normSymbol, basePrice) {
    this.subscriptions.set(normSymbol, 'simulated');
    this.startSimulation(normSymbol, basePrice);
    console.log(`[Groww] Subscribed to simulation for ${normSymbol}`);
  }

  unsubscribe(symbol) {
    const normSymbol = symbol.replace('.NS', '').replace('.BO', '');
    const sub = this.subscriptions.get(normSymbol);
    
    if (sub && sub !== 'simulated') {
      sub.unsubscribe();
    } else if (sub === 'simulated') {
      this.stopSimulation(normSymbol);
    }
    this.subscriptions.delete(normSymbol);
    console.log(`[Groww] Unsubscribed from ${normSymbol}`);
  }

  resubscribeAll() {
    // Collect keys to re-subscribe and clear the map so we don't duplicate
    const currentSymbols = Array.from(this.subscriptions.keys());
    this.subscriptions.clear();
    
    for (const sym of currentSymbols) {
      this.subscribe(sym); // This will handle real vs simulated internally
    }
  }

  // ─── Simulation Fallback (To test UI without real API keys) ───
  startSimulation(symbol, basePrice) {
    if (this.simulators.has(symbol)) return;
    
    let currentPrice = basePrice;
    
    // Stream a tick every 1-3 seconds
    const loop = () => {
      if (!this.subscriptions.has(symbol)) {
        this.stopSimulation(symbol);
        return;
      }
      
      // Random price movement (-0.2% to +0.2%)
      const changePercent = (Math.random() * 0.4) - 0.2;
      currentPrice = currentPrice * (1 + (changePercent / 100));
      
      if (this.onTickCallback) {
        this.onTickCallback({
          symbol: `${symbol}.NS`, // Map back to Yahoo format for UI consistency
          price: parseFloat(currentPrice.toFixed(2)),
          timestamp: Date.now(),
          type: 'live_tick'
        });
      }
      
      const nextDelay = 1000 + Math.random() * 2000;
      const timeoutId = setTimeout(loop, nextDelay);
      this.simulators.set(symbol, { timeoutId, price: currentPrice });
    };
    
    loop();
  }
  
  stopSimulation(symbol) {
    const sim = this.simulators.get(symbol);
    if (sim) {
      clearTimeout(sim.timeoutId);
      this.simulators.delete(symbol);
    }
  }
  
  updateSimulationBasePrice(symbol, basePrice) {
    const normSymbol = symbol.replace('.NS', '');
    const sim = this.simulators.get(normSymbol);
    if (sim) {
      sim.price = basePrice;
    } else if (this.subscriptions.has(normSymbol) && this.subscriptions.get(normSymbol) === 'simulated') {
      this.startSimulation(normSymbol, basePrice);
    }
  }
}

export const growwClient = new GrowwClient();
