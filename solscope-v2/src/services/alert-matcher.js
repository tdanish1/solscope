// ============================================
// ALERT MATCHER — Custom User Alerts
// ============================================
// Users subscribe to internal signals, NOT raw API queries.
// This means the expensive part (fetching data) is shared,
// and the matching part (checking rules) is free.
//
// Example user rule:
//   "Notify me when any token's conviction score > 75"
//
// The engine checks this against already-computed snapshots.
// Zero additional API calls per user.
// ============================================

class AlertMatcher {
  constructor(telegramBot) {
    this.telegram = telegramBot;

    // userId → array of alert rules
    this.userRules = new Map();

    // userId → alert delivery preferences
    this.userPrefs = new Map();

    // Track recently fired alerts to prevent spam
    // key = `${userId}:${ruleId}:${tokenMint}`, value = timestamp
    this.cooldowns = new Map();

    this.alertsSent = 0;
  }

  // ════════════════════════════════════════
  // RULE MANAGEMENT
  // ════════════════════════════════════════

  addRule(userId, rule) {
    if (!this.userRules.has(userId)) {
      this.userRules.set(userId, []);
    }

    const rules = this.userRules.get(userId);

    // Free tier limit: 3 rules
    // Pro: 10 rules, Pro+: unlimited
    const limit = rule.tier === "pro_plus" ? 100 : rule.tier === "pro" ? 10 : 3;
    if (rules.length >= limit) {
      return { success: false, error: `Rule limit reached (${limit}). Upgrade for more.` };
    }

    const newRule = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
      createdAt: Date.now(),
      // Rule definition
      tokenScope: rule.tokenScope || "any",        // "any" | specific mint
      signalType: rule.signalType || "any",         // signal type or "any"
      sentimentAbove: rule.sentimentAbove ?? null,   // trigger if score > X
      sentimentBelow: rule.sentimentBelow ?? null,   // trigger if score < X
      netflowAbove: rule.netflowAbove ?? null,       // trigger if inflow > $X
      netflowBelow: rule.netflowBelow ?? null,       // trigger if outflow < -$X
      holdingsChangeAbove: rule.holdingsChangeAbove ?? null,
      // Delivery
      telegram: rule.telegram !== false,
      // Cooldown (prevent repeat alerts)
      cooldownMs: rule.cooldownMs || 6 * 60 * 60 * 1000, // 6 hours default
      // Status
      enabled: true,
    };

    rules.push(newRule);
    return { success: true, rule: newRule, totalRules: rules.length };
  }

  removeRule(userId, ruleId) {
    const rules = this.userRules.get(userId);
    if (!rules) return { success: false, error: "No rules found" };

    const idx = rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return { success: false, error: "Rule not found" };

    rules.splice(idx, 1);
    return { success: true };
  }

  getRules(userId) {
    return this.userRules.get(userId) || [];
  }

  // ════════════════════════════════════════
  // MATCHING — Called after each scan
  // ════════════════════════════════════════

  // Match all user rules against a new signal
  async matchSignal(signal) {
    const notifications = [];

    for (const [userId, rules] of this.userRules) {
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (this._matches(rule, signal)) {
          if (this._checkCooldown(userId, rule.id, signal.mint)) {
            notifications.push({ userId, rule, signal });
            this._setCooldown(userId, rule.id, signal.mint, rule.cooldownMs);
          }
        }
      }
    }

    // Send notifications
    for (const n of notifications) {
      await this._notify(n.userId, n.signal);
    }

    return notifications.length;
  }

  // Match all user rules against a token snapshot (for threshold-based alerts)
  async matchSnapshot(snapshot) {
    const notifications = [];

    for (const [userId, rules] of this.userRules) {
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (this._matchesSnapshot(rule, snapshot)) {
          if (this._checkCooldown(userId, rule.id, snapshot.mint)) {
            const pseudoSignal = {
              type: "CUSTOM_ALERT",
              emoji: "🔔",
              label: "Custom Alert",
              mint: snapshot.mint,
              symbol: snapshot.symbol,
              headline: `${snapshot.symbol} matched your alert rule`,
              details: {
                sentimentScore: snapshot.sentimentScore,
                netflowUsd: snapshot.netflowUsd,
                holdingsChangePct: snapshot.holdingsChangePct,
              },
              timestamp: Date.now(),
            };
            notifications.push({ userId, signal: pseudoSignal });
            this._setCooldown(userId, rule.id, snapshot.mint, rule.cooldownMs);
          }
        }
      }
    }

    for (const n of notifications) {
      await this._notify(n.userId, n.signal);
    }

    return notifications.length;
  }

  // Check if a signal matches a rule
  _matches(rule, signal) {
    // Token scope filter
    if (rule.tokenScope !== "any" && rule.tokenScope !== signal.mint) return false;

    // Signal type filter
    if (rule.signalType !== "any" && rule.signalType !== signal.type) return false;

    // Threshold filters on signal details
    if (rule.sentimentAbove !== null && (signal.details?.sentimentScore ?? 0) < rule.sentimentAbove) return false;
    if (rule.netflowAbove !== null && (signal.details?.netflowUsd ?? 0) < rule.netflowAbove) return false;

    return true;
  }

  // Check if a snapshot matches threshold-based rules
  _matchesSnapshot(rule, snapshot) {
    if (rule.tokenScope !== "any" && rule.tokenScope !== snapshot.mint) return false;

    // Only check threshold-based rules here (not signal-type rules)
    if (rule.signalType !== "any") return false;

    let matched = false;
    if (rule.sentimentAbove !== null && snapshot.sentimentScore >= rule.sentimentAbove) matched = true;
    if (rule.sentimentBelow !== null && snapshot.sentimentScore <= rule.sentimentBelow) matched = true;
    if (rule.netflowAbove !== null && snapshot.netflowUsd >= rule.netflowAbove) matched = true;
    if (rule.netflowBelow !== null && snapshot.netflowUsd <= rule.netflowBelow) matched = true;
    if (rule.holdingsChangeAbove !== null && snapshot.holdingsChangePct >= rule.holdingsChangeAbove) matched = true;

    return matched;
  }

  // ════════════════════════════════════════
  // COOLDOWNS
  // ════════════════════════════════════════

  _checkCooldown(userId, ruleId, mint) {
    const key = `${userId}:${ruleId}:${mint}`;
    const last = this.cooldowns.get(key);
    if (!last) return true;
    return Date.now() - last.t > last.cd;
  }

  _setCooldown(userId, ruleId, mint, cooldownMs) {
    const key = `${userId}:${ruleId}:${mint}`;
    this.cooldowns.set(key, { t: Date.now(), cd: cooldownMs });

    // Clean old cooldowns
    if (this.cooldowns.size > 5000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [k, v] of this.cooldowns) {
        if (v.t < cutoff) this.cooldowns.delete(k);
      }
    }
  }

  // ════════════════════════════════════════
  // NOTIFICATIONS
  // ════════════════════════════════════════

  async _notify(userId, signal) {
    if (!this.telegram?.enabled) return;

    const fmt = (n) => {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return n.toFixed(0);
    };

    const lines = [
      `${signal.emoji} *${signal.label}*`,
      "",
      `*${signal.symbol}*`,
      signal.headline,
    ];

    if (signal.details) {
      if (signal.details.netflowUsd) lines.push(`Net flow: $${fmt(signal.details.netflowUsd)}`);
      if (signal.details.holdingsChangePct) lines.push(`Holdings change: ${signal.details.holdingsChangePct > 0 ? "+" : ""}${signal.details.holdingsChangePct.toFixed(1)}%`);
      if (signal.details.sentimentScore) lines.push(`Sentiment: ${signal.details.sentimentScore}/100`);
      if (signal.details.confidence) lines.push(`Confidence: ${signal.details.confidence}`);
    }

    lines.push("", "_SolScope — See Solana Clearly_");

    try {
      await this.telegram.bot.sendMessage(userId, lines.join("\n"), { parse_mode: "Markdown" });
      this.alertsSent++;
    } catch (e) {
      console.error(`Alert send failed for ${userId}:`, e.message);
    }
  }

  getStats() {
    return {
      totalUsers: this.userRules.size,
      totalRules: [...this.userRules.values()].reduce((a, r) => a + r.length, 0),
      alertsSent: this.alertsSent,
    };
  }
}

export default AlertMatcher;
