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

    // Fetch all prices in one Jupiter call
    const mints = entries.map(e => e.token_address);
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

    console.log(`📡 Scan #${this.scanCount}: ${scanned} tokens scanned, ${signalsGenerated} signals generated`);
    return { scanned, signalsGenerated };
  }

  // ════════════════════════════════════════
  // SIGNAL DETECTION
  // ════════════════════════════════════════

  _detectSignals(snapshot, prevScore) {
    const signals = [];
    const { mint, symbol } = snapshot;

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

    // Try symbol lookup
    if (!snapshot) {
      const mint = this.jupiter.resolveMint(mintOrSymbol);
      if (mint) snapshot = this.tokenSnapshots.get(mint);
    }

    if (!snapshot) return null;

    // Fetch holder distribution on-demand (not in regular scan to save Nansen credits)
    const holders = await this.nansen.getHolderDistribution(snapshot.mint);
    const holdersList = holders?.data || [];
    const exchangePct = holdersList.reduce((sum, h) => sum + (h.ownership_percentage || 0), 0);
    const smartMoneyPct = snapshot.smartMoneyPct || 0;
    const retailPct = Math.max(0, 100 - smartMoneyPct - exchangePct);

    return {
      symbol: snapshot.symbol,
      mint: snapshot.mint,
      price: snapshot.price,
      sentimentScore: snapshot.sentimentScore,
      trend: snapshot.trend,
      confidence: snapshot.confidence,
      netflowUsd: snapshot.netflowUsd,
      holdingsChangePct: snapshot.holdingsChangePct,
      holderDistribution: {
        smartMoney: smartMoneyPct,
        retail: retailPct,
        exchange: exchangePct,
      },
      smartMoneyCount: snapshot.smartMoneyCount,
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
    };
  }
}

export { SIGNAL_TYPES, SIGNAL_LABELS, SIGNAL_EMOJI };
export default SignalEngine;
