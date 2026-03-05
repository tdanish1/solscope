// ============================================
// TELEGRAM BOT
// ============================================
// This is your #1 distribution channel.
// Crypto users LIVE in Telegram. A bot here gets you
// users faster than any website.
//
// Cost: $0 (Telegram Bot API is free forever)
//
// Revenue model:
//   FREE tier: Basic alerts, 3 wallet watches, paper trading
//   PREMIUM ($29/mo): Unlimited wallets, whale alerts,
//                       real-time notifications, leaderboard
// ============================================

import TelegramBot from "node-telegram-bot-api";

class SolScopeBot {
  constructor(token, services) {
    if (!token || token === "your_telegram_bot_token_here") {
      console.log("⚠️  Telegram bot token not set. Bot disabled.");
      console.log("   Get one free from @BotFather on Telegram");
      this.enabled = false;
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });
    this.services = services; // { helius, whaleTracker, tokenScanner, paperTrader }
    this.enabled = true;

    // User state tracking
    this.userWatches = new Map(); // chatId → Set of wallet addresses
    this.FREE_WALLET_LIMIT = 3;

    this._registerCommands();
    console.log("🤖 Telegram bot started");
  }

  _registerCommands() {
    const bot = this.bot;

    // /start - Welcome message
    bot.onText(/\/start/, (msg) => {
      const welcome = [
        "🔬 *Welcome to SolScope Bot!*",
        "",
        "Your Solana Token Intelligence Assistant.",
        "",
        "*Commands:*",
        "/trending — Top trending tokens",
        "/whale — Recent whale activity",
        "/watch `<address>` — Watch a wallet",
        "/unwatch `<address>` — Stop watching",
        "/portfolio — Your paper trading portfolio",
        "/buy `<token>` `<amount>` — Paper buy",
        "/sell `<token>` `<amount>` — Paper sell",
        "/alerts — Toggle whale alerts on/off",
        "/stats — Bot & API stats",
        "",
        "💡 _Free tier: 3 wallet watches, paper trading_",
        "⭐ _Premium ($29/mo): Unlimited watches, whale alerts_",
      ].join("\n");
      bot.sendMessage(msg.chat.id, welcome, { parse_mode: "Markdown" });
    });

    // /trending - Show trending tokens
    bot.onText(/\/trending/, async (msg) => {
      const tokens = this.services.tokenScanner.getTrending(10);
      if (tokens.length === 0) {
        bot.sendMessage(msg.chat.id, "📊 Scanner is warming up... try again in a minute.");
        return;
      }

      const lines = tokens.map((t, i) => {
        const change = t.change24h > 0 ? `+${t.change24h}%` : `${t.change24h}%`;
        const emoji = t.change24h > 0 ? "🟢" : "🔴";
        const risk = t.risk === "HIGH" ? "⚠️" : t.risk === "MED" ? "🟡" : "✅";
        return `${i + 1}. ${emoji} *${t.symbol || t.name}* ${change} ${risk}`;
      });

      const message = [
        "📊 *Trending Tokens*",
        "",
        ...lines,
        "",
        "_Updated just now • /trending to refresh_",
      ].join("\n");

      bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    });

    // /whale - Show recent whale activity
    bot.onText(/\/whale/, (msg) => {
      const activity = this.services.whaleTracker.getRecentActivity(10);
      if (activity.length === 0) {
        bot.sendMessage(msg.chat.id, "🐋 No whale activity recorded yet. Webhooks may not be set up.");
        return;
      }

      const lines = activity.map(a => {
        const emoji = a.type === "SWAP" ? "🔄" : "💰";
        return `${emoji} \`${a.wallet}\` — ${a.description}`;
      });

      const message = ["🐋 *Recent Whale Activity*", "", ...lines].join("\n");
      bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    });

    // /watch <address> - Watch a wallet
    bot.onText(/\/watch (.+)/, async (msg, match) => {
      const address = match[1].trim();
      const chatId = msg.chat.id;

      // Validate address (basic check)
      if (address.length < 32 || address.length > 44) {
        bot.sendMessage(chatId, "❌ Invalid Solana address. Should be 32-44 characters.");
        return;
      }

      // Check free tier limit
      const watches = this.userWatches.get(chatId) || new Set();
      if (watches.size >= this.FREE_WALLET_LIMIT) {
        bot.sendMessage(chatId,
          `⭐ Free tier limit reached (${this.FREE_WALLET_LIMIT} wallets).\n\n` +
          `Upgrade to Premium for unlimited wallet watches!\n` +
          `Contact @YourUsername for Premium access.`
        );
        return;
      }

      watches.add(address);
      this.userWatches.set(chatId, watches);

      bot.sendMessage(chatId,
        `👁️ Now watching: \`${address.slice(0, 8)}...${address.slice(-4)}\`\n` +
        `Watches used: ${watches.size}/${this.FREE_WALLET_LIMIT}`,
        { parse_mode: "Markdown" }
      );
    });

    // /unwatch <address>
    bot.onText(/\/unwatch (.+)/, (msg, match) => {
      const address = match[1].trim();
      const chatId = msg.chat.id;
      const watches = this.userWatches.get(chatId) || new Set();
      watches.delete(address);
      bot.sendMessage(chatId, `✅ Stopped watching \`${address.slice(0, 8)}...\``, { parse_mode: "Markdown" });
    });

    // /portfolio - Paper trading portfolio
    bot.onText(/\/portfolio/, (msg) => {
      const portfolio = this.services.paperTrader.getPortfolio(msg.chat.id);

      const posLines = portfolio.positions.length > 0
        ? portfolio.positions.map(p => {
          const emoji = p.pnl >= 0 ? "🟢" : "🔴";
          return `${emoji} ${p.symbol}: ${p.amount.toFixed(4)} @ $${p.entryPrice.toFixed(6)} (${p.pnlPct}%)`;
        })
        : ["_No positions yet. Use /buy to start!_"];

      const message = [
        "💼 *Paper Trading Portfolio*",
        "",
        `💵 Cash: $${portfolio.balance.toFixed(2)}`,
        `📈 Total Value: $${portfolio.totalValue.toFixed(2)}`,
        `${portfolio.totalPnl >= 0 ? "🟢" : "🔴"} P&L: $${portfolio.totalPnl.toFixed(2)} (${portfolio.totalPnlPct}%)`,
        "",
        "*Positions:*",
        ...posLines,
        "",
        `_${portfolio.tradeCount} trades made_`,
      ].join("\n");

      bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    });

    // /buy <token> <usd_amount>
    bot.onText(/\/buy (.+)/, (msg, match) => {
      const parts = match[1].trim().split(/\s+/);
      if (parts.length < 2) {
        bot.sendMessage(msg.chat.id, "Usage: /buy SOL 100\n(Buy $100 worth of SOL)");
        return;
      }

      const symbol = parts[0].toUpperCase();
      const usdAmount = parseFloat(parts[1]);

      if (isNaN(usdAmount) || usdAmount <= 0) {
        bot.sendMessage(msg.chat.id, "❌ Invalid amount. Example: /buy SOL 100");
        return;
      }

      // Find token in scanner
      const tokens = this.services.tokenScanner.searchTokens(symbol);
      const token = tokens[0];

      if (!token || !token.price || token.price <= 0) {
        bot.sendMessage(msg.chat.id, `❌ Token "${symbol}" not found or no price data. Try /trending to see available tokens.`);
        return;
      }

      const amount = usdAmount / token.price;
      const result = this.services.paperTrader.buy(msg.chat.id, token.mint, symbol, amount, token.price);

      if (result.success) {
        bot.sendMessage(msg.chat.id,
          `✅ *Paper Buy Executed*\n` +
          `Bought ${amount.toFixed(4)} ${symbol} @ $${token.price.toFixed(6)}\n` +
          `Total: $${usdAmount.toFixed(2)}\n` +
          `Remaining balance: $${result.balance.toFixed(2)}`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      }
    });

    // /sell <token> <amount_or_all>
    bot.onText(/\/sell (.+)/, (msg, match) => {
      const parts = match[1].trim().split(/\s+/);
      if (parts.length < 2) {
        bot.sendMessage(msg.chat.id, "Usage: /sell SOL 50\nor: /sell SOL all");
        return;
      }

      const symbol = parts[0].toUpperCase();
      const portfolio = this.services.paperTrader.getOrCreatePortfolio(msg.chat.id);
      const position = portfolio.positions.find(p => p.symbol === symbol);

      if (!position) {
        bot.sendMessage(msg.chat.id, `❌ No ${symbol} position found. Check /portfolio`);
        return;
      }

      const tokens = this.services.tokenScanner.searchTokens(symbol);
      const token = tokens[0];
      const currentPrice = token?.price || position.entryPrice;

      const amount = parts[1].toLowerCase() === "all" ? position.amount : parseFloat(parts[1]);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(msg.chat.id, "❌ Invalid amount");
        return;
      }

      const result = this.services.paperTrader.sell(msg.chat.id, position.token, amount, currentPrice);

      if (result.success) {
        const pnlEmoji = result.pnl >= 0 ? "🟢" : "🔴";
        bot.sendMessage(msg.chat.id,
          `✅ *Paper Sell Executed*\n` +
          `Sold ${amount.toFixed(4)} ${symbol} @ $${currentPrice.toFixed(6)}\n` +
          `${pnlEmoji} P&L: $${result.pnl.toFixed(2)} (${result.pnlPct}%)\n` +
          `Balance: $${result.balance.toFixed(2)}`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      }
    });

    // /alerts - Subscribe to whale alerts
    bot.onText(/\/alerts/, (msg) => {
      const result = this.services.whaleTracker.subscribe(msg.chat.id);
      bot.sendMessage(msg.chat.id, "🐋 Whale alerts *enabled*! You'll get notifications for major whale moves.", { parse_mode: "Markdown" });
    });

    // /stats
    bot.onText(/\/stats/, (msg) => {
      const heliusStats = this.services.helius.getStats();
      const scannerStats = this.services.tokenScanner.getStats();

      const message = [
        "📊 *SolScope Stats*",
        "",
        `🔑 Helius credits: ${heliusStats.creditsRemaining.toLocaleString()} remaining`,
        `📡 API calls this minute: ${heliusStats.callsThisMinute}/${heliusStats.maxCallsPerMinute}`,
        `💾 Cache entries: ${heliusStats.cacheSize}`,
        `🔍 Tokens tracked: ${scannerStats.totalTokens}`,
        `📈 Trending tokens: ${scannerStats.trendingCount}`,
        `🔄 Scans completed: ${scannerStats.scanCount}`,
      ].join("\n");

      bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
    });

    // Handle unknown commands
    bot.on("message", (msg) => {
      if (msg.text && msg.text.startsWith("/") && !msg.text.match(/^\/(start|trending|whale|watch|unwatch|portfolio|buy|sell|alerts|stats)/)) {
        bot.sendMessage(msg.chat.id, "Unknown command. Try /start to see available commands.");
      }
    });
  }

  // Send a message to a specific chat (for alerts)
  async sendAlert(chatId, message) {
    if (!this.enabled) return;
    try {
      await this.bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (e) {
      console.error(`Failed to send alert to ${chatId}:`, e.message);
    }
  }
}

export default SolScopeBot;
