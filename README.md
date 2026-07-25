# 📊 StockPulse AI — Indian Market Analyzer

AI-powered stock analysis agent for Indian markets (NSE/BSE). Real-time charts, technical indicators, AI-driven analysis, and a conversational AI assistant — all in a premium dark-themed dashboard.

![StockPulse AI](https://img.shields.io/badge/StockPulse-AI%20Agent-00d4ff?style=for-the-badge)

## Features

- 🏠 **Market Dashboard** — Live NIFTY 50, SENSEX, BANK NIFTY indices
- 📈 **Interactive Charts** — Area charts with time range selection (1D to 5Y)
- 🔬 **Technical Indicators** — RSI, MACD, SMA, EMA, Bollinger Bands
- 🤖 **AI Analysis** — Gemini-powered buy/sell/hold recommendations
- 💬 **AI Chat Assistant** — Ask anything about Indian stocks
- ⭐ **Watchlist** — Save & monitor favorite stocks with live prices
- 🔍 **Stock Search** — Search NSE stocks by name or symbol
- 📊 **Signal Dashboard** — Aggregated signals from all indicators
- 🎨 **Premium UI** — Dark glassmorphism theme with smooth animations

## Quick Start

### 1. Install Node.js (if not installed)
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
```

### 2. Install dependencies
```bash
cd server
npm install
```

### 3. Configure Gemini API key (optional, for AI features)
Get your free key at: https://aistudio.google.com/app/apikey

Either edit `server/.env`:
```
GEMINI_API_KEY=your_key_here
```
Or add it in the app's Settings page.

### 4. Start the server
```bash
cd server
node index.js
```

### 5. Open in browser
Navigate to **http://localhost:3001**

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Frontend | Vanilla HTML/CSS/JS |
| Charts | Chart.js |
| AI | Google Gemini API |
| Data | Yahoo Finance (unofficial) |
| Indicators | Custom (RSI, MACD, SMA, EMA, Bollinger) |

## Project Structure

```
stock-analyzer/
├── server/
│   ├── index.js          # Express API server
│   ├── package.json      # Dependencies
│   └── .env              # API keys
├── public/
│   ├── index.html        # SPA shell
│   ├── style.css         # Design system
│   ├── app.js            # Core app logic
│   ├── api.js            # API client
│   ├── charts.js         # Chart.js integration
│   ├── indicators.js     # Technical calculations
│   └── ai-chat.js        # AI assistant
└── README.md
```

## ⚠️ Disclaimer

This app is for **informational and educational purposes only**. It is not financial advice. Stock data may be delayed ~15 minutes. Always do your own research before investing.
