import { create } from 'zustand';
import { api, TicketResponse } from '../api/client';

interface TicketStore {
  tickets: TicketResponse[];
  activeTab: string;
  viewType: 'table' | 'card';
  loading: boolean;
  total: number;

  setActiveTab: (tab: string) => void;
  setViewType: (vt: 'table' | 'card') => void;
  fetchTickets: (filters: Record<string, any>, signal?: AbortSignal) => Promise<void>;
  appendTickets: (filters: Record<string, any>, signal?: AbortSignal) => Promise<void>;
  updateTicket: (id: number, patch: Partial<TicketResponse>) => void;
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: [],
  activeTab: 'all',
  viewType: 'table',
  loading: false,
  total: 0,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewType: (vt) => set({ viewType: vt }),

  fetchTickets: async (filters, signal?: AbortSignal) => {
    set({ loading: true });
    try {
      const params = { limit: 200, offset: 0, ...filters };
      const { data } = await api.get('/tickets', { params, signal });
      if (!signal?.aborted) {
        set({ tickets: data, loading: false, total: data.length });
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        set({ loading: false });
      }
    }
  },

  appendTickets: async (filters, signal?: AbortSignal) => {
    const { tickets } = get();
    try {
      const params = { limit: 200, offset: tickets.length, ...filters };
      const { data } = await api.get('/tickets', { params, signal });
      if (!signal?.aborted) {
        set({ tickets: [...tickets, ...data], total: tickets.length + data.length });
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
}));
