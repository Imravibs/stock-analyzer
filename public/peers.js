/* ═══════════════════════════════════════════════════════════
   peers.js — Peer Comparison Table
   ═══════════════════════════════════════════════════════════ */

const Peers = (() => {

  function fmtPrice(v) {
    return v != null ? `₹${parseFloat(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  }

  function fmtCr(v) {
    if (v == null) return '—';
    const cr = v / 1e7;
    if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(1)}L Cr`;
    if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(1)}K Cr`;
    return `₹${cr.toFixed(0)} Cr`;
  }

  function fmtPct(v) {
    if (v == null) return '—';
    const num = parseFloat(v);
    return `<span class="${num >= 0 ? 'fin-pos' : 'fin-neg'}">${num >= 0 ? '+' : ''}${num.toFixed(2)}%</span>`;
  }

  function renderPeers(peers, currentSymbol) {
    if (!peers || peers.length === 0) {
      return '<div class="fin-empty">No comparable peers found for this stock.</div>';
    }

    return `
      <div class="peers-table-wrap">
        <table class="fin-table peers-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Price</th>
              <th>Change</th>
              <th>Market Cap</th>
              <th>P/E</th>
              <th>52W High</th>
              <th>52W Low</th>
            </tr>
          </thead>
          <tbody>
            ${peers.map(p => {
              const sym = (p.symbol || '').replace('.NS', '').replace('.BO', '');
              const isCurrent = currentSymbol && sym === currentSymbol.replace('.NS', '').replace('.BO', '');
              return `
                <tr class="${isCurrent ? 'peers-current' : 'peers-row'}" data-symbol="${sym}" title="View ${p.name}">
                  <td>
                    <div class="peer-name-cell">
                      <span class="peer-symbol">${sym}</span>
                      <span class="peer-longname">${p.name || sym}</span>
                    </div>
                  </td>
                  <td>${fmtPrice(p.price)}</td>
                  <td>${fmtPct(p.changePercent)}</td>
                  <td>${fmtCr(p.marketCap)}</td>
                  <td>${p.peRatio != null ? `${parseFloat(p.peRatio).toFixed(1)}x` : '—'}</td>
                  <td>${fmtPrice(p.fiftyTwoWeekHigh)}</td>
                  <td>${fmtPrice(p.fiftyTwoWeekLow)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="peers-hint">💡 Click any peer to view its full analysis.</p>`;
  }

  return { renderPeers };
})();
