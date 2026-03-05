// ============================================
// PAPER TRADING SERVICE
// ============================================
// This costs $0 in Helius credits — it's pure logic.
// But it's the #1 feature users will pay for because it
// lets them practice trading without risk.
//
// Monetization hook: "Upgrade to Premium to unlock
// real trading with one-click execution"
// ============================================

class PaperTrader {
  constructor() {
    // userId → portfolio
    this.portfolios = new Map();
  }

  // ---- PORTFOLIO MANAGEMENT ----

  getOrCreatePortfolio(userId) {
    if (!this.portfolios.has(userId)) {
      this.portfolios.set(userId, {
        userId,
        balance: 10000, // Start with $10K paper money
        positions: [],  // { token, symbol, amount, entryPrice, entryTime }
        trades: [],     // { type, token, amount, price, time, pnl }
        createdAt: Date.now(),
      });
    }
    return this.portfolios.get(userId);
  }

  // Buy tokens with paper money
  buy(userId, token, symbol, amount, currentPrice) {
    const portfolio = this.getOrCreatePortfolio(userId);
    const cost = amount * currentPrice;

    if (cost > portfolio.balance) {
      return { success: false, error: "Insufficient paper balance", balance: portfolio.balance, cost };
    }

    if (amount <= 0 || currentPrice <= 0) {
      return { success: false, error: "Invalid amount or price" };
    }

    // Deduct balance
    portfolio.balance -= cost;

    // Add or update position
    const existingPos = portfolio.positions.find(p => p.token === token);
    if (existingPos) {
      // Average up/down
      const totalAmount = existingPos.amount + amount;
      existingPos.entryPrice = ((existingPos.entryPrice * existingPos.amount) + (currentPrice * amount)) / totalAmount;
      existingPos.amount = totalAmount;
    } else {
      portfolio.positions.push({
        token,
        symbol,
        amount,
        entryPrice: currentPrice,
        entryTime: Date.now(),
      });
    }

    // Record trade
    const trade = {
      type: "BUY",
      token,
      symbol,
      amount,
      price: currentPrice,
      total: cost,
      time: Date.now(),
      pnl: 0,
    };
    portfolio.trades.push(trade);

    return {
      success: true,
      trade,
      balance: portfolio.balance,
      position: portfolio.positions.find(p => p.token === token),
    };
  }

  // Sell tokens
  sell(userId, token, amount, currentPrice) {
    const portfolio = this.getOrCreatePortfolio(userId);
    const position = portfolio.positions.find(p => p.token === token);

    if (!position) {
      return { success: false, error: "No position found for this token" };
    }

    if (amount > position.amount) {
      return { success: false, error: "Cannot sell more than you hold", holding: position.amount };
    }

    if (amount <= 0 || currentPrice <= 0) {
      return { success: false, error: "Invalid amount or price" };
    }

    // Calculate P&L
    const revenue = amount * currentPrice;
    const costBasis = amount * position.entryPrice;
    const pnl = revenue - costBasis;
    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Update balance
    portfolio.balance += revenue;

    // Update or remove position
    position.amount -= amount;
    if (position.amount <= 0.000001) {
      portfolio.positions = portfolio.positions.filter(p => p.token !== token);
    }

    // Record trade
    const trade = {
      type: "SELL",
      token,
      symbol: position.symbol,
      amount,
      price: currentPrice,
      total: revenue,
      time: Date.now(),
      pnl,
      pnlPct: pnlPct.toFixed(2),
    };
    portfolio.trades.push(trade);

    return {
      success: true,
      trade,
      balance: portfolio.balance,
      pnl,
      pnlPct: pnlPct.toFixed(2),
    };
  }

  // Get portfolio with current valuations
  getPortfolio(userId, currentPrices = {}) {
    const portfolio = this.getOrCreatePortfolio(userId);

    // Calculate current values
    let totalValue = portfolio.balance;
    const positions = portfolio.positions.map(pos => {
      const currentPrice = currentPrices[pos.token] || pos.entryPrice;
      const currentValue = pos.amount * currentPrice;
      const pnl = currentValue - (pos.amount * pos.entryPrice);
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      totalValue += currentValue;

      return {
        ...pos,
        currentPrice,
        currentValue,
        pnl,
        pnlPct: pnlPct.toFixed(2),
      };
    });

    const initialBalance = 10000;
    const totalPnl = totalValue - initialBalance;
    const totalPnlPct = ((totalValue - initialBalance) / initialBalance) * 100;

    return {
      balance: portfolio.balance,
      positions,
      totalValue,
      totalPnl,
      totalPnlPct: totalPnlPct.toFixed(2),
      tradeCount: portfolio.trades.length,
      createdAt: portfolio.createdAt,
    };
  }

  // Get trade history
  getTradeHistory(userId, limit = 50) {
    const portfolio = this.getOrCreatePortfolio(userId);
    return portfolio.trades.slice(-limit).reverse();
  }

  // Reset portfolio
  reset(userId) {
    this.portfolios.delete(userId);
    return this.getOrCreatePortfolio(userId);
  }

  // Leaderboard (for gamification / community)
  getLeaderboard(currentPrices = {}, limit = 20) {
    const entries = [];

    for (const [userId, portfolio] of this.portfolios) {
      let totalValue = portfolio.balance;
      for (const pos of portfolio.positions) {
        const price = currentPrices[pos.token] || pos.entryPrice;
        totalValue += pos.amount * price;
      }

      entries.push({
        userId: userId.toString().slice(0, 8) + "...",
        totalValue,
        pnl: totalValue - 10000,
        pnlPct: (((totalValue - 10000) / 10000) * 100).toFixed(2),
        tradeCount: portfolio.trades.length,
      });
    }

    return entries
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, limit);
  }
}

export default PaperTrader;
