import React, { useState, useEffect } from 'react';
import { api, TicketResponse } from './api/client';
import { TicketGrid } from './components/TicketGrid/TicketGrid';
import { WarehousePage } from './pages/WarehousePage';
import { LocationsPage } from './pages/LocationsPage';
import { AdminPage } from './pages/AdminPage';
import { CalendarPage } from './pages/CalendarPage';
import { ReportsPage } from './pages/ReportsPage';
import { KanbanPage } from './pages/KanbanPage';
import { AuditLogPage } from './pages/AuditLogPage';

async function downloadFile(url: string, filename: string) {
  const resp = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([resp.data]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
import { L } from './locale';

interface Location {
  id: number;
  name: string;
  address: string;
  customer_id: number;
  customer_name: string;
  contacts: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  assigned_engineer_id: number | null;
  assigned_engineer_name: string | null;
  contract_number: string | null;
  contract_valid_from: string | null;
  contract_valid_to: string | null;
}

interface UserInfo {
  id: number;
  email: string;
  name: string;
  phone?: string;
  patronymic?: string;
  role: string;
  status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  engineer: 'Инженер',
  dispatcher: 'Диспетчер',
  customer: 'Заказчик',
  storekeeper: 'Кладовщик',
  viewer: 'Наблюдатель',
  metrologist: 'Метролог',
  accountant: 'Бухгалтер',
  director: 'Директор',
};

const TICKET_TYPES: Record<string, string> = {
  repair: 'Ремонт',
  installation: 'Монтаж',
  maintenance: 'ТО',
  inspection: 'Инспекция',
  emergency: 'Авария',
  verification: 'Поверка',
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
};

const TICKET_PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

const NAV_ITEMS = [
  { key: 'tickets', label: 'Заявки', icon: '📋' },
  { key: 'locations', label: 'Объекты', icon: '🏢' },
  { key: 'employees', label: 'Сотрудники', icon: '👥' },
  { key: 'warehouse', label: 'Склад', icon: '📦' },
  { key: 'reports', label: 'Отчёты', icon: '📊' },
  { key: 'calendar', label: 'Календарь', icon: '📅' },
  { key: 'kanban', label: 'Моя доска', icon: '📌' },
  { key: 'audit', label: 'Журнал', icon: '📝' },
  { key: 'admin', label: 'Админка', icon: '⚙️', adminOnly: true },
] as const;

type Page = typeof NAV_ITEMS[number]['key'];

const AuthPage: React.FC<{ onLogin: (token: string, user: any) => void }> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [role, setRole] = useState('dispatcher');
  const [consent, setConsent] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const submit = async () => {
    setError('');
    setSuccessMsg('');
    try {
      const url = isLogin ? '/login' : '/signup';
      const body: any = isLogin
        ? { email, password, remember_me: rememberMe }
        : { email, password, name, patronymic, role, consent_given: consent };

      const { data } = await api.post(url, body);
      if (!isLogin && !data.token) {
        setSuccessMsg('Заявка отправлена администратору на утверждение. После подтверждения вы сможете войти.');
        setIsLogin(true);
        return;
      }
      localStorage.setItem('token', data.token);
      onLogin(data.token, data);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{isLogin ? L.login : L.signup}</h2>
        {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
        {successMsg && <p style={{ color: 'var(--success)', marginBottom: 12, fontSize: 13, background: 'var(--success-bg)', padding: '8px 12px', borderRadius: 6 }}>{successMsg}</p>}
        <input placeholder={L.email} value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder={L.password} type="password" value={password} onChange={e => setPassword(e.target.value)} />
        {isLogin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 12, marginTop: 4 }}>
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
            Запомнить меня
          </label>
        )}
        {!isLogin && (
          <>
            <input placeholder="ФИО" value={name} onChange={e => setName(e.target.value)} />
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="dispatcher">{L.dispatcher}</option>
              <option value="engineer">Инженер</option>
              <option value="storekeeper">Кладовщик</option>
              <option value="customer">Заказчик</option>
              <option value="viewer">Наблюдатель</option>
              <option value="metrologist">Метролог</option>
              <option value="accountant">Бухгалтер</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 12, marginTop: 4 }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
              Согласен на обработку персональных данных
            </label>
          </>
        )}
        <button onClick={submit}>{isLogin ? L.login : L.signup}</button>
        <div className="toggle" onClick={() => { setIsLogin(!isLogin); setError(''); setSuccessMsg(''); }}>
          {isLogin ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войдите'}
        </div>
      </div>
    </div>
  );
};

const CreateTicketModal: React.FC<{ onClose: () => void; onCreated: () => void; users: UserInfo[]; currentUser?: UserInfo }> = ({ onClose, onCreated, users, currentUser }) => {
  const [subject, setSubject] = useState('');
  const [ticketType, setTicketType] = useState('');
  const [sourceDesc, setSourceDesc] = useState('');
  const [body, setBody] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [priority, setPriority] = useState('medium');
  const [resolutionDeadline, setResolutionDeadline] = useState('');
  const [assigneeId, setAssigneeId] = useState<number | ''>(currentUser?.role === 'engineer' ? currentUser.id : '');
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locQuery, setLocQuery] = useState('');
  const [locOpen, setLocOpen] = useState(false);

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!locationId) return;
    const loc = locations.find(l => l.id === Number(locationId));
    if (loc) {
      setSiteContactName(loc.contact_name || loc.assigned_engineer_name || '');
      const phoneMatch = loc.contacts?.match(/\+7[\s()\d\-]+/);
      setSiteContactPhone(loc.contact_phone || (phoneMatch ? phoneMatch[0] : '') || '');
    }
  }, [locationId, locations]);

  const submit = async () => {
    if (!subject || !locationId) { setError('Заполните тему и выберите объект'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const selected = locations.find(l => l.id === Number(locationId));
      if (!selected) {
        setError('Выбранный объект не найден. Обновите список объектов.');
        setSaving(false);
        return;
      }
      await api.post('/tickets', {
        subject,
        body,
        type: ticketType || undefined,
        source_description: sourceDesc || undefined,
        customer_id: selected.customer_id,
        location_id: Number(locationId),
        priority,
        resolution_deadline: resolutionDeadline ? new Date(resolutionDeadline + 'T23:59:59').toISOString() : undefined,
        assignee_id: assigneeId ? Number(assigneeId) : undefined,
        site_contact_name: siteContactName || undefined,
        site_contact_phone: siteContactPhone || undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка создания');
    } finally { setSaving(false); }
  };

  const assignables = users.filter(u => u.role === 'engineer');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
        <h3>Создать заявку</h3>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-form-grid">
          <div>
            <label>Тема заявки <span className="required">*</span></label>
            <input placeholder="Введите тему" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <label>Тип заявки</label>
            <select value={ticketType} onChange={e => setTicketType(e.target.value)}>
              <option value="">— Не выбрано —</option>
              {Object.entries(TICKET_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="span-2">
            <label>Примечание</label>
            <textarea placeholder="Дополнительная информация" value={sourceDesc} onChange={e => setSourceDesc(e.target.value)} rows={2} />
          </div>
          <div style={{ position: 'relative' }}>
            <label>Объект <span className="required">*</span></label>
            {locationId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', fontSize: 13 }}>
                  {locations.find(l => l.id === Number(locationId))?.name || ''} — {locations.find(l => l.id === Number(locationId))?.address || ''}
                </span>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => { setLocationId(''); setLocQuery(''); }}>✕</button>
              </div>
            ) : (
              <>
                <input placeholder="Введите название или адрес..." value={locQuery} onChange={e => { setLocQuery(e.target.value); setLocOpen(true); }} onFocus={() => setLocOpen(true)} onBlur={() => setTimeout(() => setLocOpen(false), 200)} style={{ width: '100%' }} />
                {locOpen && locQuery.trim() && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 200, overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 100 }}>
                    {locations.filter(l => {
                      const q = locQuery.toLowerCase();
                      return l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q) || (l.customer_name || '').toLowerCase().includes(q);
                    }).slice(0, 20).map(l => (
                      <div key={l.id} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                        onMouseDown={() => { setLocationId(l.id); setLocQuery(''); setLocOpen(false); }}>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.address} — {l.customer_name}</div>
                      </div>
                    ))}
                    {locations.filter(l => {
                      const q = locQuery.toLowerCase();
                      return l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q) || (l.customer_name || '').toLowerCase().includes(q);
                    }).length === 0 && (
                      <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Ничего не найдено</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="span-2">
            <label>Описание проблемы</label>
            <textarea placeholder="Опишите проблему детально" value={body} onChange={e => setBody(e.target.value)} rows={3} />
          </div>
          <div>
            <label>Приоритет</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </div>
          <div>
            <label>Срок исполнения</label>
            <input type="date" value={resolutionDeadline} onChange={e => setResolutionDeadline(e.target.value)} />
          </div>
          <div></div>
          <div>
            <label>Исполнитель</label>
            {currentUser?.role === 'engineer' ? (
              <input value={[currentUser.name, currentUser.patronymic].filter(Boolean).join(' ')} disabled style={{ opacity: 0.7 }} />
            ) : (
              <select value={assigneeId} onChange={e => setAssigneeId(Number(e.target.value) || '')}>
                <option value="">— Назначить позже —</option>
                {assignables.map(u => (
                  <option key={u.id} value={u.id}>{[u.name, u.patronymic].filter(Boolean).join(' ')}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label>Контактное лицо на объекте</label>
            <input placeholder="ФИО" value={siteContactName} onChange={e => setSiteContactName(e.target.value)} />
          </div>
          <div>
            <label>Телефон на объекте</label>
            <input placeholder="+7 (___) ___-__-__" value={siteContactPhone} onChange={e => setSiteContactPhone(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>Создать</button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const EditTicketModal: React.FC<{ ticket: TicketResponse; onClose: () => void; onSaved: () => void; users: UserInfo[] }> = ({ ticket, onClose, onSaved, users }) => {
  const [subject, setSubject] = useState(ticket.subject);
  const [ticketType, setTicketType] = useState(ticket.type || '');
  const [sourceDesc, setSourceDesc] = useState(ticket.source_description || '');
  const [body, setBody] = useState(ticket.body);
  const [locationId, setLocationId] = useState<number | ''>(ticket.location_id);
  const [priority, setPriority] = useState(ticket.priority);
  const [resolutionDeadline, setResolutionDeadline] = useState(ticket.resolution_deadline ? ticket.resolution_deadline.substring(0, 10) : '');
  const [assigneeId, setAssigneeId] = useState<number | ''>(ticket.assignee_id ?? '');
  const [siteContactName, setSiteContactName] = useState(ticket.site_contact_name || '');
  const [siteContactPhone, setSiteContactPhone] = useState(ticket.site_contact_phone || '');
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const sel = locations.find(l => l.id === Number(locationId));
    if (sel) {
      if (!ticket.site_contact_name) setSiteContactName(sel.assigned_engineer_name || '');
      if (!ticket.site_contact_phone) {
        const phoneMatch = sel.contacts?.match(/\+7[\s()\d\-]+/);
        setSiteContactPhone(phoneMatch ? phoneMatch[0] : sel.contacts || '');
      }
    }
  }, [locationId, locations]);

  const submit = async () => {
    if (!subject || !locationId) { setError('Заполните тему и выберите объект'); return; }
    setSaving(true);
    try {
      const selected = locations.find(l => l.id === Number(locationId));
      await api.patch(`/tickets/${ticket.id}`, {
        subject,
        body,
        type: ticketType || null,
        source_description: sourceDesc || null,
        customer_id: selected?.customer_id ?? ticket.customer_id,
        location_id: Number(locationId),
        priority,
        resolution_deadline: resolutionDeadline ? new Date(resolutionDeadline + 'T23:59:59').toISOString() : null,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        site_contact_name: siteContactName || null,
        site_contact_phone: siteContactPhone || null,
      });
      onSaved();
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || 'Ошибка сохранения';
      setError(e.response ? `${e.response.status}: ${msg}` : msg);
    } finally { setSaving(false); }
  };

  const assignables = users.filter(u => u.role === 'engineer');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
        <h3>Редактировать заявку #{ticket.number}</h3>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-form-grid">
          <div>
            <label>Тема заявки <span className="required">*</span></label>
            <input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <label>Тип заявки</label>
            <select value={ticketType} onChange={e => setTicketType(e.target.value)}>
              <option value="">— Не выбрано —</option>
              {Object.entries(TICKET_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="span-2">
            <label>Примечание</label>
            <textarea value={sourceDesc} onChange={e => setSourceDesc(e.target.value)} rows={2} />
          </div>
          <div>
            <label>Объект <span className="required">*</span></label>
            <select value={locationId} onChange={e => setLocationId(Number(e.target.value) || '')}>
              <option value="">— Выберите объект —</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.customer_name})</option>
              ))}
            </select>
          </div>
          <div className="span-2">
            <label>Описание проблемы</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} />
          </div>
          <div>
            <label>Приоритет</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
            </select>
          </div>
          <div>
            <label>Срок исполнения</label>
            <input type="date" value={resolutionDeadline} onChange={e => setResolutionDeadline(e.target.value)} />
          </div>
          <div></div>
          <div>
            <label>Исполнитель</label>
            <select value={assigneeId} onChange={e => setAssigneeId(Number(e.target.value) || '')}>
              <option value="">— Назначить позже —</option>
              {assignables.map(u => (
                <option key={u.id} value={u.id}>{[u.name, u.patronymic].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Контактное лицо на объекте</label>
            <input value={siteContactName} onChange={e => setSiteContactName(e.target.value)} />
          </div>
          <div>
            <label>Телефон на объекте</label>
            <input value={siteContactPhone} onChange={e => setSiteContactPhone(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const TicketDetailModal: React.FC<{
  ticket: TicketResponse; onClose: () => void;
  onStatusChange?: (ticket: TicketResponse, target: string) => Promise<void>;
  onRefresh?: () => void; role?: string; currentUserId?: number;
}> = ({ ticket, onClose, onStatusChange, onRefresh, role, currentUserId }) => {
  const [comments, setComments] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState(ticket.resolution_deadline ? ticket.resolution_deadline.substring(0, 10) : '');

  const NS: Record<string, string> = { ASSIGNED: 'ACCEPTED', ACCEPTED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' };
  const SL: Record<string, string> = { ASSIGNED: 'Назначена', ACCEPTED: 'Принята', IN_PROGRESS: 'В работе', COMPLETED: 'Завершена' };
  const PL: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный' };
  const TL: Record<string, string> = { repair: 'Ремонт', installation: 'Монтаж', maintenance: 'ТО', inspection: 'Инспекция', emergency: 'Авария', verification: 'Поверка' };

  const canStatus = role === 'admin' || role === 'director' || (role === 'engineer' && ticket.assignee_id === currentUserId);
  const next = NS[ticket.status];

  const load = async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        api.get(`/tickets/${ticket.id}/comments`),
        api.get('/attachments', { params: { ticket_id: ticket.id } }).catch(() => ({ data: [] })),
      ]);
      setComments(cRes.data);
      setAttachments(aRes.data);
    } catch {}
  };

  useEffect(() => { load(); }, [ticket.id]);

  const [statusError, setStatusError] = useState('');

  const handleStatus = async (target: string) => {
    if (!onStatusChange) return;
    try {
      await onStatusChange(ticket, target);
      setStatusError('');
      onClose();
    } catch (e: any) {
      setStatusError(e.response?.data?.detail || e.message || 'Ошибка смены статуса');
    }
  };

  const handleSendComment = async () => {
    if (!newComment.trim() && !linkUrl.trim()) return;
    setSending(true);
    try {
      let body = newComment.trim();
      if (linkUrl.trim()) {
        const link = linkTitle.trim() ? `[${linkTitle.trim()}](${linkUrl.trim()})` : linkUrl.trim();
        body = body ? `${body}\n${link}` : link;
      }
      await api.post(`/tickets/${ticket.id}/comments`, { body });
      setNewComment('');
      setLinkUrl('');
      setLinkTitle('');
      load();
      if (onRefresh) onRefresh();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('ticket_id', String(ticket.id));
      await api.post('/attachments', form);
      load();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Ошибка загрузки файла');
    }
    e.target.value = '';
  };

  const saveDeadline = async () => {
    try {
      await api.patch(`/tickets/${ticket.id}`, { resolution_deadline: deadlineValue ? deadlineValue + 'T23:59:59' : null });
      setEditingDeadline(false);
      if (onRefresh) onRefresh();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка сохранения');
    }
  };

  const renderMarkdown = (text: string) => {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const safeUrl = url.trim();
      if (/^(https?|mailto|tel):/i.test(safeUrl)) {
        return `<a href="${safeUrl}" target="_blank" rel="noopener">${label}</a>`;
      }
      return `[${label}](${safeUrl})`;
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflow: 'auto', flex: 1 }}>
          <h3 style={{ margin: '0 0 12px' }}>#{ticket.number} {ticket.subject}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13, marginBottom: 14 }}>
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Статус</span><div><span className={`status-pill st-${ticket.status?.toLowerCase()}`}>{SL[ticket.status] || ticket.status}</span></div></div>
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Приоритет</span><div>{PL[ticket.priority] || ticket.priority}</div></div>
            {ticket.type && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Тип</span><div>{TL[ticket.type] || ticket.type}</div></div>}
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Создана</span><div>{new Date(ticket.created_at).toLocaleString('ru-RU')}</div></div>
            {ticket.resolution_deadline && !editingDeadline && canStatus && (
              <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Срок</span><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>{new Date(ticket.resolution_deadline).toLocaleDateString('ru-RU')}</span>
                <button onClick={() => setEditingDeadline(true)} style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 4, padding: '1px 5px', fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>✎</button>
              </div></div>
            )}
            {ticket.resolution_deadline && !editingDeadline && !canStatus && (
              <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Срок</span><div>{new Date(ticket.resolution_deadline).toLocaleDateString('ru-RU')}</div></div>
            )}
            {!ticket.resolution_deadline && !editingDeadline && canStatus && (
              <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Срок</span><div>
                <button onClick={() => setEditingDeadline(true)} style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>+ Указать срок</button>
              </div></div>
            )}
            {editingDeadline && (
              <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Срок исполнения</span><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="date" value={deadlineValue} onChange={e => setDeadlineValue(e.target.value)} style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text)' }} />
                <button className="btn btn-primary" onClick={saveDeadline} style={{ padding: '4px 8px', fontSize: 11 }}>OK</button>
                <button className="btn btn-secondary" onClick={() => setEditingDeadline(false)} style={{ padding: '4px 8px', fontSize: 11 }}>✕</button>
              </div></div>
            )}
            {ticket.site_contact_name && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Контакт</span><div>{ticket.site_contact_name}{ticket.site_contact_phone ? `, ${ticket.site_contact_phone}` : ''}</div></div>}
            {ticket.scheduled_end && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Выезд по</span><div>{new Date(ticket.scheduled_end).toLocaleString('ru-RU')}</div></div>}
            {ticket.source_description && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Источник</span><div>{ticket.source_description}</div></div>}
            {ticket.location_name && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Объект</span><div>{ticket.location_name}</div></div>}
            {ticket.location_address && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Адрес</span><div>{ticket.location_address}</div></div>}
            {ticket.customer_name && <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Заказчик</span><div>{ticket.customer_name}</div></div>}
          </div>
          <div style={{ marginBottom: 14 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Описание</span>
            <div style={{ marginTop: 4, padding: 10, background: 'var(--bg-surface)', borderRadius: 7, whiteSpace: 'pre-wrap', fontSize: 13 }}>{ticket.body || '—'}</div>
          </div>
          {canStatus && next && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-success" onClick={() => handleStatus(next)} style={{ fontSize: 13 }}>
                → {SL[next]}{next === 'COMPLETED' ? ' (Завершить)' : ''}
              </button>
              {statusError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{statusError}</p>}
            </div>
          )}
          {attachments.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Файлы ({attachments.length})</span>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attachments.map((a: any) => (
                  <a key={a.id} href="#" onClick={(e) => { e.preventDefault(); downloadFile(a.download_url || `/api/attachments/${a.id}`, a.filename); }} target="_blank" rel="noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-surface)', borderRadius: 6, fontSize: 12, color: 'var(--primary)', textDecoration: 'none', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    {a.filename}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Комментарии ({comments.length})</span>
            {comments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Нет комментариев</div>}
            {comments.map((c: any) => (
              <div key={c.id} style={{ marginTop: 6, padding: 8, background: 'var(--bg-surface)', borderRadius: 7, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{c.user_name || `Пользователь #${c.user_id}`} {c.is_internal ? '(внутр.)' : ''}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleString('ru-RU')}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Комментарий..." rows={2}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--bg-surface)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <button className="btn btn-primary" onClick={handleSendComment} disabled={sending || (!newComment.trim() && !linkUrl.trim())} style={{ padding: '8px 16px', fontSize: 13, alignSelf: 'flex-end' }}>
              {sending ? '...' : 'Добавить'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" placeholder="Ссылка URL" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} style={{ flex: 1, minWidth: 120, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text)' }} />
            <input type="text" placeholder="Название ссылки" value={linkTitle} onChange={e => setLinkTitle(e.target.value)} style={{ width: 140, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text)' }} />
            <label className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
              Файл<input type="file" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
};

const CompleteTicketModal: React.FC<{ ticket: TicketResponse; onConfirm: (comment: string) => Promise<void> | void; onClose: () => void }> = ({ ticket, onConfirm, onClose }) => {
  const [comment, setComment] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setUploadedPhotoUrl('');
      const reader = new FileReader();
      reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const submit = async () => {
    setUploading(true);
    try {
      let photoUrl = uploadedPhotoUrl;
      if (photoFile && !photoUrl) {
        const form = new FormData();
        form.append('file', photoFile);
        form.append('ticket_id', String(ticket.id));
        const resp = await api.post('/attachments', form);
        photoUrl = resp.data?.download_url || '';
        setUploadedPhotoUrl(photoUrl);
      }
      const fullComment = [comment, photoUrl ? `Фото: ${photoUrl}` : ''].filter(Boolean).join('\n\n');
      await onConfirm(fullComment);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка загрузки фото');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Завершить заявку #{ticket.number}</h3>
        <label>Комментарий о выполненной работе</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Опишите что сделано..." rows={4} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--bg-surface)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
        <label style={{ marginTop: 10 }}>Фото</label>
        <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
        {photoPreview && (
          <div style={{ marginTop: 6, maxWidth: 200, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <img src={photoPreview} alt="preview" style={{ width: '100%', display: 'block' }} />
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Комментарий будет добавлен как внутренний вместе с фото.</p>
        <div className="modal-actions">
          <button className="btn btn-success" onClick={submit} disabled={uploading}>
            {uploading ? 'Загрузка...' : '✓ Завершить'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const AddEmployeeModal: React.FC<{ onClose: () => void; onAdded: () => void }> = ({ onClose, onAdded }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('engineer');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email || !name || !password) { setError('Все поля обязательны'); return; }
    if (!consent) { setError('Требуется согласие на обработку персональных данных'); return; }
    try {
      await api.post('/signup', { email, name, phone, patronymic, password, role, consent_given: true });
      onAdded();
    } catch (e: any) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Добавить сотрудника</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>{error}</p>}
        <label>ФИО</label>
        <input placeholder="Иванов Иван Иванович" value={name} onChange={e => setName(e.target.value)} />
        <label>Email</label>
        <input placeholder="ivan@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <label>Телефон</label>
        <input placeholder="+7 (___) ___-__-__" value={phone} onChange={e => setPhone(e.target.value)} />
        <label>Пароль</label>
        <input placeholder="••••••••" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <label>Должность</label>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="engineer">Инженер</option>
          <option value="dispatcher">Диспетчер</option>
          <option value="admin">Администратор</option>
          <option value="storekeeper">Кладовщик</option>
          <option value="customer">Заказчик</option>
          <option value="viewer">Наблюдатель</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginTop: 8 }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
          Согласен на обработку персональных данных
        </label>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>Добавить</button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const EmployeesPage: React.FC<{ onAdd: () => void; refreshKey: number; isAdmin: boolean }> = ({ onAdd, refreshKey, isAdmin }) => {
  const [users, setUsers] = useState<UserInfo[]>([]);

  useEffect(() => {
    api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
  }, [refreshKey]);

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
    } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка'); }
  };

  return (
    <div>
      {isAdmin && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={onAdd}>+ Добавить сотрудника</button>
        </div>
      )}
      <div className="table-wrapper">
        <table>
          <thead><tr><th>ID</th><th>ФИО</th><th>Телефон</th><th>Email</th><th>Должность</th><th>Статус</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{u.id}</td>
                <td style={{ fontWeight: 600 }}>{u.name} {u.patronymic || ''}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{u.phone || '—'}</td>
                <td>{u.email}</td>
                <td><span className="status-pill" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>{ROLE_LABELS[u.role] || u.role}</span></td>
                <td>
                  {u.status === 'pending' && <span className="status-pill" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>Ожидает</span>}
                  {u.status === 'rejected' && <span className="status-pill" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>Отклонён</span>}
                  {(!u.status || u.status === 'active') && <span className="status-pill" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Активен</span>}
                </td>
                {isAdmin && (
                  <td>
                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => handleDelete(u.id)}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


const App: React.FC = () => {
  const [auth, setAuth] = useState<{ token: string; user: any } | null>(null);
  const [page, setPage] = useState<Page>('tickets');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editTicket, setEditTicket] = useState<TicketResponse | null>(null);
  const [detailTicket, setDetailTicket] = useState<TicketResponse | null>(null);
  const [confirmStatusTicket, setConfirmStatusTicket] = useState<{ ticket: TicketResponse; target: string } | null>(null);
  const [deleteTicketConfirm, setDeleteTicketConfirm] = useState<TicketResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [viewingEngineerId, setViewingEngineerId] = useState<number | null>(null);
  const [stats, setStats] = useState<{ total: number; open: number; urgent: number }>({ total: 0, open: 0, urgent: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const getInitialTheme = () => localStorage.getItem('theme') || 'dark';
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setAuth({ token, user });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('currentUserId');
        delete api.defaults.headers.common.Authorization;
      }
    }
  }, []);

  useEffect(() => {
    if (auth) {
      api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
      setStatsLoading(true);
      api.get('/reports/tickets').then(r => {
        const s = r.data;
        setStats({
          total: s.total || 0,
          open: (s.by_status || []).reduce((sum: number, st: any) => st.label !== 'COMPLETED' ? sum + st.count : sum, 0),
          urgent: (s.by_priority || []).reduce((sum: number, p: any) => (p.label === 'critical' || p.label === 'high') ? sum + p.count : sum, 0),
        });
        setStatsLoading(false);
      }).catch(() => { setStatsLoading(false); });
    }
  }, [auth, refreshKey]);

  const handleLogin = (token: string, user: any) => {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('currentUserId', String(user.user_id || user.id));
    setAuth({ token, user });
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('currentUserId');
    delete api.defaults.headers.common.Authorization;
    setAuth(null);
  };

  const handleStatusChange = async (ticket: TicketResponse, target: string) => {
    if (ticket.status === target) return;
    if (target === 'COMPLETED') {
      setConfirmStatusTicket({ ticket, target });
      return;
    }
    await api.patch(`/tickets/${ticket.id}/status`, { status: target });
    setRefreshKey(k => k + 1);
  };

  const handleDeleteTicket = async (ticket: TicketResponse) => {
    setDeleteTicketConfirm(ticket);
  };

  const executeDeleteTicket = async () => {
    if (!deleteTicketConfirm) return;
    try {
      await api.delete(`/tickets/${deleteTicketConfirm.id}`);
      setDeleteTicketConfirm(null);
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка удаления');
      setDeleteTicketConfirm(null);
    }
  };

  const confirmComplete = async (comment: string) => {
    if (!confirmStatusTicket) return;
    if (confirmStatusTicket.ticket.status === 'COMPLETED') {
      setConfirmStatusTicket(null);
      return;
    }
    try {
      await api.post(`/tickets/${confirmStatusTicket.ticket.id}/complete`, { comment });
      setConfirmStatusTicket(null);
      setDetailTicket(null);
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка');
    }
  };

  if (!auth || !auth.user) return <AuthPage onLogin={handleLogin} />;

  const user = auth.user;

  return (
    <div className="app-layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-mark">H</div>
          HUB<span> Desk</span>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Навигация</div>
          {NAV_ITEMS.filter(item => !('adminOnly' in item) || user.role === 'admin')
            .filter(item => item.key !== 'reports' || ['admin', 'director', 'dispatcher', 'accountant'].includes(user.role))
            .filter(item => item.key !== 'audit' || ['admin', 'director'].includes(user.role))
            .filter(item => item.key !== 'employees' || ['admin', 'director', 'dispatcher', 'accountant'].includes(user.role))
            .filter(item => item.key !== 'kanban' || ['admin', 'director', 'dispatcher', 'engineer'].includes(user.role))
            .filter(item => item.key !== 'warehouse' || ['admin', 'director', 'storekeeper', 'metrologist', 'accountant'].includes(user.role))
            .map(item => (
              <button
                key={item.key}
                className={`nav-item ${page === item.key ? 'active' : ''}`}
                onClick={() => { setViewingEngineerId(null); setPage(item.key); setSidebarOpen(false); }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
        </nav>
        {(user.role === 'admin' || user.role === 'director') && (
          <div className="sidebar-engineers">
            <div className="nav-section">Доски инженеров</div>
            {viewingEngineerId !== null && (
              <button className="nav-item" onClick={() => { setViewingEngineerId(null); setPage('kanban'); }}>
                <span className="nav-icon">←</span> Моя доска
              </button>
            )}
            {users.filter(u => u.role === 'engineer').sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(eng => (
              <button
                key={eng.id}
                className={`nav-item ${viewingEngineerId === eng.id ? 'active' : ''}`}
                onClick={() => { setViewingEngineerId(eng.id); setPage('kanban'); }}
              >
                <span className="nav-icon">👤</span>
                {eng.name}
              </button>
            ))}
          </div>
        )}
        <div className="sidebar-user">
          <div className="user-name">{user.name}</div>
          <div className="user-email">{user.email}</div>
          <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
          <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="logout-btn" onClick={handleLogout}>Выйти</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="top-bar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <h1>
            {page === 'tickets' ? 'Заявки' :
             page === 'calendar' ? 'Календарь' :
             page === 'kanban' ? (viewingEngineerId ? `Доска: ${users.find(u => u.id === viewingEngineerId)?.name || ''}` : 'Моя доска') :
             page === 'reports' ? 'Отчёты' :
             page === 'locations' ? 'Объекты' :
             page === 'employees' ? 'Сотрудники' :
             page === 'admin' ? 'Администрирование' :
             page === 'audit' ? 'Журнал действий' : 'Склад'}
          </h1>
          <div className="stat-pills">
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Всего заявок</div>
                <div className="stat-val" style={{ color: 'var(--text)' }}>{statsLoading ? '—' : stats.total}</div>
              </div>
            </div>
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Открыто</div>
                <div className="stat-val" style={{ color: 'var(--warning)' }}>{statsLoading ? '—' : stats.open}</div>
              </div>
            </div>
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Срочных</div>
                <div className="stat-val" style={{ color: 'var(--danger)' }}>{statsLoading ? '—' : stats.urgent}</div>
              </div>
            </div>
          </div>
        </div>

        {page === 'tickets' && (
          <>
            {(user.role === 'admin' || user.role === 'director' || user.role === 'dispatcher' || user.role === 'engineer') && (
              <div style={{ marginBottom: 14 }}>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  + Создать заявку
                </button>
              </div>
            )}
            <TicketGrid
              key={refreshKey}
              users={users}
              onEdit={setEditTicket}
              onDetail={setDetailTicket}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteTicket}
              currentUserId={user.user_id || user.id}
              role={user.role}
            />
          </>
        )}
        {page === 'calendar' && <CalendarPage onOpenTicket={setDetailTicket} />}
        {page === 'kanban' && <KanbanPage role={user.role} users={users} onDetail={setDetailTicket} onStatusChange={handleStatusChange} currentUserId={viewingEngineerId || user.user_id || user.id} viewingEngineerId={viewingEngineerId} />}
        {page === 'reports' && <ReportsPage onOpenTicket={setDetailTicket} />}
        {page === 'warehouse' && <WarehousePage />}
        {page === 'locations' && <LocationsPage />}
        {page === 'employees' && (
          <EmployeesPage
            onAdd={() => setShowAddEmployee(true)}
            refreshKey={refreshKey}
            isAdmin={user.role === 'admin'}
          />
        )}
        {page === 'admin' && <AdminPage />}
        {page === 'audit' && <AuditLogPage />}

        {showCreate && (
          <CreateTicketModal
            onClose={() => setShowCreate(false)}
            onCreated={() => setRefreshKey(k => k + 1)}
            users={users}
            currentUser={user}
          />
        )}
        {editTicket && (
          <EditTicketModal
            ticket={editTicket}
            onClose={() => setEditTicket(null)}
            onSaved={() => { setEditTicket(null); setRefreshKey(k => k + 1); }}
            users={users}
          />
        )}
        {detailTicket && (
          <TicketDetailModal
            ticket={detailTicket}
            onClose={() => setDetailTicket(null)}
            onStatusChange={handleStatusChange}
            onRefresh={() => setRefreshKey(k => k + 1)}
            role={user.role}
            currentUserId={user.user_id || user.id}
          />
        )}
        {confirmStatusTicket && (
          <CompleteTicketModal
            ticket={confirmStatusTicket.ticket}
            onConfirm={confirmComplete}
            onClose={() => setConfirmStatusTicket(null)}
          />
        )}
        {deleteTicketConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteTicketConfirm(null)}>
            <div className="modal-card" onClick={e => e.stopPropagation()}>
              <h3>Удаление заявки</h3>
              <p>Удалить заявку <strong>#{deleteTicketConfirm.number}</strong>?</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Это действие нельзя отменить.</p>
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button className="btn btn-danger" onClick={executeDeleteTicket}>Удалить</button>
                <button className="btn btn-secondary" onClick={() => setDeleteTicketConfirm(null)}>Отмена</button>
              </div>
            </div>
          </div>
        )}
        {showAddEmployee && (
          <AddEmployeeModal
            onClose={() => setShowAddEmployee(false)}
            onAdded={() => { setShowAddEmployee(false); setRefreshKey(k => k + 1); }}
          />
        )}
      </main>
    </div>
  );
};

export default App;
