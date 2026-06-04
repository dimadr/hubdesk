import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(error);
  },
);

export interface TicketResponse {
  id: number; number: number; subject: string; body: string;
  status: string; priority: string; is_internal: boolean;
  customer_id: number; location_id: number;
  equipment_id: number | null; assignee_id: number | null; group_id: number | null;
  created_at: string; accepted_at: string | null; completed_at: string | null;
  response_deadline: string | null; resolution_deadline: string | null;
  response_overdue: boolean; resolution_overdue: boolean;
}

export interface SavedViewResponse {
  id: number; name: string; view_type: string;
  filters: Record<string, any>; columns: string[];
  sort_by: string | null; sort_dir: string | null;
}
