
// SOLSCOPE v2 — Smart Money Intelligence Feed

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
  // Bind port immediately so Railway's health check passes
  const PORT = process.env.PORT || 3001;
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/", (req, res) => res.json({ name: "SolScope API", status: "starting" }));
  app.get("/api/health", (req, res) => res.json({ healthy: true, status: "initializing" }));

  const server = app.listen(PORT, () => {
    console.log(`  🚀 SolScope on port ${PORT} — initializing services...`);
  });

  // Now initialize services (port is already bound)
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey || heliusKey.includes("your_")) {
    console.error("  ❌ HELIUS_API_KEY not set");
    process.exit(1);
  }

  const helius = new HeliusService(heliusKey);
  const jupiter = new JupiterService(process.env.JUPITER_API_KEY);
  const nansen = new NansenService(process.env.NANSEN_API_KEY);

  const signalEngine = new SignalEngine(helius, jupiter, nansen, {
    convictionThreshold: parseInt(process.env.CONVICTION_THRESHOLD) || 1000000,
    holdingsChangeThreshold: parseInt(process.env.HOLDINGS_CHANGE_THRESHOLD) || 15,
  });

  await signalEngine.initializeUniverse();

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const botServices = { signalEngine, alertMatcher: null, nansen, helius, jupiter };
  const bot = new SolScopeBot(telegramToken, botServices);
  const alertMatcher = new AlertMatcher(bot);
  botServices.alertMatcher = alertMatcher;

  // Replace placeholder routes with real ones
  const services = { signalEngine, alertMatcher, helius, jupiter, nansen };
  app.use("/api", createRoutes(services));
  app.get("/", (req, res) => res.json({
    name: "SolScope API",
    tagline: "See Solana Clearly",
    version: "2.0.0",
    endpoints: { feed: "GET /api/feed", token: "GET /api/token/:symbol", health: "GET /api/health" },
  }));

  console.log("  ✓ Services ready");
  if (bot.enabled) console.log("  🤖 Telegram bot is LIVE");
  if (nansen.enabled) console.log("  🧠 Nansen intelligence is ACTIVE");

  // Fire initial scan
  const scanInterval = (parseInt(process.env.HOT_REFRESH_MINUTES) || 15) * 60 * 1000;
  signalEngine.scan().catch(console.error);

  setInterval(async () => {
    try {
      await signalEngine.scan();
      const feed = signalEngine.getFeed(10);
      for (const signal of feed) {
        if (Date.now() - signal.timestamp < scanInterval) await alertMatcher.matchSignal(signal);
      }
      for (const snapshot of signalEngine.getAllSnapshots()) {
        await alertMatcher.matchSnapshot(snapshot);
      }
    } catch (e) {
      console.error("Scan loop error:", e.message);
    }
  }, scanInterval);

  setInterval(() => signalEngine.generateDailyBrief(), 60 * 60 * 1000);
}

main().catch(console.error);
