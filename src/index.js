// ============================================
// SOLSCOPE — Main Server
// ============================================
//
// Total cost to run this:
//   Helius Agent tier:  $1 (one-time)
//   Telegram Bot:       $0 (free forever)
//   Server hosting:     $0 (Railway/Render free tier)
//   Domain (optional):  $10/year
//   ---
//   TOTAL:              $1 to start
//
// Revenue targets:
//   10 users × $29/mo  = $290/mo  (covers Developer tier upgrade)
//   50 users × $29/mo  = $1,450/mo
//   200 users × $29/mo = $5,800/mo
//
// ============================================

import "dotenv/config";
import express from "express";
import cors from "cors";

import HeliusService from "./services/helius.js";
import WhaleTracker from "./services/whale-tracker.js";
import TokenScanner from "./services/token-scanner.js";
import PaperTrader from "./services/paper-trader.js";
import SolScopeBot from "./telegram-bot.js";
import createRoutes from "./routes/api.js";

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     🔬 SolScope Token Intelligence    ║");
  console.log("║     Powered by Helius × Solana        ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  // ---- VALIDATE CONFIG ----

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey || apiKey === "your_helius_api_key_here") {
    console.error("❌ HELIUS_API_KEY not set!");
    console.error("");
    console.error("To get one ($1 one-time):");
    console.error("  1. npm install -g helius-cli");
    console.error("  2. helius keygen");
    console.error("  3. Fund wallet with 1 USDC + 0.001 SOL");
    console.error("  4. helius signup --json");
    console.error("");
    console.error("Or sign up free at: https://dashboard.helius.dev");
    process.exit(1);
  }

  // ---- INITIALIZE SERVICES ----

  console.log("🔧 Initializing services...\n");

  // Core Helius client (credit-aware)
  const helius = new HeliusService(apiKey);

  // Verify API key works
  const health = await helius.healthCheck();
  if (!health.healthy) {
    console.error("❌ Helius API key invalid or API unreachable:", health.error);
    process.exit(1);
  }
  console.log("✅ Helius API connected\n");

  // Token scanner (uses mostly free Jupiter APIs)
  const tokenScanner = new TokenScanner(helius);

  // Paper trading engine (zero API cost)
  const paperTrader = new PaperTrader();

  // Whale tracker (webhook-based, very credit efficient)
  const whaleTracker = new WhaleTracker(helius, null); // bot added below

  // Bundle services
  const services = { helius, whaleTracker, tokenScanner, paperTrader };

  // Telegram bot (free)
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const bot = new SolScopeBot(telegramToken, services);

  // ---- EXPRESS SERVER ----

  const app = express();
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use("/api", createRoutes(services));

  // Root endpoint
  app.get("/", (req, res) => {
    res.json({
      name: "SolScope API",
      version: "1.0.0",
      status: "running",
      docs: {
        trending: "GET /api/tokens/trending",
        search: "GET /api/tokens/search?q=BONK",
        token: "GET /api/tokens/:mintAddress",
        wallet: "GET /api/wallet/:address/assets",
        balance: "GET /api/wallet/:address/balance",
        history: "GET /api/wallet/:address/history",
        whales: "GET /api/whales/activity",
        portfolio: "GET /api/paper/:userId/portfolio",
        buy: "POST /api/paper/:userId/buy",
        sell: "POST /api/paper/:userId/sell",
        leaderboard: "GET /api/paper/leaderboard",
        fees: "GET /api/fees/estimate",
        health: "GET /api/health",
        stats: "GET /api/stats",
      },
    });
  });

  // ---- START BACKGROUND SERVICES ----

  // Start token scanning (every 5 min to conserve credits)
  tokenScanner.startScanning(5);

  // ---- LAUNCH SERVER ----

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log("");
    console.log("═══════════════════════════════════════");
    console.log(`🚀 SolScope API running on port ${PORT}`);
    console.log(`   http://localhost:${PORT}`);
    console.log("═══════════════════════════════════════");
    console.log("");
    console.log("📋 Quick Start:");
    console.log(`   Trending tokens:  http://localhost:${PORT}/api/tokens/trending`);
    console.log(`   Search:           http://localhost:${PORT}/api/tokens/search?q=SOL`);
    console.log(`   Wallet assets:    http://localhost:${PORT}/api/wallet/<address>/assets`);
    console.log(`   API stats:        http://localhost:${PORT}/api/stats`);
    console.log("");
    if (bot.enabled) {
      console.log("🤖 Telegram bot is LIVE — search for your bot on Telegram");
    } else {
      console.log("🤖 Telegram bot DISABLED — set TELEGRAM_BOT_TOKEN in .env");
    }
    console.log("");
    console.log("💰 Credit usage:");
    const stats = helius.getStats();
    console.log(`   Budget: ${stats.creditsBudget.toLocaleString()} credits`);
    console.log(`   Rate limit: ${stats.maxCallsPerMinute} calls/min`);
    console.log("");
  });
}

main().catch(console.error);
