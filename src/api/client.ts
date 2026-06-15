// ═══════════════════════════════════════════════════════════
// HollaEx API Client — HMAC-SHA256 / bearer authenticated
// Routes through Vite proxy (/api → /v2) to bypass CORS in dev.
// ═══════════════════════════════════════════════════════════

// In dev, requests go to /api/* which the Vite proxy forwards to <host>/v2/*.
// For a static production deploy (no Vite proxy), set VITE_API_URL to either a
// same-origin proxy path or the full HollaEx base, e.g. https://api.hollaex.com/v2
const DEFAULT_BASE_URL = (import.meta as any).env?.VITE_API_URL || '/api';

let baseUrl = DEFAULT_BASE_URL;
let bearerToken: string | null = null;
let apiKey: string | null = null;
let apiSecret: string | null = null;

// Timeouts (ms). Writes get a longer budget; both are bounded so a stalled
// socket never leaves an order/withdrawal hanging forever.
const GET_TIMEOUT = 15_000;
const WRITE_TIMEOUT = 25_000;

// Global unauthorized hook — lets AuthContext clear a dead session on any 401.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export function configureApi(opts: { baseUrl?: string; token?: string; apiKey?: string; apiSecret?: string }) {
  if (opts.baseUrl) baseUrl = opts.baseUrl;
  if (opts.token !== undefined) bearerToken = opts.token;
  if (opts.apiKey !== undefined) apiKey = opts.apiKey;
  if (opts.apiSecret !== undefined) apiSecret = opts.apiSecret;
}

export function getToken(): string | null {
  return bearerToken;
}

export function clearAuth() {
  bearerToken = null;
  apiKey = null;
  apiSecret = null;
}

// ── HMAC-SHA256 Signature (only used when api-key auth is configured) ──
async function generateSignature(method: string, path: string, expires: number, body?: string): Promise<string> {
  if (!apiSecret) throw new Error('API secret not configured');
  const message = `${method}${path}${expires}${body || ''}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Build a query string, skipping undefined/null. Shared by the fetch URL AND
// the HMAC-signed path so the signature always matches the real request.
function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  });
  return sp.toString();
}

// ── Request helper ──
async function request<T>(
  method: string,
  path: string,
  options?: { body?: unknown; params?: Record<string, string | number | boolean | undefined>; auth?: boolean }
): Promise<T> {
  const { body, params, auth = false } = options || {};

  const qs = buildQuery(params);
  const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Auth: prefer bearer token, fall back to HMAC (api-key/secret).
  if (auth) {
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    } else if (apiKey && apiSecret) {
      const expires = Math.floor(Date.now() / 1000) + 60;
      const urlPath = `/v2${path}${qs ? `?${qs}` : ''}`;
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const signature = await generateSignature(method, urlPath, expires, bodyStr);
      headers['api-key'] = apiKey;
      headers['api-signature'] = signature;
      headers['api-expires'] = String(expires);
    }
  }

  const isWrite = method !== 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isWrite ? WRITE_TIMEOUT : GET_TIMEOUT);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out — do not resubmit; check history first.', { timeout: true });
    }
    throw new ApiError(0, err?.message || 'Network error', { network: true });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: res.statusText }));
    // Global unauthorized reaction — drop a dead/expired session (skip auth routes).
    if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/signup') && onUnauthorized) {
      try { onUnauthorized(); } catch { /* noop */ }
    }
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after')) || undefined;
      throw new ApiError(res.status, errorData.message || 'Rate limited — slow down.', { ...errorData, rateLimited: true, retryAfter });
    }
    throw new ApiError(res.status, errorData.message || res.statusText, errorData);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
  get isTimeout() { return (this.data as any)?.timeout === true; }
  get isRateLimited() { return (this.data as any)?.rateLimited === true; }
}

// ── Public methods ──
export function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>('GET', path, { params });
}

export function post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>('POST', path, { body, params });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, { body });
}

export function del<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>('DELETE', path, { params });
}

// ── Authenticated methods ──
export function authGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>('GET', path, { params, auth: true });
}

export function authPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, { body, auth: true });
}

export function authPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, { body, auth: true });
}

export function authDel<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  return request<T>('DELETE', path, { params, auth: true });
}
