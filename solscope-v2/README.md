# SolScope v2 — Smart Money Intelligence Feed

**See Solana Clearly.**

SolScope shows when smart money changes conviction on Solana tokens. Not a dashboard. Not a terminal. An intelligence feed.

## Architecture

```
Helius (detects) → Jupiter (contextualizes) → Nansen (enriches)
                          ↓
                   Signal Engine (scores)
                          ↓
              Feed / Token Pages / Alerts
                          ↓
              Web App / Telegram / Seeker
```

## 5 Signal Types

1. **Conviction Increase** — Smart money accumulating
2. **Conviction Decrease** — Smart money reducing exposure
3. **Smart Money Entry** — New fund/whale positions detected
4. **Smart Money Exit** — Funds closing positions
5. **Sentiment Spike** — Sudden sentiment score change

## Setup

```bash
npm install
cp .env.example .env
# Fill in your API keys
npm start
```

## API

| Endpoint | Description |
|----------|-------------|
| GET /api/feed | Intelligence signal feed |
| GET /api/token/:symbol | Token intelligence page |
| GET /api/tokens | All token snapshots |
| GET /api/brief | Daily intelligence brief |
| GET /api/alerts/:userId | User's custom alert rules |
| POST /api/alerts/:userId | Create custom alert rule |
| GET /api/health | System status |

## Cost

| Service | Cost | Purpose |
|---------|------|---------|
| Helius | Free tier | Blockchain events |
| Jupiter | Free | Market data |
| Nansen | 10M credits (existing) | Smart money intelligence |
| Railway | Free/$5 | Hosting |

Data sources: Nansen · Helius · Jupiter
