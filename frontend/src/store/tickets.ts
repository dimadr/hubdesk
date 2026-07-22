import { create } from 'zustand';
import { api, TicketResponse } from '../api/client';

interface TicketStore {
  tickets: TicketResponse[];
  activeTab: string;
  viewType: 'table' | 'card';
  loading: boolean;
  error: string;
  total: number;
  hasMore: boolean;
  lastFilters: Record<string, any>;
  search: string;
  colFilter: Record<string, string | undefined>;

  setActiveTab: (tab: string) => void;
  setViewType: (vt: 'table' | 'card') => void;
  setSearch: (q: string) => void;
  setColFilter: (f: Record<string, string | undefined> | ((prev: Record<string, string | undefined>) => Record<string, string | undefined>)) => void;
  fetchTickets: (filters: Record<string, any>, signal?: AbortSignal) => Promise<void>;
  appendTickets: (filters: Record<string, any>, signal?: AbortSignal) => Promise<void>;
  updateTicket: (id: number, patch: Partial<TicketResponse>) => void;
  setLastFilters: (filters: Record<string, any>) => void;
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: [],
  activeTab: 'all',
  viewType: 'table',
  loading: false,
  error: '',
  total: 0,
  hasMore: false,
  lastFilters: {},
  search: '',
  colFilter: {},

  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewType: (vt) => set({ viewType: vt }),
  setSearch: (q) => set({ search: q }),
  setColFilter: (f) => set((s) => ({ colFilter: typeof f === 'function' ? f(s.colFilter) : f })),
  setLastFilters: (filters) => set({ lastFilters: filters }),

  fetchTickets: async (filters, signal?: AbortSignal) => {
    set({ loading: true, error: '' });
    try {
      const params = { limit: 200, offset: 0, ...filters };
      const { data } = await api.get('/tickets', { params, signal });
      if (!signal?.aborted) {
        set({ tickets: data, loading: false, total: data.length, hasMore: data.length === 200, lastFilters: filters });
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        set({ loading: false, error: err.response?.data?.detail || 'Ошибка загрузки заявок' });
      }
    }
  },

  appendTickets: async (filters, signal?: AbortSignal) => {
    const { tickets } = get();
    const LIMIT = 200;
    try {
      const params = { limit: LIMIT, offset: tickets.length, ...filters };
      const { data } = await api.get('/tickets', { params, signal });
      if (!signal?.aborted) {
        set({
          tickets: [...tickets, ...data],
          total: tickets.length + data.length,
          hasMore: data.length === LIMIT,
        });
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        set({ loading: false, error: err.response?.data?.detail || 'Ошибка загрузки заявок' });
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
