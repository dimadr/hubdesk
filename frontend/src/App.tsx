import React, { useState, useEffect } from 'react';
import { api, TicketResponse } from './api/client';
import { TicketGrid } from './components/TicketGrid/TicketGrid';
import { WarehousePage } from './pages/WarehousePage';
import { LocationsPage } from './pages/LocationsPage';
import { AdminPage } from './pages/AdminPage';
import { L } from './locale';

interface Location {
  id: number; name: string; address: string; customer_id: number; customer_name: string;
  contacts: string | null; assigned_engineer_id: number | null; assigned_engineer_name: string | null;
  contract_number: string | null; contract_valid_from: string | null; contract_valid_to: string | null;
}

interface UserInfo {
  id: number; email: string; name: string; role: string; status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор', engineer: 'Инженер', dispatcher: 'Диспетчер',
  customer: 'Заказчик', storekeeper: 'Кладовщик',
};

const AuthPage: React.FC<{ onLogin: (token: string, user: any) => void }> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('dispatcher');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const submit = async () => {
    setError('');
    setSuccessMsg('');
    try {
      const url = isLogin ? '/login' : '/signup';
      const body: any = isLogin ? { email, password } : { email, password, name, role, consent_given: consent };
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
        {!isLogin && (
          <>
            <input placeholder={L.name} value={name} onChange={e => setName(e.target.value)} />
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="dispatcher">{L.dispatcher}</option>
              <option value="engineer">Инженер</option>
              <option value="storekeeper">Кладовщик</option>
              <option value="customer">Заказчик</option>
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

const CreateTicketModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!subject || !locationId) { setError('Заполните тему и выберите объект'); return; }
    try {
      const selected = locations.find(l => l.id === Number(locationId));
      await api.post('/tickets', {
        subject, body,
        customer_id: selected?.customer_id ?? 1,
        location_id: Number(locationId),
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка создания');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Создать заявку</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>{error}</p>}
        <label>Тема заявки</label>
        <input placeholder="Введите тему" value={subject} onChange={e => setSubject(e.target.value)} />
        <label>Описание</label>
        <textarea placeholder="Опишите проблему" value={body} onChange={e => setBody(e.target.value)} rows={3} />
        <label>Объект</label>
        <select value={locationId} onChange={e => setLocationId(Number(e.target.value) || '')}>
          <option value="">— Выберите объект —</option>
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name} ({l.customer_name})</option>
          ))}
        </select>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>Создать</button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const AddEmployeeModal: React.FC<{ onClose: () => void; onAdded: () => void }> = ({ onClose, onAdded }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('engineer');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email || !name || !password) { setError('Все поля обязательны'); return; }
    try {
      await api.post('/signup', { email, name, password, role });
      onAdded();
    } catch (e: any) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Добавить сотрудника</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>{error}</p>}
        <label>Имя</label>
        <input placeholder="Иван Петров" value={name} onChange={e => setName(e.target.value)} />
        <label>Email</label>
        <input placeholder="ivan@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <label>Пароль</label>
        <input placeholder="••••••••" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <label>Роль</label>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="engineer">Инженер</option>
          <option value="dispatcher">Диспетчер</option>
          <option value="admin">Администратор</option>
          <option value="storekeeper">Кладовщик</option>
          <option value="customer">Заказчик</option>
        </select>
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
  { key: 'admin', label: 'Админка', icon: '⚙️', adminOnly: true },
] as const;

type Page = typeof NAV_ITEMS[number]['key'];

const App: React.FC = () => {
  const [auth, setAuth] = useState<{ token: string; user: any } | null>(null);
  const [page, setPage] = useState<Page>('tickets');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
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
          <div className="logo-mark">F</div>
          FSM<span> Desk</span>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Навигация</div>
          {NAV_ITEMS.filter(item => !(item as any).adminOnly || user.role === 'admin').map(item => (
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
            <TicketGrid key={refreshKey} users={users} />
          </>
        )}
        {page === 'warehouse' && <WarehousePage />}
        {page === 'locations' && <LocationsPage />}
        {page === 'employees' && <EmployeesPage onAdd={() => setShowAddEmployee(true)} refreshKey={refreshKey} isAdmin={user.role === 'admin'} />}
        {page === 'admin' && <AdminPage />}
        {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onCreated={() => setRefreshKey(k => k + 1)} />}
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
          <thead><tr><th>ID</th><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{u.id}</td>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
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
