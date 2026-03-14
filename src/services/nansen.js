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

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "apiKey": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Nansen API ${res.status} on ${endpoint}: ${errText}`);
        return null;
      }

      return await res.json();
    } catch (e) {
      console.error(`Nansen fetch failed: ${e.message}`);
      return null;
    }
  }

  // Smart Money Net Flow
  async getSmartMoneyNetflow(tokenAddress) {
    const ck = `netflow:${tokenAddress}`;
    const cached = this._cached(ck, 10 * 60 * 1000);
    if (cached) return cached;

    const data = await this._fetch("/smart-money/netflow", {
      chain: "solana",
      token_address: tokenAddress,
      time_range: "24h",
    });

    if (data) this._cache(ck, data);
    return data;
  }

  // Smart Money Holdings
  async getSmartMoneyHoldings(tokenAddress) {
    const ck = `holdings:${tokenAddress}`;
    const cached = this._cached(ck, 15 * 60 * 1000);
    if (cached) return cached;

    const data = await this._fetch("/smart-money/holdings", {
      chain: "solana",
      token_address: tokenAddress,
    });

    if (data) this._cache(ck, data);
    return data;
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

  computeSentimentScore(netflowEntry, holdingsEntry) {
    let score = 50;

    // Factor 1: Net flow direction & magnitude (40% weight)
    if (netflowEntry) {
      const netflow = netflowEntry.net_flow_24h_usd || 0;
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
    if (holdingsEntry) {
      const change = holdingsEntry.balance_24h_percent_change || 0;
      if (change > 30) score += 15;
      else if (change > 15) score += 10;
      else if (change > 5) score += 5;
      else if (change > -5) score += 0;
      else if (change > -15) score -= 5;
      else if (change > -30) score -= 10;
      else score -= 15;
    }

    // Factor 3: Smart money share of holdings (20% weight)
    if (holdingsEntry) {
      const smartMoneyPct = holdingsEntry.share_of_holdings_percent || 0;
      if (smartMoneyPct > 25) score += 10;
      else if (smartMoneyPct > 15) score += 6;
      else if (smartMoneyPct > 5) score += 2;
      else score -= 4;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
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

  getConfidence(netflowEntry, holdingsEntry) {
    let dataPoints = 0;
    if (netflowEntry) dataPoints++;
    if (holdingsEntry) dataPoints++;
    if (dataPoints === 0) return "LOW";
    if (dataPoints === 1) return "MEDIUM";
    return "HIGH";
  }

  // ════════════════════════════════════════
  // FULL TOKEN INTELLIGENCE (one call per token)
  // ════════════════════════════════════════

  // includeHolders should only be true for on-demand token detail page loads
  // — skipping it in the regular scan saves 1/3 of Nansen credits
  async getTokenIntelligence(tokenAddress, includeHolders = false) {
    if (!this.enabled) {
      return this._mockIntelligence(tokenAddress);
    }

    const [netflow, holdings, holders] = await Promise.all([
      this.getSmartMoneyNetflow(tokenAddress),
      this.getSmartMoneyHoldings(tokenAddress),
      includeHolders ? this.getHolderDistribution(tokenAddress) : Promise.resolve(null),
    ]);

    // Extract the first matching entry for this token
    const netflowEntry = netflow?.data?.find(
      d => d.token_address?.toLowerCase() === tokenAddress.toLowerCase()
    ) || netflow?.data?.[0] || null;

    const holdingsEntry = holdings?.data?.find(
      d => d.token_address?.toLowerCase() === tokenAddress.toLowerCase()
    ) || holdings?.data?.[0] || null;

    const sentimentScore = this.computeSentimentScore(netflowEntry, holdingsEntry);
    const trend = this.getTrend(sentimentScore);
    const confidence = this.getConfidence(netflowEntry, holdingsEntry);

    const netflowUsd = netflowEntry?.net_flow_24h_usd || 0;
    const holdingsChangePct = holdingsEntry?.balance_24h_percent_change || 0;
    const smartMoneyPct = holdingsEntry?.share_of_holdings_percent || 0;
    const smartMoneyCount = holdingsEntry?.holders_count || 0;

    // Holder distribution: smart money from holdings, retail as remainder
    const holdersList = holders?.data || [];
    const exchangePct = holdersList.reduce((sum, h) => sum + (h.ownership_percentage || 0), 0);
    const retailPct = Math.max(0, 100 - smartMoneyPct - exchangePct);

    return {
      tokenAddress,
      timestamp: Date.now(),
      sentimentScore,
      trend,
      confidence,
      netflowUsd,
      holdingsChangePct,
      smartMoneyPct,
      retailPct,
      exchangePct,
      smartMoneyCount,
      _isAccumulating: sentimentScore >= 60 && holdingsChangePct > 5,
      _isDistributing: sentimentScore <= 40 && holdingsChangePct < -5,
      _hasNewEntry: smartMoneyCount > 0 && holdingsChangePct > 20,
      _hasExit: holdingsChangePct < -20,
      _isHighConviction: sentimentScore >= 75 && confidence === "HIGH",
    };
  }

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
