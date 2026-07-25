/* ═══════════════════════════════════════════════════════════
   App — Core SPA logic, routing, state, watchlist
   ═══════════════════════════════════════════════════════════ */

const StockPulseApp = (() => {
  // ─── State ───
  let currentView = 'dashboard';
  let currentStock = null;
  let currentQuote = null;
  let currentRange = '1mo';
  let watchlist = [];
  let searchTimeout = null;
  let refreshInterval = null;

  const DEFAULT_STOCKS = [
    'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS',
    'HINDUNILVR.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'KOTAKBANK.NS',
    'LT.NS', 'AXISBANK.NS', 'BAJFINANCE.NS', 'MARUTI.NS', 'WIPRO.NS',
  ];

  const POPULAR_DISPLAY = [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy' },
    { symbol: 'INFY.NS', name: 'Infosys' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
    { symbol: 'SBIN.NS', name: 'State Bank of India' },
    { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' },
    { symbol: 'ITC.NS', name: 'ITC Ltd' },
    { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever' },
    { symbol: 'LT.NS', name: 'Larsen & Toubro' },
    { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance' },
    { symbol: 'WIPRO.NS', name: 'Wipro' },
  ];

  // ─── Helpers ───
  function formatINR(num) {
    if (num == null) return '—';
    return '₹' + Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatLargeNumber(num) {
    if (num == null) return '—';
    if (num >= 1e7) return '₹' + (num / 1e7).toFixed(2) + ' Cr';
    if (num >= 1e5) return '₹' + (num / 1e5).toFixed(2) + ' L';
    return num.toLocaleString('en-IN');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 300); }, 3500);
  }

  // ─── Navigation ───
  let screenerInited = false;

  function navigateTo(view, data) {
    currentView = view;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`${view}-view`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navItem) navItem.classList.add('active');

    // Close mobile sidebar
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');

    // View-specific actions
    if (view === 'stock' && data?.symbol) {
      loadStock(data.symbol);
    } else if (view === 'watchlist') {
      renderWatchlistFull();
    } else if (view === 'screener') {
      if (!screenerInited && typeof Screener !== 'undefined') {
        Screener.init();
        screenerInited = true;
      }
    }
  }

  // ─── Company Tab Bar ───
  let activeCompanyTab = 'chart';
  let financialsData = null;
  let ratiosData = null;
  let peersData = null;
  let shareholdingData = null;

  function initCompanyTabBar() {
    document.getElementById('company-tab-bar')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ctab');
      if (!btn) return;
      const tab = btn.dataset.ctab;
      if (!tab || tab === activeCompanyTab) return;

      document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.ctab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`ctab-${tab}`)?.classList.add('active');
      activeCompanyTab = tab;

      if (!currentStock) return;

      // Lazy-load panel data
      if ((tab === 'ratios' || tab === 'pros-cons') && !ratiosData) {
        try {
          document.getElementById('ratios-content').innerHTML = '<div class="fin-loading">Loading ratios...</div>';
          document.getElementById('pros-cons-content').innerHTML = '<div class="fin-loading">Generating insights...</div>';
          ratiosData = await (await fetch(`/api/ratios/${currentStock}`)).json();
        } catch(e) { ratiosData = null; }
      }
      if (tab === 'ratios') {
        document.getElementById('ratios-content').innerHTML = Financials.renderRatios(ratiosData);
      }
      if (tab === 'pros-cons') {
        if (!financialsData) {
          try { financialsData = await (await fetch(`/api/financials/${currentStock}`)).json(); } catch(e) { financialsData = null; }
        }
        document.getElementById('pros-cons-content').innerHTML = Financials.renderProsCons(ratiosData, financialsData);
      }

      if (tab === 'peers' && !peersData) {
        document.getElementById('peers-content').innerHTML = '<div class="fin-loading">Loading peers...</div>';
        try { peersData = await (await fetch(`/api/peers/${currentStock}`)).json(); } catch(e) { peersData = []; }
        const peersSym = currentStock.replace('.NS', '').replace('.BO', '');
        document.getElementById('peers-content').innerHTML = Peers.renderPeers(peersData, peersSym);
        // Click to navigate
        document.getElementById('peers-content')?.querySelectorAll('[data-symbol]').forEach(row => {
          row.addEventListener('click', () => {
            const s = row.dataset.symbol;
            if (s) loadStock(`${s}.NS`);
          });
        });
      }

      if ((tab === 'quarterly' || tab === 'annual' || tab === 'balance' || tab === 'cashflow') && !financialsData) {
        document.getElementById(`${tab}-content`).innerHTML = '<div class="fin-loading">Loading financials...</div>';
        try { financialsData = await (await fetch(`/api/financials/${currentStock}`)).json(); } catch(e) { financialsData = null; }
      }
      if (tab === 'quarterly') document.getElementById('quarterly-content').innerHTML = Financials.renderQuarterlyPL(financialsData);
      if (tab === 'annual') document.getElementById('annual-content').innerHTML = Financials.renderAnnualPL(financialsData);
      if (tab === 'balance') document.getElementById('balance-content').innerHTML = Financials.renderBalanceSheet(financialsData);
      if (tab === 'cashflow') document.getElementById('cashflow-content').innerHTML = Financials.renderCashFlow(financialsData);

      if (tab === 'shareholding' && !shareholdingData) {
        document.getElementById('shareholding-content').innerHTML = '<div class="fin-loading">Loading shareholding...</div>';
        try { shareholdingData = await (await fetch(`/api/shareholding/${currentStock}`)).json(); } catch(e) { shareholdingData = null; }
        document.getElementById('shareholding-content').innerHTML = Financials.renderShareholding(shareholdingData);
      }
    });
  }

  // ─── Search ───
  function initSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) return;

    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = input.value.trim();
      if (query.length < 2) {
        results.classList.remove('active');
        return;
      }
      results.innerHTML = '<div class="search-loading">Searching...</div>';
      results.classList.add('active');

      searchTimeout = setTimeout(async () => {
        try {
          const data = await API.search(query);
          if (data.length === 0) {
            results.innerHTML = '<div class="search-empty">No stocks found</div>';
          } else {
            results.innerHTML = data.map(s => `
              <div class="search-result-item" data-symbol="${s.symbol}">
                <div>
                  <span class="search-result-symbol">${s.symbol.replace('.NS', '').replace('.BO', '')}</span>
                  <span class="search-result-name">${s.shortName}</span>
                </div>
                <span class="search-result-exchange">${s.exchange || 'NSE'}</span>
              </div>
            `).join('');

            results.querySelectorAll('.search-result-item').forEach(item => {
              item.addEventListener('click', () => {
                const symbol = item.dataset.symbol;
                results.classList.remove('active');
                input.value = '';
                navigateTo('stock', { symbol });
              });
            });
          }
        } catch (err) {
          results.innerHTML = `<div class="search-empty">Error: ${err.message}</div>`;
        }
      }, 400);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-wrapper')) results.classList.remove('active');
    });

    // Keyboard shortcut: /
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input && !e.target.closest('input, textarea')) {
        e.preventDefault();
        input.focus();
      }
      if (e.key === 'Escape') {
        results.classList.remove('active');
        input.blur();
      }
    });
  }

  // ─── Load Market Summary ───
  async function loadMarketSummary() {
    try {
      const indices = await API.getMarketSummary();
      const strip = document.getElementById('indices-strip');
      if (!strip || !indices.length) return;

      strip.innerHTML = indices.map(idx => {
        const isPositive = idx.change >= 0;
        return `
          <div class="index-card">
            <div class="index-name">${idx.name}</div>
            <div class="index-price">${Number(idx.price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div class="index-change ${isPositive ? 'positive' : 'negative'}">
              ${isPositive ? '▲' : '▼'} ${Math.abs(idx.change).toFixed(2)} (${isPositive ? '+' : ''}${idx.changePercent}%)
            </div>
          </div>
        `;
      }).join('');

      // Update market status
      updateMarketStatus();
    } catch (err) {
      console.error('Market summary error:', err);
    }
  }

  function updateMarketStatus() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const day = now.getDay();
    const timeInMinutes = hours * 60 + minutes;

    // NSE: Mon-Fri, 9:15 AM - 3:30 PM IST
    const isOpen = day >= 1 && day <= 5 && timeInMinutes >= 555 && timeInMinutes <= 930;
    const statusEl = document.getElementById('market-status');
    if (statusEl) {
      statusEl.className = `market-status ${isOpen ? 'open' : ''}`;
      statusEl.querySelector('.status-text').textContent = isOpen ? 'Market Open' : 'Market Closed';
    }
  }

  // ─── Load Stock ───
  async function loadStock(symbol) {
    currentStock = symbol;
    // Reset cached deep-dive data when switching stocks
    financialsData = null;
    ratiosData = null;
    peersData = null;
    shareholdingData = null;
    // Reset tab to chart
    document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
    document.querySelector('.ctab[data-ctab="chart"]')?.classList.add('active');
    document.querySelectorAll('.ctab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('ctab-chart')?.classList.add('active');
    activeCompanyTab = 'chart';

    // Update UI with loading state
    document.getElementById('stock-name').textContent = symbol.replace('.NS', '').replace('.BO', '');
    document.getElementById('stock-symbol').textContent = symbol;
    document.getElementById('stock-price').textContent = 'Loading...';
    document.getElementById('stock-change').textContent = '—';
    document.getElementById('stock-change').className = 'stock-change neutral';

    try {
      // Fetch quote and chart in parallel
      const [quote, chartData] = await Promise.all([
        API.getQuote(symbol),
        API.getChart(symbol, currentRange),
      ]);

      currentQuote = quote;

      // Update header
      document.getElementById('stock-name').textContent = quote.shortName || symbol;
      document.getElementById('stock-symbol').textContent = quote.symbol;
      document.getElementById('stock-price').textContent = formatINR(quote.price);

      const isPositive = quote.change >= 0;
      const changeEl = document.getElementById('stock-change');
      changeEl.textContent = `${isPositive ? '+' : ''}${quote.change.toFixed(2)} (${isPositive ? '+' : ''}${quote.changePercent.toFixed(2)}%)`;
      changeEl.className = `stock-change ${isPositive ? 'positive' : 'negative'}`;

      document.getElementById('stock-exchange').textContent = `${quote.exchange} · ${quote.currency}`;
      document.getElementById('stock-market-state').textContent = quote.marketState === 'REGULAR' ? '🟢 Live' : '🔴 Closed';

      // Stats
      document.getElementById('stat-day-low').textContent = formatINR(quote.dayLow);
      document.getElementById('stat-day-high').textContent = formatINR(quote.dayHigh);
      document.getElementById('stat-volume').textContent = formatLargeNumber(quote.volume);
      document.getElementById('stat-52w-low').textContent = formatINR(quote.fiftyTwoWeekLow);
      document.getElementById('stat-52w-high').textContent = formatINR(quote.fiftyTwoWeekHigh);
      document.getElementById('stat-prev-close').textContent = formatINR(quote.previousClose);

      // Watchlist button
      updateWatchlistButton(symbol);

      // Charts
      const chartOptions = {
        showSMA: document.getElementById('toggle-sma')?.checked,
        showEMA: document.getElementById('toggle-ema')?.checked,
        showBB: document.getElementById('toggle-bb')?.checked,
      };

      if (chartData.candles.length > 0) {
        console.log('Rendering charts with', chartData.candles.length, 'candles');
        StockCharts.renderAll(chartData.candles, currentRange, chartOptions);

        // Technical signals
        const closes = chartData.candles.map(c => c.close);
        renderSignals(closes);
        
        // Subscribe to real-time updates
        API.subscribe(symbol, quote.price);
      }

    } catch (err) {
      console.error('Load stock error:', err);
      document.getElementById('stock-price').textContent = 'Error';
      showToast(`Failed to load ${symbol}: ${err.message}`, 'error');
    }
  }

  // ─── Live Tick Handler ───
  function handleLiveTick(tick) {
    // 1. Update Watchlist Tiles
    const tiles = document.querySelectorAll(`[data-symbol="${tick.symbol}"]`);
    tiles.forEach(tile => {
      const priceEl = tile.querySelector('.tile-price');
      if (!priceEl) return;
      
      const oldStr = priceEl.textContent.replace(/[^\d.-]/g, '');
      const oldPrice = parseFloat(oldStr) || 0;
      
      if (oldPrice !== tick.price) {
        priceEl.textContent = formatINR(tick.price);
        // Flash animation
        const isUp = tick.price > oldPrice;
        tile.classList.add(isUp ? 'flash-up' : 'flash-down');
        setTimeout(() => {
          tile.classList.remove('flash-up', 'flash-down');
        }, 600);
      }
    });

    // 2. Update Current Stock Detail
    if (currentStock === tick.symbol && currentQuote) {
      const priceEl = document.getElementById('stock-price');
      const changeEl = document.getElementById('stock-change');
      
      const oldPrice = currentQuote.price;
      currentQuote.price = tick.price;
      currentQuote.change = tick.price - currentQuote.previousClose;
      currentQuote.changePercent = (currentQuote.change / currentQuote.previousClose) * 100;

      if (oldPrice !== tick.price) {
        priceEl.textContent = formatINR(tick.price);
        const isPos = currentQuote.change >= 0;
        changeEl.textContent = `${isPos ? '+' : ''}${currentQuote.change.toFixed(2)} (${isPos ? '+' : ''}${currentQuote.changePercent.toFixed(2)}%)`;
        changeEl.className = `stock-change ${isPos ? 'positive' : 'negative'}`;

        // Flash animation
        const isUp = tick.price > oldPrice;
        priceEl.classList.add(isUp ? 'flash-text-up' : 'flash-text-down');
        setTimeout(() => {
          priceEl.classList.remove('flash-text-up', 'flash-text-down');
        }, 600);
        
        // Push tick to chart
        if (StockCharts.appendLiveTick) {
          StockCharts.appendLiveTick(tick.price, tick.timestamp);
        }
      }
    }
  }

  // ─── Render Signals ───
  function renderSignals(closes) {
    const result = Indicators.generateSignals(closes);
    const { overall, confidence, signals } = result;
    const counts = result.counts || { buy: 0, hold: 0, sell: 0 };

    // Verdict
    const verdictEl = document.getElementById('signal-verdict');
    if (!verdictEl) return;
    verdictEl.textContent = overall;
    verdictEl.className = `signal-verdict ${overall.toLowerCase()}`;

    // Confidence
    const confEl = document.getElementById('signal-confidence');
    if (confEl) confEl.textContent =
      `${counts.buy} Buy · ${counts.hold} Hold · ${counts.sell} Sell`;

    // Gauge rotation (BUY = left/green, SELL = right/red)
    const gauge = document.getElementById('gauge-fill');
    let rotation = 0; // HOLD = top
    if (overall === 'BUY') rotation = -60 - (confidence * 60);
    else if (overall === 'SELL') rotation = 60 + (confidence * 60);
    if (gauge) gauge.style.transform = `rotate(${rotation}deg)`;

    // Signal breakdown
    const breakdown = document.getElementById('signal-breakdown');
    breakdown.innerHTML = Object.entries(signals).map(([name, sig]) => `
      <div class="signal-row">
        <span class="indicator-name">${name}</span>
        <span class="signal-badge ${sig.signal.toLowerCase()}">${sig.signal}</span>
      </div>
    `).join('');
  }

  // ─── AI Analysis ───
  async function runAIAnalysis() {
    if (!currentStock || !currentQuote) {
      showToast('Select a stock first', 'warning');
      return;
    }

    const apiKey = localStorage.getItem('stockpulse_gemini_key') || null;

    const label = document.getElementById('ai-analysis-label');
    const container = document.getElementById('ai-analysis');
    label.style.display = 'block';
    container.style.display = 'block';
    container.innerHTML = '<div class="ai-analysis-loading"><div class="ai-spinner"></div> Analyzing with Gemini AI...</div>';

    try {
      // Get current signals for context
      let indicators = null;
      try {
        const chartData = await API.getChart(currentStock, '3mo');
        const closes = chartData.candles.map(c => c.close);
        const signalResult = Indicators.generateSignals(closes);
        indicators = {
          overallSignal: signalResult.overall,
          signals: Object.fromEntries(Object.entries(signalResult.signals).map(([k, v]) => [k, `${v.signal} (${v.reason})`])),
        };
      } catch (e) { /* ignore */ }

      const analysis = await API.analyzeStock(currentStock, { ...currentQuote, indicators }, apiKey);

      container.innerHTML = renderAIAnalysis(analysis);
    } catch (err) {
      container.innerHTML = `<div style="padding:20px; color:var(--color-loss);">❌ AI Analysis failed: ${err.message}</div>`;
    }
  }

  function renderAIAnalysis(a) {
    const signal = (a.signal || 'HOLD').toUpperCase();
    const conf = a.confidence != null ? Math.round(a.confidence * 100) : '—';

    return `
      <div class="ai-result-header">
        <span class="ai-signal-badge ${signal.toLowerCase()}">${signal}</span>
        <div class="ai-confidence">Confidence: <strong>${conf}%</strong> · ${a.timeHorizon || ''}</div>
      </div>
      <div class="ai-summary">${a.summary || 'No summary available.'}</div>
      <div class="ai-grid">
        <div>
          <div class="ai-list-title strengths">💪 Strengths</div>
          <ul class="ai-list strengths">
            ${(a.strengths || []).map(s => `<li>${s}</li>`).join('') || '<li>No data</li>'}
          </ul>
        </div>
        <div>
          <div class="ai-list-title risks">⚠️ Risks</div>
          <ul class="ai-list risks">
            ${(a.risks || []).map(r => `<li>${r}</li>`).join('') || '<li>No data</li>'}
          </ul>
        </div>
      </div>
      <div class="ai-targets">
        <div class="ai-target">
          <div class="target-label">Target Price</div>
          <div class="target-value" style="color:var(--color-gain)">${a.targetPrice ? formatINR(a.targetPrice) : '—'}</div>
        </div>
        <div class="ai-target">
          <div class="target-label">Stop Loss</div>
          <div class="target-value" style="color:var(--color-loss)">${a.stopLoss ? formatINR(a.stopLoss) : '—'}</div>
        </div>
        <div class="ai-target">
          <div class="target-label">Support</div>
          <div class="target-value">${a.support ? formatINR(a.support) : '—'}</div>
        </div>
        <div class="ai-target">
          <div class="target-label">Resistance</div>
          <div class="target-value">${a.resistance ? formatINR(a.resistance) : '—'}</div>
        </div>
      </div>
      <div class="ai-disclaimer">⚠️ This analysis is AI-generated and should not be considered financial advice. Always do your own research before investing.</div>
    `;
  }

  // ─── Watchlist ───
  function loadWatchlist() {
    try {
      const saved = localStorage.getItem('stockpulse_watchlist');
      watchlist = saved ? JSON.parse(saved) : [];
    } catch { watchlist = []; }
    updateWatchlistCount();
  }

  function saveWatchlist() {
    localStorage.setItem('stockpulse_watchlist', JSON.stringify(watchlist));
    updateWatchlistCount();
  }

  function updateWatchlistCount() {
    const el = document.getElementById('watchlist-count');
    if (el) el.textContent = watchlist.length;
  }

  function toggleWatchlist(symbol) {
    const idx = watchlist.indexOf(symbol);
    if (idx >= 0) {
      watchlist.splice(idx, 1);
      showToast(`${symbol.replace('.NS', '')} removed from watchlist`, 'info');
    } else {
      watchlist.push(symbol);
      showToast(`${symbol.replace('.NS', '')} added to watchlist`, 'success');
    }
    saveWatchlist();
    updateWatchlistButton(symbol);
    renderDashboardWatchlist();
  }

  function updateWatchlistButton(symbol) {
    const star = document.getElementById('watchlist-star');
    const btn = document.getElementById('btn-watchlist-toggle');
    if (star && btn) {
      const isInList = watchlist.includes(symbol);
      star.textContent = isInList ? '★' : '☆';
      btn.style.borderColor = isInList ? 'var(--color-hold)' : '';
      btn.style.color = isInList ? 'var(--color-hold)' : '';
    }
  }

  // ─── Render watchlist on dashboard ───
  async function renderDashboardWatchlist() {
    const grid = document.getElementById('dashboard-watchlist');
    const hint = document.getElementById('empty-watchlist-hint');
    if (!grid) return;

    if (watchlist.length === 0) {
      grid.innerHTML = '';
      if (hint) {
        grid.appendChild(hint);
        hint.style.display = 'block';
      }
      return;
    }
    if (hint) hint.style.display = 'none';

    // Render placeholder tiles first
    grid.innerHTML = watchlist.map(sym => `
      <div class="watchlist-tile" data-symbol="${sym}" id="tile-${sym.replace('.', '-')}">
        <div class="tile-symbol">${sym.replace('.NS', '').replace('.BO', '')}</div>
        <div class="tile-name">Loading...</div>
        <div class="tile-price">—</div>
        <div class="tile-change">—</div>
        <button class="tile-remove" data-symbol="${sym}" title="Remove">✕</button>
      </div>
    `).join('');

    // Add click handlers
    grid.querySelectorAll('.watchlist-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        if (e.target.classList.contains('tile-remove')) {
          e.stopPropagation();
          toggleWatchlist(tile.dataset.symbol);
          return;
        }
        navigateTo('stock', { symbol: tile.dataset.symbol });
      });
    });

    // Fetch quotes in parallel
    watchlist.forEach(async (sym) => {
      try {
        const q = await API.getQuote(sym);
        const tile = document.getElementById(`tile-${sym.replace('.', '-')}`);
        if (!tile) return;

        const isPos = q.change >= 0;
        tile.querySelector('.tile-name').textContent = q.shortName || sym;
        tile.querySelector('.tile-price').textContent = formatINR(q.price);
        const changeEl = tile.querySelector('.tile-change');
        changeEl.textContent = `${isPos ? '+' : ''}${q.change.toFixed(2)} (${isPos ? '+' : ''}${q.changePercent.toFixed(2)}%)`;
        changeEl.className = `tile-change ${isPos ? 'positive' : 'negative'}`;
      } catch (err) {
        const tile = document.getElementById(`tile-${sym.replace('.', '-')}`);
        if (tile) tile.querySelector('.tile-name').textContent = 'Error loading';
      }
    });
    
    // Subscribe to live updates for all watchlist items
    watchlist.forEach(sym => API.subscribe(sym, 1000));
  }

  // Full watchlist view
  async function renderWatchlistFull() {
    const grid = document.getElementById('watchlist-full-grid');
    const empty = document.getElementById('watchlist-empty');
    if (!grid) return;

    if (watchlist.length === 0) {
      grid.innerHTML = '';
      if (empty) grid.appendChild(empty);
      return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = watchlist.map(sym => `
      <div class="watchlist-tile" data-symbol="${sym}" id="wl-${sym.replace('.', '-')}">
        <div class="tile-symbol">${sym.replace('.NS', '').replace('.BO', '')}</div>
        <div class="tile-name">Loading...</div>
        <div class="tile-price">—</div>
        <div class="tile-change">—</div>
        <button class="tile-remove" data-symbol="${sym}" title="Remove">✕</button>
      </div>
    `).join('');

    grid.querySelectorAll('.watchlist-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        if (e.target.classList.contains('tile-remove')) {
          e.stopPropagation();
          toggleWatchlist(tile.dataset.symbol);
          renderWatchlistFull();
          return;
        }
        navigateTo('stock', { symbol: tile.dataset.symbol });
      });
    });

    watchlist.forEach(async (sym) => {
      try {
        const q = await API.getQuote(sym);
        const tile = document.getElementById(`wl-${sym.replace('.', '-')}`);
        if (!tile) return;
        const isPos = q.change >= 0;
        tile.querySelector('.tile-name').textContent = q.shortName || sym;
        tile.querySelector('.tile-price').textContent = formatINR(q.price);
        const changeEl = tile.querySelector('.tile-change');
        changeEl.textContent = `${isPos ? '+' : ''}${q.change.toFixed(2)} (${isPos ? '+' : ''}${q.changePercent.toFixed(2)}%)`;
        changeEl.className = `tile-change ${isPos ? 'positive' : 'negative'}`;
      } catch (err) {
        const tile = document.getElementById(`wl-${sym.replace('.', '-')}`);
        if (tile) tile.querySelector('.tile-name').textContent = 'Error loading';
      }
    });
    
    // Subscribe to live updates
    watchlist.forEach(sym => API.subscribe(sym, 1000));
  }

  // ─── Popular Stocks ───
  function renderPopularStocks() {
    const grid = document.getElementById('popular-grid');
    if (!grid) return;
    grid.innerHTML = POPULAR_DISPLAY.map(s => `
      <div class="popular-chip" data-symbol="${s.symbol}">
        <span class="chip-symbol">${s.symbol.replace('.NS', '')}</span>
        <span class="chip-arrow">→</span>
      </div>
    `).join('');

    grid.querySelectorAll('.popular-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        navigateTo('stock', { symbol: chip.dataset.symbol });
      });
    });
  }

  // ─── Settings ───
  function initSettings() {
    // Load saved API key
    const savedKey = localStorage.getItem('stockpulse_gemini_key');
    const input = document.getElementById('settings-api-key');
    if (input && savedKey) input.value = savedKey;

    document.getElementById('btn-save-api-key')?.addEventListener('click', async () => {
      const key = document.getElementById('settings-api-key')?.value?.trim();
      const status = document.getElementById('api-key-status');
      if (!key) {
        if (status) { status.textContent = '❌ Please enter an API key'; status.className = 'settings-status error'; }
        return;
      }
      try {
        await API.setApiKey(key);
        localStorage.setItem('stockpulse_gemini_key', key);
        if (status) { status.textContent = '✅ API key saved successfully!'; status.className = 'settings-status success'; }
        showToast('Gemini API key configured!', 'success');
      } catch (err) {
        if (status) { status.textContent = `❌ Error: ${err.message}`; status.className = 'settings-status error'; }
      }
    });

    // Load defaults
    document.getElementById('btn-load-defaults')?.addEventListener('click', () => {
      DEFAULT_STOCKS.forEach(sym => {
        if (!watchlist.includes(sym)) watchlist.push(sym);
      });
      saveWatchlist();
      renderDashboardWatchlist();
      showToast('Default Nifty 50 stocks loaded!', 'success');
    });

    // Auto-refresh toggle
    const autoRefresh = document.getElementById('toggle-auto-refresh');
    if (autoRefresh) {
      autoRefresh.addEventListener('change', (e) => {
        if (e.target.checked) startAutoRefresh();
        else stopAutoRefresh();
      });
    }
  }

  // ─── Auto-refresh ───
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(() => {
      if (currentView === 'dashboard') {
        loadMarketSummary();
        renderDashboardWatchlist();
      } else if (currentView === 'stock' && currentStock) {
        loadStock(currentStock);
      }
    }, 30000);
  }

  function stopAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = null;
  }

  // ─── Get current stock context for AI ───
  function getCurrentStockContext() {
    if (!currentQuote) return '';
    return `Currently viewing: ${currentQuote.shortName} (${currentQuote.symbol})
Price: ₹${currentQuote.price}, Change: ${currentQuote.change > 0 ? '+' : ''}${currentQuote.change} (${currentQuote.changePercent}%)
Day Range: ₹${currentQuote.dayLow} - ₹${currentQuote.dayHigh}
52W Range: ₹${currentQuote.fiftyTwoWeekLow || 'N/A'} - ₹${currentQuote.fiftyTwoWeekHigh || 'N/A'}
Volume: ${currentQuote.volume?.toLocaleString('en-IN') || 'N/A'}`;
  }

  // ─── Chart Controls ───
  function initChartControls() {
    // Range tabs
    document.getElementById('range-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.range) return;

      document.querySelectorAll('#range-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentRange = btn.dataset.range;
      if (currentStock) {
        loadChartOnly(currentStock, currentRange);
      }
    });

    // Indicator toggles
    ['toggle-sma', 'toggle-ema', 'toggle-bb'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (currentStock) loadChartOnly(currentStock, currentRange);
      });
    });
  }

  async function loadChartOnly(symbol, range) {
    try {
      const chartData = await API.getChart(symbol, range);
      if (chartData.candles.length > 0) {
        const options = {
          showSMA: document.getElementById('toggle-sma')?.checked,
          showEMA: document.getElementById('toggle-ema')?.checked,
          showBB: document.getElementById('toggle-bb')?.checked,
        };
        StockCharts.renderAll(chartData.candles, range, options);

        const closes = chartData.candles.map(c => c.close);
        renderSignals(closes);
      }
    } catch (err) {
      console.error('Chart load error:', err);
    }
  }

  // ─── Initialize ───
  function init() {
    // Load persisted state
    loadWatchlist();
    
    // Init WebSockets
    const gKey = localStorage.getItem('stockpulse_groww_key');
    const gSec = localStorage.getItem('stockpulse_groww_secret');
    API.initSocket(gKey, gSec);
    API.onTick(handleLiveTick);

    // Navigation
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(el.dataset.view);
      });
    });

    // Mobile menu
    document.getElementById('menu-btn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('open');
      document.getElementById('sidebar-overlay')?.classList.toggle('active');
    });
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('active');
    });

    // Search
    initSearch();

    // Chart controls
    initChartControls();

    // AI analyze button
    document.getElementById('btn-ai-analyze')?.addEventListener('click', runAIAnalysis);

    // Watchlist toggle button
    document.getElementById('btn-watchlist-toggle')?.addEventListener('click', () => {
      if (currentStock) toggleWatchlist(currentStock);
    });

    // AI fab button
    document.getElementById('ai-fab')?.addEventListener('click', () => navigateTo('chat'));

    // Settings
    initSettings();

    // Init AI Chat
    AIChat.init();

    // Init company tab bar
    initCompanyTabBar();

    // Load dashboard data
    loadMarketSummary();
    renderDashboardWatchlist();
    renderPopularStocks();

    // Start auto-refresh
    const autoRefresh = document.getElementById('toggle-auto-refresh');
    if (autoRefresh?.checked) startAutoRefresh();

    // Update market status every minute
    setInterval(updateMarketStatus, 60000);

    console.log('🚀 StockPulse AI v2 initialized — Screener.in Edition');
  }

  // Expose for AI chat context and screener navigation
  window.StockPulseApp = { getCurrentStockContext, loadStock: (sym) => { navigateTo('stock'); loadStock(sym); } };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { navigateTo, getCurrentStockContext };
})();
