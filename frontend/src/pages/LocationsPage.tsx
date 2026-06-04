import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Location {
  id: number; name: string; address: string; customer_id: number; customer_name: string;
  contacts: string | null; assigned_engineer_id: number | null; assigned_engineer_name: string | null;
  contract_number: string | null; contract_valid_from: string | null; contract_valid_to: string | null;
}
interface UserInfo { id: number; email: string; name: string; role: string; }

export const LocationsPage: React.FC = () => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const load = () => {
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
    api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Объекты обслуживания</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Добавить объект</button>
      </div>
      <div className="table-wrapper">
        <table>
          <thead><tr>
            <th>ID</th><th>Название</th><th>Адрес</th><th>Контакты</th>
            <th>Инженер</th><th>Договор</th><th>Срок</th><th></th>
          </tr></thead>
          <tbody>
            {locations.map(l => (
              <tr key={l.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{l.id}</td>
                <td style={{ fontWeight: 600 }}>{l.name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{l.address}</td>
                <td>{l.contacts || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td>{l.assigned_engineer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{l.contract_number || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td style={{ fontSize: 11 }}>
                  {l.contract_valid_from && <span>с {l.contract_valid_from.slice(0, 10)}</span>}
                  {l.contract_valid_to && <span> до {l.contract_valid_to.slice(0, 10)}</span>}
                  {!l.contract_valid_from && !l.contract_valid_to && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  <button onClick={() => setEditId(l.id)} className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}>✎</button>
                </td>
              </tr>
            ))}
            {locations.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Нет объектов</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {showAdd && <LocForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} users={users} />}
      {editId && <LocForm onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} users={users} loc={locations.find(l => l.id === editId)} />}
    </div>
  );
};

const LocForm: React.FC<{ onClose: () => void; onSaved: () => void; users: UserInfo[]; loc?: Location }> = ({ onClose, onSaved, users, loc }) => {
  const [name, setName] = useState(loc?.name || '');
  const [address, setAddress] = useState(loc?.address || '');
  const [contacts, setContacts] = useState(loc?.contacts || '');
  const [engId, setEngId] = useState<string>(loc?.assigned_engineer_id?.toString() || '');
  const [contractNo, setContractNo] = useState(loc?.contract_number || '');
  const [from, setFrom] = useState(loc?.contract_valid_from || '');
  const [to, setTo] = useState(loc?.contract_valid_to || '');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name) { setError('Название обязательно'); return; }
    try {
      const body: any = { name, address, contacts, assigned_engineer_id: engId ? Number(engId) : null, contract_number: contractNo, contract_valid_from: from || null, contract_valid_to: to || null };
      if (loc) await api.patch(`/locations/${loc.id}`, body);
      else await api.post('/locations', body);
      onSaved();
    } catch (e: any) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflow: 'auto' }}>
        <h3>{loc ? 'Редактировать' : 'Добавить'} объект</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
        <label>Название *</label>
        <input placeholder="Введите название" value={name} onChange={e => setName(e.target.value)} />
        <label>Адрес</label>
        <input placeholder="Введите адрес" value={address} onChange={e => setAddress(e.target.value)} />
        <label>Контакты (тел, email)</label>
        <input placeholder="Введите контакты" value={contacts} onChange={e => setContacts(e.target.value)} />
        <label>Ответственный инженер</label>
        <select value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">— Не назначен —</option>
          {users.filter(u => u.role === 'engineer' || u.role === 'admin').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label>Договор</label>
        <input placeholder="Номер договора" value={contractNo} onChange={e => setContractNo(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="с" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="до" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>{loc ? 'Сохранить' : 'Добавить'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};
