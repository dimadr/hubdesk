import { create } from 'zustand';
import { api, TicketResponse } from '../api/client';

interface TicketStore {
  tickets: TicketResponse[];
  activeTab: string;
  viewType: 'table' | 'card' | 'tree';
  loading: boolean;
  counters: Record<string, number>;

  setActiveTab: (tab: string) => void;
  setViewType: (vt: 'table' | 'card' | 'tree') => void;
  fetchTickets: (filters: Record<string, any>) => Promise<void>;
  updateCounter: (event: string, count: number) => void;
}

export const useTicketStore = create<TicketStore>((set) => ({
  tickets: [],
  activeTab: 'all',
  viewType: 'table',
  loading: false,
  counters: {},

  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewType: (vt) => set({ viewType: vt }),

  fetchTickets: async (filters) => {
    set({ loading: true });
    const { data } = await api.get('/tickets', { params: filters });
    set({ tickets: data, loading: false });
  },

  updateCounter: (event, count) => {
    set((s) => ({ counters: { ...s.counters, [event]: count } }));
  },
}));
