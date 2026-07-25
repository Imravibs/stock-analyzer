/* ═══════════════════════════════════════════════════════════
   screener.js — Stock Screener with proper DSL parser
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
    { name: '📈 Near 52W High', query: 'Price > 52W High * 0.9' },
    { name: '💰 High Dividend', query: 'Dividend Yield > 3' },
    { name: '📉 Low P/E Value', query: 'PE > 0 AND PE < 15' },
    { name: '🏆 Large Cap', query: 'Market Cap > 500000000000' },
    { name: '🔥 High ROE', query: 'ROE > 20 AND Debt to Equity < 1' },
    { name: '⚡ Rising Today', query: 'Change > 2' },
    { name: '📉 Falling Today', query: 'Change < -2' },
    { name: '🏦 Debt Free', query: 'Debt to Equity < 0.1 AND ROE > 10' },
    { name: '💎 Quality Value', query: 'PE < 20 AND ROE > 15 AND Debt to Equity < 1' },
    { name: '📊 High Margin', query: 'Net Margin > 20 AND Revenue Growth > 10' },
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

  // ─── Run Query using AST parser ───
  function runQuery(queryText) {
    if (!queryText || !queryText.trim()) {
      currentResults = [...universe];
    } else {
      // Use the proper AST-based parser
      if (typeof QueryParser !== 'undefined') {
        currentResults = QueryParser.filter(queryText, universe);
      } else {
        currentResults = [...universe];
      }
    }
    currentPage = 1;
    renderResults();
  }

  // ─── NL-to-Query ───
  async function convertNLToQuery(text) {
    const nlBtn = document.getElementById('screener-nl-btn');
    const nlInput = document.getElementById('screener-nl-input');
    const qInput = document.getElementById('screener-query');
    const preview = document.getElementById('nl-query-preview');

    if (nlBtn) { nlBtn.textContent = '⏳ Converting...'; nlBtn.disabled = true; }
    try {
      const res = await fetch('/api/ai/nl-to-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.query) {
        if (qInput) qInput.value = data.query;
        if (preview) {
          preview.innerHTML = `<span class="nl-preview-label">✨ Generated query:</span> <code>${data.query}</code>`;
          preview.classList.remove('hidden');
        }
        // Auto-run the generated query
        runQuery(data.query);
      }
    } catch (e) {
      console.error('NL-to-query error:', e);
    } finally {
      if (nlBtn) { nlBtn.textContent = '✨ Convert'; nlBtn.disabled = false; }
    }
  }

  // ─── Save Screen ───
  async function saveCurrentScreen() {
    const token = localStorage.getItem('stockpulse_token');
    if (!token) {
      alert('Please log in to save screens.');
      return;
    }
    const query = document.getElementById('screener-query')?.value || '';
    if (!query) { alert('Write a query first.'); return; }
    const name = prompt('Screen name:', 'My Screen');
    if (!name) return;

    try {
      const res = await fetch('/api/screens/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name, query, isPublic: false }),
      });
      if (res.ok) alert(`✅ Screen "${name}" saved!`);
      else alert('Failed to save screen.');
    } catch (e) { alert('Error saving screen.'); }
  }

  // ─── Render ───
  function renderPresets() {
    const el = document.getElementById('screener-presets');
    if (!el) return;
    el.innerHTML = PRESETS.map((p, i) => `
      <div class="preset-chip" data-idx="${i}" title="${p.query}">${p.name}</div>`).join('');

    el.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = PRESETS[parseInt(chip.dataset.idx)];
        const qInput = document.getElementById('screener-query');
        if (qInput) qInput.value = preset.query;
        el.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        runQuery(preset.query);
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
      currentResults = universe;
      renderResults();
    });

    renderPresets();

    // DSL Query input
    const qInput = document.getElementById('screener-query');
    const runBtn = document.getElementById('screener-run-btn');
    if (runBtn && qInput) {
      runBtn.addEventListener('click', () => runQuery(qInput.value.trim()));
      qInput.addEventListener('keydown', e => { if (e.key === 'Enter') runQuery(qInput.value.trim()); });
    }

    // NL-to-query
    const nlBtn = document.getElementById('screener-nl-btn');
    const nlInput = document.getElementById('screener-nl-input');
    if (nlBtn && nlInput) {
      nlBtn.addEventListener('click', () => {
        const text = nlInput.value.trim();
        if (text) convertNLToQuery(text);
      });
      nlInput.addEventListener('keydown', e => { if (e.key === 'Enter') nlBtn.click(); });
    }

    // Save screen
    const saveBtn = document.getElementById('screener-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentScreen);

    // Export CSV
    const exportBtn = document.getElementById('screener-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (currentResults.length === 0) return;
        const header = 'Symbol,Name,Price,Change%,MarketCap,PE,DivYield,52WH\n';
        const rows = currentResults.map(s =>
          `${s.symbol},"${s.name}",${s.price},${s.changePercent?.toFixed(2)},${s.marketCap},${s.peRatio?.toFixed(1)},${s.dividendYield?.toFixed(2)},${s.fiftyTwoWeekHigh}`
        ).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = 'stockpulse-screen.csv'; a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  return { init };
})();
