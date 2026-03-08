// Helius RPC service
// Role: Detect on-chain events, wallet activity,
// transaction parsing. The "ears" of SolScope.
//
// Cost: 1 credit per RPC call, 10 per DAS call

class HeliusService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    this.apiUrl = `https://api.helius.xyz`;
    this.cache = new Map();
    this.callCount = 0;

    console.log("  ✓ Helius connected (blockchain layer)");
  }

  // Cache helper
  _cached(key, maxAge = 30000) {
    const e = this.cache.get(key);
    if (e && Date.now() - e.t < maxAge) return e.d;
    return null;
  }
  _cache(key, data) {
    this.cache.set(key, { d: data, t: Date.now() });
    if (this.cache.size > 500) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
  }

  // RPC call
  async rpc(method, params = []) {
    this.callCount++;
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Helius RPC: ${data.error.message}`);
    return data.result;
  }

  // Health check
  async healthCheck() {
    try {
      const r = await this.rpc("getHealth");
      return { healthy: r === "ok", calls: this.callCount };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  // Get wallet token holdings
  async getWalletAssets(address) {
    const ck = `assets:${address}`;
    const cached = this._cached(ck, 60000);
    if (cached) return cached;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getAssetsByOwner",
        params: { ownerAddress: address, page: 1, limit: 50, displayOptions: { showFungible: true } },
      }),
    });
    const data = await res.json();
    const result = data.result;
    this._cache(ck, result);
    return result;
  }

  // Get parsed transaction history
  async getTransactionHistory(address, limit = 10) {
    const ck = `txh:${address}:${limit}`;
    const cached = this._cached(ck, 60000);
    if (cached) return cached;

    const res = await fetch(
      `${this.apiUrl}/v0/addresses/${address}/transactions?api-key=${this.apiKey}&limit=${limit}`
    );
    const data = await res.json();
    this._cache(ck, data);
    return data;
  }

  // Create webhook for real-time events
  async createWebhook(callbackUrl, addresses, types = ["TRANSFER", "SWAP"]) {
    const res = await fetch(`${this.apiUrl}/v0/webhooks?api-key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL: callbackUrl,
        transactionTypes: types,
        accountAddresses: addresses,
        webhookType: "enhanced",
      }),
    });
    return res.json();
  }

  getStats() {
    return { calls: this.callCount, cacheSize: this.cache.size };
  }
}

export default HeliusService;
