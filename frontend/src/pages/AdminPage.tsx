import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Stats {
  total_users: number; total_customers: number; total_locations: number;
  total_warehouses: number; total_tickets: number; open_tickets: number;
  overdue_tickets: number; completed_tickets: number; critical_tickets: number;
  user_breakdown: { role: string; count: number }[];
}

interface CustomerData { id: number; name: string; type: string; locations_count: number; }
interface UserInfo { id: number; email: string; name: string; phone?: string; patronymic?: string; role: string; status?: string; }
interface PendingUser { id: number; email: string; name: string; role: string; status: string; consent_given: boolean; consent_date: string | null; }

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор', engineer: 'Инженер', dispatcher: 'Диспетчер',
  customer: 'Заказчик', storekeeper: 'Кладовщик', viewer: 'Наблюдатель', metrologist: 'Метролог', accountant: 'Бухгалтер',
};

export const AdminPage: React.FC = () => {
  const [tab, setTab] = useState<'dashboard' | 'users' | 'moderation' | 'customers' | 'history' | 'mailbox' | 'apikeys'>('dashboard');

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 20, display: 'inline-flex' }}>
        {([
          { key: 'dashboard', label: 'Дашборд', icon: '📊' },
          { key: 'users', label: 'Пользователи', icon: '👥' },
          { key: 'moderation', label: 'Модерация', icon: '🛡️' },
          { key: 'customers', label: 'Клиенты', icon: '🏢' },
          { key: 'history', label: 'История', icon: '📜' },
          { key: 'mailbox', label: 'Почта', icon: '📧' },
          { key: 'apikeys', label: 'API-ключи', icon: '🔑' },
        ] as const).map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'moderation' && <ModerationTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'mailbox' && <MailboxTab />}
      {tab === 'apikeys' && <ApiKeysTab />}
    </div>
  );
};

const DashboardTab: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/stats')
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => { setStats(null); setLoading(false); });
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;
  if (!stats) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Ошибка загрузки статистики</div>;

  const statCards = [
    { label: 'Пользователей', value: stats.total_users, color: 'var(--primary)' },
    { label: 'Клиентов', value: stats.total_customers, color: 'var(--info)' },
    { label: 'Объектов', value: stats.total_locations, color: 'var(--success)' },
    { label: 'Складов', value: stats.total_warehouses, color: 'var(--warning)' },
  ];

  const ticketCards = [
    { label: 'Всего заявок', value: stats.total_tickets, sub: null, color: 'var(--text)' },
    { label: 'Открыто', value: stats.open_tickets, sub: null, color: 'var(--warning)' },
    { label: 'Просрочено', value: stats.overdue_tickets, sub: null, color: 'var(--danger)' },
    { label: 'Завершено', value: stats.completed_tickets, sub: null, color: 'var(--success)' },
  ];

  return (
    <div>
      <div className="section-title">Система</div>
      <div className="kpi-row">
        {statCards.map(s => (
          <div className="kpi" key={s.label}>
            <div className="kpi-lab">{s.label}</div>
            <div className="kpi-val" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>Заявки</div>
      <div className="kpi-row">
        {ticketCards.map(s => (
          <div className="kpi" key={s.label}>
            <div className="kpi-lab">{s.label}</div>
            <div className="kpi-val" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>Пользователи по ролям</div>
      <div className="table-wrapper" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Должность</th><th>Количество</th></tr></thead>
          <tbody>
            {stats.user_breakdown.map((u, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{ROLE_LABELS[u.role] || u.role}</td>
                <td className="mono">{u.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const UsersTab: React.FC = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get('/users/list')
      .then(r => { setUsers(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>ID</th><th>ФИО</th><th>Телефон</th><th>Email</th><th>Должность</th><th></th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{u.id}</td>
                <td style={{ fontWeight: 600 }}>{u.name} {u.patronymic || ''}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{u.phone || '—'}</td>
                <td>{u.email}</td>
                <td>
                  <span className="status-pill" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                  {' '}
                  {u.status === 'pending' && <span className="status-pill" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>Ожидает</span>}
                  {u.status === 'rejected' && <span className="status-pill" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>Отклонён</span>}
                </td>
                <td>
                  <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setEditId(u.id)}>✎</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editId && (
        <UserEditModal
          user={users.find(u => u.id === editId)!}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); load(); }}
        />
      )}
    </div>
  );
};

const UserEditModal: React.FC<{ user: UserInfo; onClose: () => void; onSaved: () => void }> = ({ user, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name + (user.patronymic ? ' ' + user.patronymic : ''));
      setEmail(user.email);
      setPhone(user.phone || '');
      setRole(user.role);
      setPassword('');
      setError('');
    }
  }, [user]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body: any = {};
      const fullName = user.name + (user.patronymic ? ' ' + user.patronymic : '');

      if (name.trim() !== fullName) body.name = name.trim();
      if (email.trim() !== user.email) body.email = email.trim();
      if (phone.trim() !== (user.phone || '')) body.phone = phone.trim();
      if (role !== user.role) body.role = role;
      if (password) body.password = password;

      if (Object.keys(body).length === 0) { onClose(); return; }

      await api.patch(`/admin/users/${user.id}`, body);
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Редактировать: {user.name} {user.patronymic || ''}</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
        <label>ФИО</label>
        <input value={name} onChange={e => setName(e.target.value)} />
        <label>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} />
        <label>Телефон</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} />
        <label>Должность</label>
        <select value={role} onChange={e => setRole(e.target.value)}>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label>Новый пароль (оставьте пустым, чтобы не менять)</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const CustomersTab: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get('/admin/customers')
      .then(r => { setCustomers(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const deleteCust = async (id: number) => {
    if (!confirm('Удалить клиента?')) return;
    try {
      await api.delete(`/admin/customers/${id}`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка удаления');
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Клиенты</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Добавить клиента</button>
      </div>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Объектов</th><th></th></tr></thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{c.id}</td>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td><span className="status-pill" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>{c.type === 'company' ? 'Компания' : 'Физлицо'}</span></td>
                <td className="mono">{c.locations_count}</td>
                <td>
                  <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setEditId(c.id)} title="Редактировать">✎</button>
                  {' '}
                  <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => deleteCust(c.id)} title="Удалить">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && <CustomerFormModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editId && <CustomerFormModal onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} customer={customers.find(c => c.id === editId)} />}
    </div>
  );
};

const CustomerFormModal: React.FC<{ onClose: () => void; onSaved: () => void; customer?: CustomerData }> = ({ onClose, onSaved, customer }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('company');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(customer?.name || '');
    setType(customer?.type || 'company');
    setError('');
  }, [customer]);

  const save = async () => {
    if (!name.trim()) { setError('Название обязательно'); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), type };
      if (customer) await api.patch(`/admin/customers/${customer.id}`, body);
      else await api.post('/admin/customers', body);
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>{customer ? 'Редактировать' : 'Добавить'} клиента</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
        <label>Название</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="ООО Компания" />
        <label>Тип</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="company">Компания</option>
          <option value="individual">Физлицо</option>
        </select>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Сохранение...' : (customer ? 'Сохранить' : 'Добавить')}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const ModerationTab: React.FC = () => {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get('/admin/pending-users')
      .then(r => { setPending(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: number) => {
    try { await api.post(`/admin/pending-users/${id}/approve`); load(); } catch {}
  };

  const handleReject = async (id: number) => {
    try { await api.post(`/admin/pending-users/${id}/reject`); load(); } catch {}
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Модерация пользователей</h2>
        <span className="text-muted">{pending.length} заявок на рассмотрении</span>
      </div>
      {pending.length === 0 ? (
        <div className="dash-card card-accent">
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 16 }}>Заявок на утверждение нет</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Имя</th><th>Email</th><th>Должность</th><th>Согласие</th><th>Действия</th></tr></thead>
            <tbody>
              {pending.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td>{u.email}</td>
                  <td><span className="status-pill" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>{ROLE_LABELS[u.role] || u.role}</span></td>
                  <td>
                    {u.consent_given
                      ? <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ Дано {u.consent_date ? new Date(u.consent_date).toLocaleDateString('ru-RU') : ''}</span>
                      : <span style={{ color: 'var(--danger)', fontSize: 12 }}>✕ Отсутствует</span>}
                  </td>
                  <td>
                    <button className="btn btn-success" style={{ padding: '5px 12px', fontSize: 12, marginRight: 6 }} onClick={() => handleApprove(u.id)}>✓ Утвердить</button>
                    <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => handleReject(u.id)}>✕ Отклонить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const HistoryTab: React.FC = () => {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/history')
      .then(r => { setLines(r.data.lines || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>История действий</h2>
        <span className="text-muted">{lines.length} записей</span>
      </div>
      <div className="table-wrapper" style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <table>
          <thead><tr><th style={{ width: 160 }}>Дата</th><th>Событие</th></tr></thead>
          <tbody>
            {lines.map((line, i) => {
              const match = line.match(/^\[(.+?)\]\s+(.+)/);
              const ts = match ? match[1] : '';
              const msg = match ? match[2] : line;
              return (
                <tr key={i}>
                  <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{ts}</td>
                  <td>{msg}</td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>История пуста</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MailboxTab: React.FC = () => {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchResult, setFetchResult] = useState('');
  const [form, setForm] = useState({
    enabled: false,
    imap_server: 'imap.timeweb.ru', imap_port: 993,
    folder: 'INBOX', check_interval_min: 5,
  });

  useEffect(() => {
    api.get('/admin/mailbox')
      .then(r => {
        if (r.data) { setForm(prev => ({ ...prev, ...r.data })); setCfg(r.data); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await api.post('/admin/mailbox', form); setCfg(form); } catch {}
    finally { setSaving(false); }
  };

  const fetchNow = async () => {
    setFetchResult('');
    try {
      const r = await api.post('/admin/mailbox/fetch');
      setFetchResult(r.data.created > 0 ? `Создано заявок: ${r.data.created}` : 'Новых писем нет');
    } catch (e: any) { setFetchResult('Ошибка: ' + (e.response?.data?.detail || e.message)); }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header"><h2>Настройка почтового ящика</h2></div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Email и пароль хранятся в <code>.env</code> (mailbox_email, mailbox_password).
        {cfg?.email && <span style={{ color: 'var(--text)' }}> Подключён: <strong>{cfg.email}</strong></span>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', maxWidth: 520 }}>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
          Включить автоматический сбор заявок из почты
        </label>
        <div><label>IMAP сервер</label><input value={form.imap_server} onChange={e => setForm({ ...form, imap_server: e.target.value })} /></div>
        <div><label>Порт</label><input type="number" value={form.imap_port} onChange={e => setForm({ ...form, imap_port: Number(e.target.value) })} /></div>
        <div><label>Папка</label><input value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} /></div>
        <div><label>Интервал (мин)</label><input type="number" value={form.check_interval_min} onChange={e => setForm({ ...form, check_interval_min: Number(e.target.value) })} /></div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '...' : 'Сохранить'}</button>
        <button className="btn btn-secondary" onClick={fetchNow} disabled={!cfg?.enabled}>Проверить сейчас</button>
        {fetchResult && <span style={{ fontSize: 13, color: fetchResult.includes('Ошибка') ? 'var(--danger)' : 'var(--success)' }}>{fetchResult}</span>}
        {cfg?.last_check_at && <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>Последняя проверка: {new Date(cfg.last_check_at).toLocaleString('ru-RU')}</span>}
      </div>
    </div>
  );
};

const ApiKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  const load = () => {
    api.get('/admin/api-keys').then(r => { setKeys(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    try { await api.post('/admin/api-keys', { name: newName.trim() }); setNewName(''); load(); } catch {}
  };

  const toggle = async (id: number) => {
    try { await api.patch(`/admin/api-keys/${id}`); load(); } catch {}
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить ключ?')) return;
    try { await api.delete(`/admin/api-keys/${id}`); load(); } catch {}
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header"><h2>API-ключи</h2></div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Используйте для автоматического создания заявок: <code>POST /api/v1/tickets</code> с заголовком <code>X-Api-Key: ваш_ключ</code>
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input placeholder="Название (например: 1С, Мониторинг)" value={newName} onChange={e => setNewName(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)' }} />
        <button className="btn btn-primary" onClick={create} style={{ padding: '6px 14px', fontSize: 12 }}>Создать</button>
      </div>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>Название</th><th>Ключ</th><th>Статус</th><th>Создан</th><th></th></tr></thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td style={{ fontWeight: 600 }}>{k.name}</td>
                <td><code style={{ fontSize: 11, background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 4 }}>{k.key}</code></td>
                <td><span className="status-pill" style={{ background: k.is_active ? 'var(--success-bg)' : 'var(--danger-bg)', color: k.is_active ? 'var(--success)' : 'var(--danger)' }}>{k.is_active ? 'Активен' : 'Отключён'}</span></td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(k.created_at).toLocaleString('ru-RU')}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => toggle(k.id)} style={{ padding: '3px 8px', fontSize: 10 }}>{k.is_active ? 'Откл' : 'Вкл'}</button>
                  <button className="btn btn-danger" onClick={() => remove(k.id)} style={{ padding: '3px 8px', fontSize: 10, marginLeft: 4 }}>✕</button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Нет ключей</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
