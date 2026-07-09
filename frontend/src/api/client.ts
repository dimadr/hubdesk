import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isAuthRequest = requestUrl.endsWith('/login') || requestUrl.endsWith('/signup');

    if (error.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('currentUserId');
      delete api.defaults.headers.common.Authorization;
      window.location.reload();
    }
    return Promise.reject(error);
  },
);

export interface TicketResponse {
  id: number; number: number; subject: string; body: string;
  status: string; priority: string; type: string | null; is_internal: boolean;
  customer_id: number; customer_name?: string | null; location_id: number;
  location_name?: string | null; location_address?: string | null;
  equipment_id: number | null; assignee_id: number | null; group_id: number | null;
  site_contact_name: string | null; site_contact_phone: string | null;
  scheduled_start: string | null; scheduled_end: string | null;
  source_description: string | null;
  created_at: string; accepted_at: string | null; completed_at: string | null;
  response_deadline: string | null; resolution_deadline: string | null;
  response_overdue: boolean; resolution_overdue: boolean;
  is_archived: boolean;
}

export interface SavedViewResponse {
  id: number; name: string; view_type: string;
  filters: Record<string, any>; columns: string[];
  sort_by: string | null; sort_dir: string | null;
}
