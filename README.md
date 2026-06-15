# Black Chart

A minimalist, monospace **terminal-style crypto exchange** front-end for the
[HollaEx](https://apidocs.hollaex.com/) API. Markets, an ASCII candlestick chart
engine (with drag-to-zoom, pan, and volume), live order books and trades over
WebSocket, real order placement, wallet deposits/withdrawals, and full account
management — all rendered in a single font on a black canvas.

Built with React 19 + TypeScript + Vite.

## Data & API

Everything is powered by HollaEx (`/v2` REST + `/stream` WebSocket):

| Surface            | Source |
|--------------------|--------|
| Markets / prices   | `GET /tickers`, `GET /constants` |
| Chart candles      | `GET /chart` (OHLCV, resolutions `1/5/15/60/240/1D/1W`) |
| Order book / trades| `GET /orderbook`, `GET /trades` + `wss://…/stream` (`orderbook:`, `trade:`) |
| Auth               | `POST /login`, `/signup`, `/verify`, `/reset-password` |
| Trading            | `POST /order`, `GET /orders`, `DELETE /order` |
| Wallet             | `/user/create-address`, `/user/request-withdrawal`, `/user/deposits`, `/user/withdrawals` |
| Account            | `/user`, `/user/stats`, `/user/tokens` |

Auth uses the bearer token from email/password login. The client also supports
HMAC-SHA256 (api-key/secret) signing as a fallback.

## Develop

```bash
npm install
npm run dev      # http://localhost:5182
```

The dev server proxies `/api → https://<host>/v2` and `/stream → wss://<host>/stream`,
which also sidesteps CORS.

### Environment

By default the dev proxy targets **production** (`api.hollaex.com`). Point it at the
sandbox for safe testing (test funds, test accounts):

```bash
# .env.local
VITE_HOLLAEX_ENV=sandbox
```

## Production build & deploy

```bash
npm run build    # -> dist/
```

A static `dist/` has **no Vite proxy**, so configure where the API lives via env
(baked in at build time). Two options:

1. **Reverse proxy (recommended):** serve `dist/` and have your web server forward
   `/api/* → https://api.hollaex.com/v2/*` and `/stream → wss://api.hollaex.com/stream`.
   No env needed — the defaults (`/api`, `/stream`) just work.

2. **Direct (no proxy):** point the app straight at HollaEx (relies on HollaEx CORS):

   ```bash
   # .env.production
   VITE_API_URL=https://api.hollaex.com/v2
   VITE_WS_URL=wss://api.hollaex.com/stream
   ```

## Notes

- This is a front-end only; no secrets are stored in the repo.
- The login token is kept in `localStorage`. For a hardened deployment, prefer an
  http-only cookie/session at your proxy layer.
- Withdrawals require selecting the correct network for multi-chain assets
  (e.g. USDT on eth/trx/bnb/matic) — the wallet enforces this.
