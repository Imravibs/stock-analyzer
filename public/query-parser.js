/* ═══════════════════════════════════════════════════════════
   query-parser.js — Proper grammar + AST DSL parser for the screener
   
   Grammar:
     query    → expr
     expr     → term (("AND" | "OR") term)*
     term     → "(" expr ")" | comparison
     comparison → fieldExpr op valueExpr
     fieldExpr  → field | field ("*" | "/" | "+" | "-") NUMBER
     op         → ">" | "<" | ">=" | "<=" | "=" | "!="
     valueExpr  → NUMBER | NUMBER "%"
     field      → known field name (case-insensitive, multi-word)

   Examples:
     PE < 20
     Market Cap > 500000000000 AND Dividend Yield > 2
     Current price > 52W High * 0.85 AND ROE > 15
     (PE < 20 OR Dividend Yield > 3) AND Market Cap > 100000000000
   ═══════════════════════════════════════════════════════════ */

const QueryParser = (() => {

  // ─── Field Aliases → canonical data keys ───
  const FIELD_MAP = {
    'price': 'price',
    'current price': 'price',
    'cmp': 'price',
    'market cap': 'marketCap',
    'marketcap': 'marketCap',
    'market capitalization': 'marketCap',
    'pe': 'peRatio',
    'p/e': 'peRatio',
    'pe ratio': 'peRatio',
    'p/e ratio': 'peRatio',
    'price to earning': 'peRatio',
    'dividend yield': 'dividendYield',
    'div yield': 'dividendYield',
    '52w high': 'fiftyTwoWeekHigh',
    '52 week high': 'fiftyTwoWeekHigh',
    'high price': 'fiftyTwoWeekHigh',
    '52w low': 'fiftyTwoWeekLow',
    '52 week low': 'fiftyTwoWeekLow',
    'low price': 'fiftyTwoWeekLow',
    'volume': 'volume',
    'change': 'changePercent',
    'change %': 'changePercent',
    'change percent': 'changePercent',
    'roe': 'roe',
    'return on equity': 'roe',
    'roce': 'roce',
    'return on capital employed': 'roce',
    'debt to equity': 'debtToEquity',
    'debt/equity': 'debtToEquity',
    'd/e': 'debtToEquity',
    'net margin': 'netMargin',
    'profit margin': 'netMargin',
    'operating margin': 'operatingMargin',
    'gross margin': 'grossMargin',
    'beta': 'beta',
    'book value': 'bookValue',
    'revenue growth': 'revenueGrowth',
    'earnings growth': 'earningsGrowth',
    'current ratio': 'currentRatio',
    'roa': 'roa',
    'return on assets': 'roa',
  };

  // ─── Tokenizer ───
  const TOKEN = {
    NUMBER: 'NUMBER',
    FIELD: 'FIELD',
    OP: 'OP',
    ARITH: 'ARITH',
    AND: 'AND',
    OR: 'OR',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    PERCENT: 'PERCENT',
    EOF: 'EOF',
  };

  function tokenize(input) {
    const tokens = [];
    let i = 0;
    const src = input.trim();

    while (i < src.length) {
      // skip whitespace
      if (/\s/.test(src[i])) { i++; continue; }

      // two-char operators
      if (i + 1 < src.length) {
        const two = src.slice(i, i + 2);
        if (['>=', '<=', '!='].includes(two)) {
          tokens.push({ type: TOKEN.OP, value: two });
          i += 2;
          continue;
        }
      }

      // single-char operators
      if (['>', '<', '='].includes(src[i])) {
        tokens.push({ type: TOKEN.OP, value: src[i] });
        i++; continue;
      }

      // arithmetic operators
      if (['*', '/', '+', '-'].includes(src[i]) && tokens.length > 0) {
        tokens.push({ type: TOKEN.ARITH, value: src[i] });
        i++; continue;
      }

      // parens
      if (src[i] === '(') { tokens.push({ type: TOKEN.LPAREN, value: '(' }); i++; continue; }
      if (src[i] === ')') { tokens.push({ type: TOKEN.RPAREN, value: ')' }); i++; continue; }

      // percent
      if (src[i] === '%') { tokens.push({ type: TOKEN.PERCENT, value: '%' }); i++; continue; }

      // number
      if (/[\d.]/.test(src[i])) {
        let num = '';
        while (i < src.length && /[\d.]/.test(src[i])) { num += src[i++]; }
        tokens.push({ type: TOKEN.NUMBER, value: parseFloat(num) });
        continue;
      }

      // word/identifier — could be AND, OR, or a field name
      if (/[a-zA-Z_\/]/.test(src[i])) {
        let word = '';
        const wordStart = i;
        // consume the word, including spaces for multi-word field names
        // We'll try to match longest known field name first
        let j = i;
        while (j < src.length && /[a-zA-Z0-9_\/\s%]/.test(src[j])) {
          // stop at operators or parens
          if (['(', ')', '<', '>', '=', '!', '*', '+'].includes(src[j])) break;
          word += src[j++];
        }
        word = word.trim();

        const upper = word.toUpperCase();
        if (upper === 'AND') { tokens.push({ type: TOKEN.AND, value: 'AND' }); i = j; continue; }
        if (upper === 'OR') { tokens.push({ type: TOKEN.OR, value: 'OR' }); i = j; continue; }

        // Try to match a field name (longest match, case-insensitive)
        const lower = word.toLowerCase().trim();
        let matchedField = null;
        let matchedLen = 0;

        // Sort by length desc for longest match
        const sortedFields = Object.keys(FIELD_MAP).sort((a, b) => b.length - a.length);
        for (const f of sortedFields) {
          if (lower.startsWith(f)) {
            matchedField = f;
            matchedLen = f.length;
            break;
          }
        }

        if (matchedField) {
          tokens.push({ type: TOKEN.FIELD, value: FIELD_MAP[matchedField], raw: matchedField });
          // only advance by the matched field length in the original string
          i = wordStart;
          let consumed = 0;
          let skipSpaces = 0;
          while (consumed < matchedLen || skipSpaces < matchedLen) {
            if (i >= src.length) break;
            if (/\s/.test(src[i])) { i++; continue; }
            i++;
            consumed++;
            if (consumed >= matchedLen) break;
          }
          continue;
        }

        // Unknown word — skip it
        i = j;
        continue;
      }

      i++; // skip unknown chars
    }

    tokens.push({ type: TOKEN.EOF });
    return tokens;
  }

  // ─── Parser (recursive descent) ───
  function parse(tokens) {
    let pos = 0;

    function peek() { return tokens[pos]; }
    function consume() { return tokens[pos++]; }

    function parseExpr() {
      let left = parseTerm();
      while (peek().type === TOKEN.AND || peek().type === TOKEN.OR) {
        const op = consume().type === TOKEN.AND ? 'AND' : 'OR';
        const right = parseTerm();
        left = { type: 'LOGICAL', op, left, right };
      }
      return left;
    }

    function parseTerm() {
      if (peek().type === TOKEN.LPAREN) {
        consume(); // (
        const expr = parseExpr();
        if (peek().type === TOKEN.RPAREN) consume(); // )
        return expr;
      }
      return parseComparison();
    }

    function parseComparison() {
      const fieldExpr = parseFieldExpr();
      const op = peek().type === TOKEN.OP ? consume().value : null;
      if (!op) return fieldExpr;
      const val = parseValueExpr();
      return { type: 'COMPARISON', op, left: fieldExpr, right: val };
    }

    function parseFieldExpr() {
      if (peek().type !== TOKEN.FIELD) {
        // might be a number on the left side (unusual but handle gracefully)
        if (peek().type === TOKEN.NUMBER) {
          const num = consume().value;
          return { type: 'NUMBER', value: num };
        }
        return { type: 'UNKNOWN' };
      }
      const field = consume().value;
      const node = { type: 'FIELD', name: field };

      // check for arithmetic: field * NUMBER, field / NUMBER, etc.
      if (peek().type === TOKEN.ARITH) {
        const arithOp = consume().value;
        const right = peek().type === TOKEN.NUMBER ? consume().value : null;
        if (right !== null) {
          return { type: 'ARITH', op: arithOp, left: node, right: { type: 'NUMBER', value: right } };
        }
      }
      return node;
    }

    function parseValueExpr() {
      if (peek().type === TOKEN.NUMBER) {
        const num = consume().value;
        // consume optional % sign
        if (peek().type === TOKEN.PERCENT) {
          consume();
          return { type: 'NUMBER', value: num, isPercent: true };
        }
        return { type: 'NUMBER', value: num };
      }
      if (peek().type === TOKEN.FIELD) {
        // value could also be a field reference (e.g. "52W High * 0.85")
        const f = consume().value;
        const node = { type: 'FIELD', name: f };
        if (peek().type === TOKEN.ARITH) {
          const arithOp = consume().value;
          const right = peek().type === TOKEN.NUMBER ? consume().value : null;
          if (right !== null) {
            return { type: 'ARITH', op: arithOp, left: node, right: { type: 'NUMBER', value: right } };
          }
        }
        return node;
      }
      return { type: 'NUMBER', value: 0 };
    }

    return parseExpr();
  }

  // ─── AST Evaluator ───
  function evalNode(node, stock) {
    if (!node) return null;
    switch (node.type) {
      case 'NUMBER': return node.value;
      case 'FIELD': return stock[node.name] ?? null;
      case 'ARITH': {
        const l = evalNode(node.left, stock);
        const r = evalNode(node.right, stock);
        if (l == null || r == null) return null;
        if (node.op === '*') return l * r;
        if (node.op === '/') return r !== 0 ? l / r : null;
        if (node.op === '+') return l + r;
        if (node.op === '-') return l - r;
        return null;
      }
      case 'COMPARISON': {
        const l = evalNode(node.left, stock);
        const r = evalNode(node.right, stock);
        if (l == null) return false;
        const rv = r ?? 0;
        if (node.op === '>') return l > rv;
        if (node.op === '<') return l < rv;
        if (node.op === '>=') return l >= rv;
        if (node.op === '<=') return l <= rv;
        if (node.op === '=') return Math.abs(l - rv) < 0.001;
        if (node.op === '!=') return Math.abs(l - rv) >= 0.001;
        return false;
      }
      case 'LOGICAL': {
        const l = evalNode(node.left, stock);
        if (node.op === 'AND') return l && evalNode(node.right, stock);
        if (node.op === 'OR') return l || evalNode(node.right, stock);
        return false;
      }
      default: return null;
    }
  }

  // ─── Public API ───
  function compile(queryText) {
    if (!queryText || !queryText.trim()) return null;
    try {
      const tokens = tokenize(queryText);
      const ast = parse(tokens);
      return ast;
    } catch (e) {
      console.error('Query parse error:', e);
      return null;
    }
  }

  function evaluate(ast, stock) {
    if (!ast) return true; // no filter = match all
    try {
      const result = evalNode(ast, stock);
      return result === true;
    } catch (e) {
      return false;
    }
  }

  function filter(queryText, stocks) {
    const ast = compile(queryText);
    return stocks.filter(s => evaluate(ast, s));
  }

  // Explain the AST in human-readable form (for NL-to-query preview)
  function explain(ast, depth = 0) {
    if (!ast) return '';
    const indent = '  '.repeat(depth);
    switch (ast.type) {
      case 'COMPARISON':
        return `${indent}${ast.left.name || '?'} ${ast.op} ${ast.right.value ?? ast.right.name}`;
      case 'LOGICAL':
        return `${indent}(\n${explain(ast.left, depth + 1)}\n${indent}  ${ast.op}\n${explain(ast.right, depth + 1)}\n${indent})`;
      default: return `${indent}[${ast.type}]`;
    }
  }

  return { compile, evaluate, filter, explain, FIELD_MAP };
})();
