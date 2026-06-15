// ═══════════════════════════════════════════════════════════
// HollaEx WebSocket Service — Real-time data
// Routes through Vite proxy (/stream) to bypass CORS.
// ═══════════════════════════════════════════════════════════

// Listeners receive the full HollaEx envelope: { topic, action, symbol, data, time }.
export interface WsMessage {
  topic: string;
  action?: 'partial' | 'insert' | 'update' | string;
  symbol?: string;
  data?: unknown;
  time?: number;
}
type Listener = (msg: WsMessage) => void;

export class HollaExWS {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private subscriptions = new Set<string>();
  private authParams: string | null = null;

  constructor(baseUrl?: string) {
    // In dev, use ws(s)://<host>/stream which the Vite proxy forwards to the API.
    // For a static production deploy, set VITE_WS_URL to the full stream URL,
    // e.g. wss://api.hollaex.com/stream
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const envUrl = (import.meta as any).env?.VITE_WS_URL as string | undefined;
    this.baseUrl = baseUrl || envUrl || `${protocol}//${window.location.host}/stream`;
  }

  setAuth(apiKey: string, apiSignature: string, apiExpires: number) {
    this.authParams = `api-key=${apiKey}&api-signature=${apiSignature}&api-expires=${apiExpires}`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = this.authParams ? `${this.baseUrl}?${this.authParams}` : this.baseUrl;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Re-subscribe to all channels
      this.subscriptions.forEach((channel) => this.sendSubscribe(channel));
      // Keep alive ping every 30s
      this.pingTimer = setInterval(() => {
        this.ws?.send(JSON.stringify({ op: 'ping' }));
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        if (msg.topic) {
          // HollaEx sends topic ("orderbook") + symbol ("btc-usdt") separately,
          // but channels are subscribed as "orderbook:btc-usdt". Route to both.
          const keys = msg.symbol ? [`${msg.topic}:${msg.symbol}`, msg.topic] : [msg.topic];
          for (const key of keys) {
            this.listeners.get(key)?.forEach((cb) => cb(msg));
          }
        }
        // Also emit to wildcard listeners
        this.listeners.get('*')?.forEach((cb) => cb(msg));
      } catch {
        // ignore non-JSON messages (pong, etc.)
      }
    };

    this.ws.onclose = () => {
      this.cleanup();
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private sendSubscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'subscribe', args: [channel] }));
    }
  }

  private sendUnsubscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'unsubscribe', args: [channel] }));
    }
  }

  subscribe(channel: string, callback: Listener): () => void {
    this.subscriptions.add(channel);
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);
    this.sendSubscribe(channel);

    // Return unsubscribe function
    return () => {
      const set = this.listeners.get(channel);
      set?.delete(callback);
      if (set?.size === 0) {
        this.listeners.delete(channel);
        this.subscriptions.delete(channel);
        this.sendUnsubscribe(channel);
      }
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.ws?.close();
    this.ws = null;
    this.subscriptions.clear();
    this.listeners.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const ws = new HollaExWS();
