// Signal processing engine
// "Helius detects, Jupiter contextualizes,
//  Nansen enriches, SolScope scores,
//  then alerts fan out."
//
// This is the heart of SolScope.
// It produces 5 signal types:
//   1. Conviction Increase
//   2. Conviction Decrease
//   3. New Smart Money Entry
//   4. Smart Money Exit
//   5. Liquidity Risk

// Core Solana tokens that should always have intelligence data
const CORE_TOKENS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { symbol: 'PYTH', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  { symbol: 'JTO', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL' },
  { symbol: 'DRIFT', mint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7' },
  { symbol: 'ORCA', mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE' },
  { symbol: 'RENDER', mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof' },
];

const SIGNAL_TYPES = {
  CONVICTION_UP: "CONVICTION_UP",
  CONVICTION_DOWN: "CONVICTION_DOWN",
  SMART_MONEY_ENTRY: "SMART_MONEY_ENTRY",
  SMART_MONEY_EXIT: "SMART_MONEY_EXIT",
  LIQUIDITY_RISK: "LIQUIDITY_RISK",
  SENTIMENT_SPIKE: "SENTIMENT_SPIKE",
};

const SIGNAL_LABELS = {
  CONVICTION_UP: "Conviction Increasing",
  CONVICTION_DOWN: "Conviction Decreasing",
  SMART_MONEY_ENTRY: "Smart Money Entry",
  SMART_MONEY_EXIT: "Smart Money Exit",
  LIQUIDITY_RISK: "Liquidity Risk",
  SENTIMENT_SPIKE: "Sentiment Spike",
};

const SIGNAL_EMOJI = {
  CONVICTION_UP: "🔥",
  CONVICTION_DOWN: "⚠️",
  SMART_MONEY_ENTRY: "🐋",
  SMART_MONEY_EXIT: "🚪",
  LIQUIDITY_RISK: "🔻",
  SENTIMENT_SPIKE: "⚡",
};

class SignalEngine {
  constructor(helius, jupiter, nansen, config = {}) {
    this.helius = helius;
    this.jupiter = jupiter;
    this.nansen = nansen;

    // Thresholds — calibrated for Nansen Solana smart money flows (thousands, not millions)
    this.convictionThreshold = config.convictionThreshold || 1000; // $1K net flow
    this.holdingsChangeThreshold = config.holdingsChangeThreshold || 5; // flow velocity score

    // State
    this.tokenSnapshots = new Map();  // mint → latest intelligence snapshot
    this.previousScores = new Map();  // mint → previous sentiment score
    this.signals = [];                // chronological signal feed
    this.dailyBrief = null;           // morning brief cache
    this.scanCount = 0;

    // Tracked token universe (hot/warm/cold tiers)
    this.trackedTokens = new Map(); // mint → { symbol, tier, lastScan, hotScansRemaining }

    console.log("  ✓ Signal engine initialized");
  }

  // ════════════════════════════════════════
  // TOKEN UNIVERSE MANAGEMENT
  // ════════════════════════════════════════

  async initializeUniverse() {
    const tokens = await this.jupiter.buildTokenUniverse();
    for (const t of tokens) {
      this.trackedTokens.set(t.mint, {
        symbol: t.symbol,
        tier: "warm",
        lastScan: 0,
        price: t.price,
      });
    }
    console.log(`  ✓ Tracking ${this.trackedTokens.size} tokens`);
  }

  // Promote a token to hot tier (scan more frequently)
  // Auto-demotes back to warm after 2 hot scans to protect Nansen credits
  promoteToken(mint) {
    const t = this.trackedTokens.get(mint);
    if (t) {
      t.tier = "hot";
      t.hotScansRemaining = 2;
    }
  }

  // ════════════════════════════════════════
  // MAIN SCAN LOOP
  // ════════════════════════════════════════

  async scan() {
    this.scanCount++;
    const now = Date.now();

    // Nansen's response IS the token universe — whatever smart money is trading
    const nansenData = await this.nansen.getAllSolanaNetflow(100);
    if (!nansenData?.data?.length) {
      console.log(`📡 Scan #${this.scanCount}: Nansen returned no data`);
      return { scanned: 0, signalsGenerated: 0 };
    }

    const entries = nansenData.data;

    // Fetch all prices in one Jupiter call (include core tokens)
    const coreMints = CORE_TOKENS.map(t => t.mint);
    const mints = [...new Set([...entries.map(e => e.token_address), ...coreMints])];
    const prices = await this.jupiter.getPrices(mints);

    // Update trackedTokens to reflect the actual universe
    for (const entry of entries) {
      if (!this.trackedTokens.has(entry.token_address)) {
        this.trackedTokens.set(entry.token_address, { symbol: entry.token_symbol, tier: "warm" });
      }
    }

    let scanned = 0;
    let signalsGenerated = 0;

    for (const entry of entries) {
      const mint = entry.token_address;
      const symbol = entry.token_symbol || mint.slice(0, 8);

      try {
        const price = parseFloat(prices[mint]?.price) || 0;
        const intel = this.nansen.computeIntelligenceFromNetflow(entry);

        const prevScore = this.previousScores.get(mint) || null;
        this.previousScores.set(mint, intel.sentimentScore);
        intel.trend = this.nansen.getTrend(intel.sentimentScore, prevScore);

        const snapshot = {
          mint,
          symbol,
          price,
          ...intel,
          scoreDelta: prevScore !== null ? intel.sentimentScore - prevScore : 0,
          updatedAt: now,
        };
        this.tokenSnapshots.set(mint, snapshot);

        const newSignals = this._detectSignals(snapshot, prevScore);
        for (const sig of newSignals) {
          this._addSignal(sig);
          signalsGenerated++;
        }

        scanned++;
      } catch (e) {
        console.error(`Scan failed for ${symbol}: ${e.message}`);
      }
    }

    // Scan core tokens that weren't in the bulk results
    const bulkMints = new Set(entries.map(e => e.token_address));
    const missingCore = CORE_TOKENS.filter(t => !bulkMints.has(t.mint));

    for (const token of missingCore) {
      try {
        const entry = await this.nansen.getTokenNetflow(token.mint);
        if (!entry) continue;

        // Fill fields the holders endpoint doesn't provide
        entry.token_symbol = entry.token_symbol || token.symbol;
        const price = parseFloat(prices[token.mint]?.price) || 0;
        const jupData = prices[token.mint];
        if (!entry.market_cap_usd && jupData?.extraInfo?.quotedPrice?.buyPrice) {
          entry.market_cap_usd = 0; // Jupiter doesn't reliably give mcap, leave for DexScreener
        }

        const intel = this.nansen.computeIntelligenceFromNetflow(entry);

        const prevScore = this.previousScores.get(token.mint) || null;
        this.previousScores.set(token.mint, intel.sentimentScore);
        intel.trend = this.nansen.getTrend(intel.sentimentScore, prevScore);

        const snapshot = {
          mint: token.mint,
          symbol: token.symbol,
          price,
          ...intel,
          scoreDelta: prevScore !== null ? intel.sentimentScore - prevScore : 0,
          updatedAt: now,
        };
        this.tokenSnapshots.set(token.mint, snapshot);

        const newSignals = this._detectSignals(snapshot, prevScore);
        for (const sig of newSignals) {
          this._addSignal(sig);
          signalsGenerated++;
        }

        scanned++;
      } catch (e) {
        console.error(`Core token scan failed for ${token.symbol}: ${e.message}`);
      }
    }

    console.log(`📡 Scan #${this.scanCount}: ${scanned} tokens scanned (${missingCore.length} core), ${signalsGenerated} signals generated`);
    return { scanned, signalsGenerated };
  }

  // ════════════════════════════════════════
  // SIGNAL DETECTION
  // ════════════════════════════════════════

  _detectSignals(snapshot, prevScore) {
    const signals = [];
    const { mint, symbol } = snapshot;

    // Quality filter: skip low-quality tokens
    if ((snapshot.marketCap || 0) < 50000 || (snapshot.smartMoneyCount || 0) < 2) {
      return signals;
    }

    // Signal 1: Conviction Increase
    if (
      snapshot._isAccumulating &&
      snapshot.netflowUsd > this.convictionThreshold &&
      snapshot.holdingsChangePct > this.holdingsChangeThreshold
    ) {
      signals.push({
        type: SIGNAL_TYPES.CONVICTION_UP,
        mint, symbol,
        headline: `Smart money conviction increasing on ${symbol}`,
        details: {
          netflowUsd: snapshot.netflowUsd,
          holdingsChangePct: snapshot.holdingsChangePct,
          sentimentScore: snapshot.sentimentScore,
          confidence: snapshot.confidence,
          fundsAccumulating: snapshot.smartMoneyCount,
        },
      });
    }

    // Signal 2: Conviction Decrease
    if (
      snapshot._isDistributing &&
      snapshot.netflowUsd < -this.convictionThreshold &&
      snapshot.holdingsChangePct < -this.holdingsChangeThreshold
    ) {
      signals.push({
        type: SIGNAL_TYPES.CONVICTION_DOWN,
        mint, symbol,
        headline: `Smart money reducing exposure to ${symbol}`,
        details: {
          netflowUsd: snapshot.netflowUsd,
          holdingsChangePct: snapshot.holdingsChangePct,
          sentimentScore: snapshot.sentimentScore,
          confidence: snapshot.confidence,
        },
      });
    }

    // Signal 3: New Smart Money Entry
    if (snapshot._hasNewEntry) {
      signals.push({
        type: SIGNAL_TYPES.SMART_MONEY_ENTRY,
        mint, symbol,
        headline: `New smart money positions detected in ${symbol}`,
        details: {
          newPositions: snapshot.smartMoneyCount,
          netflowUsd: snapshot.netflowUsd,
          holdingsChangePct: snapshot.holdingsChangePct,
          confidence: snapshot.confidence,
        },
      });
    }

    // Signal 4: Smart Money Exit
    if (snapshot._hasExit) {
      signals.push({
        type: SIGNAL_TYPES.SMART_MONEY_EXIT,
        mint, symbol,
        headline: `Smart money closing positions in ${symbol}`,
        details: {
          netflowUsd: snapshot.netflowUsd,
          holdingsChangePct: snapshot.holdingsChangePct,
          confidence: snapshot.confidence,
        },
      });
    }

    // Signal 5: Sentiment Spike (large sudden change)
    if (prevScore !== null) {
      const delta = snapshot.sentimentScore - prevScore;
      if (Math.abs(delta) >= 15) {
        signals.push({
          type: SIGNAL_TYPES.SENTIMENT_SPIKE,
          mint, symbol,
          headline: delta > 0
            ? `Sentiment surging for ${symbol} (+${delta} pts)`
            : `Sentiment dropping for ${symbol} (${delta} pts)`,
          details: {
            previousScore: prevScore,
            currentScore: snapshot.sentimentScore,
            delta,
            trend: snapshot.trend,
          },
        });
      }
    }

    return signals;
  }

  _addSignal(signal) {
    signal.id = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    signal.timestamp = Date.now();
    signal.emoji = SIGNAL_EMOJI[signal.type];
    signal.label = SIGNAL_LABELS[signal.type];
    this.signals.unshift(signal);

    // Keep last 200 signals
    if (this.signals.length > 200) {
      this.signals = this.signals.slice(0, 200);
    }
  }

  // ════════════════════════════════════════
  // PUBLIC API — Feed & Pages
  // ════════════════════════════════════════

  // Get the intelligence feed (main product)
  getFeed(limit = 20) {
    return this.signals.slice(0, limit);
  }

  // Get token intelligence page (fetches holders on-demand for the detail view)
  async getTokenPage(mintOrSymbol) {
    // Try direct mint lookup
    let snapshot = this.tokenSnapshots.get(mintOrSymbol);

    // Try symbol lookup in snapshots
    if (!snapshot) {
      for (const s of this.tokenSnapshots.values()) {
        if (s.symbol === mintOrSymbol) { snapshot = s; break; }
      }
    }

    // Fallback: Jupiter's known tokens
    if (!snapshot) {
      const mint = this.jupiter.resolveMint(mintOrSymbol);
      if (mint) snapshot = this.tokenSnapshots.get(mint);
    }

    if (!snapshot) return null;

    return {
      symbol: snapshot.symbol,
      mint: snapshot.mint,
      price: snapshot.price,
      sentimentScore: snapshot.sentimentScore,
      trend: snapshot.trend,
      confidence: snapshot.confidence,
      netflowUsd: snapshot.netflowUsd,
      netflow1h: snapshot.netflow1h,
      netflow7d: snapshot.netflow7d,
      holdingsChangePct: snapshot.holdingsChangePct,
      smartMoneyCount: snapshot.smartMoneyCount,
      marketCap: snapshot.marketCap,
      updatedAt: snapshot.updatedAt,
      recentSignals: this.signals
        .filter(s => s.mint === snapshot.mint)
        .slice(0, 5),
    };
  }

  // Get all token snapshots (for feed enrichment)
  getAllSnapshots() {
    return [...this.tokenSnapshots.values()]
      .sort((a, b) => b.sentimentScore - a.sentimentScore);
  }

  // ════════════════════════════════════════
  // DAILY BRIEF
  // ════════════════════════════════════════

  generateDailyBrief() {
    const snapshots = this.getAllSnapshots();
    const last24h = this.signals.filter(s => Date.now() - s.timestamp < 24 * 60 * 60 * 1000);

    const topInflows = snapshots
      .filter(s => s.netflowUsd > 0)
      .sort((a, b) => b.netflowUsd - a.netflowUsd)
      .slice(0, 5);

    const topOutflows = snapshots
      .filter(s => s.netflowUsd < 0)
      .sort((a, b) => a.netflowUsd - b.netflowUsd)
      .slice(0, 5);

    const convictionAlerts = last24h.filter(s =>
      s.type === SIGNAL_TYPES.CONVICTION_UP || s.type === SIGNAL_TYPES.CONVICTION_DOWN
    );

    this.dailyBrief = {
      generatedAt: Date.now(),
      topInflows: topInflows.map(s => ({
        symbol: s.symbol, netflowUsd: s.netflowUsd, sentimentScore: s.sentimentScore,
      })),
      topOutflows: topOutflows.map(s => ({
        symbol: s.symbol, netflowUsd: s.netflowUsd, sentimentScore: s.sentimentScore,
      })),
      convictionAlerts: convictionAlerts.length,
      totalSignals24h: last24h.length,
      avgSentiment: snapshots.length > 0
        ? Math.round(snapshots.reduce((a, s) => a + s.sentimentScore, 0) / snapshots.length)
        : 50,
    };

    return this.dailyBrief;
  }

  getDailyBrief() {
    if (!this.dailyBrief || Date.now() - this.dailyBrief.generatedAt > 60 * 60 * 1000) {
      this.generateDailyBrief();
    }
    return this.dailyBrief;
  }

  getStats() {
    return {
      trackedTokens: this.trackedTokens.size,
      snapshotsStored: this.tokenSnapshots.size,
      totalSignals: this.signals.length,
      scanCount: this.scanCount,
      convictionThreshold: this.convictionThreshold,
      holdingsChangeThreshold: this.holdingsChangeThreshold,
    };
  }
}

export { SIGNAL_TYPES, SIGNAL_LABELS, SIGNAL_EMOJI };
export default SignalEngine;
