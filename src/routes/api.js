import { Router } from "express";

const MARKET_CACHE_TTL = 60_000;
const FETCH_TIMEOUT = 10_000;
const marketCache = new Map();  // key → { d: data, t: timestamp }
const inflight = new Map();     // key → Promise (thundering herd dedup)

function getCached(key) {
  const e = marketCache.get(key);
  if (e && Date.now() - e.t < MARKET_CACHE_TTL) return e.d;
  return null;
}
function getStale(key) {
  return marketCache.get(key)?.d || null;
}
function setCache(key, data) {
  marketCache.set(key, { d: data, t: Date.now() });
  if (marketCache.size > 500) marketCache.delete(marketCache.keys().next().value);
}

function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Dedup: if a fetch for this key is already in-flight, reuse it
function dedup(key, fn) {
  const cached = getCached(key);
  if (cached) return Promise.resolve(cached);

  if (inflight.has(key)) return inflight.get(key);

  const promise = fn()
    .then(result => { setCache(key, result); return result; })
    .catch(() => getStale(key))  // serve stale data on failure
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

function fetchTokenMarketData(mint) {
  return dedup(`market:${mint}`, async () => {
    const isSol = mint === 'So11111111111111111111111111111111111111112';

    const [cgData, dexData] = await Promise.all([
      (async () => {
        try {
          const url = isSol
            ? 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&community_data=false&developer_data=false'
            : `https://api.coingecko.com/api/v3/coins/solana/contract/${mint}`;
          const res = await fetchWithTimeout(url);
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
          const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
          if (!res.ok) return null;
          const d = await res.json();
          const solanaPairs = (d.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken?.address === mint);
          if (!solanaPairs.length) return null;
          // Pick highest-liquidity pair for price/mcap, sum liquidity + volume across all pairs
          solanaPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
          const best = solanaPairs[0];
          const totalLiquidity = solanaPairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);
          const totalVolume = solanaPairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0);
          return {
            price: parseFloat(best.priceUsd) || 0,
            priceChange24h: best.priceChange?.h24 || 0,
            volume24h: totalVolume,
            liquidity: totalLiquidity,
            marketCap: best.marketCap || best.fdv || 0,
            imageUrl: best.info?.imageUrl || null,
          };
        } catch { return null; }
      })(),
    ]);

    return {
      mint,
      price: cgData?.price || dexData?.price || 0,
      priceChange24h: cgData?.priceChange24h ?? dexData?.priceChange24h ?? 0,
      volume24h: cgData?.volume24h || dexData?.volume24h || 0,
      liquidity: dexData?.liquidity || 0,
      marketCap: cgData?.marketCap || dexData?.marketCap || 0,
      imageUrl: dexData?.imageUrl || null,
    };
  });
}

function fetchBatchPrices(mints) {
  const sortedKey = `batch:${[...mints].sort().join(',')}`;
  return dedup(sortedKey, async () => {
    const results = {};

    try {
      const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
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

    const missing = mints.filter(m => !results[m]);
    if (missing.length > 0) {
      try {
        const cgIds = missing.map(m =>
          m === 'So11111111111111111111111111111111111111112' ? 'solana' : null
        ).filter(Boolean);
        if (cgIds.length > 0) {
          const res = await fetchWithTimeout(
            `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`
          );
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

    return results;
  });
}

export default function createRoutes(services) {
  const router = Router();
  const { signalEngine, alertMatcher, helius, jupiter, nansen, push } = services;

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

  router.post("/watchlist/sync", (req, res) => {
    const { pushToken, mints } = req.body;
    if (!pushToken || !Array.isArray(mints)) {
      return res.status(400).json({ error: "pushToken and mints[] required" });
    }
    const ok = push.syncWatchlist(pushToken, mints);
    if (!ok) return res.status(400).json({ error: "Invalid push token" });
    res.json({ synced: mints.length });
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
        push: push.getStats(),
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
