// TELEGRAM BOT — Intelligence Feed Companion
// Commands focused on signals, not trading.
// This is a distribution channel, not the product.

import TelegramBot from "node-telegram-bot-api";

class SolScopeBot {
  constructor(token, services) {
    if (!token || token.includes("your_")) {
      console.log("  ⚠ Telegram bot not configured");
      this.enabled = false;
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });
    this.bot.on("polling_error", (err) => console.error("Telegram polling error:", err.message));
    this.services = services;
    this.enabled = true;
    this._register();
    console.log("  ✓ Telegram bot started");
  }

  _fmt(n) {
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(0);
  }

  _register() {
    const bot = this.bot;
    const { signalEngine, alertMatcher } = this.services;

    // /start
    bot.onText(/\/start/, (msg) => {
      bot.sendMessage(msg.chat.id, [
        "🔬 *SolScope — See Solana Clearly*",
        "",
        "Smart money intelligence for Solana tokens.",
        "",
        "*Commands:*",
        "/feed — Latest intelligence signals",
        "/brief — Daily Solana intelligence brief",
        "/token `<symbol>` — Token intelligence page",
        "/alert — Set up custom alerts",
        "/alerts — View your alert rules",
        "/stats — System status",
        "",
        "Data sources: Nansen · Helius · Jupiter",
        "",
        "🌐 _solscope.xyz_",
      ].join("\n"), { parse_mode: "Markdown" });
    });

    // /feed — Main intelligence feed
    bot.onText(/\/feed/, (msg) => {
      const signals = signalEngine.getFeed(8);
      if (signals.length === 0) {
        bot.sendMessage(msg.chat.id, "📡 No signals detected yet. Engine is warming up...");
        return;
      }

      const lines = ["📡 *SolScope Intelligence Feed*", ""];
      for (const s of signals) {
        lines.push(`${s.emoji} *${s.symbol}* — ${s.label}`);
        if (s.details?.netflowUsd) lines.push(`   Flow: ${this._fmt(s.details.netflowUsd)}`);
        if (s.details?.sentimentScore) lines.push(`   Sentiment: ${s.details.sentimentScore}/100`);
        lines.push("");
      }
      lines.push("_Use /token <symbol> for details_");

      bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /brief — Daily intelligence brief
    bot.onText(/\/brief/, (msg) => {
      const brief = signalEngine.getDailyBrief();
      if (!brief) {
        bot.sendMessage(msg.chat.id, "📋 Brief not ready yet. Try again in a few minutes.");
        return;
      }

      const lines = [
        "📋 *Solana Intelligence Brief*",
        "",
        "*Top Smart Money Inflows:*",
      ];

      if (brief.topInflows.length > 0) {
        brief.topInflows.forEach((t, i) => {
          lines.push(`${i + 1}. *${t.symbol}* — ${this._fmt(t.netflowUsd)} (Score: ${t.sentimentScore})`);
        });
      } else {
        lines.push("_No significant inflows detected_");
      }

      lines.push("", "*Top Outflows:*");
      if (brief.topOutflows.length > 0) {
        brief.topOutflows.forEach((t, i) => {
          lines.push(`${i + 1}. *${t.symbol}* — ${this._fmt(t.netflowUsd)}`);
        });
      } else {
        lines.push("_No significant outflows detected_");
      }

      lines.push(
        "",
        `Signals (24h): ${brief.totalSignals24h}`,
        `Avg Sentiment: ${brief.avgSentiment}/100`,
        "",
        "_SolScope — See Solana Clearly_"
      );

      bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /token <symbol> — Token intelligence page
    bot.onText(/\/token (.+)/, (msg, match) => {
      const query = match[1].trim().toUpperCase();
      const page = signalEngine.getTokenPage(query);

      if (!page) {
        bot.sendMessage(msg.chat.id, `❌ Token "${query}" not found. Try SOL, JUP, BONK, etc.`);
        return;
      }

      const trendEmoji = page.trend.includes("ACCUMULATION") ? "📈" :
        page.trend.includes("DISTRIBUTION") ? "📉" : "➡️";

      const lines = [
        `🔬 *${page.symbol} Intelligence*`,
        "",
        `*Smart Money Sentiment*`,
        `Score: *${page.sentimentScore}/100*`,
        `Trend: ${trendEmoji} ${page.trend.replace(/_/g, " ")}`,
        `Confidence: ${page.confidence}`,
        "",
        `*Smart Money Flow*`,
        `Net flow: ${this._fmt(page.netflowUsd)}`,
        `Holdings change: ${page.holdingsChangePct > 0 ? "+" : ""}${page.holdingsChangePct.toFixed(1)}%`,
        "",
        `*Holder Distribution*`,
        `Smart Money: ${page.holderDistribution.smartMoney.toFixed(1)}%`,
        `Retail: ${page.holderDistribution.retail.toFixed(1)}%`,
        `Exchange: ${page.holderDistribution.exchange.toFixed(1)}%`,
        "",
        `Price: $${page.price < 0.01 ? page.price.toFixed(6) : page.price.toFixed(4)}`,
      ];

      if (page.recentSignals.length > 0) {
        lines.push("", "*Recent Signals:*");
        page.recentSignals.forEach(s => {
          lines.push(`${s.emoji} ${s.label}`);
        });
      }

      lines.push("", "_SolScope — See Solana Clearly_");
      bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /alert — Create a custom alert
    bot.onText(/\/alert/, (msg) => {
      bot.sendMessage(msg.chat.id, [
        "🔔 *Create Custom Alert*",
        "",
        "Send a command like:",
        "",
        "`/setalert sentiment_above 75`",
        "→ Alert when any token's sentiment > 75",
        "",
        "`/setalert conviction_up any`",
        "→ Alert on all conviction increase signals",
        "",
        "`/setalert inflow_above 2000000`",
        "→ Alert when smart money inflow > $2M",
        "",
        "Use /alerts to see your current rules.",
      ].join("\n"), { parse_mode: "Markdown" });
    });

    // /setalert <type> <value>
    bot.onText(/\/setalert (.+)/, (msg, match) => {
      const parts = match[1].trim().split(/\s+/);
      if (parts.length < 2) {
        bot.sendMessage(msg.chat.id, "Usage: /setalert sentiment\\_above 75");
        return;
      }

      const [type, value] = parts;
      const rule = { telegram: true };

      switch (type.toLowerCase()) {
        case "sentiment_above":
          rule.sentimentAbove = parseInt(value);
          break;
        case "sentiment_below":
          rule.sentimentBelow = parseInt(value);
          break;
        case "inflow_above":
          rule.netflowAbove = parseInt(value);
          break;
        case "outflow_below":
          rule.netflowBelow = -Math.abs(parseInt(value));
          break;
        case "conviction_up":
          rule.signalType = "CONVICTION_UP";
          break;
        case "conviction_down":
          rule.signalType = "CONVICTION_DOWN";
          break;
        case "smart_money_entry":
          rule.signalType = "SMART_MONEY_ENTRY";
          break;
        default:
          bot.sendMessage(msg.chat.id, `Unknown alert type: ${type}`);
          return;
      }

      const result = alertMatcher.addRule(msg.chat.id.toString(), rule);
      if (result.success) {
        bot.sendMessage(msg.chat.id, `✅ Alert created! (${result.totalRules}/3 free slots used)\n\nYou'll be notified via Telegram when triggered.`);
      } else {
        bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      }
    });

    // /alerts — View current rules
    bot.onText(/\/alerts/, (msg) => {
      const rules = alertMatcher.getRules(msg.chat.id.toString());
      if (rules.length === 0) {
        bot.sendMessage(msg.chat.id, "No alert rules set. Use /alert to create one.");
        return;
      }

      const lines = ["🔔 *Your Alert Rules*", ""];
      rules.forEach((r, i) => {
        const desc = [];
        if (r.sentimentAbove !== null) desc.push(`Sentiment > ${r.sentimentAbove}`);
        if (r.sentimentBelow !== null) desc.push(`Sentiment < ${r.sentimentBelow}`);
        if (r.netflowAbove !== null) desc.push(`Inflow > ${this._fmt(r.netflowAbove)}`);
        if (r.signalType && r.signalType !== "any") desc.push(`Type: ${r.signalType}`);
        if (desc.length === 0) desc.push("All signals");
        lines.push(`${i + 1}. ${desc.join(", ")} — \`${r.id}\``);
      });
      lines.push("", `_${rules.length}/3 free slots used_`);

      bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /stats
    bot.onText(/\/stats/, (msg) => {
      const se = signalEngine.getStats();
      const ns = this.services.nansen.getStats();
      const lines = [
        "📊 *SolScope Status*",
        "",
        `Tokens tracked: ${se.trackedTokens}`,
        `Signals generated: ${se.totalSignals}`,
        `Scans completed: ${se.scanCount}`,
        "",
        `Nansen credits: ${ns.creditsRemaining?.toLocaleString() || "N/A"} remaining`,
        `Nansen calls: ${ns.calls}`,
        "",
        "_SolScope — See Solana Clearly_",
      ];
      bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
    });
  }
}

export default SolScopeBot;
