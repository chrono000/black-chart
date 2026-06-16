// localStorage that never throws. Cross-origin iframes and private/locked-down
// browser modes can make localStorage access throw (SecurityError) — which would
// otherwise white-screen the whole app at startup. Degrades to no-op / null.
export const safeStorage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
};
