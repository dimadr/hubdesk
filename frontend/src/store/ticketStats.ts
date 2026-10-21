import { create } from 'zustand';
import { api } from '../api/client';

export const canViewTicketReports = (role: string): boolean => (
  ['admin', 'director', 'dispatcher', 'accountant', 'chief_accountant'].includes(role)
);

interface Stats {
  total: number;
  open: number;
  urgent: number;
}

interface StatsAuth {
  token: string;
  user: { role: string };
}

interface TicketStatsState {
  stats: Stats | null;
  scope: string | null;
  loading: boolean;
  load: (auth: StatsAuth | null) => Promise<void>;
  reset: () => void;
}

let generation = 0;

export const useTicketStatsStore = create<TicketStatsState>((set) => ({
  stats: null,
  scope: null,
  loading: false,
  reset: () => {
    generation += 1;
    set({ stats: null, scope: null, loading: false });
  },
  load: async (auth) => {
    const request = ++generation;
    set({ stats: null, scope: null, loading: false });
    if (!auth || !canViewTicketReports(auth.user.role)) return;
    set({ scope: auth.token, loading: true });
    try {
      const { data } = await api.get('/reports/tickets');
      if (request !== generation) return;
      set({
        stats: {
          total: data.total || 0,
          open: (data.by_status || []).reduce((sum: number, item: { label: string; count: number }) => (
            item.label !== 'COMPLETED' ? sum + item.count : sum
          ), 0),
          urgent: (data.by_priority || []).reduce((sum: number, item: { label: string; count: number }) => (
            ['critical', 'high'].includes(item.label) ? sum + item.count : sum
          ), 0),
        },
        loading: false,
      });
    } catch {
      if (request === generation) set({ stats: null, loading: false });
    }
  },
}));
