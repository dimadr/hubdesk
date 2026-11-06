export function createActivityReporter(send: () => Promise<unknown>, now = Date.now) {
  let lastSent = -Infinity;
  return async () => {
    const current = now();
    if (current - lastSent < 60_000) return;
    lastSent = current;
    try { await send(); } catch { /* Activity must not interrupt the user's work. */ }
  };
}
