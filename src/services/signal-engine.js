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

function fmt(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const SIGNAL_TYPES = {
  CONVICTION_UP: "CONVICTION_UP",
  CONVICTION_DOWN: "CONVICTION_DOWN",
  SMART_MONEY_ENTRY: "SMART_MONEY_ENTRY",
  SMART_MONEY_EXIT: "SMART_MONEY_EXIT",
  LIQUIDITY_RISK: "LIQUIDITY_RISK",
  SENTIMENT_SPIKE: "SENTIMENT_SPIKE",
  WHALE_ALERT: "WHALE_ALERT",
  NEW_TOKEN_DISCOVERY: "NEW_TOKEN_DISCOVERY",
};

const SIGNAL_LABELS = {
  CONVICTION_UP: "Conviction Increasing",
  CONVICTION_DOWN: "Conviction Decreasing",
  SMART_MONEY_ENTRY: "Smart Money Entry",
  SMART_MONEY_EXIT: "Smart Money Exit",
  LIQUIDITY_RISK: "Liquidity Risk",
  SENTIMENT_SPIKE: "Sentiment Spike",
  WHALE_ALERT: "Whale Alert",
  NEW_TOKEN_DISCOVERY: "New Discovery",
};

const SIGNAL_EMOJI = {
  CONVICTION_UP: "🔥",
  CONVICTION_DOWN: "⚠️",
  SMART_MONEY_ENTRY: "🐋",
  SMART_MONEY_EXIT: "🚪",
  LIQUIDITY_RISK: "🔻",
  SENTIMENT_SPIKE: "⚡",
  WHALE_ALERT: "🚨",
  NEW_TOKEN_DISCOVERY: "🆕",
};

class SignalEngine {
  constructor(helius, jupiter, nansen, config = {}) {
    this.helius = helius;
    this.jupiter = jupiter;
    this.nansen = nansen;

    this.convictionThreshold = config.convictionThreshold || 1000;
    this.holdingsChangeThreshold = config.holdingsChangeThreshold || 5;
    this.whaleThreshold = config.whaleThreshold || 50000;
    this.tokenSnapshots = new Map();
    this.previousScores = new Map();
    this.knownTokenMints = new Set();   // tokens seen in previous scans (for discovery)
    this.firstScanDone = false;         // skip discovery signals on first scan
    this.signals = [];
    this.dailyBrief = null;
    this.scanCount = 0;
    this.trackedTokens = new Map();

    console.log("  ✓ Signal engine initialized");
  }

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

  promoteToken(mint) {
    const t = this.trackedTokens.get(mint);
    if (t) {
      t.tier = "hot";
      t.hotScansRemaining = 2;
    }
  }

  async scan() {
    this.scanCount++;
    const now = Date.now();

    const nansenData = await this.nansen.getAllSolanaNetflow(100);
    if (!nansenData?.data?.length) {
      console.log(`📡 Scan #${this.scanCount}: Nansen returned no data`);
      return { scanned: 0, signalsGenerated: 0 };
    }

    const entries = nansenData.data;

    const coreMints = CORE_TOKENS.map(t => t.mint);
    const mints = [...new Set([...entries.map(e => e.token_address), ...coreMints])];
    const prices = await this.jupiter.getPrices(mints);

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

    let coreScanned = 0;

    for (const token of CORE_TOKENS) {
      try {
        const entry = await this.nansen.getTokenNetflow(token.mint);
        if (!entry) continue;

        entry.token_symbol = token.symbol;
        const price = parseFloat(prices[token.mint]?.price) || 0;

        const intel = this.nansen.computeIntelligenceFromNetflow(entry);

        const prevScore = this.previousScores.get(token.mint) || null;
        this.previousScores.set(token.mint, intel.sentimentScore);
        intel.trend = this.nansen.getTrend(intel.sentimentScore, prevScore);

        const existingSnapshot = this.tokenSnapshots.get(token.mint);
        const snapshot = {
          mint: token.mint,
          symbol: token.symbol,
          price,
          ...intel,
          marketCap: intel.marketCap || existingSnapshot?.marketCap || 0,
          scoreDelta: prevScore !== null ? intel.sentimentScore - prevScore : 0,
          updatedAt: now,
        };
        this.tokenSnapshots.set(token.mint, snapshot);

        const newSignals = this._detectSignals(snapshot, prevScore);
        for (const sig of newSignals) {
          this._addSignal(sig);
          signalsGenerated++;
        }

        coreScanned++;
      } catch (e) {
        console.error(`Core token scan failed for ${token.symbol}: ${e.message}`);
      }
    }

    // Track known tokens for discovery signals
    for (const entry of entries) {
      this.knownTokenMints.add(entry.token_address);
    }
    for (const token of CORE_TOKENS) {
      this.knownTokenMints.add(token.mint);
    }
    this.firstScanDone = true;

    // Evict oldest snapshots if over 500
    if (this.tokenSnapshots.size > 500) {
      const sorted = [...this.tokenSnapshots.entries()]
        .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
      const toRemove = sorted.slice(0, this.tokenSnapshots.size - 500);
      for (const [key] of toRemove) this.tokenSnapshots.delete(key);
    }

    console.log(`📡 Scan #${this.scanCount}: ${scanned} bulk + ${coreScanned} core tokens, ${signalsGenerated} signals`);
    return { scanned, signalsGenerated };
  }

  _detectSignals(snapshot, prevScore) {
    const signals = [];
    const { mint, symbol } = snapshot;

    const isCore = CORE_TOKENS.some(t => t.mint === mint);
    if (!isCore && ((snapshot.marketCap || 0) < 100000 || (snapshot.smartMoneyCount || 0) < 3)) {
      return signals;
    }

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

    // Whale Alert: single scan shows massive flow (>$50K)
    if (Math.abs(snapshot.netflowUsd || 0) >= this.whaleThreshold) {
      const inflow = snapshot.netflowUsd > 0;
      signals.push({
        type: SIGNAL_TYPES.WHALE_ALERT,
        mint, symbol,
        headline: inflow
          ? `Whale buying ${symbol} — ${fmt(snapshot.netflowUsd)} inflow detected`
          : `Whale dumping ${symbol} — ${fmt(snapshot.netflowUsd)} outflow detected`,
        details: {
          netflowUsd: snapshot.netflowUsd,
          confidence: snapshot.confidence,
          direction: inflow ? 'BUY' : 'SELL',
        },
      });
    }

    // New Token Discovery: token appears in smart money flows for the first time
    if (this.firstScanDone && !this.knownTokenMints.has(mint) && (snapshot.smartMoneyCount || 0) >= 2 && (snapshot.netflowUsd || 0) > 0) {
      signals.push({
        type: SIGNAL_TYPES.NEW_TOKEN_DISCOVERY,
        mint, symbol,
        headline: `Smart money just discovered ${symbol}`,
        details: {
          netflowUsd: snapshot.netflowUsd,
          smartMoneyCount: snapshot.smartMoneyCount,
          confidence: snapshot.confidence,
        },
      });
    }

    return signals;
  }

  _addSignal(signal) {
    signal.id = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    signal.timestamp = Date.now();
    signal.emoji = SIGNAL_EMOJI[signal.type];
    signal.label = SIGNAL_LABELS[signal.type];

    // Dedup: one signal per type+mint
    this.signals = this.signals.filter(
      (s) => !(s.type === signal.type && s.mint === signal.mint)
    );

    this.signals.unshift(signal);

    if (this.signals.length > 200) {
      this.signals = this.signals.slice(0, 200);
    }
  }

  getFeed(limit = 20) {
    return this.signals.slice(0, limit);
  }

  async getTokenPage(mintOrSymbol) {
    let snapshot = this.tokenSnapshots.get(mintOrSymbol);

    if (!snapshot) {
      for (const s of this.tokenSnapshots.values()) {
        if (s.symbol === mintOrSymbol) { snapshot = s; break; }
      }
    }

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

  getAllSnapshots() {
    return [...this.tokenSnapshots.values()]
      .sort((a, b) => b.sentimentScore - a.sentimentScore);
  }

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
