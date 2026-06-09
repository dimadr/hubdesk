import React, { useState, useEffect } from 'react';
import { api, TicketResponse } from './api/client';
import { TicketGrid } from './components/TicketGrid/TicketGrid';
import { WarehousePage } from './pages/WarehousePage';
import { LocationsPage } from './pages/LocationsPage';
import { AdminPage } from './pages/AdminPage';
import { CalendarPage } from './pages/CalendarPage';
import { ReportsPage } from './pages/ReportsPage';
import { L } from './locale';

interface Location {
  id: number; name: string; address: string; customer_id: number; customer_name: string;
  contacts: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  assigned_engineer_id: number | null; assigned_engineer_name: string | null;
  contract_number: string | null; contract_valid_from: string | null; contract_valid_to: string | null;
}

interface UserInfo {
  id: number; email: string; name: string; phone?: string; role: string; status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор', engineer: 'Инженер', dispatcher: 'Диспетчер',
  customer: 'Заказчик', storekeeper: 'Кладовщик', viewer: 'Наблюдатель', metrologist: 'Метролог', accountant: 'Бухгалтер',
};

const AuthPage: React.FC<{ onLogin: (token: string, user: any) => void }> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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
      const body: any = isLogin ? { email, password, remember_me: rememberMe } : { email, password, name, role, consent_given: consent };
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
            <input placeholder={L.name} value={name} onChange={e => setName(e.target.value)} />
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

const TICKET_TYPES: Record<string, string> = {
  repair: 'Ремонт', installation: 'Монтаж', maintenance: 'ТО',
  inspection: 'Инспекция', emergency: 'Авария',
};

const CreateTicketModal: React.FC<{ onClose: () => void; onCreated: () => void; users: UserInfo[] }> = ({ onClose, onCreated, users }) => {
  const [subject, setSubject] = useState('');
  const [ticketType, setTicketType] = useState('');
  const [sourceDesc, setSourceDesc] = useState('');
  const [body, setBody] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [equipmentId, setEquipmentId] = useState<number | ''>('');
  const [priority, setPriority] = useState('medium');
  const [resolutionDeadline, setResolutionDeadline] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [groupId, setGroupId] = useState<number | ''>('');
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
    api.get('/equipment').then(r => setEquipment(r.data)).catch(() => {});
    api.get('/groups').then(r => setGroups(r.data)).catch(() => {});
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
    try {
      const selected = locations.find(l => l.id === Number(locationId));
      await api.post('/tickets', {
        subject,
        body,
        type: ticketType || undefined,
        source_description: sourceDesc || undefined,
        customer_id: selected?.customer_id ?? 1,
        location_id: Number(locationId),
        equipment_id: equipmentId ? Number(equipmentId) : undefined,
        priority,
        resolution_deadline: resolutionDeadline ? new Date(resolutionDeadline).toISOString() : undefined,
        scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : undefined,
        scheduled_end: scheduledEnd ? new Date(scheduledEnd).toISOString() : undefined,
        assignee_id: assigneeId ? Number(assigneeId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        site_contact_name: siteContactName || undefined,
        site_contact_phone: siteContactPhone || undefined,
        is_internal: isInternal,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка создания');
    }
  };

  const engineers = users.filter(u => u.role === 'engineer');
  const eqForLocation = equipment.filter(e => !locationId || e.location_id === Number(locationId));

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
            <label>Источник обращения</label>
            <textarea placeholder="Текст обращения клиента (как сообщили)" value={sourceDesc} onChange={e => setSourceDesc(e.target.value)} rows={2} />
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
          <div>
            <label>Оборудование</label>
            <select value={equipmentId} onChange={e => setEquipmentId(Number(e.target.value) || '')}>
              <option value="">— Не выбрано —</option>
              {(locationId ? eqForLocation : equipment).map(e => (
                <option key={e.id} value={e.id}>{e.model} ({e.serial_number})</option>
              ))}
            </select>
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
            <input type="datetime-local" value={resolutionDeadline} onChange={e => setResolutionDeadline(e.target.value)} />
          </div>
          <div>
            <label>Плановый выезд с</label>
            <input type="datetime-local" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} />
          </div>
          <div>
            <label>Плановый выезд по</label>
            <input type="datetime-local" value={scheduledEnd} onChange={e => setScheduledEnd(e.target.value)} />
          </div>
          <div>
            <label>Исполнитель</label>
            <select value={assigneeId} onChange={e => setAssigneeId(Number(e.target.value) || '')}>
              <option value="">— Назначить позже —</option>
              {engineers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Группа</label>
            <select value={groupId} onChange={e => setGroupId(Number(e.target.value) || '')}>
              <option value="">— Не выбрана —</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Контактное лицо на объекте</label>
            <input placeholder="ФИО" value={siteContactName} onChange={e => setSiteContactName(e.target.value)} />
          </div>
          <div>
            <label>Телефон на объекте</label>
            <input placeholder="+7 (___) ___-__-__" value={siteContactPhone} onChange={e => setSiteContactPhone(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
              Внутренняя заявка
            </label>
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
  const [equipmentId, setEquipmentId] = useState<number | ''>(ticket.equipment_id ?? '');
  const [priority, setPriority] = useState(ticket.priority);
  const [resolutionDeadline, setResolutionDeadline] = useState(ticket.resolution_deadline ? ticket.resolution_deadline.substring(0, 16) : '');
  const [scheduledStart, setScheduledStart] = useState(ticket.scheduled_start ? ticket.scheduled_start.substring(0, 16) : '');
  const [scheduledEnd, setScheduledEnd] = useState(ticket.scheduled_end ? ticket.scheduled_end.substring(0, 16) : '');
  const [assigneeId, setAssigneeId] = useState<number | ''>(ticket.assignee_id ?? '');
  const [groupId, setGroupId] = useState<number | ''>(ticket.group_id ?? '');
  const [siteContactName, setSiteContactName] = useState(ticket.site_contact_name || '');
  const [siteContactPhone, setSiteContactPhone] = useState(ticket.site_contact_phone || '');
  const [isInternal, setIsInternal] = useState(ticket.is_internal);
  const [locations, setLocations] = useState<Location[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
    api.get('/equipment').then(r => setEquipment(r.data)).catch(() => {});
    api.get('/groups').then(r => setGroups(r.data)).catch(() => {});
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
        type: ticketType || undefined,
        source_description: sourceDesc || undefined,
        customer_id: selected?.customer_id ?? ticket.customer_id,
        location_id: Number(locationId),
        equipment_id: equipmentId ? Number(equipmentId) : undefined,
        priority,
        resolution_deadline: resolutionDeadline ? new Date(resolutionDeadline).toISOString() : undefined,
        scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : undefined,
        scheduled_end: scheduledEnd ? new Date(scheduledEnd).toISOString() : undefined,
        assignee_id: assigneeId ? Number(assigneeId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        site_contact_name: siteContactName || undefined,
        site_contact_phone: siteContactPhone || undefined,
        is_internal: isInternal,
      });
      onSaved();
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || 'Ошибка сохранения';
      setError(e.response ? `${e.response.status}: ${msg}` : msg);
    } finally { setSaving(false); }
  };

  const engineers = users.filter(u => u.role === 'engineer');
  const eqForLocation = equipment.filter(e => !locationId || e.location_id === Number(locationId));

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
            <label>Источник обращения</label>
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
          <div>
            <label>Оборудование</label>
            <select value={equipmentId} onChange={e => setEquipmentId(Number(e.target.value) || '')}>
              <option value="">— Не выбрано —</option>
              {(locationId ? eqForLocation : equipment).map(e => (
                <option key={e.id} value={e.id}>{e.model} ({e.serial_number})</option>
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
            <input type="datetime-local" value={resolutionDeadline} onChange={e => setResolutionDeadline(e.target.value)} />
          </div>
          <div>
            <label>Плановый выезд с</label>
            <input type="datetime-local" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} />
          </div>
          <div>
            <label>Плановый выезд по</label>
            <input type="datetime-local" value={scheduledEnd} onChange={e => setScheduledEnd(e.target.value)} />
          </div>
          <div>
            <label>Исполнитель</label>
            <select value={assigneeId} onChange={e => setAssigneeId(Number(e.target.value) || '')}>
              <option value="">— Назначить позже —</option>
              {engineers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Группа</label>
            <select value={groupId} onChange={e => setGroupId(Number(e.target.value) || '')}>
              <option value="">— Не выбрана —</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
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
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
              Внутренняя заявка
            </label>
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

const AddEmployeeModal: React.FC<{ onClose: () => void; onAdded: () => void }> = ({ onClose, onAdded }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('engineer');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email || !name || !password) { setError('Все поля обязательны'); return; }
    if (!consent) { setError('Требуется согласие на обработку персональных данных'); return; }
    try {
      await api.post('/signup', { email, name, phone, password, role, consent_given: true });
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

const NAV_ITEMS = [
  { key: 'tickets', label: 'Заявки', icon: '📋' },
  { key: 'locations', label: 'Объекты', icon: '🏢' },
  { key: 'employees', label: 'Сотрудники', icon: '👥' },
  { key: 'warehouse', label: 'Склад', icon: '📦' },
  { key: 'reports', label: 'Отчёты', icon: '📊' },
  { key: 'calendar', label: 'Календарь', icon: '📅' },
  { key: 'admin', label: 'Админка', icon: '⚙️', adminOnly: true },
] as const;

type Page = typeof NAV_ITEMS[number]['key'];

const App: React.FC = () => {
  const [auth, setAuth] = useState<{ token: string; user: any } | null>(null);
  const [page, setPage] = useState<Page>('tickets');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editTicket, setEditTicket] = useState<TicketResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [stats, setStats] = useState<{ total: number; open: number; urgent: number }>({ total: 0, open: 0, urgent: 0 });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const userStr = localStorage.getItem('user');
      if (userStr) setAuth({ token, user: JSON.parse(userStr) });
    }
  }, []);

  useEffect(() => {
    if (auth) {
      api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
      api.get('/tickets').then(r => {
        const tickets = r.data;
        setStats({
          total: tickets.length,
          open: tickets.filter((t: any) => t.status !== 'COMPLETED').length,
          urgent: tickets.filter((t: any) => t.priority === 'critical' || t.priority === 'high').length,
        });
      }).catch(() => {});
    }
  }, [auth, refreshKey]);

  const handleLogin = (token: string, user: any) => {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    localStorage.setItem('user', JSON.stringify(user));
    setAuth({ token, user });
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuth(null);
  };

  if (!auth) return <AuthPage onLogin={handleLogin} />;

  const user = auth.user;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">H</div>
          HUB<span> Desk</span>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Навигация</div>
          {NAV_ITEMS.filter(item => !(item as any).adminOnly || user.role === 'admin')
            .filter(item => item.key !== 'reports' || user.role === 'admin' || user.role === 'dispatcher' || user.role === 'accountant')
            .map(item => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? 'active' : ''}`}
              onClick={() => setPage(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="user-name">{user.name}</div>
          <div className="user-email">{user.email}</div>
          <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
          <button className="logout-btn" onClick={handleLogout}>Выйти</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="top-bar">
          <h1>
            {page === 'tickets' ? 'Заявки' :
             page === 'calendar' ? 'Календарь' :
             page === 'reports' ? 'Отчёты' :
             page === 'locations' ? 'Объекты' :
             page === 'employees' ? 'Сотрудники' :
             page === 'admin' ? 'Администрирование' : 'Склад'}
          </h1>
          <div className="stat-pills">
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Всего заявок</div>
                <div className="stat-val" style={{ color: 'var(--text)' }}>{stats.total}</div>
              </div>
            </div>
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Открыто</div>
                <div className="stat-val" style={{ color: 'var(--warning)' }}>{stats.open}</div>
              </div>
            </div>
            <div className="stat-pill">
              <div>
                <div className="stat-lab">Срочных</div>
                <div className="stat-val" style={{ color: 'var(--danger)' }}>{stats.urgent}</div>
              </div>
            </div>
          </div>
        </div>

        {page === 'tickets' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                + Создать заявку
              </button>
            </div>
            <TicketGrid key={refreshKey} users={users} onEdit={t => setEditTicket(t)} />
          </>
        )}
        {page === 'calendar' && <CalendarPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'warehouse' && <WarehousePage />}
        {page === 'locations' && <LocationsPage />}
        {page === 'employees' && <EmployeesPage onAdd={() => setShowAddEmployee(true)} refreshKey={refreshKey} isAdmin={user.role === 'admin'} />}
        {page === 'admin' && <AdminPage />}
        {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onCreated={() => setRefreshKey(k => k + 1)} users={users} />}
        {editTicket && <EditTicketModal ticket={editTicket} onClose={() => setEditTicket(null)} onSaved={() => { setEditTicket(null); setRefreshKey(k => k + 1); }} users={users} />}
        {showAddEmployee && <AddEmployeeModal onClose={() => setShowAddEmployee(false)} onAdded={() => { setShowAddEmployee(false); setRefreshKey(k => k + 1); }} />}
      </main>
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
                <td style={{ fontWeight: 600 }}>{u.name}</td>
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

export default App;
