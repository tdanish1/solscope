// ============================================
// API ROUTES
// ============================================
// REST API for the React dashboard frontend.
// Also handles Helius webhook callbacks.
// ============================================

import { Router } from "express";

export default function createRoutes(services) {
  const router = Router();
  const { helius, whaleTracker, tokenScanner, paperTrader } = services;

  // ---- HEALTH ----

  router.get("/health", async (req, res) => {
    const health = await helius.healthCheck();
    res.json(health);
  });

  router.get("/stats", (req, res) => {
    res.json({
      helius: helius.getStats(),
      scanner: tokenScanner.getStats(),
    });
  });

  // ---- TOKENS ----

  router.get("/tokens/trending", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const tokens = tokenScanner.getTrending(limit);
    res.json({ tokens, count: tokens.length });
  });

  router.get("/tokens/search", (req, res) => {
    const query = req.query.q || "";
    if (!query) return res.json({ tokens: [] });
    const tokens = tokenScanner.searchTokens(query);
    res.json({ tokens, count: tokens.length });
  });

  router.get("/tokens/:mint", async (req, res) => {
    try {
      let token = tokenScanner.getToken(req.params.mint);
      if (!token) {
        // Enrich from Helius (costs 10 credits)
        await tokenScanner.enrichWithHelius(req.params.mint);
        token = tokenScanner.getToken(req.params.mint);
      }
      if (!token) return res.status(404).json({ error: "Token not found" });
      res.json(token);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- WALLET DATA ----

  router.get("/wallet/:address/assets", async (req, res) => {
    try {
      const assets = await helius.getAssetsByOwner(req.params.address);
      res.json(assets);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/wallet/:address/balance", async (req, res) => {
    try {
      const balance = await helius.getBalance(req.params.address);
      res.json({ address: req.params.address, lamports: balance.value, sol: balance.value / 1e9 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/wallet/:address/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const history = await helius.getTransactionHistory(req.params.address, limit);
      res.json({ transactions: history, count: history.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- WHALE TRACKER ----

  router.get("/whales/activity", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const activity = whaleTracker.getRecentActivity(limit);
    res.json({ activity, count: activity.length });
  });

  router.post("/whales/track", (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "address required" });
    const result = whaleTracker.addWallet(address);
    res.json(result);
  });

  // ---- PAPER TRADING ----

  router.get("/paper/:userId/portfolio", (req, res) => {
    // In production, userId would come from auth. For now, use a param.
    const currentPrices = {};
    for (const [mint, token] of Object.entries(tokenScanner.tokens || {})) {
      if (token.price) currentPrices[mint] = token.price;
    }
    const portfolio = paperTrader.getPortfolio(req.params.userId, currentPrices);
    res.json(portfolio);
  });

  router.post("/paper/:userId/buy", (req, res) => {
    const { token, symbol, amount, price } = req.body;
    if (!token || !amount || !price) {
      return res.status(400).json({ error: "token, amount, and price required" });
    }
    const result = paperTrader.buy(req.params.userId, token, symbol || "?", amount, price);
    res.json(result);
  });

  router.post("/paper/:userId/sell", (req, res) => {
    const { token, amount, price } = req.body;
    if (!token || !amount || !price) {
      return res.status(400).json({ error: "token, amount, and price required" });
    }
    const result = paperTrader.sell(req.params.userId, token, amount, price);
    res.json(result);
  });

  router.get("/paper/:userId/trades", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const trades = paperTrader.getTradeHistory(req.params.userId, limit);
    res.json({ trades, count: trades.length });
  });

  router.post("/paper/:userId/reset", (req, res) => {
    const portfolio = paperTrader.reset(req.params.userId);
    res.json({ reset: true, balance: portfolio.balance });
  });

  router.get("/paper/leaderboard", (req, res) => {
    const currentPrices = {};
    const leaderboard = paperTrader.getLeaderboard(currentPrices);
    res.json({ leaderboard });
  });

  // ---- HELIUS WEBHOOK RECEIVER ----
  // This endpoint receives events from Helius webhooks
  // It costs 1 credit per event received

  router.post("/webhooks/helius", async (req, res) => {
    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];

      for (const event of events) {
        // Route to whale tracker
        await whaleTracker.processEvent(event);
      }

      res.json({ received: events.length });
    } catch (e) {
      console.error("Webhook processing error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- PRIORITY FEES ----

  router.get("/fees/estimate", async (req, res) => {
    try {
      const estimate = await helius.getPriorityFeeEstimate();
      res.json(estimate);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
