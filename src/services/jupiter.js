// ============================================
// JUPITER SERVICE — Market Context Layer
// ============================================
// Role: Token prices, liquidity, market data.
// The "eyes" of SolScope.
//
// Uses current api.jup.ag (not deprecated lite-api)
// Cost: Free (rate-limited generously)
// ============================================

// Well-known Solana token addresses
const KNOWN_TOKENS = {
  SOL: "So11111111111111111111111111111111111111112",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  RENDER: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
  HNT: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
  DRIFT: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  MOBILE: "mb1eu7TzEc71KxDpsmsKoucSSuuo6KWcsQEP9gQLy2g",
  SAMO: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  BOME: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
};

class JupiterService {
  constructor(apiKey) {
    // Current correct base URL per Jupiter developer docs
    this.baseUrl = "https://api.jup.ag";
    this.apiKey = apiKey || null;
    this.cache = new Map();
    this.callCount = 0;

    console.log("  ✓ Jupiter connected (market layer)");
  }

  _cached(key, maxAge = 30000) {
    const e = this.cache.get(key);
    if (e && Date.now() - e.t < maxAge) return e.d;
    return null;
  }
  _cache(key, data) {
    this.cache.set(key, { d: data, t: Date.now() });
    if (this.cache.size > 300) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
  }

  _headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  // ── Get prices for multiple tokens ──
  async getPrices(mintAddresses) {
    const ids = mintAddresses.join(",");
    const ck = `prices:${ids}`;
    const cached = this._cached(ck, 15000); // 15s cache for prices
    if (cached) return cached;

    this.callCount++;
    try {
      const res = await fetch(`${this.baseUrl}/price/v2?ids=${ids}`, {
        headers: this._headers(),
      });
      const data = await res.json();
      this._cache(ck, data.data || {});
      return data.data || {};
    } catch (e) {
      console.error("Jupiter price fetch failed:", e.message);
      return {};
    }
  }

  // ── Get token list (verified tokens) ──
  async getVerifiedTokens(limit = 100) {
    const ck = "verified_tokens";
    const cached = this._cached(ck, 300000); // 5 min cache
    if (cached) return cached;

    this.callCount++;
    try {
      const res = await fetch(`${this.baseUrl}/tokens/v1`, {
        headers: this._headers(),
      });
      const tokens = await res.json();
      const result = tokens.slice(0, limit);
      this._cache(ck, result);
      return result;
    } catch (e) {
      console.error("Jupiter token list fetch failed:", e.message);
      return [];
    }
  }

  // ── Get single token info ──
  async getTokenInfo(mintAddress) {
    const ck = `token:${mintAddress}`;
    const cached = this._cached(ck, 120000);
    if (cached) return cached;

    this.callCount++;
    try {
      const res = await fetch(`${this.baseUrl}/tokens/v1/${mintAddress}`, {
        headers: this._headers(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      this._cache(ck, data);
      return data;
    } catch (e) {
      return null;
    }
  }

  // ── Build tracked token universe from known tokens ──
  async buildTokenUniverse() {
    const mints = Object.values(KNOWN_TOKENS);
    const prices = await this.getPrices(mints);

    const universe = [];
    for (const [symbol, mint] of Object.entries(KNOWN_TOKENS)) {
      const priceData = prices[mint];
      universe.push({
        mint,
        symbol,
        price: priceData ? parseFloat(priceData.price) : 0,
        // We'll enrich with Nansen data later
        tier: "warm", // hot/warm/cold — determines refresh frequency
      });
    }
    return universe;
  }

  // ── Resolve symbol to mint address ──
  resolveMint(symbolOrMint) {
    if (symbolOrMint.length > 20) return symbolOrMint; // already a mint
    return KNOWN_TOKENS[symbolOrMint.toUpperCase()] || null;
  }

  // ── Resolve mint to symbol ──
  resolveSymbol(mint) {
    for (const [sym, addr] of Object.entries(KNOWN_TOKENS)) {
      if (addr === mint) return sym;
    }
    return mint.slice(0, 6) + "...";
  }

  getStats() {
    return { calls: this.callCount, cacheSize: this.cache.size, trackedTokens: Object.keys(KNOWN_TOKENS).length };
  }
}

export { KNOWN_TOKENS };
export default JupiterService;
