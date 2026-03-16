// Nansen API service

class NansenService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.nansen.ai/api/v1";
    this.cache = new Map();
    this.callCount = 0;
    this.creditUsed = 0;
    this.creditBudget = 10_000_000;

    if (!apiKey || apiKey === "your_nansen_api_key") {
      this.enabled = false;
      console.log("  ⚠ Nansen not configured (running without smart money data)");
    } else {
      this.enabled = true;
      console.log("  ✓ Nansen connected (intelligence layer — 10M credits)");
    }
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

  async _fetch(endpoint, body = {}) {
    if (!this.enabled) return null;

    this.callCount++;
    this.creditUsed += 5;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "apiKey": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Nansen API ${res.status} on ${endpoint}: ${errText}`);
        return null;
      }

      return await res.json();
    } catch (e) {
      clearTimeout(timeout);
      console.error(`Nansen fetch failed: ${e.message}`);
      return null;
    }
  }

  // Bulk Smart Money Net Flow — all Solana tokens Nansen is tracking, no per-token filter needed
  async getAllSolanaNetflow(perPage = 50) {
    const ck = `bulk_netflow_solana`;
    const cached = this._cached(ck, 10 * 60 * 1000);
    if (cached) return cached;

    const data = await this._fetch("/smart-money/netflow", {
      chains: ["solana"],
      pagination: { per_page: perPage },
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // Per-token smart money intelligence via TGM flow-intelligence
  // Fetches 1h, 1d, and 7d timeframes. Works for ALL tokens including native SOL.
  // Each timeframe is cached independently with its own TTL to optimize credit usage:
  //   1h  -> 5 min   (fast-moving, needs freshness)
  //   1d  -> 15 min  (standard scan interval)
  //   7d  -> 60 min  (slow-moving, saves ~2/3 of 7d API calls)
  async getTokenNetflow(tokenAddress) {
    const ck1h = `token_netflow_1h:${tokenAddress}`;
    const ck1d = `token_netflow_1d:${tokenAddress}`;
    const ck7d = `token_netflow_7d:${tokenAddress}`;

    const cached1h = this._cached(ck1h, 5 * 60 * 1000);
    const cached1d = this._cached(ck1d, 15 * 60 * 1000);
    const cached7d = this._cached(ck7d, 60 * 60 * 1000);

    const fetchFlow = (tf) => this._fetch("/tgm/flow-intelligence", {
      chain: "solana",
      token_address: tokenAddress,
      timeframe: tf,
    });

    // Only fetch timeframes whose cache has expired
    const [data1h, data1d, data7d] = await Promise.all([
      cached1h ? Promise.resolve(cached1h) : fetchFlow("1h"),
      cached1d ? Promise.resolve(cached1d) : fetchFlow("1d"),
      cached7d ? Promise.resolve(cached7d) : fetchFlow("7d"),
    ]);

    // Cache each raw API response individually
    if (!cached1h && data1h) this._cache(ck1h, data1h);
    if (!cached1d && data1d) this._cache(ck1d, data1d);
    if (!cached7d && data7d) this._cache(ck7d, data7d);

    const f1d = data1d?.data?.[0];
    if (!f1d) return null;

    const sumSmartFlow = (f) => {
      if (!f) return { flow: 0, wallets: 0 };
      return {
        flow: (f.smart_trader_net_flow_usd || 0) + (f.top_pnl_net_flow_usd || 0) + (f.whale_net_flow_usd || 0),
        wallets: (f.smart_trader_wallet_count || 0) + (f.top_pnl_wallet_count || 0) + (f.whale_wallet_count || 0),
      };
    };

    const flow1h = sumSmartFlow(data1h?.data?.[0]);
    const flow1d = sumSmartFlow(f1d);
    const flow7d = sumSmartFlow(data7d?.data?.[0]);

    return {
      token_address: tokenAddress,
      token_symbol: null,
      net_flow_1h_usd: flow1h.flow,
      net_flow_24h_usd: flow1d.flow,
      net_flow_7d_usd: flow7d.flow,
      net_flow_30d_usd: 0,
      chain: "solana",
      trader_count: flow1d.wallets,
      market_cap_usd: 0,
      token_sectors: [],
    };
  }

  // Token Holder Distribution (smart money holders via TGM)
  async getHolderDistribution(tokenAddress) {
    const ck = `holders:${tokenAddress}`;
    const cached = this._cached(ck, 30 * 60 * 1000);
    if (cached) return cached;

    const data = await this._fetch("/tgm/holders", {
      chain: "solana",
      token_address: tokenAddress,
      label_type: "smart_money",
      pagination: { per_page: 100 },
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // ════════════════════════════════════════
  // DERIVED INTELLIGENCE (safe to display)
  // ════════════════════════════════════════

  // Compute full intelligence snapshot from a Nansen netflow entry
  computeIntelligenceFromNetflow(entry) {
    const netflow24h = entry.net_flow_24h_usd || 0;
    const netflow1h  = entry.net_flow_1h_usd  || 0;
    const netflow7d  = entry.net_flow_7d_usd  || 0;
    const traderCount = entry.trader_count || 0;

    let score = 50;

    // Factor 1: 24h net flow direction & magnitude (±25 pts)
    if      (netflow24h >  50000) score += 25;
    else if (netflow24h >  10000) score += 20;
    else if (netflow24h >   5000) score += 15;
    else if (netflow24h >   1000) score += 10;
    else if (netflow24h >      0) score +=  5;
    else if (netflow24h >  -1000) score -=  5;
    else if (netflow24h >  -5000) score -= 10;
    else if (netflow24h > -10000) score -= 15;
    else if (netflow24h > -50000) score -= 20;
    else                          score -= 25;

    // Factor 2: Smart money wallet count (±15 pts) — more wallets = stronger conviction
    if      (traderCount >= 20) score += 15;
    else if (traderCount >= 10) score += 10;
    else if (traderCount >=  5) score +=  7;
    else if (traderCount >=  2) score +=  3;

    // Factor 3: 7d trend alignment with 24h (±10 pts)
    if      (netflow7d > 0 && netflow24h > 0) score += 10; // sustained accumulation
    else if (netflow7d < 0 && netflow24h < 0) score -= 10; // sustained distribution
    else if (netflow7d < 0 && netflow24h > 0) score +=  3; // possible reversal (bullish)
    else if (netflow7d > 0 && netflow24h < 0) score -=  5; // trend breaking down

    score = Math.max(0, Math.min(100, Math.round(score)));

    // holdingsChangePct: daily flow velocity relative to 7d baseline
    const dailyAvg7d = netflow7d / 7;
    const holdingsChangePct = dailyAvg7d !== 0
      ? Math.max(-100, Math.min(100, Math.round((netflow24h / Math.abs(dailyAvg7d) - 1) * 10)))
      : (netflow24h > 0 ? 20 : netflow24h < 0 ? -20 : 0);

    const confidence = traderCount >= 10 ? 'HIGH' : traderCount >= 3 ? 'MEDIUM' : 'LOW';

    return {
      tokenAddress: entry.token_address,
      timestamp: Date.now(),
      sentimentScore: score,
      trend: score >= 65 ? 'ACCUMULATION' : score <= 35 ? 'DISTRIBUTION' : 'NEUTRAL',
      confidence,
      netflowUsd: netflow24h,
      netflow1h,
      netflow7d,
      holdingsChangePct,
      smartMoneyPct: 0,
      retailPct: 100,
      exchangePct: 0,
      smartMoneyCount: traderCount,
      marketCap: entry.market_cap_usd || 0,
      tokenSectors: entry.token_sectors || [],
      _isAccumulating: score >= 65 && netflow24h > 0,
      _isDistributing: score <= 35 && netflow24h < 0,
      _hasNewEntry: traderCount >= 2 && netflow1h > 0 && netflow24h > 0,
      _hasExit: netflow1h < 0 && netflow24h < 0 && traderCount >= 2,
      _isHighConviction: score >= 75 && traderCount >= 5,
    };
  }

  getTrend(score, previousScore) {
    if (previousScore !== null && previousScore !== undefined) {
      const delta = score - previousScore;
      if (delta > 15) return "STRONG_ACCUMULATION";
      if (delta > 5) return "ACCUMULATION";
      if (delta < -15) return "STRONG_DISTRIBUTION";
      if (delta < -5) return "DISTRIBUTION";
    }

    if (score >= 80) return "STRONG_ACCUMULATION";
    if (score >= 60) return "ACCUMULATION";
    if (score <= 20) return "STRONG_DISTRIBUTION";
    if (score <= 40) return "DISTRIBUTION";
    return "NEUTRAL";
  }


  getStats() {
    return {
      enabled: this.enabled,
      calls: this.callCount,
      creditsUsed: this.creditUsed,
      creditsRemaining: this.creditBudget - this.creditUsed,
      cacheSize: this.cache.size,
    };
  }
}

export default NansenService;
