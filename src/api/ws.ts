// ═══════════════════════════════════════════════════════════
// HollaEx WebSocket Service — Real-time data
// Routes through Vite proxy (/stream) to bypass CORS in dev.
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
  private subscriptions = new Set<string>();
  private authParams: string | null = null;
  private intentionalClose = false;
  private netListenersBound = false;

  constructor(baseUrl?: string) {
    // In dev, use ws(s)://<host>/stream which the Vite proxy forwards to the API.
    // For a static production deploy, set VITE_WS_URL to the full stream URL,
    // e.g. wss://api.hollaex.com/stream
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const envUrl = (import.meta as any).env?.VITE_WS_URL as string | undefined;
    this.baseUrl = baseUrl || envUrl || `${protocol}//${window.location.host}/stream`;
  }

  // For future private (order/wallet) channels — needs api-key HMAC, not the bearer.
  setAuth(apiKey: string, apiSignature: string, apiExpires: number) {
    this.authParams = `api-key=${apiKey}&api-signature=${apiSignature}&api-expires=${apiExpires}`;
  }

  private handleOnline = () => {
    this.reconnectAttempts = 0;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) this.connect();
  };
  private handleVisibility = () => {
    if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
      this.reconnectAttempts = 0;
      this.connect();
    }
  };
  private bindNetListeners() {
    if (this.netListenersBound) return;
    window.addEventListener('online', this.handleOnline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.netListenersBound = true;
  }
  private unbindNetListeners() {
    if (!this.netListenersBound) return;
    window.removeEventListener('online', this.handleOnline);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.netListenersBound = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.intentionalClose = false;
    this.bindNetListeners();

    const url = this.authParams ? `${this.baseUrl}?${this.authParams}` : this.baseUrl;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (socket !== this.ws) return; // stale socket from an overlapping connect()
      this.reconnectAttempts = 0;
      this.subscriptions.forEach((channel) => this.sendSubscribe(channel));
      // Idempotent: clear any prior ping before starting a fresh one.
      this.cleanup();
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'ping' }));
      }, 25000);
    };

    socket.onmessage = (event) => {
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
        this.listeners.get('*')?.forEach((cb) => cb(msg));
      } catch {
        // ignore non-JSON messages (pong, etc.)
      }
    };

    socket.onclose = () => {
      if (socket !== this.ws) return; // a superseded socket closing — ignore
      this.cleanup();
      if (this.intentionalClose) return;
      this.attemptReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private attemptReconnect() {
    // Capped exponential backoff, retried for the lifetime of the session
    // (online/visibility handlers also nudge recovery). No permanent give-up.
    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
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
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.subscriptions.clear();
    this.listeners.clear();
    this.reconnectAttempts = 0;
    this.unbindNetListeners();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const ws = new HollaExWS();
