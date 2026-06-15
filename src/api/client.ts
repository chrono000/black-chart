// ═══════════════════════════════════════════════════════════
// HollaEx API Client — HMAC-SHA256 authenticated
// Routes through Vite proxy (/api → /v2) to bypass CORS.
// ═══════════════════════════════════════════════════════════

// In dev, requests go to /api/* which the Vite proxy forwards to <host>/v2/*.
// For a static production deploy (no Vite proxy), set VITE_API_URL to either a
// same-origin proxy path or the full HollaEx base, e.g. https://api.hollaex.com/v2
const DEFAULT_BASE_URL = (import.meta as any).env?.VITE_API_URL || '/api';

let baseUrl = DEFAULT_BASE_URL;
let bearerToken: string | null = null;
let apiKey: string | null = null;
let apiSecret: string | null = null;

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

// ── HMAC-SHA256 Signature ──
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

// ── Request helper ──
async function request<T>(
  method: string,
  path: string,
  options?: { body?: unknown; params?: Record<string, string | number | boolean | undefined>; auth?: boolean }
): Promise<T> {
  const { body, params, auth = false } = options || {};

  // Build URL with query params
  let url = `${baseUrl}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) searchParams.set(k, String(v));
    });
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Auth: prefer bearer token, fall back to HMAC
  if (auth) {
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    } else if (apiKey && apiSecret) {
      const expires = Math.floor(Date.now() / 1000) + 60;
      const urlPath = `/v2${path}${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`;
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const signature = await generateSignature(method, urlPath, expires, bodyStr);
      headers['api-key'] = apiKey;
      headers['api-signature'] = signature;
      headers['api-expires'] = String(expires);
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, errorData.message || res.statusText, errorData);
  }

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
