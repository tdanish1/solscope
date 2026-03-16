import { Router } from "express";

// CoinGecko + DexScreener cache (shared across all users)
const marketCache = new Map();
const MARKET_CACHE_TTL = 60_000; // 60s

function getCached(key) {
  const e = marketCache.get(key);
  if (e && Date.now() - e.t < MARKET_CACHE_TTL) return e.d;
  return null;
}
function setCache(key, data) {
  marketCache.set(key, { d: data, t: Date.now() });
  if (marketCache.size > 500) marketCache.delete(marketCache.keys().next().value);
}

async function fetchTokenMarketData(mint) {
  const cached = getCached(`market:${mint}`);
  if (cached) return cached;

  const isSol = mint === 'So11111111111111111111111111111111111111112';

  const [cgData, dexData] = await Promise.all([
    (async () => {
      try {
        const url = isSol
          ? 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&community_data=false&developer_data=false'
          : `https://api.coingecko.com/api/v3/coins/solana/contract/${mint}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const cg = await res.json();
        return {
          price: cg.market_data?.current_price?.usd || 0,
          priceChange24h: cg.market_data?.price_change_percentage_24h || 0,
          volume24h: cg.market_data?.total_volume?.usd || 0,
          marketCap: cg.market_data?.market_cap?.usd || 0,
        };
      } catch { return null; }
    })(),
    (async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (!res.ok) return null;
        const d = await res.json();
        const pair = (d.pairs || []).find(p => p.chainId === 'solana' && p.baseToken?.address === mint);
        if (!pair) return null;
        return {
          price: parseFloat(pair.priceUsd) || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume24h: pair.volume?.h24 || 0,
          liquidity: pair.liquidity?.usd || 0,
          marketCap: pair.marketCap || pair.fdv || 0,
          imageUrl: pair.info?.imageUrl || null,
        };
      } catch { return null; }
    })(),
  ]);

  const result = {
    mint,
    price: cgData?.price || dexData?.price || 0,
    priceChange24h: cgData?.priceChange24h ?? dexData?.priceChange24h ?? 0,
    volume24h: cgData?.volume24h || dexData?.volume24h || 0,
    liquidity: dexData?.liquidity || 0,
    marketCap: cgData?.marketCap || dexData?.marketCap || 0,
    imageUrl: dexData?.imageUrl || null,
  };

  setCache(`market:${mint}`, result);
  return result;
}

async function fetchBatchPrices(mints) {
  const cacheKey = `batch:${mints.sort().join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const results = {};

  // DexScreener batch (handles most tokens)
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
    if (res.ok) {
      const data = await res.json();
      for (const mint of mints) {
        const pair = (data.pairs || []).find(p =>
          p.chainId === 'solana' && p.baseToken?.address === mint
        );
        if (pair) {
          results[mint] = {
            price: parseFloat(pair.priceUsd) || 0,
            change24h: pair.priceChange?.h24 || 0,
            imageUrl: pair.info?.imageUrl || null,
          };
        }
      }
    }
  } catch {}

  // CoinGecko fallback for missing (e.g. SOL)
  const missing = mints.filter(m => !results[m]);
  if (missing.length > 0) {
    try {
      const cgIds = missing.map(m =>
        m === 'So11111111111111111111111111111111111111112' ? 'solana' : null
      ).filter(Boolean);
      if (cgIds.length > 0) {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`);
        if (res.ok) {
          const data = await res.json();
          for (const mint of missing) {
            const cgKey = mint === 'So11111111111111111111111111111111111111112' ? 'solana' : null;
            if (cgKey && data[cgKey]) {
              results[mint] = {
                price: data[cgKey].usd || 0,
                change24h: data[cgKey].usd_24h_change || 0,
                imageUrl: null,
              };
            }
          }
        }
      }
    } catch {}
  }

  setCache(cacheKey, results);
  return results;
}

export default function createRoutes(services) {
  const router = Router();
  const { signalEngine, alertMatcher, helius, jupiter, nansen } = services;

  router.get("/feed", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const feed = signalEngine.getFeed(limit);
    res.json({ signals: feed, count: feed.length });
  });

  router.get("/token/:id", async (req, res) => {
    const page = await signalEngine.getTokenPage(req.params.id);
    if (!page) return res.status(404).json({ error: "Token not found or not yet scanned" });
    res.json(page);
  });

  router.get("/tokens", (req, res) => {
    const snapshots = signalEngine.getAllSnapshots();
    res.json({ tokens: snapshots, count: snapshots.length });
  });

  router.get("/brief", (req, res) => {
    const brief = signalEngine.getDailyBrief();
    res.json(brief);
  });

  // Market data proxy (CoinGecko + DexScreener, cached 60s)
  router.get("/market/batch", async (req, res) => {
    const mints = (req.query.mints || '').split(',').filter(Boolean);
    if (!mints.length) return res.json({});
    const data = await fetchBatchPrices(mints);
    res.json(data);
  });

  router.get("/market/:mint", async (req, res) => {
    const data = await fetchTokenMarketData(req.params.mint);
    res.json(data);
  });

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

  router.get("/debug/nansen", async (req, res) => {
    nansen.cache.delete("bulk_netflow_solana");
    const raw = await nansen.getAllSolanaNetflow(20);
    const trackedMints = [...signalEngine.trackedTokens.keys()];
    const matches = raw?.data
      ? trackedMints.filter(m => raw.data.some(e => e.token_address === m))
      : [];
    res.json({
      nansenEnabled: nansen.enabled,
      rawResponse: raw,
      trackedMints,
      matchCount: matches.length,
      matchedMints: matches,
    });
  });

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

  router.post("/webhooks/helius", async (req, res) => {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
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
