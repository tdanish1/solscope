// API endpoints

import { Router } from "express";

export default function createRoutes(services) {
  const router = Router();
  const { signalEngine, alertMatcher, helius, jupiter, nansen } = services;

  // Feed (main product)
  router.get("/feed", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const feed = signalEngine.getFeed(limit);
    res.json({ signals: feed, count: feed.length });
  });

  // Token intelligence page
  router.get("/token/:id", (req, res) => {
    const page = signalEngine.getTokenPage(req.params.id);
    if (!page) return res.status(404).json({ error: "Token not found or not yet scanned" });
    res.json(page);
  });

  // All token snapshots (for the overview)
  router.get("/tokens", (req, res) => {
    const snapshots = signalEngine.getAllSnapshots();
    res.json({ tokens: snapshots, count: snapshots.length });
  });

  // Daily brief
  router.get("/brief", (req, res) => {
    const brief = signalEngine.getDailyBrief();
    res.json(brief);
  });

  // Custom alerts
  router.get("/alerts/:userId", (req, res) => {
    const rules = alertMatcher.getRules(req.params.userId);
    res.json({ rules, count: rules.length });
  });

  router.post("/alerts/:userId", (req, res) => {
    const result = alertMatcher.addRule(req.params.userId, req.body);
    res.json(result);
  });

  router.delete("/alerts/:userId/:ruleId", (req, res) => {
    const result = alertMatcher.removeRule(req.params.userId, req.params.ruleId);
    res.json(result);
  });

  // Temporary debug endpoint — test raw Nansen API response
  router.get("/debug/nansen", async (req, res) => {
    if (!nansen.enabled) return res.json({ error: "Nansen not configured" });
    const url = new URL("https://api.nansen.ai/v1/smart-money/inflows/netflow");
    url.searchParams.set("chain", "solana");
    url.searchParams.set("token_address", "So11111111111111111111111111111111111111112"); // SOL
    url.searchParams.set("timeframe", "24h");
    try {
      const r = await fetch(url.toString(), {
        headers: { "Authorization": `Bearer ${nansen.apiKey}`, "Content-Type": "application/json" },
      });
      const body = await r.text();
      res.json({ status: r.status, url: url.toString().replace(nansen.apiKey, "***"), body: body.slice(0, 1000) });
    } catch (e) {
      res.json({ error: e.message });
    }
  });

  // Health & stats
  router.get("/health", async (req, res) => {
    const h = await helius.healthCheck();
    res.json({
      healthy: h.healthy,
      services: {
        helius: h,
        jupiter: jupiter.getStats(),
        nansen: nansen.getStats(),
        signals: signalEngine.getStats(),
        alerts: alertMatcher.getStats(),
      },
    });
  });

  // Webhook receiver (for Helius real-time events)
  router.post("/webhooks/helius", async (req, res) => {
    // Process incoming blockchain events
    // This triggers signal generation for affected tokens
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      // Promote affected tokens to hot tier for faster scanning
      if (event.tokenTransfers) {
        for (const t of event.tokenTransfers) {
          signalEngine.promoteToken(t.mint);
        }
      }
    }
    res.json({ received: events.length });
  });

  return router;
}
