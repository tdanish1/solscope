// ============================================
// TOKEN SCANNER SERVICE
// ============================================
// Finds and scores new Solana tokens.
//
// COST OPTIMIZATION:
//   - Uses standard RPC calls (1 credit each) for basic data
//   - Only uses DAS API (10 credits) for tokens that pass initial filters
//   - Caches everything aggressively
//   - Polls on intervals instead of constantly hammering the API
//
// On Agent tier (1M credits), this lets you scan for MONTHS
// ============================================

class TokenScanner {
  constructor(heliusService) {
    this.helius = heliusService;
    this.tokens = new Map();        // token mint → data
    this.trending = [];             // sorted by score
    this.scanInterval = null;
    this.scanCount = 0;
  }

  // ---- PUBLIC METHODS ----

  // Get trending tokens for the dashboard
  getTrending(limit = 20) {
    return this.trending.slice(0, limit);
  }

  // Get details for a specific token
  getToken(mintAddress) {
    return this.tokens.get(mintAddress) || null;
  }

  // Search tokens by name/symbol
  searchTokens(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const [mint, token] of this.tokens) {
      if (
        token.name?.toLowerCase().includes(q) ||
        token.symbol?.toLowerCase().includes(q)
      ) {
        results.push(token);
      }
    }
    return results.slice(0, 20);
  }

  // ---- TOKEN ANALYSIS ----

  // Score a token's risk level (no API calls needed — pure logic)
  scoreToken(token) {
    let score = 50; // neutral
    const flags = [];

    // Age bonus: older = safer
    if (token.ageMinutes > 1440) { score += 15; }      // > 1 day
    else if (token.ageMinutes > 60) { score += 5; }     // > 1 hour
    else { score -= 20; flags.push("VERY_NEW"); }       // < 1 hour

    // Holder count
    if (token.holders > 1000) { score += 15; }
    else if (token.holders > 100) { score += 5; }
    else { score -= 15; flags.push("FEW_HOLDERS"); }

    // Liquidity check
    if (token.liquidity > 100000) { score += 15; }
    else if (token.liquidity > 10000) { score += 5; }
    else { score -= 20; flags.push("LOW_LIQUIDITY"); }

    // Volume relative to mcap (healthy = 5-50%)
    if (token.mcap > 0) {
      const volRatio = token.volume24h / token.mcap;
      if (volRatio > 0.05 && volRatio < 0.5) { score += 10; }
      else if (volRatio > 2) { score -= 10; flags.push("SUSPICIOUS_VOLUME"); }
    }

    // Top holder concentration
    if (token.topHolderPct > 50) { score -= 25; flags.push("WHALE_DOMINATED"); }
    else if (token.topHolderPct > 30) { score -= 10; flags.push("CONCENTRATED"); }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Risk label
    let risk = "HIGH";
    if (score > 65) risk = "LOW";
    else if (score > 40) risk = "MED";

    return { score, risk, flags };
  }

  // ---- DATA INGESTION ----

  // Add or update a token from any data source
  upsertToken(mintAddress, data) {
    const existing = this.tokens.get(mintAddress) || {};
    const token = {
      ...existing,
      ...data,
      mint: mintAddress,
      lastUpdated: Date.now(),
    };

    // Score it
    const { score, risk, flags } = this.scoreToken(token);
    token.score = score;
    token.risk = risk;
    token.flags = flags;

    this.tokens.set(mintAddress, token);
    return token;
  }

  // Rebuild the trending list (call periodically)
  rebuildTrending() {
    this.trending = [...this.tokens.values()]
      .filter(t => t.mcap > 0) // only tokens with known mcap
      .sort((a, b) => {
        // Sort by: recent price change magnitude × volume
        const aScore = Math.abs(a.change24h || 0) * Math.log10(Math.max(1, a.volume24h || 0));
        const bScore = Math.abs(b.change24h || 0) * Math.log10(Math.max(1, b.volume24h || 0));
        return bScore - aScore;
      })
      .slice(0, 100);
  }

  // ---- EXTERNAL DATA INTEGRATION ----
  // These methods fetch from FREE public APIs to save Helius credits

  // Fetch token data from Jupiter (FREE, no API key needed)
  async fetchFromJupiter(mintAddresses) {
    try {
      // Jupiter price API is free and rate-limited generously
      const mints = mintAddresses.join(",");
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mints}`);
      const data = await res.json();

      for (const [mint, info] of Object.entries(data.data || {})) {
        if (info) {
          this.upsertToken(mint, {
            name: info.mintSymbol || "Unknown",
            symbol: info.mintSymbol || "?",
            price: parseFloat(info.price) || 0,
          });
        }
      }
      return data;
    } catch (e) {
      console.error("Jupiter fetch failed:", e.message);
      return null;
    }
  }

  // Fetch token list from Jupiter (FREE)
  async fetchTrendingFromJupiter() {
    try {
      const res = await fetch("https://tokens.jup.ag/tokens?tags=verified");
      const tokens = await res.json();

      // Only process verified tokens (these are safer for users)
      for (const t of tokens.slice(0, 200)) {
        this.upsertToken(t.address, {
          name: t.name,
          symbol: t.symbol,
          logoUri: t.logoURI,
          decimals: t.decimals,
          tags: t.tags || [],
          // We'll fill in price/volume/mcap from Jupiter price API
          mcap: 0,
          volume24h: 0,
          change24h: 0,
          holders: 0,
          liquidity: 0,
          topHolderPct: 0,
          ageMinutes: 999999, // verified tokens are old enough
        });
      }

      console.log(`📊 Loaded ${tokens.length} verified tokens from Jupiter`);
      return tokens.length;
    } catch (e) {
      console.error("Jupiter token list fetch failed:", e.message);
      return 0;
    }
  }

  // Enrich a token with Helius DAS data (10 credits — use selectively!)
  async enrichWithHelius(mintAddress) {
    try {
      const asset = await this.helius.getAsset(mintAddress);
      if (asset) {
        this.upsertToken(mintAddress, {
          name: asset.content?.metadata?.name || "Unknown",
          symbol: asset.content?.metadata?.symbol || "?",
          supply: asset.token_info?.supply || 0,
          decimals: asset.token_info?.decimals || 0,
          logoUri: asset.content?.links?.image || "",
        });
      }
      return asset;
    } catch (e) {
      console.error(`Helius enrich failed for ${mintAddress}:`, e.message);
      return null;
    }
  }

  // ---- PERIODIC SCANNING ----

  // Start background scanning (runs every N minutes)
  startScanning(intervalMinutes = 5) {
    console.log(`🔍 Token scanner starting (every ${intervalMinutes} min)`);

    // Initial load
    this._scan();

    this.scanInterval = setInterval(() => {
      this._scan();
    }, intervalMinutes * 60 * 1000);
  }

  stopScanning() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
      console.log("🔍 Token scanner stopped");
    }
  }

  async _scan() {
    this.scanCount++;
    console.log(`🔍 Scan #${this.scanCount} starting...`);

    // Step 1: Load token list from Jupiter (FREE)
    if (this.tokens.size === 0) {
      await this.fetchTrendingFromJupiter();
    }

    // Step 2: Get prices for tracked tokens (FREE via Jupiter)
    const mints = [...this.tokens.keys()].slice(0, 100); // Jupiter allows ~100 at once
    if (mints.length > 0) {
      await this.fetchFromJupiter(mints);
    }

    // Step 3: Rebuild trending list
    this.rebuildTrending();

    console.log(`🔍 Scan #${this.scanCount} complete. ${this.tokens.size} tokens tracked.`);
  }

  // ---- STATS ----

  getStats() {
    return {
      totalTokens: this.tokens.size,
      trendingCount: this.trending.length,
      scanCount: this.scanCount,
    };
  }
}

export default TokenScanner;
