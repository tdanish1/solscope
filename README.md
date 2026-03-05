# 🔬 SolScope — Solana Token Intelligence

**A complete backend for a Solana analytics + paper trading product, powered by Helius.**

Built to start at **$1 total cost** and scale to thousands of paying users.

---

## 💰 Cost Breakdown

| Item | Cost | Notes |
|------|------|-------|
| Helius Agent tier | **$1** one-time | 1M credits, 10 req/s |
| Telegram Bot | **$0** | Free forever via BotFather |
| Server hosting | **$0** | Railway/Render/Fly.io free tier |
| Domain (optional) | ~$10/year | Can skip initially |
| **TOTAL TO START** | **$1** | |

### When to upgrade Helius plan

| Revenue | Action |
|---------|--------|
| $0-100/mo | Stay on Agent tier ($1) |
| $100-500/mo | Upgrade to Developer ($49/mo) |
| $500+/mo | Upgrade to Business ($499/mo) |

---

## 🚀 Setup (5 minutes)

### 1. Get a Helius API Key ($1)

**Option A — Dashboard (easiest):**
- Go to https://dashboard.helius.dev
- Sign up free (100K DAS API calls/mo included)
- Or pay $1 for Agent tier (1M credits)

**Option B — CLI (for automation):**
```bash
npm install -g helius-cli
helius keygen
# Fund wallet with 1 USDC + 0.001 SOL
helius signup --json
# Copy the apiKey from the response
```

### 2. Get a Telegram Bot Token (free)

1. Open Telegram, message @BotFather
2. Send `/newbot`
3. Follow prompts, copy the token

### 3. Configure & Run

```bash
# Clone / download this project
cd solscope

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your HELIUS_API_KEY and TELEGRAM_BOT_TOKEN

# Start the server
npm start

# Or for development (auto-restart on changes)
npm run dev
```

### 4. Test It

```bash
# Health check
curl http://localhost:3001/api/health

# Trending tokens
curl http://localhost:3001/api/tokens/trending

# Search tokens
curl http://localhost:3001/api/tokens/search?q=SOL

# Wallet assets (replace with real address)
curl http://localhost:3001/api/wallet/86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY/assets

# Paper trade
curl -X POST http://localhost:3001/api/paper/user1/buy \
  -H "Content-Type: application/json" \
  -d '{"token":"So11111111111111111111111111111111111111112","symbol":"SOL","amount":10,"price":135}'
```

---

## 📁 Project Structure

```
solscope/
├── src/
│   ├── index.js              # Main server (Express)
│   ├── telegram-bot.js       # Telegram bot (free distribution channel)
│   ├── services/
│   │   ├── helius.js         # Helius API wrapper (credit-aware + cached)
│   │   ├── whale-tracker.js  # Whale monitoring via webhooks
│   │   ├── token-scanner.js  # Token discovery (mostly free via Jupiter)
│   │   └── paper-trader.js   # Paper trading engine (zero API cost)
│   └── routes/
│       └── api.js            # REST API routes for dashboard
├── .env.example              # Environment config template
├── package.json
└── README.md
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                   CLIENTS                        │
│  React Dashboard  │  Telegram Bot  │  API Users  │
└────────┬──────────┴───────┬────────┴──────┬──────┘
         │                  │               │
         ▼                  ▼               ▼
┌─────────────────────────────────────────────────┐
│              EXPRESS API SERVER                   │
│  /api/tokens/*  /api/wallet/*  /api/paper/*      │
│  /api/whales/*  /api/webhooks/helius             │
└────────┬──────────┬───────────┬──────────────────┘
         │          │           │
         ▼          ▼           ▼
┌──────────┐ ┌───────────┐ ┌──────────────┐
│ Token    │ │  Whale    │ │   Paper      │
│ Scanner  │ │  Tracker  │ │   Trader     │
│(Jupiter) │ │(Webhooks) │ │   (In-mem)   │
│ FREE     │ │ 1cr/event │ │   $0 cost    │
└────┬─────┘ └─────┬─────┘ └──────────────┘
     │             │
     ▼             ▼
┌─────────────────────────────────────────────────┐
│         HELIUS SERVICE (Credit-Aware)            │
│  • In-memory cache (30s-2min TTL)               │
│  • Rate limiting (stays under 10 req/s)         │
│  • Credit tracking with low-balance warnings     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              HELIUS APIs                         │
│  RPC (1cr) │ DAS (10cr) │ Enhanced TX (100cr)   │
│  Webhooks (1cr/event) │ Sender (FREE)           │
└─────────────────────────────────────────────────┘
```

---

## 💵 Revenue Model

### Free Tier (user acquisition)
- Trending tokens feed
- 3 wallet watches
- Paper trading with $10K virtual balance
- Basic token risk scores

### Premium — $29/month (target: 200 users = $5,800/mo)
- Unlimited wallet watches
- Real-time whale alerts (Telegram)
- Advanced token scoring
- Paper trading leaderboard
- Priority support

### Pro — $79/month (target: 50 users = $3,950/mo)
- Everything in Premium
- API access for their own bots
- Custom alert rules
- Historical data exports
- Real trading execution (via Helius Sender)

---

## 🎯 Credit Budget Planner

### Agent Tier: 1,000,000 credits

| Operation | Credits | Calls/day | Daily cost | Monthly cost |
|-----------|---------|-----------|------------|-------------|
| Token scanning (Jupiter=free, Helius enrich) | 10 | 50 | 500 | 15,000 |
| Wallet lookups (DAS API) | 10 | 100 | 1,000 | 30,000 |
| Transaction history | 100 | 20 | 2,000 | 60,000 |
| Webhook events | 1 | 200 | 200 | 6,000 |
| RPC calls (balance, health) | 1 | 500 | 500 | 15,000 |
| Priority fee checks | 1 | 100 | 100 | 3,000 |
| **TOTAL** | | | **4,300** | **~129,000** |

**Result: 1M credits lasts ~7-8 months** at moderate usage.

### When you hit Developer tier ($49/mo = 10M credits)
You can 10x the usage: more wallet lookups, faster scanning, real-time features.

---

## 🚢 Deployment (Free)

### Railway (recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```
Set environment variables in Railway dashboard.

### Render
1. Push to GitHub
2. Connect repo at render.com
3. Set environment variables
4. Deploy (free tier available)

### Fly.io
```bash
fly launch
fly secrets set HELIUS_API_KEY=your_key
fly secrets set TELEGRAM_BOT_TOKEN=your_token
fly deploy
```

---

## 📈 Growth Playbook

### Week 1-2: Launch
- [ ] Deploy backend + Telegram bot
- [ ] Post in Solana Discord servers
- [ ] Tweet about it (tag @heaboringsl, @solaboringna)
- [ ] Get 50 Telegram bot users

### Week 3-4: Validate
- [ ] Track which features get used most
- [ ] Add 5 real whale wallets to track
- [ ] Get feedback from 10 active users
- [ ] Build simple landing page

### Month 2: Monetize
- [ ] Add Stripe for Premium subscriptions
- [ ] Gate advanced features behind paywall
- [ ] Target: 10 paying users ($290/mo)

### Month 3-6: Scale
- [ ] Upgrade to Helius Developer tier
- [ ] Add more data sources
- [ ] Build referral program
- [ ] Target: 100 paying users ($2,900/mo)

---

## 🔌 API Endpoints Reference

### Tokens
- `GET /api/tokens/trending?limit=20` — Trending tokens
- `GET /api/tokens/search?q=BONK` — Search by name/symbol
- `GET /api/tokens/:mintAddress` — Token details

### Wallets
- `GET /api/wallet/:address/assets` — All tokens/NFTs (10 credits)
- `GET /api/wallet/:address/balance` — SOL balance (1 credit)
- `GET /api/wallet/:address/history?limit=20` — TX history (100 credits)

### Whale Tracking
- `GET /api/whales/activity?limit=20` — Recent whale moves
- `POST /api/whales/track` — Add wallet to track
- `POST /api/webhooks/helius` — Webhook receiver (set this as callback URL)

### Paper Trading
- `GET /api/paper/:userId/portfolio` — Portfolio with P&L
- `POST /api/paper/:userId/buy` — Buy tokens (paper)
- `POST /api/paper/:userId/sell` — Sell tokens (paper)
- `GET /api/paper/:userId/trades?limit=50` — Trade history
- `POST /api/paper/:userId/reset` — Reset portfolio
- `GET /api/paper/leaderboard` — Top paper traders

### System
- `GET /api/health` — API health + credit status
- `GET /api/stats` — Usage statistics
- `GET /api/fees/estimate` — Current priority fee estimate
