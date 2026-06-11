export interface TicketResponse {
  id: number; number: number; subject: string; body: string;
  status: string; priority: string; type: string | null; is_internal: boolean;
  customer_id: number; location_id: number | null;
  equipment_id: number | null; assignee_id: number | null;
  site_contact_name: string | null; site_contact_phone: string | null;
  scheduled_end: string | null;
  source_description: string | null;
  created_at: string; resolution_deadline: string | null;
  response_overdue: boolean; resolution_overdue: boolean;
  is_archived: boolean;
}

export interface UserInfo {
  id: number; email: string; name: string; phone?: string; role: string;
}

export const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', ON_THE_WAY: 'В пути',
  ARRIVED: 'На месте', IN_PROGRESS: 'В работе', REVIEW: 'Проверка', COMPLETED: 'Завершена',
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
};

export const TYPE_LABELS: Record<string, string> = {
  repair: 'Ремонт', installation: 'Монтаж', maintenance: 'ТО', inspection: 'Инспекция', emergency: 'Авария',
};

export const NEXT_STATUS: Record<string, string> = {
  ASSIGNED: 'ACCEPTED', ACCEPTED: 'ON_THE_WAY', ON_THE_WAY: 'ARRIVED',
  ARRIVED: 'IN_PROGRESS', IN_PROGRESS: 'REVIEW', REVIEW: 'COMPLETED',
};

export const BTN_LABELS: Record<string, string> = {
  ACCEPTED: 'Еду', ON_THE_WAY: 'На месте', ARRIVED: 'Работаю',
  IN_PROGRESS: 'Готово', REVIEW: 'Завершить',
};

export const FILTER_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'ASSIGNED', label: 'Назначены' },
  { key: 'IN_PROGRESS', label: 'В работе' },
  { key: 'overdue', label: 'Просрочены' },
  { key: 'archive', label: 'Архив' },
];
