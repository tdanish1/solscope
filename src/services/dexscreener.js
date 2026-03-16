// DexScreener market intelligence service
// Free, no API key needed.
// Provides: price, volume, buy/sell pressure, price momentum for any Solana token.

class DexScreenerService {
  constructor() {
    this.baseUrl = 'https://api.dexscreener.com/latest/dex';
    this.cache = new Map();
    this.callCount = 0;
    console.log('  ✓ DexScreener connected (market intelligence)');
  }

  _cached(key, maxAge) {
    const e = this.cache.get(key);
    if (e && Date.now() - e.t < maxAge) return e.d;
    return null;
  }

  _cache(key, data) {
    this.cache.set(key, { d: data, t: Date.now() });
    if (this.cache.size > 200) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
  }

  async getTokenPair(mintAddress) {
    const ck = `pair:${mintAddress}`;
    const cached = this._cached(ck, 5 * 60 * 1000);
    if (cached) return cached;

    try {
      this.callCount++;
      const res = await fetch(`${this.baseUrl}/tokens/${mintAddress}`);
      if (!res.ok) return null;
      const data = await res.json();

      const pairs = (data.pairs || []).filter(p => p.chainId === 'solana');
      if (pairs.length === 0) return null;

      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const best = pairs[0];
      this._cache(ck, best);
      return best;
    } catch (e) {
      console.error(`DexScreener fetch failed for ${mintAddress}: ${e.message}`);
      return null;
    }
  }

  computeIntelligence(pair, mintAddress) {
    if (!pair) {
      return {
        tokenAddress: mintAddress,
        timestamp: Date.now(),
        sentimentScore: 50,
        trend: 'NEUTRAL',
        confidence: 'LOW',
        netflowUsd: 0,
        holdingsChangePct: 0,
        smartMoneyPct: 0,
        retailPct: 100,
        exchangePct: 0,
        smartMoneyCount: 0,
        volume24h: 0,
        buyRatio: 0.5,
        priceChange24h: 0,
        priceChange1h: 0,
        _isAccumulating: false,
        _isDistributing: false,
        _hasNewEntry: false,
        _hasExit: false,
        _isHighConviction: false,
      };
    }

    const buys24h = pair.txns?.h24?.buys || 0;
    const sells24h = pair.txns?.h24?.sells || 0;
    const total24h = buys24h + sells24h;
    const buyRatio = total24h > 0 ? buys24h / total24h : 0.5;

    const priceChange24h = pair.priceChange?.h24 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const volume24h = pair.volume?.h24 || 0;
    const volume1h = pair.volume?.h1 || 0;

    // Sentiment score (0–100)
    let score = 50;
    score += Math.round((buyRatio - 0.5) * 40);           // buy/sell pressure  (±20)
    score += Math.max(-15, Math.min(15, Math.round(priceChange24h * 0.75))); // 24h momentum (±15)
    score += Math.max(-10, Math.min(10, Math.round(priceChange1h * 1.2)));   // 1h momentum  (±10)
    if (volume24h > 0) {
      const avgHourly = volume24h / 24;
      if (avgHourly > 0) {
        const volMomentum = Math.round((volume1h / avgHourly - 1) * 5);
        score += Math.max(-5, Math.min(5, volMomentum)); // volume spike (±5)
      }
    }
    score = Math.max(0, Math.min(100, score));

    // Net flow: buy imbalance * volume
    const netflowUsd = Math.round((buyRatio - 0.5) * 2 * volume24h);
    const confidence = volume24h > 1_000_000 ? 'HIGH' : volume24h > 100_000 ? 'MEDIUM' : 'LOW';

    return {
      tokenAddress: mintAddress,
      timestamp: Date.now(),
      sentimentScore: score,
      trend: score >= 65 ? 'ACCUMULATION' : score <= 35 ? 'DISTRIBUTION' : 'NEUTRAL',
      confidence,
      netflowUsd,
      holdingsChangePct: priceChange24h,
      smartMoneyPct: 0,
      retailPct: 100,
      exchangePct: 0,
      smartMoneyCount: 0,
      volume24h,
      buyRatio,
      priceChange24h,
      priceChange1h,
      _isAccumulating: score >= 62 && priceChange24h > 2,
      _isDistributing: score <= 38 && priceChange24h < -2,
      _hasNewEntry: buyRatio > 0.62 && volume24h > 500_000 && priceChange1h > 1,
      _hasExit: buyRatio < 0.38 && volume24h > 500_000 && priceChange1h < -1,
      _isHighConviction: score >= 75 && confidence === 'HIGH',
    };
  }

  async getTokenIntelligence(mintAddress) {
    const pair = await this.getTokenPair(mintAddress);
    return this.computeIntelligence(pair, mintAddress);
  }

  getTrend(score, previousScore) {
    if (previousScore !== null && previousScore !== undefined) {
      const delta = score - previousScore;
      if (delta > 15) return 'STRONG_ACCUMULATION';
      if (delta > 5) return 'ACCUMULATION';
      if (delta < -15) return 'STRONG_DISTRIBUTION';
      if (delta < -5) return 'DISTRIBUTION';
    }
    if (score >= 80) return 'STRONG_ACCUMULATION';
    if (score >= 65) return 'ACCUMULATION';
    if (score <= 20) return 'STRONG_DISTRIBUTION';
    if (score <= 35) return 'DISTRIBUTION';
    return 'NEUTRAL';
  }

  getStats() {
    return { calls: this.callCount, cacheSize: this.cache.size };
  }
}

export default DexScreenerService;
