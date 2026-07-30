import React, { useEffect, useState } from 'react';
import { api, TicketResponse } from '../api/client';

interface ContactItem {
  id?: number;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  is_primary: boolean;
}

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
  contacts_list: ContactItem[];
  assigned_engineer_id: number | null;
  assigned_engineer_name: string | null;
  contract_number: string | null;
  contract_valid_from: string | null;
  contract_valid_to: string | null;
  inn: string | null;
}

interface UserInfo { id: number; email: string; name: string; role: string; }
interface CustomerInfo { id: number; name: string; }

interface LocationsPageProps {
  onOpenTicket?: (ticket: TicketResponse) => void;
}

export const LocationsPage: React.FC<LocationsPageProps> = ({ onOpenTicket }) => {
  const role = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').role || ''; } catch { return ''; } })();
  const isAdmin = role === 'admin';
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [worksLocation, setWorksLocation] = useState<Location | null>(null);

  const refreshLocations = async () => {
    try {
      const res = await api.get('/locations');
      setLocations(res.data);
    } catch (err) {
      console.error("Ошибка обновления списка локаций:", err);
    }
  };

  const initPage = () => {
    setLoading(true);
    setPageError(null);
    Promise.all([
      api.get('/locations'),
      api.get('/users/list').catch(() => ({ data: [] })),
      api.get('/admin/customers').catch(() => ({ data: [] })),
    ])
      .then(([locRes, userRes, custRes]) => {
        setLocations(locRes.data);
        setUsers(userRes.data);
        setCustomers(custRes.data);
      })
      .catch((err) => {
        console.error("Ошибка инициализации страницы:", err);
        setPageError(err.response?.data?.detail || "Не удалось загрузить данные. Проверьте права доступа.");
      })
      .finally(() => setLoading(false));
  };

  const handleDelete = async (id: number) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    setConfirmDelete(null);
    try {
      await api.delete(`/locations/${id}`);
      refreshLocations();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка удаления');
    }
  };

  useEffect(() => { initPage(); }, []);

  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}>Загрузка...</div>;
  if (pageError) return <div style={{ padding: 24, color: 'var(--danger)' }}>{pageError}</div>;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? locations.filter(l => l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q) || (l.customer_name && l.customer_name.toLowerCase().includes(q)))
    : locations;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2>Объекты обслуживания</h2>
        {(role === 'admin' || role === 'director' || role === 'dispatcher' || role === 'accountant' || role === 'engineer') && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Добавить объект</button>
        )}
      </div>
      <input
        type="text"
        className="search-bar"
        placeholder="Поиск по названию, адресу или клиенту..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 14 }}
      />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Название</th><th>Клиент</th><th>Адрес</th><th>ИНН</th><th>Контакты</th>
              <th>Инженер</th><th>Договор</th><th>Срок</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => {
              const contactStr = l.contacts_list?.length
                ? l.contacts_list.map(c => [c.name, c.phone, c.email].filter(Boolean).join(' / ')).join(', ')
                : [l.contact_name, l.contact_phone, l.contact_email].filter(Boolean).join(' / ') || l.contacts;
              return (
                <tr key={l.id}>
                  <td className="mono" style={{ color: 'var(--text-muted)' }}>#{l.id}</td>
                  <td style={{ fontWeight: 600 }}>
                    <button
                      type="button"
                      onClick={() => setWorksLocation(l)}
                      title="Открыть работы по объекту"
                      style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                    >
                      {l.name}
                    </button>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{l.customer_name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.address}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.inn || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{contactStr || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{l.assigned_engineer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{l.contract_number || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {l.contract_valid_from && <span>с {l.contract_valid_from.substring(0, 10)}</span>}
                    {l.contract_valid_to && <span> до {l.contract_valid_to.substring(0, 10)}</span>}
                    {!l.contract_valid_from && !l.contract_valid_to && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    <button onClick={() => setEditId(l.id)} className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}>✎</button>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(l.id)}
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 11, marginLeft: 4, color: confirmDelete === l.id ? 'var(--danger)' : undefined }}
                      >
                        {confirmDelete === l.id ? 'Подтвердить?' : '✕'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                {q ? 'Ничего не найдено' : 'Нет объектов'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <LocForm
          key="add"
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refreshLocations(); }}
          users={users}
          customers={customers}
        />
      )}

      {editId && (
        <LocForm
          key={editId}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); refreshLocations(); }}
          users={users}
          customers={customers}
          loc={locations.find(l => l.id === editId)}
        />
      )}

      {worksLocation && (
        <LocationWorksModal
          location={worksLocation}
          onClose={() => setWorksLocation(null)}
          onOpenTicket={onOpenTicket}
        />
      )}
    </div>
  );
};

const WORK_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
};

const LocationWorksModal: React.FC<{
  location: Location;
  onClose: () => void;
  onOpenTicket?: (ticket: TicketResponse) => void;
}> = ({ location, onClose, onOpenTicket }) => {
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadTickets = async () => {
      const all: TicketResponse[] = [];
      const limit = 200;
      setLoading(true);
      setError('');

      try {
        for (let offset = 0; ; offset += limit) {
          const response = await api.get<TicketResponse[]>('/tickets', {
            params: {
              location_id: location.id,
              limit,
              offset,
              sort_by: 'created_at',
              sort_dir: 'desc',
            },
            signal: controller.signal,
          });
          all.push(...response.data);
          setTickets([...all]);
          if (response.data.length < limit) break;
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          setError(err.response?.data?.detail || 'Не удалось загрузить работы по объекту');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadTickets();
    return () => controller.abort();
  }, [location.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(1100px, 95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>Работы по объекту: {location.name}</h3>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
              {[location.customer_name, location.address].filter(Boolean).join(' — ')}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            style={{ marginLeft: 'auto', padding: '4px 9px', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        <div className="table-wrapper" style={{ overflow: 'auto', flex: 1 }}>
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Работа</th>
                <th>Статус</th>
                <th>Исполнитель</th>
                <th>Создана</th>
                <th>Дедлайн</th>
                <th>Завершена</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => (
                <tr
                  key={ticket.id}
                  onClick={() => onOpenTicket?.(ticket)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenTicket?.(ticket);
                    }
                  }}
                  tabIndex={0}
                  style={{ cursor: onOpenTicket ? 'pointer' : 'default' }}
                >
                  <td className="mono">#{ticket.number}</td>
                  <td>{ticket.subject}</td>
                  <td>
                    <span className={`status-pill st-${ticket.status.toLowerCase()}`}>
                      {WORK_STATUS_LABELS[ticket.status] || ticket.status}
                    </span>
                    {ticket.is_archived && <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>Архив</div>}
                  </td>
                  <td>{ticket.assignee_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(ticket.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(ticket.resolution_deadline)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(ticket.completed_at)}</td>
                </tr>
              ))}
              {!loading && !error && tickets.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    По объекту нет доступных заявок
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div style={{ padding: '10px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
            Загрузка работ... {tickets.length > 0 ? `Получено: ${tickets.length}` : ''}
          </div>
        )}
        {error && <div className="modal-error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
        {!loading && !error && tickets.length > 0 && (
          <div style={{ paddingTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
            Всего работ: {tickets.length}
          </div>
        )}
      </div>
    </div>
  );
};

interface LocFormProps {
  onClose: () => void;
  onSaved: () => void;
  users: UserInfo[];
  customers: CustomerInfo[];
  loc?: Location;
}

const LocForm: React.FC<LocFormProps> = ({ onClose, onSaved, users, customers, loc }) => {
  const [name, setName] = useState(loc?.name || '');
  const [customerId, setCustomerId] = useState<string>(loc?.customer_id != null ? loc.customer_id.toString() : '');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [address, setAddress] = useState(loc?.address || '');
  const [contactName, setContactName] = useState(loc?.contact_name || '');
  const [contactPhone, setContactPhone] = useState(loc?.contact_phone || '');
  const [contactEmail, setContactEmail] = useState(loc?.contact_email || '');
  const [contactsList, setContactsList] = useState<ContactItem[]>(
    loc?.contacts_list?.length
      ? loc.contacts_list
      : (loc?.contact_name || loc?.contact_phone || loc?.contact_email
        ? [{ name: loc?.contact_name || '', phone: loc?.contact_phone || null, email: loc?.contact_email || null, position: null, is_primary: true }]
        : [])
  );
  const [engId, setEngId] = useState<string>(loc?.assigned_engineer_id != null ? loc.assigned_engineer_id.toString() : '');
  const [contractNo, setContractNo] = useState(loc?.contract_number || '');
  const [from, setFrom] = useState(loc?.contract_valid_from ? loc.contract_valid_from.substring(0, 10) : '');
  const [to, setTo] = useState(loc?.contract_valid_to ? loc.contract_valid_to.substring(0, 10) : '');
  const [inn, setInn] = useState(loc?.inn || '');
  const [innLoading, setInnLoading] = useState(false);
  const [innResult, setInnResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const engineers = users.filter(u => u.role === 'engineer');

  const handleInnLookup = async () => {
    const normalizedInn = inn.replace(/\D/g, '');
    if (normalizedInn !== inn) setInn(normalizedInn);
    if (!normalizedInn || (normalizedInn.length !== 10 && normalizedInn.length !== 12)) {
      setError('Введите корректный ИНН (10 или 12 цифр)');
      return;
    }
    setInnLoading(true);
    setError('');
    setInnResult(null);
    try {
      const { data } = await api.get('/locations/lookup-inn', { params: { inn: normalizedInn } });
      if (data.error) { setError(data.error); return; }
      const filled: string[] = [];
      if (data.short_name) {
        setName(data.short_name);
        filled.push('название (краткое)');
      } else if (data.name && !name) {
        setName(data.name);
        filled.push('название');
      }
      if (data.address) { setAddress(data.address); filled.push('адрес'); }
      if (data.phone) { setContactPhone(data.phone); filled.push('телефон'); }
      if (data.name && !customerId && !loc) {
        setNewCustomerName(data.name);
        filled.push('клиент');
      }
      const notFound = ['название', 'адрес', 'телефон'].filter(f => !filled.includes(f));
      setInnResult(
        `Заполнено: ${filled.join(', ')}.` +
        (notFound.length ? ` Не найдено: ${notFound.join(', ')}.` : '') +
        (data.name && data.name !== (data.short_name || data.name) ? ` Полное наименование: ${data.name}` : '')
      );
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка при поиске ИНН');
    } finally {
      setInnLoading(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) { setError('Название объекта обязательно'); return; }
    if (!loc && !customerId && !newCustomerName.trim()) {
      setError('Выберите клиента или введите название нового');
      return;
    }

    try {
      const body: any = {
        name: name.trim(),
        address: address.trim(),
        contacts: null,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
        contacts_list: contactsList.filter(c => c.name.trim()).map((c, i) => ({
          name: c.name.trim(),
          phone: c.phone?.trim() || null,
          email: c.email?.trim() || null,
          position: c.position?.trim() || null,
          is_primary: i === 0,
        })),
        assigned_engineer_id: engId ? Number(engId) : null,
        contract_number: contractNo.trim() || null,
        contract_valid_from: from || null,
        contract_valid_to: to || null,
        inn: inn.trim() || null,
      };

      if (customerId) {
        body.customer_id = Number(customerId);
      } else if (!loc && newCustomerName.trim()) {
        body.customer_name = newCustomerName.trim();
      }

      if (loc) {
        await api.patch(`/locations/${loc.id}`, body);
      } else {
        await api.post('/locations', body);
      }
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Произошла ошибка при сохранении');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflow: 'auto' }}>
        <h3>{loc ? 'Редактировать' : 'Добавить'} объект</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6, marginBottom: 14 }}>{error}</p>}
        {innResult && <p style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--primary-bg)', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>{innResult}</p>}

        <div className="modal-form-grid">
          <div className="span-2">
            <label>Клиент <span className="required">*</span></label>
            <select value={customerId || (newCustomerName ? '__new__' : '')} onChange={e => {
              const v = e.target.value;
              if (v === '__new__') return;
              setCustomerId(v);
              setNewCustomerName('');
            }}>
              <option value="">— Выберите —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              {!loc && <option value="__new__">+ Создать нового клиента</option>}
            </select>
            {(!customerId && !loc) && (
              <input
                placeholder="Название нового клиента"
                value={newCustomerName}
                onChange={e => setNewCustomerName(e.target.value)}
                style={{ marginTop: 6 }}
              />
            )}
          </div>

          <div className="span-2">
            <label>Название объекта <span className="required">*</span></label>
            <input placeholder="Введите название (например, Магазин №5)" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="span-2">
            <label>Адрес</label>
            <input placeholder="Город, улица, дом..." value={address} onChange={e => setAddress(e.target.value)} />
          </div>

          <div className="span-2">
            <label>ИНН контрагента</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="10 или 12 цифр" value={inn} onChange={e => setInn(e.target.value)} maxLength={12} style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={handleInnLookup} disabled={innLoading} type="button" style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                {innLoading ? 'Поиск...' : 'Заполнить по ИНН'}
              </button>
            </div>
          </div>

          <div className="span-2">
            <label>Контактное лицо (ФИО)</label>
            <input placeholder="Иванов Иван Иванович" value={contactName} onChange={e => setContactName(e.target.value)} />
          </div>

          <div>
            <label>Телефон</label>
            <input type="tel" placeholder="+7 (___) ___-__-__" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
          </div>

          <div>
            <label>Email</label>
            <input type="email" placeholder="contact@domain.ru" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
          </div>

          <div className="span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 600 }}>Контактные лица</label>
              <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => setContactsList(prev => [...prev, { name: '', phone: null, email: null, position: null, is_primary: false }])}>
                + Добавить
              </button>
            </div>
            {contactsList.map((c, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'end' }}>
                <div>
                  {idx === 0 && <label style={{ fontSize: 10 }}>ФИО</label>}
                  <input placeholder="ФИО" value={c.name} onChange={e => {
                    const v = [...contactsList]; v[idx] = { ...v[idx], name: e.target.value }; setContactsList(v);
                  }} style={{ fontSize: 12 }} />
                </div>
                <div>
                  {idx === 0 && <label style={{ fontSize: 10 }}>Телефон</label>}
                  <input placeholder="Телефон" value={c.phone || ''} onChange={e => {
                    const v = [...contactsList]; v[idx] = { ...v[idx], phone: e.target.value || null }; setContactsList(v);
                  }} style={{ fontSize: 12 }} />
                </div>
                <div>
                  {idx === 0 && <label style={{ fontSize: 10 }}>Email</label>}
                  <input placeholder="Email" value={c.email || ''} onChange={e => {
                    const v = [...contactsList]; v[idx] = { ...v[idx], email: e.target.value || null }; setContactsList(v);
                  }} style={{ fontSize: 12 }} />
                </div>
                <button type="button" className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, marginBottom: 1 }}
                  onClick={() => setContactsList(prev => prev.filter((_, i) => i !== idx))}>✕</button>
              </div>
            ))}
          </div>

          <div className="span-2">
            <label>Ответственный инженер</label>
            <select value={engId} onChange={e => setEngId(e.target.value)}>
              <option value="">— Не назначен —</option>
              {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="span-2">
            <label>Договор</label>
            <input placeholder="Номер договора" value={contractNo} onChange={e => setContractNo(e.target.value)} />
          </div>

          <div>
            <label>Срок действия с</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>

          <div>
            <label>Срок действия до</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" onClick={submit}> {loc ? 'Сохранить' : 'Добавить'} </button>
          <button className="btn btn-secondary" onClick={onClose} type="button">Отмена</button>
        </div>
      </div>
    </div>
  );
};
