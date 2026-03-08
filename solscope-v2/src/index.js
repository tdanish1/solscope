// ============================================
// SOLSCOPE v2 — Smart Money Intelligence Feed
// ============================================
// Architecture:
//   Helius detects → Jupiter contextualizes →
//   Nansen enriches → SolScope scores →
//   Alerts fan out
// ============================================

import "dotenv/config";
import express from "express";
import cors from "cors";

import HeliusService from "./services/helius.js";
import JupiterService from "./services/jupiter.js";
import NansenService from "./services/nansen.js";
import SignalEngine from "./services/signal-engine.js";
import AlertMatcher from "./services/alert-matcher.js";
import SolScopeBot from "./telegram-bot.js";
import createRoutes from "./routes/api.js";

async function main() {
  console.log("");
  console.log("  ╔═══════════════════════════════════════╗");
  console.log("  ║  🔬 SolScope — See Solana Clearly      ║");
  console.log("  ║  Smart Money Intelligence Feed          ║");
  console.log("  ╚═══════════════════════════════════════╝");
  console.log("");
  console.log("  Initializing 3-API stack...");
  console.log("");

  // ── Validate minimum config ──
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey || heliusKey.includes("your_")) {
    console.error("  ❌ HELIUS_API_KEY not set. Get one at https://dashboard.helius.dev");
    process.exit(1);
  }

  // ── Layer 1: Blockchain infrastructure ──
  const helius = new HeliusService(heliusKey);
  const health = await helius.healthCheck();
  if (!health.healthy) {
    console.error("  ❌ Helius connection failed:", health.error);
    process.exit(1);
  }

  // ── Layer 2: Market context ──
  const jupiter = new JupiterService(process.env.JUPITER_API_KEY);

  // ── Layer 3: Smart money intelligence ──
  const nansen = new NansenService(process.env.NANSEN_API_KEY);

  // ── Signal engine (the core product) ──
  const signalEngine = new SignalEngine(helius, jupiter, nansen, {
    convictionThreshold: parseInt(process.env.CONVICTION_THRESHOLD) || 1000000,
    holdingsChangeThreshold: parseInt(process.env.HOLDINGS_CHANGE_THRESHOLD) || 15,
  });

  // Initialize token universe
  await signalEngine.initializeUniverse();

  // ── Telegram bot ──
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const botServices = { signalEngine, alertMatcher: null, nansen, helius, jupiter };
  const bot = new SolScopeBot(telegramToken, botServices);

  // ── Alert matcher ──
  const alertMatcher = new AlertMatcher(bot);
  botServices.alertMatcher = alertMatcher;

  // ── Express server ──
  const app = express();
  app.use(cors());
  app.use(express.json());

  const services = { signalEngine, alertMatcher, helius, jupiter, nansen };
  app.use("/api", createRoutes(services));

  // Root
  app.get("/", (req, res) => {
    res.json({
      name: "SolScope API",
      tagline: "See Solana Clearly",
      version: "2.0.0",
      endpoints: {
        feed: "GET /api/feed",
        token: "GET /api/token/:symbol",
        tokens: "GET /api/tokens",
        brief: "GET /api/brief",
        alerts: "GET /api/alerts/:userId",
        health: "GET /api/health",
      },
    });
  });

  // ── Start scan loop ──
  const scanInterval = (parseInt(process.env.HOT_REFRESH_MINUTES) || 5) * 60 * 1000;

  // Initial scan
  console.log("");
  console.log("  Running initial scan...");
  await signalEngine.scan();

  // Periodic scan
  setInterval(async () => {
    try {
      const result = await signalEngine.scan();

      // After each scan, match alerts against new signals
      const feed = signalEngine.getFeed(10);
      for (const signal of feed) {
        if (Date.now() - signal.timestamp < scanInterval) {
          await alertMatcher.matchSignal(signal);
        }
      }

      // Also match threshold-based alerts against snapshots
      for (const snapshot of signalEngine.getAllSnapshots()) {
        await alertMatcher.matchSnapshot(snapshot);
      }
    } catch (e) {
      console.error("Scan loop error:", e.message);
    }
  }, scanInterval);

  // Daily brief (regenerate every hour)
  setInterval(() => {
    signalEngine.generateDailyBrief();
  }, 60 * 60 * 1000);

  // ── Launch ──
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log("");
    console.log("  ═══════════════════════════════════════");
    console.log(`  🚀 SolScope running on port ${PORT}`);
    console.log(`     http://localhost:${PORT}`);
    console.log("  ═══════════════════════════════════════");
    console.log("");
    console.log("  Endpoints:");
    console.log(`    Feed:    http://localhost:${PORT}/api/feed`);
    console.log(`    Token:   http://localhost:${PORT}/api/token/SOL`);
    console.log(`    Brief:   http://localhost:${PORT}/api/brief`);
    console.log(`    Health:  http://localhost:${PORT}/api/health`);
    console.log("");
    if (bot.enabled) console.log("  🤖 Telegram bot is LIVE");
    if (nansen.enabled) console.log("  🧠 Nansen intelligence is ACTIVE");
    else console.log("  ⚠️  Nansen not configured (running in demo mode)");
    console.log("");
  });
}

main().catch(console.error);
