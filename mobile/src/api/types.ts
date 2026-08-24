export type TicketStatus = 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TicketResponse {
  id: number;
  number: number;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: string | null;
  is_internal: boolean;
  customer_id: number | null;
  customer_name: string | null;
  location_id: number | null;
  location_name: string | null;
  location_address: string | null;
  equipment_id: number | null;
  assignee_id: number | null;
  assignee_name: string | null;
  group_id: number | null;
  site_contact_name: string | null;
  site_contact_phone: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  source_description: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  response_deadline: string | null;
  resolution_deadline: string | null;
  response_overdue: boolean;
  resolution_overdue: boolean;
  is_archived: boolean;
}

export interface UserInfo {
  user_id: number;
  email: string;
  name: string;
  role: string;
  status: string;
}

export interface UserListItem {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  patronymic: string | null;
  position: string | null;
  role: string;
  status: string;
  customer_id: number | null;
}

export interface LocationContact {
  id?: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  is_primary: boolean;
}

export interface AuthResponse extends UserInfo {
  token: string;
  refresh_token: string | null;
  session_id: number | null;
  access_token_expires_in: number | null;
}

export interface DeviceSessionResponse {
  id: number;
  device_name: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

export type PersonalTaskColumn = 'project' | 'todo' | 'in_progress' | 'done';

export interface PersonalTaskResponse {
  id: number;
  title: string;
  description: string;
  column: PersonalTaskColumn;
  position: number;
  ticket_id: number | null;
  ticket_subject: string | null;
  ticket_status: string | null;
  created_at: string;
}

export interface WarehouseResponse {
  id: number;
  name: string;
  type: 'physical' | 'personal';
}

export interface NomenclatureResponse {
  id: number;
  name: string;
  type: string;
  unit: string;
}

export interface WarehouseDocumentLine {
  id: number;
  nomenclature_id: number;
  quantity: number;
}

export interface WarehouseDocumentResponse {
  id: number;
  doc_type: 'INFLOW' | 'TRANSFER' | 'WRITE_OFF';
  status: 'DRAFT' | 'APPROVAL' | 'DELIVERY' | 'ACCOUNTED';
  source_warehouse_id: number | null;
  target_warehouse_id: number | null;
  created_at: string;
  lines: WarehouseDocumentLine[];
}

export interface WarehouseBalanceResponse {
  warehouse_id: number;
  nomenclature_id: number;
  quantity: number;
}

export interface ReplacementDeviceResponse {
  id: number;
  name: string;
  serial_number: string;
  verification_expiry: string | null;
  balance: number;
}

export interface InsertProductResponse {
  id: number;
  name: string;
  diameter_inner: string | null;
  diameter_outer: string | null;
  length: string | null;
  flange_type: string | null;
  notes: string | null;
  cell?: string | null;
  balance: number;
}

export interface LocationResponse {
  id: number;
  name: string;
  address: string;
  customer_id: number;
  customer_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contacts: string | null;
  contacts_list: LocationContact[];
  assigned_engineer_id: number | null;
  assigned_engineer_name: string | null;
  contract_number: string | null;
  contract_valid_from: string | null;
  contract_valid_to: string | null;
  inn: string | null;
}

export interface CommentResponse {
  id: number;
  ticket_id: number;
  user_id: number;
  user_name: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface AttachmentResponse {
  id: number;
  ticket_id: number | null;
  comment_id: number | null;
  filename: string;
  download_url: string | null;
  content_type: string;
  size: number;
  is_internal: boolean;
  created_at: string;
}

export interface ChecklistField {
  id: number;
  label: string;
  field_type: 'checkbox' | 'text' | 'number' | 'photo' | 'signature';
  is_mandatory: boolean;
  value: string | null;
}

export interface ChecklistResponse {
  id: number;
  name: string;
  fields: ChecklistField[];
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  ASSIGNED: 'Назначена',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
};

export const TYPE_LABELS: Record<string, string> = {
  repair: 'Ремонт', installation: 'Монтаж', maintenance: 'ТО', inspection: 'Инспекция',
  verification: 'Поверка', emergency: 'Авария',
};

export const NEXT_STATUS: Partial<Record<TicketStatus, TicketStatus>> = {
  ASSIGNED: 'ACCEPTED',
  ACCEPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
};

export const BTN_LABELS: Partial<Record<TicketStatus, string>> = {
  ACCEPTED: 'Принять',
  IN_PROGRESS: 'Начать работу',
  COMPLETED: 'Завершить',
};

export const FILTER_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'ASSIGNED', label: 'Назначены' },
  { key: 'IN_PROGRESS', label: 'В работе' },
  { key: 'overdue', label: 'Просрочены' },
  { key: 'archive', label: 'Архив' },
];
