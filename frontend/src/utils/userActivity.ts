import { api } from '../api/client';

export function createActivityReporter(send: () => Promise<unknown>, now = Date.now) {
  let lastSent = -Infinity;
  return async () => {
    const current = now();
    if (current - lastSent < 60_000) return;
    lastSent = current;
    try { await send(); } catch { /* Activity must not interrupt the user's work. */ }
  };
}

export function trackUserActivity() {
  const report = createActivityReporter(() => api.post('/activity'));
  const active = () => {
    if (document.visibilityState === 'visible') void report();
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'visibilitychange'] as const;
  events.forEach(event => document.addEventListener(event, active, { passive: true }));
  active();
  return () => events.forEach(event => document.removeEventListener(event, active));
}

export function formatLastActivity(value: string | null | undefined): string {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}
