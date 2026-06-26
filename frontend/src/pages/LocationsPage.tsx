import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

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
  inn: string | null;
}

interface UserInfo { id: number; email: string; name: string; role: string; }
interface CustomerInfo { id: number; name: string; }

export const LocationsPage: React.FC = () => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

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
      api.get('/users/list'),
      api.get('/admin/customers'),
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

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2>Объекты обслуживания</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Добавить объект</button>
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Название</th><th>Клиент</th><th>Адрес</th><th>ИНН</th><th>Контакты</th>
              <th>Инженер</th><th>Договор</th><th>Срок</th><th></th>
            </tr>
          </thead>
          <tbody>
            {locations.map(l => {
              const contactStr = [l.contact_name, l.contact_phone, l.contact_email].filter(Boolean).join(' / ') || l.contacts;
              return (
                <tr key={l.id}>
                  <td className="mono" style={{ color: 'var(--text-muted)' }}>#{l.id}</td>
                  <td style={{ fontWeight: 600 }}>{l.name}</td>
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
                  </td>
                </tr>
              );
            })}
            {locations.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Нет объектов</td></tr>
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
        assigned_engineer_id: engId ? Number(engId) : null,
        contract_number: contractNo.trim() || null,
        contract_valid_from: from || null,
        contract_valid_to: to || null,
        inn: inn.trim() || null,
      };

      if (customerId) {
        body.customer_id = Number(customerId);
      } else if (loc) {
        body.customer_id = null;  // редактирование: не менять клиента
      } else if (newCustomerName.trim()) {
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
