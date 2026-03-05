// ============================================
// WHALE TRACKER SERVICE
// ============================================
// Strategy: Use Helius Webhooks (1 credit/event) instead of
// polling (which would burn through credits fast).
//
// Known whale wallets are tracked via webhooks.
// When a whale moves tokens, webhook fires → we notify users.
// ============================================

// Well-known Solana whale wallets to track
// You can expand this list over time from on-chain research
const KNOWN_WHALES = [
  // Add real whale addresses as you discover them
  // These are placeholder examples — replace with real ones
  // Find whales at: https://solscan.io/leaderboard
];

class WhaleTracker {
  constructor(heliusService, telegramBot) {
    this.helius = heliusService;
    this.telegram = telegramBot;
    this.webhookId = null;
    this.trackedWallets = new Set(KNOWN_WHALES);
    this.recentActivity = []; // Last 100 whale moves
    this.subscribers = new Set(); // Telegram chat IDs
  }

  // Register a webhook to track whale wallets
  // This costs 100 credits ONE TIME, then 1 credit per event
  async setupWebhook(callbackUrl) {
    if (this.trackedWallets.size === 0) {
      console.log("⚠️  No whale wallets configured. Add addresses to KNOWN_WHALES.");
      return null;
    }

    try {
      const webhook = await this.helius.createWebhook({
        webhookURL: callbackUrl,
        transactionTypes: ["TRANSFER", "SWAP"],
        accountAddresses: [...this.trackedWallets],
        webhookType: "enhanced",
      });

      this.webhookId = webhook.webhookID;
      console.log(`🐋 Whale webhook created: ${this.webhookId}`);
      console.log(`   Tracking ${this.trackedWallets.size} wallets`);
      return webhook;
    } catch (error) {
      console.error("Failed to create whale webhook:", error.message);
      return null;
    }
  }

  // Process incoming webhook event
  async processEvent(event) {
    // Parse the enhanced transaction data
    const activity = {
      id: Date.now(),
      signature: event.signature,
      type: event.type, // TRANSFER, SWAP, etc.
      timestamp: event.timestamp,
      wallet: this._identifyWhale(event),
      description: event.description || "Unknown activity",
      // Extract token transfer details
      tokenTransfers: (event.tokenTransfers || []).map(t => ({
        token: t.tokenStandard === "Fungible" ? t.mint : "SOL",
        amount: t.tokenAmount,
        fromUser: t.fromUserAccount,
        toUser: t.toUserAccount,
      })),
      // Extract SOL transfers
      solTransfers: (event.nativeTransfers || []).map(t => ({
        amount: t.amount / 1e9, // lamports to SOL
        from: t.fromUserAccount,
        to: t.toUserAccount,
      })),
    };

    // Add to recent activity (keep last 100)
    this.recentActivity.unshift(activity);
    if (this.recentActivity.length > 100) {
      this.recentActivity = this.recentActivity.slice(0, 100);
    }

    // Notify Telegram subscribers if it's a significant move
    if (this._isSignificant(activity)) {
      await this._notifySubscribers(activity);
    }

    return activity;
  }

  // Check if a whale move is significant enough to alert
  _isSignificant(activity) {
    // Alert on SOL transfers > 100 SOL
    const bigSolMove = activity.solTransfers.some(t => t.amount > 100);
    // Alert on any swap (whales swapping is noteworthy)
    const isSwap = activity.type === "SWAP";
    return bigSolMove || isSwap;
  }

  // Identify which tracked whale made the transaction
  _identifyWhale(event) {
    const accounts = event.accountData?.map(a => a.account) || [];
    for (const addr of accounts) {
      if (this.trackedWallets.has(addr)) {
        return addr.slice(0, 4) + "..." + addr.slice(-4);
      }
    }
    return "Unknown whale";
  }

  // Send Telegram alerts
  async _notifySubscribers(activity) {
    if (!this.telegram || this.subscribers.size === 0) return;

    const emoji = activity.type === "SWAP" ? "🔄" : "💰";
    const message = [
      `${emoji} *Whale Alert!*`,
      `Wallet: \`${activity.wallet}\``,
      `Type: ${activity.type}`,
      activity.description,
      `[View on Solscan](https://solscan.io/tx/${activity.signature})`,
    ].join("\n");

    for (const chatId of this.subscribers) {
      try {
        await this.telegram.sendMessage(chatId, message, { parse_mode: "Markdown" });
      } catch (e) {
        console.error(`Failed to notify ${chatId}:`, e.message);
      }
    }
  }

  // Add a wallet to track
  addWallet(address) {
    this.trackedWallets.add(address);
    console.log(`🐋 Now tracking: ${address.slice(0, 8)}...`);
    // Note: you'll need to recreate the webhook to include new addresses
    return { tracked: this.trackedWallets.size };
  }

  // Subscribe a Telegram chat to whale alerts
  subscribe(chatId) {
    this.subscribers.add(chatId);
    return { subscribed: true, totalSubscribers: this.subscribers.size };
  }

  unsubscribe(chatId) {
    this.subscribers.delete(chatId);
    return { unsubscribed: true };
  }

  // Get recent whale activity (for the dashboard)
  getRecentActivity(limit = 20) {
    return this.recentActivity.slice(0, limit);
  }
}

export default WhaleTracker;
