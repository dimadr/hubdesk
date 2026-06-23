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
  fetchTickets: (filters: Record<string, any>, signal?: AbortSignal) => Promise<void>;
  updateTicket: (id: number, patch: Partial<TicketResponse>) => void;
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

  fetchTickets: async (filters, signal?: AbortSignal) => {
    set({ loading: true });
    try {
      const { data } = await api.get('/tickets', { params: filters, signal });
      if (!signal?.aborted) {
        set({ tickets: data, loading: false });
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        set({ loading: false });
      }
    }
  },

  updateTicket: (id, patch) => {
    set((s) => ({
      tickets: s.tickets.map((ticket) => (
        ticket.id === id ? { ...ticket, ...patch } : ticket
      )),
    }));
  },

  updateCounter: (event, count) => {
    set((s) => ({ counters: { ...s.counters, [event]: count } }));
  },
}));
