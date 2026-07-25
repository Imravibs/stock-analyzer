/* ═══════════════════════════════════════════════════════════
   screener.js — Stock Screener (Phase 2)
   ═══════════════════════════════════════════════════════════ */

const Screener = (() => {

  let universe = [];
  let currentResults = [];
  let sortField = 'marketCap';
  let sortAsc = false;
  let currentPage = 1;
  const PAGE_SIZE = 25;

  // ─── Preset Screens ───
  const PRESETS = [
    { name: '📈 52-Week High', desc: 'Stocks near their 52-week high — strong momentum', filters: [{ field: 'price', op: '>=', value: 0 }], query: 'Price > 52W Low * 1.9' },
    { name: '💰 High Dividend', desc: 'Dividend yield > 3% — income-generating stocks', filters: [{ field: 'dividendYield', op: '>', value: 3 }], query: 'Dividend Yield > 3' },
    { name: '📉 Low P/E Value', desc: 'P/E below 15 — potentially undervalued', filters: [{ field: 'pe', op: '<', value: 15 }, { field: 'pe', op: '>', value: 0 }], query: 'PE > 0 AND PE < 15' },
    { name: '🏆 Large Cap', desc: 'Market cap above ₹50,000 Cr — blue-chip companies', filters: [{ field: 'marketcap', op: '>', value: 5e11 }], query: 'Market Cap > 500000000000' },
    { name: '⚡ High Growth', desc: 'Stocks up more than 2% today', filters: [{ field: 'change', op: '>', value: 2 }], query: 'Change % > 2' },
    { name: '📉 Falling Stocks', desc: 'Stocks down more than 2% today', filters: [{ field: 'change', op: '<', value: -2 }], query: 'Change % < -2' },
  ];

  function fmtPrice(v) {
    return v != null ? `₹${parseFloat(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  }

  function fmtCr(v) {
    if (v == null) return '—';
    const cr = v / 1e7;
    if (cr >= 1e5) return `${(cr / 1e5).toFixed(1)}L Cr`;
    if (cr >= 1e3) return `${(cr / 1e3).toFixed(1)}K Cr`;
    return `${cr.toFixed(0)} Cr`;
  }

  function fmtPct(v) {
    if (v == null) return '—';
    const num = parseFloat(v);
    return `<span class="${num >= 0 ? 'fin-pos' : 'fin-neg'}">${num >= 0 ? '+' : ''}${num.toFixed(2)}%</span>`;
  }

  // ─── Load Universe ───
  async function loadUniverse() {
    try {
      const res = await fetch('/api/screener/universe');
      universe = await res.json();
    } catch (e) {
      console.error('Failed to load screener universe:', e);
    }
  }

  // ─── Run Filters ───
  async function runFilters(filters) {
    try {
      const res = await fetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      const data = await res.json();
      currentResults = data.results || [];
      currentPage = 1;
      renderResults();
    } catch (e) {
      console.error('Screener run error:', e);
    }
  }

  // ─── Parse Query Text ───
  function parseQuery(queryText) {
    const filters = [];
    const parts = queryText.toUpperCase().split(/\s+AND\s+/);
    const fieldAliases = {
      'PRICE': 'price',
      'PE': 'pe', 'P/E': 'pe', 'P\\/E RATIO': 'pe',
      'MARKET CAP': 'marketcap', 'MARKETCAP': 'marketcap',
      'DIVIDEND YIELD': 'dividend yield',
      '52W HIGH': '52w high', '52W LOW': '52w low',
      'VOLUME': 'volume',
      'CHANGE': 'change', 'CHANGE %': 'change',
    };

    parts.forEach(part => {
      const m = part.trim().match(/^(.+?)\s*(>=|<=|>|<|=)\s*([\d.]+)$/);
      if (m) {
        const rawField = m[1].trim();
        const field = fieldAliases[rawField] || rawField.toLowerCase();
        filters.push({ field, op: m[2], value: parseFloat(m[3]) });
      }
    });
    return filters;
  }

  // ─── Render ───
  function renderPresets() {
    const el = document.getElementById('screener-presets');
    if (!el) return;
    el.innerHTML = PRESETS.map((p, i) => `
      <div class="preset-chip" data-idx="${i}" title="${p.desc}">
        ${p.name}
      </div>`).join('');

    el.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = PRESETS[parseInt(chip.dataset.idx)];
        document.getElementById('screener-query').value = preset.query;
        runFilters(preset.filters);
        el.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  function sortResults(field) {
    if (sortField === field) sortAsc = !sortAsc;
    else { sortField = field; sortAsc = false; }
    renderResults();
  }

  function renderResults() {
    const sorted = [...currentResults].sort((a, b) => {
      const av = a[sortField] ?? (sortAsc ? Infinity : -Infinity);
      const bv = b[sortField] ?? (sortAsc ? Infinity : -Infinity);
      return sortAsc ? av - bv : bv - av;
    });

    const total = sorted.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = sorted.slice(start, start + PAGE_SIZE);

    const el = document.getElementById('screener-results');
    if (!el) return;

    const countEl = document.getElementById('screener-count');
    if (countEl) countEl.textContent = `${total} results`;

    const thArr = [
      { label: 'Company', field: null },
      { label: 'Price', field: 'price' },
      { label: 'Change %', field: 'changePercent' },
      { label: 'Market Cap (Cr)', field: 'marketCap' },
      { label: 'P/E', field: 'peRatio' },
      { label: 'Div Yield %', field: 'dividendYield' },
      { label: '52W High', field: 'fiftyTwoWeekHigh' },
    ];

    el.innerHTML = `
      <div class="screener-table-wrap">
        <table class="fin-table screener-table">
          <thead>
            <tr>
              <th>#</th>
              ${thArr.map(h => `<th class="${h.field ? 'sortable' : ''}" data-field="${h.field || ''}">${h.label}${h.field === sortField ? (sortAsc ? ' ↑' : ' ↓') : ''}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${page.length === 0 ? `<tr><td colspan="8" class="fin-empty">No stocks match your filter.</td></tr>` :
              page.map((s, i) => `
                <tr class="screener-row" data-symbol="${s.symbol}">
                  <td class="row-num">${start + i + 1}</td>
                  <td>
                    <div class="peer-name-cell">
                      <span class="peer-symbol">${s.symbol}</span>
                      <span class="peer-longname">${s.name}</span>
                    </div>
                  </td>
                  <td>${fmtPrice(s.price)}</td>
                  <td>${fmtPct(s.changePercent)}</td>
                  <td>${fmtCr(s.marketCap)}</td>
                  <td>${s.peRatio != null ? `${parseFloat(s.peRatio).toFixed(1)}x` : '—'}</td>
                  <td>${s.dividendYield != null ? `${parseFloat(s.dividendYield).toFixed(2)}%` : '—'}</td>
                  <td>${fmtPrice(s.fiftyTwoWeekHigh)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div class="screener-pagination">
          <button class="btn btn-outline btn-sm" id="screener-prev" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${currentPage} of ${totalPages}</span>
          <button class="btn btn-outline btn-sm" id="screener-next" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
        </div>` : ''}`;

    // Bind sort
    el.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => { if (th.dataset.field) sortResults(th.dataset.field); });
    });

    // Bind rows — click to navigate to stock
    el.querySelectorAll('.screener-row').forEach(row => {
      row.addEventListener('click', () => {
        const sym = row.dataset.symbol;
        if (sym && window.StockPulseApp) {
          window.StockPulseApp.loadStock(sym + '.NS');
        }
      });
    });

    // Pagination
    const prev = document.getElementById('screener-prev');
    const next = document.getElementById('screener-next');
    if (prev) prev.addEventListener('click', () => { currentPage--; renderResults(); });
    if (next) next.addEventListener('click', () => { currentPage++; renderResults(); });
  }

  function init() {
    // Load universe on mount
    loadUniverse().then(() => {
      // Show all stocks by default
      currentResults = universe;
      renderResults();
    });

    renderPresets();

    // Query input handler
    const qInput = document.getElementById('screener-query');
    const runBtn = document.getElementById('screener-run-btn');

    if (runBtn && qInput) {
      runBtn.addEventListener('click', () => {
        const filters = parseQuery(qInput.value.trim());
        if (filters.length === 0) {
          currentResults = universe;
          currentPage = 1;
          renderResults();
        } else {
          runFilters(filters);
        }
      });

      qInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') runBtn.click();
      });
    }
  }

  return { init };
})();
