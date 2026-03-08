// Nansen API service
// behavior and transforms it into derived signals.
//
//
//

class NansenService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.nansen.ai";
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

  async _fetch(endpoint, params = {}) {
    if (!this.enabled) return null;

    this.callCount++;
    this.creditUsed += 5; // each call costs 5 credits

    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    try {
      const res = await fetch(url.toString(), {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Nansen API ${res.status}: ${errText}`);
        return null;
      }

      return await res.json();
    } catch (e) {
      console.error(`Nansen fetch failed: ${e.message}`);
      return null;
    }
  }

  // Smart Money Net Flow
  // Returns: net inflow/outflow $ for a token
  async getSmartMoneyNetflow(tokenAddress, timeframe = "24h") {
    const ck = `netflow:${tokenAddress}:${timeframe}`;
    const cached = this._cached(ck, 10 * 60 * 1000); // 10 min cache
    if (cached) return cached;

    const data = await this._fetch("/v1/smart-money/inflows/netflow", {
      chain: "solana",
      token_address: tokenAddress,
      timeframe,
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // Smart Money Holdings
  // Returns: how much smart money holds of a token
  async getSmartMoneyHoldings(tokenAddress) {
    const ck = `holdings:${tokenAddress}`;
    const cached = this._cached(ck, 15 * 60 * 1000); // 15 min cache
    if (cached) return cached;

    const data = await this._fetch("/v1/smart-money/holdings", {
      chain: "solana",
      token_address: tokenAddress,
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // Token Holder Distribution
  // Returns: % smart money vs retail vs exchange
  async getHolderDistribution(tokenAddress) {
    const ck = `holders:${tokenAddress}`;
    const cached = this._cached(ck, 30 * 60 * 1000); // 30 min cache
    if (cached) return cached;

    const data = await this._fetch("/v1/tgm/holders", {
      chain: "solana",
      token_address: tokenAddress,
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // ════════════════════════════════════════
  // DERIVED INTELLIGENCE (safe to display)
  // ════════════════════════════════════════

  // Compute Smart Money Sentiment Score (0-100)
  // This is SolScope's proprietary metric — safe to show
  computeSentimentScore(netflowData, holdingsData, holderData) {
    let score = 50; // neutral baseline

    // Factor 1: Net flow direction & magnitude (40% weight)
    if (netflowData) {
      const netflow = netflowData.net_flow_usd || netflowData.netflow || 0;
      if (netflow > 5000000) score += 20;
      else if (netflow > 1000000) score += 14;
      else if (netflow > 500000) score += 8;
      else if (netflow > 0) score += 3;
      else if (netflow > -500000) score -= 3;
      else if (netflow > -1000000) score -= 8;
      else if (netflow > -5000000) score -= 14;
      else score -= 20;
    }

    // Factor 2: Holdings change trend (30% weight)
    if (holdingsData) {
      const change = holdingsData.holdings_change_pct || holdingsData.change_pct || 0;
      if (change > 30) score += 15;
      else if (change > 15) score += 10;
      else if (change > 5) score += 5;
      else if (change > -5) score += 0;
      else if (change > -15) score -= 5;
      else if (change > -30) score -= 10;
      else score -= 15;
    }

    // Factor 3: Holder quality (20% weight)
    if (holderData) {
      const smartMoneyPct = holderData.smart_money_pct || holderData.smart_money_percentage || 0;
      if (smartMoneyPct > 25) score += 10;
      else if (smartMoneyPct > 15) score += 6;
      else if (smartMoneyPct > 5) score += 2;
      else score -= 4;
    }

    // Factor 4: Liquidity stability (10% weight) — reserved for later

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Determine trend label from score
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

  // Get confidence level
  getConfidence(netflowData, holdingsData) {
    let dataPoints = 0;
    if (netflowData) dataPoints++;
    if (holdingsData) dataPoints++;
    if (dataPoints === 0) return "LOW";
    if (dataPoints === 1) return "MEDIUM";
    return "HIGH";
  }

  // ════════════════════════════════════════
  // FULL TOKEN INTELLIGENCE (one call per token)
  // ════════════════════════════════════════

  // This is the main method the signal engine calls
  // Returns a complete intelligence snapshot for one token
  async getTokenIntelligence(tokenAddress) {
    if (!this.enabled) {
      return this._mockIntelligence(tokenAddress);
    }

    // Fetch all three data points in parallel
    const [netflow, holdings, holders] = await Promise.all([
      this.getSmartMoneyNetflow(tokenAddress),
      this.getSmartMoneyHoldings(tokenAddress),
      this.getHolderDistribution(tokenAddress),
    ]);

    // Compute derived metrics
    const sentimentScore = this.computeSentimentScore(netflow, holdings, holders);
    const trend = this.getTrend(sentimentScore);
    const confidence = this.getConfidence(netflow, holdings);

    // Extract safe-to-display numbers
    const netflowUsd = netflow?.net_flow_usd || netflow?.netflow || 0;
    const holdingsChangePct = holdings?.holdings_change_pct || holdings?.change_pct || 0;
    const smartMoneyPct = holders?.smart_money_pct || holders?.smart_money_percentage || 0;
    const retailPct = holders?.retail_pct || holders?.retail_percentage || 0;
    const exchangePct = holders?.exchange_pct || holders?.exchange_percentage || 0;
    const smartMoneyCount = holdings?.num_smart_money_holders || holdings?.count || 0;

    return {
      tokenAddress,
      timestamp: Date.now(),
      // Derived scores (safe to display)
      sentimentScore,
      trend,
      confidence,
      // Aggregated numbers (safe — no wallet labels)
      netflowUsd,
      holdingsChangePct,
      smartMoneyPct,
      retailPct,
      exchangePct,
      smartMoneyCount,
      // Raw flags for signal engine
      _isAccumulating: sentimentScore >= 60 && holdingsChangePct > 5,
      _isDistributing: sentimentScore <= 40 && holdingsChangePct < -5,
      _hasNewEntry: smartMoneyCount > 0 && holdingsChangePct > 20,
      _hasExit: holdingsChangePct < -20,
      _isHighConviction: sentimentScore >= 75 && confidence === "HIGH",
    };
  }

  // Mock data when Nansen isn't configured
  _mockIntelligence(tokenAddress) {
    const hash = tokenAddress.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const score = 30 + (hash % 50);
    return {
      tokenAddress,
      timestamp: Date.now(),
      sentimentScore: score,
      trend: score > 60 ? "ACCUMULATION" : score < 40 ? "DISTRIBUTION" : "NEUTRAL",
      confidence: "DEMO",
      netflowUsd: ((hash % 10) - 5) * 500000,
      holdingsChangePct: ((hash % 40) - 20),
      smartMoneyPct: 5 + (hash % 25),
      retailPct: 50 + (hash % 30),
      exchangePct: 100 - (5 + (hash % 25)) - (50 + (hash % 30)),
      smartMoneyCount: hash % 15,
      _isAccumulating: score > 60,
      _isDistributing: score < 40,
      _hasNewEntry: false,
      _hasExit: false,
      _isHighConviction: false,
    };
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
