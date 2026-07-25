/* ═══════════════════════════════════════════════════════════
   Technical Indicators — Pure calculation functions
   RSI, MACD, SMA, EMA, Bollinger Bands, Signal Generator
   ═══════════════════════════════════════════════════════════ */

const Indicators = (() => {

  // ─── Simple Moving Average ───
  function SMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        result.push(sum / period);
      }
    }
    return result;
  }

  // ─── Exponential Moving Average ───
  function EMA(data, period) {
    const result = [];
    const multiplier = 2 / (period + 1);

    // First value is SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      result.push(null);
      sum += data[i];
    }
    result[period - 1] = sum / period;

    for (let i = period; i < data.length; i++) {
      const ema = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(ema);
    }
    return result;
  }

  // ─── Relative Strength Index ───
  function RSI(closes, period = 14) {
    const result = [];
    if (closes.length < period + 1) return closes.map(() => null);

    let gains = 0, losses = 0;

    // First calculate average gain and loss
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Fill nulls for warmup period
    for (let i = 0; i <= period; i++) result.push(null);

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[period] = 100 - (100 / (1 + rs));

    // Continue with smoothed RS
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      result.push(rsi);
    }

    return result;
  }

  // ─── MACD ───
  function MACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = EMA(closes, fastPeriod);
    const emaSlow = EMA(closes, slowPeriod);

    // MACD Line = Fast EMA - Slow EMA
    const macdLine = closes.map((_, i) => {
      if (emaFast[i] == null || emaSlow[i] == null) return null;
      return emaFast[i] - emaSlow[i];
    });

    // Signal Line = EMA of MACD Line
    const validMacd = macdLine.filter(v => v != null);
    const signalRaw = EMA(validMacd, signalPeriod);

    // Map signal back to original indices
    const signalLine = [];
    let validIdx = 0;
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null) {
        signalLine.push(null);
      } else {
        signalLine.push(signalRaw[validIdx] || null);
        validIdx++;
      }
    }

    // Histogram = MACD Line - Signal Line
    const histogram = macdLine.map((v, i) => {
      if (v == null || signalLine[i] == null) return null;
      return v - signalLine[i];
    });

    return { macdLine, signalLine, histogram };
  }

  // ─── Bollinger Bands ───
  function BollingerBands(closes, period = 20, stdDev = 2) {
    const sma = SMA(closes, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < closes.length; i++) {
      if (sma[i] == null) {
        upper.push(null);
        lower.push(null);
      } else {
        let variance = 0;
        for (let j = i - period + 1; j <= i; j++) {
          variance += Math.pow(closes[j] - sma[i], 2);
        }
        const std = Math.sqrt(variance / period);
        upper.push(sma[i] + stdDev * std);
        lower.push(sma[i] - stdDev * std);
      }
    }

    return { middle: sma, upper, lower };
  }

  // ─── Signal Generator ───
  function generateSignals(closes) {
    if (!closes || closes.length < 30) {
      return { overall: 'HOLD', confidence: 0, signals: {} };
    }

    const signals = {};
    const lastPrice = closes[closes.length - 1];

    // RSI Signal
    const rsiValues = RSI(closes, 14);
    const lastRSI = rsiValues.filter(v => v != null).pop();
    if (lastRSI != null) {
      if (lastRSI < 30) signals.RSI = { signal: 'BUY', value: lastRSI.toFixed(1), reason: 'Oversold' };
      else if (lastRSI > 70) signals.RSI = { signal: 'SELL', value: lastRSI.toFixed(1), reason: 'Overbought' };
      else signals.RSI = { signal: 'HOLD', value: lastRSI.toFixed(1), reason: 'Neutral zone' };
    }

    // MACD Signal
    const macd = MACD(closes);
    const lastMACD = macd.macdLine.filter(v => v != null);
    const lastSignal = macd.signalLine.filter(v => v != null);
    const lastHist = macd.histogram.filter(v => v != null);
    if (lastMACD.length > 1 && lastSignal.length > 1) {
      const prevHist = lastHist[lastHist.length - 2];
      const currHist = lastHist[lastHist.length - 1];
      if (currHist > 0 && prevHist <= 0) signals.MACD = { signal: 'BUY', value: currHist.toFixed(2), reason: 'Bullish crossover' };
      else if (currHist < 0 && prevHist >= 0) signals.MACD = { signal: 'SELL', value: currHist.toFixed(2), reason: 'Bearish crossover' };
      else if (currHist > 0) signals.MACD = { signal: 'BUY', value: currHist.toFixed(2), reason: 'Bullish momentum' };
      else signals.MACD = { signal: 'SELL', value: currHist.toFixed(2), reason: 'Bearish momentum' };
    }

    // SMA (20/50) Crossover
    const sma20 = SMA(closes, 20);
    const sma50 = SMA(closes, 50);
    const lastSMA20 = sma20.filter(v => v != null).pop();
    const lastSMA50 = sma50.filter(v => v != null).pop();
    if (lastSMA20 != null && lastSMA50 != null) {
      if (lastPrice > lastSMA20 && lastSMA20 > lastSMA50) signals['SMA Cross'] = { signal: 'BUY', value: `${lastSMA20.toFixed(0)}/${lastSMA50.toFixed(0)}`, reason: 'Price above SMAs' };
      else if (lastPrice < lastSMA20 && lastSMA20 < lastSMA50) signals['SMA Cross'] = { signal: 'SELL', value: `${lastSMA20.toFixed(0)}/${lastSMA50.toFixed(0)}`, reason: 'Price below SMAs' };
      else signals['SMA Cross'] = { signal: 'HOLD', value: `${lastSMA20.toFixed(0)}/${lastSMA50.toFixed(0)}`, reason: 'Mixed signals' };
    }

    // Bollinger Bands position
    const bb = BollingerBands(closes, 20, 2);
    const lastUpper = bb.upper.filter(v => v != null).pop();
    const lastLower = bb.lower.filter(v => v != null).pop();
    const lastMiddle = bb.middle.filter(v => v != null).pop();
    if (lastUpper && lastLower) {
      if (lastPrice <= lastLower) signals['Bollinger'] = { signal: 'BUY', value: `₹${lastLower.toFixed(0)}`, reason: 'At lower band' };
      else if (lastPrice >= lastUpper) signals['Bollinger'] = { signal: 'SELL', value: `₹${lastUpper.toFixed(0)}`, reason: 'At upper band' };
      else signals['Bollinger'] = { signal: 'HOLD', value: `₹${lastMiddle.toFixed(0)}`, reason: 'Within bands' };
    }

    // Price vs SMA 200
    const sma200 = SMA(closes, 200);
    const lastSMA200 = sma200.filter(v => v != null).pop();
    if (lastSMA200 != null) {
      if (lastPrice > lastSMA200) signals['SMA 200'] = { signal: 'BUY', value: `₹${lastSMA200.toFixed(0)}`, reason: 'Above long-term trend' };
      else signals['SMA 200'] = { signal: 'SELL', value: `₹${lastSMA200.toFixed(0)}`, reason: 'Below long-term trend' };
    }

    // Volume trend (simple check)
    // Using price momentum as proxy
    const momentum5 = closes.length > 5 ? ((lastPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
    if (momentum5 > 3) signals['Momentum'] = { signal: 'BUY', value: `${momentum5.toFixed(1)}%`, reason: '5-day positive momentum' };
    else if (momentum5 < -3) signals['Momentum'] = { signal: 'SELL', value: `${momentum5.toFixed(1)}%`, reason: '5-day negative momentum' };
    else signals['Momentum'] = { signal: 'HOLD', value: `${momentum5.toFixed(1)}%`, reason: 'Sideways movement' };

    // Calculate overall signal
    let buyCount = 0, sellCount = 0, holdCount = 0;
    Object.values(signals).forEach(s => {
      if (s.signal === 'BUY') buyCount++;
      else if (s.signal === 'SELL') sellCount++;
      else holdCount++;
    });

    const total = buyCount + sellCount + holdCount;
    let overall, confidence;
    if (buyCount > sellCount && buyCount > holdCount) {
      overall = 'BUY';
      confidence = buyCount / total;
    } else if (sellCount > buyCount && sellCount > holdCount) {
      overall = 'SELL';
      confidence = sellCount / total;
    } else {
      overall = 'HOLD';
      confidence = holdCount / total;
    }

    return { overall, confidence, signals, counts: { buy: buyCount, sell: sellCount, hold: holdCount } };
  }

  return { SMA, EMA, RSI, MACD, BollingerBands, generateSignals };
})();
