// ============================================
// HELIUS SERVICE — Credit-Aware API Wrapper
// ============================================
// The #1 priority is preserving credits on the $1 Agent tier.
// Strategy:
//   - Cache aggressively (most data doesn't change every second)
//   - Batch requests where possible
//   - Track credit usage so you never run out unexpectedly
//   - Use cheap endpoints first (1 credit) before expensive ones (100 credits)
// ============================================

import { createHelius } from "helius-sdk";

// Credit costs per API call (from Helius docs)
const CREDIT_COSTS = {
  standardRpc: 1,       // getBalance, getSlot, etc.
  priorityFee: 1,       // getPriorityFeeEstimate
  webhookEvent: 1,      // per event delivered
  dasApi: 10,            // getAssetsByOwner, searchAssets, etc.
  getProgramAccounts: 10,
  enhancedTx: 100,       // parsed transaction data
  getTransactionsForAddress: 100,
  walletApi: 100,
  webhookManagement: 100, // create/edit/delete webhooks
  sender: 0,             // FREE on all plans
};

class HeliusService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = createHelius({ apiKey, network: "mainnet" });
    this.baseUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

    // Simple in-memory cache to save credits
    this.cache = new Map();
    this.creditUsed = 0;
    this.creditBudget = 1_000_000; // Agent tier starting credits

    // Rate limiting
    this.callsThisMinute = 0;
    this.maxCallsPerMinute = parseInt(process.env.MAX_CALLS_PER_MINUTE || "120");
    setInterval(() => { this.callsThisMinute = 0; }, 60_000);

    console.log("✅ Helius client initialized (Agent tier: 1M credits)");
  }

  // ---- CREDIT TRACKING ----

  _trackCredits(operation) {
    const cost = CREDIT_COSTS[operation] || 1;
    this.creditUsed += cost;
    if (this.creditUsed % 10000 === 0) {
      console.log(`📊 Credits used: ${this.creditUsed.toLocaleString()} / ${this.creditBudget.toLocaleString()}`);
    }
    if (this.creditBudget - this.creditUsed < 50000) {
      console.warn("⚠️  Running low on credits! Consider upgrading to Developer plan ($49/mo)");
    }
  }

  // ---- CACHING ----

  _getCached(key, maxAgeMs = 30_000) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < maxAgeMs) {
      return entry.data;
    }
    return null;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, time: Date.now() });
    // Prevent memory leaks — cap cache at 500 entries
    if (this.cache.size > 500) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  // ---- RATE LIMITING ----

  async _rateLimitGuard() {
    if (this.callsThisMinute >= this.maxCallsPerMinute) {
      console.warn("⏳ Rate limit reached, waiting...");
      await new Promise(r => setTimeout(r, 5000));
    }
    this.callsThisMinute++;
  }

  // ---- RAW RPC (1 credit each) ----

  async rpcCall(method, params = []) {
    await this._rateLimitGuard();
    this._trackCredits("standardRpc");

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`RPC error: ${data.error.message}`);
    return data.result;
  }

  // ---- TOKEN / ASSET DATA (10 credits) ----

  async getAssetsByOwner(walletAddress, page = 1, limit = 50) {
    const cacheKey = `assets:${walletAddress}:${page}`;
    const cached = this._getCached(cacheKey, 60_000); // cache 1 min
    if (cached) return cached;

    await this._rateLimitGuard();
    this._trackCredits("dasApi");

    const result = await this.client.getAssetsByOwner({
      ownerAddress: walletAddress,
      page,
      limit,
      displayOptions: { showFungible: true, showNativeBalance: true },
    });

    this._setCache(cacheKey, result);
    return result;
  }

  async searchAssets(params) {
    const cacheKey = `search:${JSON.stringify(params)}`;
    const cached = this._getCached(cacheKey, 30_000);
    if (cached) return cached;

    await this._rateLimitGuard();
    this._trackCredits("dasApi");

    const result = await this.client.searchAssets(params);
    this._setCache(cacheKey, result);
    return result;
  }

  async getAsset(assetId) {
    const cacheKey = `asset:${assetId}`;
    const cached = this._getCached(cacheKey, 120_000); // cache 2 min (metadata rarely changes)
    if (cached) return cached;

    await this._rateLimitGuard();
    this._trackCredits("dasApi");

    const result = await this.client.getAsset({ id: assetId });
    this._setCache(cacheKey, result);
    return result;
  }

  // ---- TRANSACTION HISTORY (100 credits — use sparingly!) ----

  async getTransactionHistory(address, limit = 20) {
    const cacheKey = `txHistory:${address}:${limit}`;
    const cached = this._getCached(cacheKey, 60_000); // cache 1 min
    if (cached) return cached;

    await this._rateLimitGuard();
    this._trackCredits("enhancedTx");

    // Use the enhanced parsed transactions endpoint
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${this.apiKey}&limit=${limit}`);
    const result = await res.json();

    this._setCache(cacheKey, result);
    return result;
  }

  // ---- PRIORITY FEES (1 credit — cheap!) ----

  async getPriorityFeeEstimate(accountKeys = []) {
    const cacheKey = `fees:${accountKeys.join(",")}`;
    const cached = this._getCached(cacheKey, 15_000); // cache 15s
    if (cached) return cached;

    await this._rateLimitGuard();
    this._trackCredits("priorityFee");

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getPriorityFeeEstimate",
        params: [{ accountKeys, options: { recommended: true } }],
      }),
    });
    const data = await res.json();
    this._setCache(cacheKey, data.result);
    return data.result;
  }

  // ---- WALLET BALANCE (1 credit) ----

  async getBalance(address) {
    const cacheKey = `balance:${address}`;
    const cached = this._getCached(cacheKey, 15_000);
    if (cached) return cached;

    const result = await this.rpcCall("getBalance", [address]);
    this._setCache(cacheKey, result);
    return result;
  }

  // ---- TOKEN ACCOUNTS (1 credit) ----

  async getTokenAccounts(walletAddress) {
    const cacheKey = `tokenAccounts:${walletAddress}`;
    const cached = this._getCached(cacheKey, 30_000);
    if (cached) return cached;

    const result = await this.rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed" },
    ]);
    this._setCache(cacheKey, result);
    return result;
  }

  // ---- WEBHOOKS (100 credits to create, 1 credit per event) ----
  // Webhooks are the MOST cost-effective way to get real-time data
  // Create once (100 credits), then receive events for 1 credit each

  async createWebhook(config) {
    await this._rateLimitGuard();
    this._trackCredits("webhookManagement");

    const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.json();
  }

  async getWebhooks() {
    const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`);
    return res.json();
  }

  async deleteWebhook(webhookId) {
    await this._rateLimitGuard();
    this._trackCredits("webhookManagement");

    const res = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${this.apiKey}`, {
      method: "DELETE",
    });
    return res.json();
  }

  // ---- HEALTH CHECK (1 credit) ----

  async healthCheck() {
    try {
      const result = await this.rpcCall("getHealth");
      return { healthy: result === "ok", credits: { used: this.creditUsed, budget: this.creditBudget } };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  // ---- STATS ----

  getStats() {
    return {
      creditsUsed: this.creditUsed,
      creditsBudget: this.creditBudget,
      creditsRemaining: this.creditBudget - this.creditUsed,
      cacheSize: this.cache.size,
      callsThisMinute: this.callsThisMinute,
      maxCallsPerMinute: this.maxCallsPerMinute,
    };
  }
}

export default HeliusService;
