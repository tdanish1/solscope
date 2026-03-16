import { Expo } from 'expo-server-sdk';

const expo = new Expo();

class PushService {
  constructor() {
    // pushToken → { mints: Set, lastSync: timestamp }
    this.watchlists = new Map();
    this.pushesSent = 0;
    console.log("  ✓ Push notification service initialized");
  }

  syncWatchlist(pushToken, mints) {
    if (!Expo.isExpoPushToken(pushToken)) return false;
    this.watchlists.set(pushToken, {
      mints: new Set(mints),
      lastSync: Date.now(),
    });
    return true;
  }

  removeDevice(pushToken) {
    this.watchlists.delete(pushToken);
  }

  // Find all push tokens watching a given mint
  getTokensWatching(mint) {
    const tokens = [];
    for (const [pushToken, entry] of this.watchlists) {
      if (entry.mints.has(mint)) tokens.push(pushToken);
    }
    return tokens;
  }

  async notifySignal(signal) {
    const watchers = this.getTokensWatching(signal.mint);
    if (!watchers.length) return 0;

    const messages = watchers.map(token => ({
      to: token,
      sound: 'default',
      title: `${signal.emoji} ${signal.symbol} — ${signal.label}`,
      body: signal.headline,
      data: { mint: signal.mint, symbol: signal.symbol, type: signal.type },
    }));

    const chunks = expo.chunkPushNotifications(messages);
    let sent = 0;

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') sent++;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            // Clean up invalid tokens
            const idx = tickets.indexOf(ticket);
            if (idx >= 0 && idx < chunk.length) {
              this.watchlists.delete(chunk[idx].to);
            }
          }
        }
      } catch (e) {
        console.error('Push send failed:', e.message);
      }
    }

    this.pushesSent += sent;
    return sent;
  }

  getStats() {
    return {
      devices: this.watchlists.size,
      pushesSent: this.pushesSent,
    };
  }
}

export default PushService;
