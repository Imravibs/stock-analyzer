import fetch from 'node-fetch'; // No, use global fetch in Node 24

const symbols = ['RELIANCE.NS', 'TCS.NS'].join(',');
const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;

fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  }
})
.then(r => r.json())
.then(data => {
  console.log(data.quoteResponse.result.map(q => ({ sym: q.symbol, price: q.regularMarketPrice })));
})
.catch(console.error);
