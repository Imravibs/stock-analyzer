// ═══════════════════════════════════════════════════════════
// ai/red-flag-detector.js — Rules + LLM hybrid anomaly detector
// ═══════════════════════════════════════════════════════════

import { stmts } from '../db.js';

const FLAG_RULES = [
  {
    type: 'margin_spike',
    severity: 'high',
    check(ratios, financials) {
      if (!financials?.quarterlyPL || financials.quarterlyPL.length < 3) return null;
      const q = financials.quarterlyPL;
      const last = q[q.length - 1];
      const prev = q[q.length - 2];
      if (!last.netIncome || !prev.netIncome || !last.revenue || !prev.revenue) return null;
      const lastMargin = (last.netIncome / last.revenue) * 100;
      const prevMargin = (prev.netIncome / prev.revenue) * 100;
      const delta = lastMargin - prevMargin;
      if (Math.abs(delta) > 8) {
        return {
          title: `Sudden ${delta > 0 ? 'margin spike' : 'margin collapse'} of ${Math.abs(delta).toFixed(1)}% QoQ`,
          description: `Net profit margin changed from ${prevMargin.toFixed(1)}% to ${lastMargin.toFixed(1)}% in the last quarter. ${delta > 0 ? 'Sharp improvements without revenue growth can indicate one-time gains or accounting adjustments.' : 'Sharp margin drops may indicate cost pressures, provisions, or write-offs.'}`,
        };
      }
      return null;
    }
  },
  {
    type: 'high_debt',
    severity: 'medium',
    check(ratios) {
      if (!ratios?.debtToEquity) return null;
      if (ratios.debtToEquity > 3) {
        return {
          title: `Very high Debt-to-Equity ratio of ${parseFloat(ratios.debtToEquity).toFixed(2)}x`,
          description: `A D/E above 3x indicates the company is heavily leveraged. Rising interest rates could significantly impact profitability and increase default risk.`,
        };
      }
      return null;
    }
  },
  {
    type: 'revenue_decline',
    severity: 'medium',
    check(ratios) {
      if (!ratios?.revenueGrowth) return null;
      if (ratios.revenueGrowth < -10) {
        return {
          title: `Revenue declining sharply: ${parseFloat(ratios.revenueGrowth).toFixed(1)}% YoY`,
          description: `Revenue is shrinking at an accelerating rate. This may indicate loss of market share, pricing pressure, or broader sector headwinds.`,
        };
      }
      return null;
    }
  },
  {
    type: 'negative_cashflow',
    severity: 'high',
    check(ratios, financials) {
      if (!financials?.cashFlow) return null;
      const cf = financials.cashFlow;
      const recent = cf.slice(-3);
      const negOps = recent.filter(c => c.operatingCashflow != null && c.operatingCashflow < 0);
      if (negOps.length >= 2) {
        return {
          title: `Negative operating cash flow in ${negOps.length} of last 3 years`,
          description: `Operating cash flow has been negative multiple years in a row. Even a profitable-looking income statement cannot compensate for chronic cash burn — this company may be relying on debt or equity issuance to fund operations.`,
        };
      }
      return null;
    }
  },
  {
    type: 'negative_roe',
    severity: 'medium',
    check(ratios) {
      if (!ratios?.roe) return null;
      if (parseFloat(ratios.roe) < 0) {
        return {
          title: `Negative ROE of ${parseFloat(ratios.roe).toFixed(1)}%`,
          description: `Negative return on equity means the company is destroying shareholder value. This often reflects accumulated losses eroding the equity base.`,
        };
      }
      return null;
    }
  },
  {
    type: 'high_pe_low_growth',
    severity: 'low',
    check(ratios) {
      if (!ratios?.peRatio || !ratios?.revenueGrowth) return null;
      const pe = parseFloat(ratios.peRatio);
      const growth = parseFloat(ratios.revenueGrowth);
      if (pe > 50 && growth < 10) {
        return {
          title: `Expensive valuation (P/E ${pe.toFixed(0)}x) with slow growth (${growth.toFixed(1)}%)`,
          description: `The stock trades at a very high P/E multiple but revenue growth does not justify the premium. The PEG ratio (P/E ÷ growth) is very high, suggesting potential overvaluation.`,
        };
      }
      return null;
    }
  }
];

export async function detectRedFlags(symbol, ratios, financials, gemini) {
  const triggered = [];

  // Run rules engine
  for (const rule of FLAG_RULES) {
    try {
      const result = rule.check(ratios, financials);
      if (result) {
        triggered.push({
          type: rule.type,
          severity: rule.severity,
          ...result,
          ai_summary: null,
        });
      }
    } catch (e) { /* skip failed rule */ }
  }

  // LLM enhancement for critical flags
  if (triggered.length > 0 && gemini) {
    try {
      const flagSummary = triggered.map(f => `- ${f.title}: ${f.description}`).join('\n');
      const prompt = `You are an expert Indian stock market risk analyst. Review these automated red flags detected for ${symbol} and write a concise plain-English risk summary (max 3 sentences). Be direct about risk severity. Do not repeat the flags verbatim — synthesize the overall risk picture.

Detected flags:
${flagSummary}

Key ratios:
- P/E: ${ratios?.peRatio ?? 'N/A'}
- ROE: ${ratios?.roe ?? 'N/A'}%
- Debt/Equity: ${ratios?.debtToEquity ?? 'N/A'}
- Net Margin: ${ratios?.netMargin ?? 'N/A'}%

Write only the risk summary, no preamble:`;

      const response = await gemini.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemma-2-27b-it',
        contents: prompt,
      });
      const aiSummary = response.text?.trim() || null;

      // Attach AI summary to the most severe flag
      if (triggered.length > 0 && aiSummary) {
        triggered[0].ai_summary = aiSummary;
      }
    } catch (e) {
      console.error('Red flag AI error:', e.message);
    }
  }

  // Store detected flags in DB
  for (const flag of triggered) {
    try {
      stmts.insertRedFlag.run(
        symbol,
        flag.type,
        flag.severity,
        flag.title,
        flag.description,
        flag.ai_summary,
        null
      );
    } catch (e) { /* ignore duplicate */ }
  }

  return triggered;
}
