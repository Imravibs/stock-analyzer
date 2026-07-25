/* ═══════════════════════════════════════════════════════════
   Charts — TradingView Lightweight Charts Integration
   with SMA, EMA, Bollinger Band overlays
   ═══════════════════════════════════════════════════════════ */

const StockCharts = (() => {
  let mainChart = null;
  let priceSeries = null;
  let volumeSeries = null;
  
  // Overlay series (dynamically added/removed)
  let sma20Series = null;
  let sma50Series = null;
  let ema12Series = null;
  let ema26Series = null;
  let bbUpperSeries = null;
  let bbLowerSeries = null;

  let rsiChartObj = null;
  let rsiSeries = null;

  let macdChartObj = null;
  let macdLineSeries = null;
  let macdSignalSeries = null;
  let macdHistSeries = null;

  let currentData = null;
  let currentRange = '1mo';
  let currentOptions = {};

  const CHART_OPTIONS = {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#94a3b8',
      fontFamily: 'Inter',
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { width: 1, color: 'rgba(255, 255, 255, 0.2)', style: 3 },
      horzLine: { width: 1, color: 'rgba(255, 255, 255, 0.2)', style: 3 },
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      autoScale: true,
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  };

  // ─── Main Chart ───
  function initMainChart() {
    const container = document.getElementById('price-chart');
    if (!container) return;

    if (mainChart) {
      mainChart.remove();
      mainChart = null;
    }
    container.innerHTML = '';

    mainChart = LightweightCharts.createChart(container, CHART_OPTIONS);

    // Candlestick Series (v5 API)
    priceSeries = mainChart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#00e676',
      downColor: '#ff3366',
      borderVisible: false,
      wickUpColor: '#00e676',
      wickDownColor: '#ff3366',
    });

    // Volume Series (v5 API)
    volumeSeries = mainChart.addSeries(LightweightCharts.HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // Reset overlay refs
    sma20Series = sma50Series = ema12Series = ema26Series = bbUpperSeries = bbLowerSeries = null;

    // Sync resize
    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      mainChart.applyOptions({ width: newRect.width, height: newRect.height });
    }).observe(container);
  }

  // ─── RSI Chart ───
  function initRSIChart() {
    const container = document.getElementById('rsi-chart');
    if (!container) return;
    
    if (rsiChartObj) {
      rsiChartObj.remove();
      rsiChartObj = null;
    }
    container.innerHTML = '';

    rsiChartObj = LightweightCharts.createChart(container, {
      ...CHART_OPTIONS,
      timeScale: { visible: false },
      rightPriceScale: { autoScale: false, scaleMargins: { top: 0.1, bottom: 0.1 } }
    });
    
    rsiChartObj.priceScale('right').applyOptions({
      autoScale: false,
      mode: LightweightCharts.PriceScaleMode.Normal,
    });

    rsiSeries = rsiChartObj.addSeries(LightweightCharts.LineSeries, {
      color: '#e040fb',
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      rsiChartObj.applyOptions({ width: newRect.width, height: newRect.height });
    }).observe(container);
  }

  // ─── MACD Chart ───
  function initMACDChart() {
    const container = document.getElementById('macd-chart');
    if (!container) return;

    if (macdChartObj) {
      macdChartObj.remove();
      macdChartObj = null;
    }
    container.innerHTML = '';

    macdChartObj = LightweightCharts.createChart(container, {
      ...CHART_OPTIONS,
      timeScale: { visible: false }
    });

    macdHistSeries = macdChartObj.addSeries(LightweightCharts.HistogramSeries, {
      color: '#26a69a',
      lineWidth: 2,
    });

    macdLineSeries = macdChartObj.addSeries(LightweightCharts.LineSeries, {
      color: '#00f2fe',
      lineWidth: 2,
    });

    macdSignalSeries = macdChartObj.addSeries(LightweightCharts.LineSeries, {
      color: '#ffab00',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
    });

    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      macdChartObj.applyOptions({ width: newRect.width, height: newRect.height });
    }).observe(container);
  }

  // ─── Helpers ───
  function tvTime(ts) {
    return Math.floor(ts / 1000);
  }

  function removeSeries(seriesRef) {
    if (seriesRef && mainChart) {
      try { mainChart.removeSeries(seriesRef); } catch(e) { /* already removed */ }
    }
    return null;
  }

  function buildLineData(indicatorArray, cleanCandles) {
    const data = [];
    indicatorArray.forEach((val, i) => {
      if (val !== null && val !== undefined && i < cleanCandles.length && cleanCandles[i]) {
        data.push({ time: tvTime(cleanCandles[i].time), value: val });
      }
    });
    return data;
  }

  // ─── Apply Overlays on Main Chart ───
  function applyOverlays(closes, cleanCandles, options) {
    // --- SMA ---
    sma20Series = removeSeries(sma20Series);
    sma50Series = removeSeries(sma50Series);
    if (options.showSMA) {
      const sma20 = Indicators.SMA(closes, 20);
      const sma20Data = buildLineData(sma20, cleanCandles);
      if (sma20Data.length > 0) {
        sma20Series = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: '#ffab00',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'SMA 20',
        });
        sma20Series.setData(sma20Data);
      }

      if (closes.length >= 50) {
        const sma50 = Indicators.SMA(closes, 50);
        const sma50Data = buildLineData(sma50, cleanCandles);
        if (sma50Data.length > 0) {
          sma50Series = mainChart.addSeries(LightweightCharts.LineSeries, {
            color: '#ff6d00',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
            title: 'SMA 50',
          });
          sma50Series.setData(sma50Data);
        }
      }
    }

    // --- EMA ---
    ema12Series = removeSeries(ema12Series);
    ema26Series = removeSeries(ema26Series);
    if (options.showEMA) {
      const ema12 = Indicators.EMA(closes, 12);
      const ema12Data = buildLineData(ema12, cleanCandles);
      if (ema12Data.length > 0) {
        ema12Series = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: '#e040fb',
          lineWidth: 2,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'EMA 12',
        });
        ema12Series.setData(ema12Data);
      }

      const ema26 = Indicators.EMA(closes, 26);
      const ema26Data = buildLineData(ema26, cleanCandles);
      if (ema26Data.length > 0) {
        ema26Series = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: '#7c4dff',
          lineWidth: 2,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'EMA 26',
        });
        ema26Series.setData(ema26Data);
      }
    }

    // --- Bollinger Bands ---
    bbUpperSeries = removeSeries(bbUpperSeries);
    bbLowerSeries = removeSeries(bbLowerSeries);
    if (options.showBB && closes.length >= 20) {
      const bb = Indicators.BollingerBands(closes, 20, 2);
      const bbUpperData = buildLineData(bb.upper, cleanCandles);
      const bbLowerData = buildLineData(bb.lower, cleanCandles);

      if (bbUpperData.length > 0) {
        bbUpperSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: 'rgba(0, 242, 254, 0.5)',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'BB Upper',
        });
        bbUpperSeries.setData(bbUpperData);
      }

      if (bbLowerData.length > 0) {
        bbLowerSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: 'rgba(0, 242, 254, 0.5)',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: 'BB Lower',
        });
        bbLowerSeries.setData(bbLowerData);
      }
    }
  }

  // ─── Render All ───
  function renderAll(candles, range, options = {}) {
    if (!candles || candles.length === 0) return;

    currentRange = range;
    currentOptions = options;

    if (!mainChart) initMainChart();
    if (!rsiChartObj) initRSIChart();
    if (!macdChartObj) initMACDChart();

    // 1. Deduplicate and sort candles by tvTime
    const uniqueMap = new Map();
    candles.forEach(c => {
      uniqueMap.set(tvTime(c.time), c);
    });
    
    const cleanCandles = Array.from(uniqueMap.values()).sort((a, b) => tvTime(a.time) - tvTime(b.time));
    currentData = cleanCandles;

    // Map Price and Volume
    const uCandles = [];
    const uVol = [];
    
    cleanCandles.forEach(c => {
      const time = tvTime(c.time);
      const open = c.open !== null ? c.open : c.close;
      const high = c.high !== null ? c.high : c.close;
      const low = c.low !== null ? c.low : c.close;
      const close = c.close;
      
      uCandles.push({ time, open, high, low, close });
      uVol.push({
        time,
        value: c.volume || 0,
        color: close >= open ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 51, 102, 0.4)'
      });
    });

    priceSeries.setData(uCandles);
    volumeSeries.setData(uVol);

    // 2. Indicators & Overlays
    const closes = cleanCandles.map(c => c.close);

    // Apply SMA / EMA / BB overlays on the main chart
    applyOverlays(closes, cleanCandles, options);

    mainChart.timeScale().fitContent();

    // RSI
    const rsiRaw = Indicators.RSI(closes, 14);
    const rsiData = [];
    rsiRaw.forEach((val, i) => {
      if (val !== null && i < cleanCandles.length && cleanCandles[i]) rsiData.push({ time: tvTime(cleanCandles[i].time), value: val });
    });
    rsiSeries.setData(rsiData);
    if (rsiData.length > 0) rsiChartObj.timeScale().fitContent();

    // MACD
    const macdRaw = Indicators.MACD(closes);
    const mLine = [], mSig = [], mHist = [];
    
    for (let i = 0; i < closes.length; i++) {
      if (macdRaw.macdLine[i] !== null) {
        const time = tvTime(cleanCandles[i].time);
        mLine.push({ time, value: macdRaw.macdLine[i] });
        mSig.push({ time, value: macdRaw.signalLine[i] });
        mHist.push({
          time,
          value: macdRaw.histogram[i],
          color: macdRaw.histogram[i] >= 0 ? 'rgba(0, 230, 118, 0.6)' : 'rgba(255, 51, 102, 0.6)'
        });
      }
    }
    
    macdLineSeries.setData(mLine);
    macdSignalSeries.setData(mSig);
    macdHistSeries.setData(mHist);
    if (mLine.length > 0) macdChartObj.timeScale().fitContent();

    setupTooltips();
  }

  // ─── Update Overlays Only (toggle without re-fetching data) ───
  function updateOverlays(options) {
    if (currentData && mainChart) {
      currentOptions = options;
      const closes = currentData.map(c => c.close);
      applyOverlays(closes, currentData, options);
    }
  }

  // ─── Append Live Tick ───
  function appendLiveTick(price, timestamp) {
    if (!currentData || !priceSeries || currentData.length === 0) return;
    
    const lastCandle = currentData[currentData.length - 1];
    const newTime = tvTime(timestamp);
    const lastTime = tvTime(lastCandle.time);
    
    const isSameCandle = newTime === lastTime;
    
    if (isSameCandle) {
      lastCandle.close = price;
      lastCandle.high = Math.max(lastCandle.high, price);
      lastCandle.low = Math.min(lastCandle.low, price);
    } else {
      currentData.push({ time: timestamp, open: price, high: price, low: price, close: price, volume: 0 });
    }

    const latest = currentData[currentData.length - 1];
    priceSeries.update({
      time: tvTime(latest.time),
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close
    });
  }

  // ─── Tooltips ───
  function setupTooltips() {
    setupTooltip(macdChartObj, 'macd-chart', param => {
      const mLine = param.seriesData.get(macdLineSeries);
      const mSig = param.seriesData.get(macdSignalSeries);
      const mHist = param.seriesData.get(macdHistSeries);
      if (!mLine) return null;
      
      const timeStr = new Date(param.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="time">${timeStr}</div>
        <div class="row"><div class="dot" style="background:#00f2fe"></div> MACD: ${mLine.value.toFixed(2)}</div>
        <div class="row"><div class="dot" style="background:#ffab00"></div> Signal: ${mSig ? mSig.value.toFixed(2) : '-'}</div>
        <div class="row"><div class="dot" style="background:#00e676"></div> Histogram: ${mHist ? mHist.value.toFixed(2) : '-'}</div>
      `;
    });

    setupTooltip(rsiChartObj, 'rsi-chart', param => {
      const rsi = param.seriesData.get(rsiSeries);
      if (!rsi) return null;
      const timeStr = new Date(param.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="time">${timeStr}</div>
        <div class="row"><div class="dot" style="background:#e040fb"></div> RSI: ${rsi.value.toFixed(2)}</div>
      `;
    });

    setupTooltip(mainChart, 'price-chart', param => {
      const price = param.seriesData.get(priceSeries);
      if (!price) return null;
      const timeStr = new Date(param.time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="time">${timeStr}</div>
        <div class="row"><div class="dot" style="background:#00e676"></div> O: ${price.open.toFixed(2)} H: ${price.high.toFixed(2)}</div>
        <div class="row"><div class="dot" style="background:#ff3366"></div> L: ${price.low.toFixed(2)} C: ${price.close.toFixed(2)}</div>
      `;
    });
  }

  function setupTooltip(chartObj, containerId, renderHtml) {
    const container = document.getElementById(containerId);
    if (!container || !chartObj) return;
    
    let tooltip = container.querySelector('.floating-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'floating-tooltip';
      container.style.position = 'relative';
      container.appendChild(tooltip);
    }

    chartObj.subscribeCrosshairMove(param => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        tooltip.style.display = 'none';
        return;
      }
      const html = renderHtml(param);
      if (!html) {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      const ttWidth = tooltip.offsetWidth;
      const ttHeight = tooltip.offsetHeight;
      let left = param.point.x + 15;
      if (left + ttWidth > container.clientWidth) left = param.point.x - ttWidth - 15;
      let top = param.point.y - 15;
      if (top < 0) top = 0;
      if (top + ttHeight > container.clientHeight) top = container.clientHeight - ttHeight;

      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    });
  }

  return { renderAll, updateOverlays, appendLiveTick };
})();
