/* ═══════════════════════════════════════════════════════════
   financials.js — P&L, Balance Sheet, Cash Flow, Ratios rendering
   ═══════════════════════════════════════════════════════════ */

const Financials = (() => {

  // ─── Formatters ───
  function fmtCr(val) {
    if (val == null) return '—';
    const cr = val / 1e7;
    if (Math.abs(cr) >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`;
    if (Math.abs(cr) >= 1e3) return `₹${(cr / 1e3).toFixed(2)}K Cr`;
    return `₹${cr.toFixed(2)} Cr`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  function fmtPct(val) {
    if (val == null) return '—';
    return `${parseFloat(val).toFixed(2)}%`;
  }

  function fmtNum(val, decimals = 2) {
    if (val == null) return '—';
    return parseFloat(val).toFixed(decimals);
  }

  // ─── Calculate Growth ───
  function cagr(first, last, years) {
    if (!first || !last || years <= 0 || first <= 0) return null;
    return (Math.pow(last / first, 1 / years) - 1) * 100;
  }

  function renderGrowthBoxes(label, series) {
    const vals = series.filter(v => v != null && v > 0);
    if (vals.length < 2) return '';
    const last = vals[vals.length - 1];
    const g3 = vals.length >= 4 ? cagr(vals[vals.length - 4], last, 3) : null;
    const g5 = vals.length >= 6 ? cagr(vals[vals.length - 6], last, 5) : null;
    const gMax = vals.length >= 2 ? cagr(vals[0], last, vals.length - 1) : null;

    const box = (label, val) => val == null ? '' :
      `<div class="growth-box"><div class="growth-label">${label}</div><div class="growth-val ${val >= 0 ? 'pos' : 'neg'}">${val >= 0 ? '+' : ''}${val.toFixed(1)}%</div><div class="growth-sub">CAGR</div></div>`;

    return `
      <div class="growth-summary">
        <div class="growth-title">${label}</div>
        <div class="growth-boxes">
          ${box('3 Year', g3)}
          ${box('5 Year', g5)}
          ${box('Max', gMax)}
        </div>
      </div>`;
  }

  // ─── Render Annual P&L ───
  function renderAnnualPL(data) {
    if (!data || !data.annualPL || data.annualPL.length === 0) {
      return '<div class="fin-empty">No annual P&L data available.</div>';
    }
    const rows = data.annualPL;
    const revSeries = rows.map(r => r.revenue);
    const profSeries = rows.map(r => r.netIncome);

    return `
      <div class="fin-table-wrap">
        <table class="fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${rows.map(r => `<th>${fmtDate(r.date)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="fin-row-primary">
              <td>Revenue</td>
              ${rows.map(r => `<td>${fmtCr(r.revenue)}</td>`).join('')}
            </tr>
            <tr>
              <td>Gross Profit</td>
              ${rows.map(r => `<td>${fmtCr(r.grossProfit)}</td>`).join('')}
            </tr>
            <tr>
              <td>Operating Profit</td>
              ${rows.map(r => `<td>${fmtCr(r.ebit)}</td>`).join('')}
            </tr>
            <tr class="fin-row-primary">
              <td>Net Profit</td>
              ${rows.map(r => `<td class="${(r.netIncome ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.netIncome)}</td>`).join('')}
            </tr>
            <tr>
              <td>EPS (₹)</td>
              ${rows.map(r => `<td>${fmtNum(r.eps)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
      <div class="fin-growth-row">
        ${renderGrowthBoxes('Sales Growth', revSeries)}
        ${renderGrowthBoxes('Profit Growth', profSeries)}
      </div>`;
  }

  // ─── Render Quarterly P&L ───
  function renderQuarterlyPL(data) {
    if (!data || !data.quarterlyPL || data.quarterlyPL.length === 0) {
      return '<div class="fin-empty">No quarterly data available.</div>';
    }
    const rows = data.quarterlyPL.slice(-8);
    return `
      <div class="fin-table-wrap">
        <table class="fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${rows.map(r => `<th>${fmtDate(r.date)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="fin-row-primary">
              <td>Revenue</td>
              ${rows.map(r => `<td>${fmtCr(r.revenue)}</td>`).join('')}
            </tr>
            <tr>
              <td>Gross Profit</td>
              ${rows.map(r => `<td>${fmtCr(r.grossProfit)}</td>`).join('')}
            </tr>
            <tr class="fin-row-primary">
              <td>Net Profit</td>
              ${rows.map(r => `<td class="${(r.netIncome ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.netIncome)}</td>`).join('')}
            </tr>
            <tr>
              <td>EPS (₹)</td>
              ${rows.map(r => `<td>${fmtNum(r.eps)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // ─── Render Balance Sheet ───
  function renderBalanceSheet(data) {
    if (!data || !data.balanceSheet || data.balanceSheet.length === 0) {
      return '<div class="fin-empty">No balance sheet data available.</div>';
    }
    const rows = data.balanceSheet;
    return `
      <div class="fin-table-wrap">
        <table class="fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${rows.map(r => `<th>${fmtDate(r.date)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="fin-section-head"><td colspan="${rows.length + 1}">Assets</td></tr>
            <tr class="fin-row-primary">
              <td>Total Assets</td>
              ${rows.map(r => `<td>${fmtCr(r.totalAssets)}</td>`).join('')}
            </tr>
            <tr>
              <td>Current Assets</td>
              ${rows.map(r => `<td>${fmtCr(r.totalCurrentAssets)}</td>`).join('')}
            </tr>
            <tr>
              <td>Cash & Equivalents</td>
              ${rows.map(r => `<td>${fmtCr(r.cash)}</td>`).join('')}
            </tr>
            <tr class="fin-section-head"><td colspan="${rows.length + 1}">Liabilities & Equity</td></tr>
            <tr>
              <td>Total Liabilities</td>
              ${rows.map(r => `<td>${fmtCr(r.totalLiab)}</td>`).join('')}
            </tr>
            <tr>
              <td>Current Liabilities</td>
              ${rows.map(r => `<td>${fmtCr(r.totalCurrentLiabilities)}</td>`).join('')}
            </tr>
            <tr>
              <td>Long-Term Debt</td>
              ${rows.map(r => `<td>${fmtCr(r.longTermDebt)}</td>`).join('')}
            </tr>
            <tr class="fin-row-primary">
              <td>Shareholder Equity</td>
              ${rows.map(r => `<td>${fmtCr(r.totalStockholderEquity)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // ─── Render Cash Flow ───
  function renderCashFlow(data) {
    if (!data || !data.cashFlow || data.cashFlow.length === 0) {
      return '<div class="fin-empty">No cash flow data available.</div>';
    }
    const rows = data.cashFlow;
    return `
      <div class="fin-table-wrap">
        <table class="fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${rows.map(r => `<th>${fmtDate(r.date)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="fin-row-primary">
              <td>Operating Cash Flow</td>
              ${rows.map(r => `<td class="${(r.operatingCashflow ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.operatingCashflow)}</td>`).join('')}
            </tr>
            <tr>
              <td>Investing Cash Flow</td>
              ${rows.map(r => `<td class="${(r.investingCashflow ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.investingCashflow)}</td>`).join('')}
            </tr>
            <tr>
              <td>Financing Cash Flow</td>
              ${rows.map(r => `<td class="${(r.financingCashflow ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.financingCashflow)}</td>`).join('')}
            </tr>
            <tr class="fin-row-primary">
              <td>Free Cash Flow</td>
              ${rows.map(r => `<td class="${(r.freeCashflow ?? 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmtCr(r.freeCashflow)}</td>`).join('')}
            </tr>
            <tr>
              <td>Capex</td>
              ${rows.map(r => `<td>${fmtCr(r.capitalExpenditures)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // ─── Render Key Ratios Grid ───
  function renderRatios(ratios) {
    if (!ratios) return '<div class="fin-empty">Loading ratios...</div>';

    const fmt = (val, suffix = '') => val != null ? `${parseFloat(val).toFixed(2)}${suffix}` : '—';
    const fmtM = (val) => {
      if (val == null) return '—';
      if (val >= 1e12) return `₹${(val/1e12).toFixed(2)}T`;
      if (val >= 1e9) return `₹${(val/1e9).toFixed(2)}B`;
      if (val >= 1e7) return `₹${(val/1e7).toFixed(2)} Cr`;
      return `₹${val.toLocaleString('en-IN')}`;
    };

    const card = (label, value, badge = '') => `
      <div class="ratio-card glass-card">
        <div class="ratio-label">${label}</div>
        <div class="ratio-value">${value}${badge ? `<span class="ratio-badge">${badge}</span>` : ''}</div>
      </div>`;

    return `
      <div class="ratios-grid">
        ${card('Market Cap', fmtM(ratios.marketCap))}
        ${card('P/E Ratio', fmt(ratios.peRatio, 'x'))}
        ${card('P/B Ratio', fmt(ratios.pbRatio, 'x'))}
        ${card('EV/EBITDA', fmt(ratios.evToEbitda, 'x'))}
        ${card('Book Value', ratios.bookValue != null ? `₹${fmt(ratios.bookValue)}` : '—')}
        ${card('Dividend Yield', fmtPct(ratios.dividendYield))}
        ${card('ROE', fmtPct(ratios.roe), ratios.roe > 15 ? '✓ Good' : '')}
        ${card('ROA', fmtPct(ratios.roa))}
        ${card('Net Margin', fmtPct(ratios.netMargin))}
        ${card('Operating Margin', fmtPct(ratios.operatingMargin))}
        ${card('Debt/Equity', fmt(ratios.debtToEquity, 'x'), ratios.debtToEquity < 1 ? '✓ Low' : '')}
        ${card('Current Ratio', fmt(ratios.currentRatio, 'x'))}
        ${card('Beta', fmt(ratios.beta, 'x'))}
        ${card('Revenue Growth', fmtPct(ratios.revenueGrowth))}
        ${card('Earnings Growth', fmtPct(ratios.earningsGrowth))}
        ${card('Gross Margin', fmtPct(ratios.grossMargin))}
      </div>`;
  }

  // ─── Render Pros/Cons (rules-based) ───
  function renderProsCons(ratios, financialsData) {
    const pros = [];
    const cons = [];

    if (ratios) {
      if (ratios.roe > 15) pros.push(`Strong ROE of ${fmtPct(ratios.roe)} — company generating good returns on equity.`);
      else if (ratios.roe < 8 && ratios.roe != null) cons.push(`Low ROE of ${fmtPct(ratios.roe)} — below healthy threshold of 8%.`);

      if (ratios.debtToEquity != null && ratios.debtToEquity < 0.5) pros.push(`Low Debt-to-Equity of ${fmtNum(ratios.debtToEquity, 2)}x — company is nearly debt-free.`);
      else if (ratios.debtToEquity > 2) cons.push(`High Debt-to-Equity of ${fmtNum(ratios.debtToEquity, 2)}x — significant leverage risk.`);

      if (ratios.dividendYield > 2) pros.push(`Attractive dividend yield of ${fmtPct(ratios.dividendYield)} — good income stock.`);

      if (ratios.currentRatio > 1.5) pros.push(`Healthy current ratio of ${fmtNum(ratios.currentRatio, 2)}x — strong short-term liquidity.`);
      else if (ratios.currentRatio < 1 && ratios.currentRatio != null) cons.push(`Current ratio below 1 (${fmtNum(ratios.currentRatio, 2)}x) — short-term liquidity concern.`);

      if (ratios.netMargin > 15) pros.push(`High net profit margin of ${fmtPct(ratios.netMargin)} — very profitable business.`);
      else if (ratios.netMargin < 5 && ratios.netMargin != null) cons.push(`Thin net profit margin of ${fmtPct(ratios.netMargin)} — limited profitability.`);

      if (ratios.peRatio > 60) cons.push(`P/E ratio of ${fmtNum(ratios.peRatio, 1)}x is very expensive — growth expectations may be stretched.`);
      else if (ratios.peRatio < 15 && ratios.peRatio > 0) pros.push(`Reasonable P/E of ${fmtNum(ratios.peRatio, 1)}x — potentially undervalued.`);

      if (ratios.revenueGrowth > 15) pros.push(`Strong revenue growth of ${fmtPct(ratios.revenueGrowth)} — company scaling rapidly.`);
      else if (ratios.revenueGrowth < 0 && ratios.revenueGrowth != null) cons.push(`Revenue declining by ${fmtPct(Math.abs(ratios.revenueGrowth))} — business contraction.`);

      if (ratios.beta > 1.5) cons.push(`High beta of ${fmtNum(ratios.beta, 2)} — stock is significantly more volatile than the market.`);
      else if (ratios.beta < 0.8 && ratios.beta > 0) pros.push(`Low beta of ${fmtNum(ratios.beta, 2)} — relatively stable stock, good for defensive portfolios.`);
    }

    if (pros.length === 0 && cons.length === 0) {
      return '<div class="fin-empty">Generating insights...</div>';
    }

    return `
      <div class="pros-cons-grid">
        ${pros.length > 0 ? `
          <div class="pros-col">
            <div class="pc-header pc-pros-header">✅ Strengths</div>
            <ul class="pc-list">
              ${pros.map(p => `<li class="pc-item pc-pro"><span class="pc-dot">+</span>${p}</li>`).join('')}
            </ul>
          </div>` : ''}
        ${cons.length > 0 ? `
          <div class="cons-col">
            <div class="pc-header pc-cons-header">⚠️ Concerns</div>
            <ul class="pc-list">
              ${cons.map(c => `<li class="pc-item pc-con"><span class="pc-dot">-</span>${c}</li>`).join('')}
            </ul>
          </div>` : ''}
      </div>
      <p class="pc-disclaimer">⚠️ Pros & cons are auto-generated from financial ratios. Not financial advice. Do your own research.</p>`;
  }

  // ─── Render Shareholding ───
  function renderShareholding(data) {
    if (!data) return '<div class="fin-empty">No shareholding data available.</div>';

    const bar = (label, pct, color) => pct == null ? '' : `
      <div class="sh-bar-item">
        <div class="sh-bar-label"><span>${label}</span><span class="sh-pct">${pct}%</span></div>
        <div class="sh-bar-track"><div class="sh-bar-fill" style="width:${Math.min(parseFloat(pct), 100)}%;background:${color}"></div></div>
      </div>`;

    const instPercent = data.institutionsPercent;
    const insiderPercent = data.insidersPercent;
    const publicPercent = instPercent && insiderPercent
      ? Math.max(0, 100 - parseFloat(instPercent) - parseFloat(insiderPercent)).toFixed(2)
      : null;

    return `
      <div class="shareholding-layout">
        <div class="sh-bars glass-card">
          <h4 class="sh-title">Ownership Breakdown</h4>
          ${bar('Institutions (FII/DII)', instPercent, 'var(--color-accent)')}
          ${bar('Insiders / Promoters', insiderPercent, '#e040fb')}
          ${bar('Public', publicPercent, '#26c6da')}
        </div>
        ${data.topInstitutions && data.topInstitutions.length > 0 ? `
          <div class="sh-table-wrap glass-card">
            <h4 class="sh-title">Top Institutional Holders</h4>
            <table class="fin-table">
              <thead><tr><th>Institution</th><th>% Held</th><th>Shares</th></tr></thead>
              <tbody>
                ${data.topInstitutions.map(h => `
                  <tr>
                    <td>${h.name || '—'}</td>
                    <td>${h.pctHeld != null ? `${h.pctHeld}%` : '—'}</td>
                    <td>${h.shares != null ? h.shares.toLocaleString('en-IN') : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
      </div>`;
  }

  return {
    renderRatios,
    renderProsCons,
    renderAnnualPL,
    renderQuarterlyPL,
    renderBalanceSheet,
    renderCashFlow,
    renderShareholding,
  };
})();
