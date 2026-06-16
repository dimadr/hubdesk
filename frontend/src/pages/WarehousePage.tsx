import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Warehouse { id: number; name: string; type: string; }
interface NomenclatureItem { id: number; name: string; type: string; unit: string; }
interface DocLine { id: number; nomenclature_id: number; quantity: number; }
interface Doc { id: number; doc_type: string; status: string; source_warehouse_id: number | null; target_warehouse_id: number | null; created_at: string; lines: DocLine[]; }
interface Balance { warehouse_id: number; nomenclature_id: number; quantity: number; }

const DOC_TYPES = { INFLOW: 'Приход', TRANSFER: 'Перемещение', WRITE_OFF: 'Списание' };
const DOC_STATUS: Record<string, string> = { DRAFT: 'Черновик', APPROVAL: 'Согласование', DELIVERY: 'Доставка', ACCOUNTED: 'Учтён' };
const WAREHOUSE_TYPES: Record<string, string> = { physical: 'Физический', personal: 'Персональный' };
const NOM_TYPES: Record<string, string> = { material: 'Материал', product: 'Продукт', service: 'Услуга', work: 'Работа' };

export const WarehousePage: React.FC = () => {
  const [tab, setTab] = useState<'warehouses' | 'nomenclature' | 'docs' | 'balances' | 'replacement' | 'insert'>('docs');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [nomenclatures, setNomen] = useState<NomenclatureItem[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingWh, setEditingWh] = useState<number | null>(null);
  const [editWhName, setEditWhName] = useState('');
  const [newWhName, setNewWhName] = useState('');
  const [balWhFilter, setBalWhFilter] = useState<number | ''>('');
  const [balSearch, setBalSearch] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [w, n, d, b] = await Promise.all([
        api.get('/warehouses'),
        api.get('/nomenclature'),
        api.get('/warehouse-documents'),
        api.get('/balances'),
      ]);
      setWarehouses(w.data); setNomen(n.data); setDocs(d.data); setBalances(b.data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const nomName = (id: number) => nomenclatures.find(n => n.id === id)?.name || `#${id}`;
  const whName = (id: number | null) => id ? warehouses.find(w => w.id === id)?.name || `#${id}` : '—';

  const doAction = async (docId: number, action: string) => {
    await api.patch(`/warehouse-documents/${docId}/${action}`);
    loadAll();
  };

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 16, display: 'inline-flex' }}>
        {(['docs', 'warehouses', 'nomenclature', 'balances', 'replacement', 'insert'] as const).map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'docs' ? 'Документы' : t === 'warehouses' ? 'Склады' : t === 'nomenclature' ? 'Номенклатура' : t === 'replacement' ? 'Подменный фонд' : t === 'insert' ? 'Склад вставок' : 'Остатки'}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Загрузка...</div>}

      {tab === 'docs' && (
        <DocumentsTab docs={docs} warehouses={warehouses} nomenclatures={nomenclatures} nomName={nomName} whName={whName} doAction={doAction} onRefresh={loadAll} />
      )}
      {tab === 'warehouses' && (
        <div>
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Склады</h2>
          </div>
          <div className="table-wrapper">
            <table><thead><tr><th>ID</th><th>Название</th><th>Тип</th><th></th></tr></thead>
              <tbody>
                {warehouses.map(w => (
                  <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => { setBalWhFilter(w.id); setTab('balances'); }}>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>#{w.id}</td>
                    <td style={{ fontWeight: 600 }}>
                      {editingWh === w.id
                        ? <input value={editWhName} onChange={e => setEditWhName(e.target.value)} onClick={e => e.stopPropagation()} style={{ padding: '2px 6px', width: '80%' }} />
                        : w.name}
                    </td>
                    <td><span className="status-pill" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>{WAREHOUSE_TYPES[w.type] || w.type}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      {editingWh === w.id ? (
                        <>
                          <button className="btn btn-success" style={{ padding: '2px 6px', fontSize: 10 }} onClick={async () => { try { await api.patch(`/warehouses/${w.id}`, { name: editWhName }); setEditingWh(null); loadAll(); } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка'); } }}>✓</button>
                          <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4 }} onClick={() => setEditingWh(null)}>✕</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => { setEditingWh(w.id); setEditWhName(w.name); }}>✎</button>
                          <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4 }} onClick={async () => { try { await api.delete(`/warehouses/${w.id}`); loadAll(); } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка'); } }}>✕</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <input placeholder="Название нового склада" value={newWhName} onChange={e => setNewWhName(e.target.value)} style={{ padding: '4px 8px', fontSize: 12, width: '100%' }} />
                  </td>
                  <td colSpan={2}>
                    <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={async () => { if (!newWhName.trim()) return; try { await api.post('/warehouses', { name: newWhName, type: 'physical' }); setNewWhName(''); loadAll(); } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка'); } }}>+ Добавить</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'nomenclature' && (
        <div className="table-wrapper">
          <table><thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Ед. изм.</th></tr></thead>
            <tbody>{nomenclatures.map(n => (<tr key={n.id}><td className="mono" style={{ color: 'var(--text-muted)' }}>#{n.id}</td><td style={{fontWeight:600}}>{n.name}</td><td><span className="status-pill" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>{NOM_TYPES[n.type] || n.type}</span></td><td className="mono">{n.unit}</td></tr>))}</tbody>
          </table>
        </div>
      )}
      {tab === 'balances' && (
        <div>
          <div className="page-header" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Остатки</h2>
            <select value={balWhFilter} onChange={e => setBalWhFilter(e.target.value ? Number(e.target.value) : '')}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12 }}>
              <option value="">— Все склады —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input type="text" placeholder="Поиск по названию..." value={balSearch} onChange={e => setBalSearch(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12, width: 180 }} />
            <span className="text-muted" style={{ fontSize: 12 }}>
              {balances.filter(b => (!balWhFilter || b.warehouse_id === balWhFilter) && (!balSearch || nomName(b.nomenclature_id).toLowerCase().includes(balSearch.toLowerCase()))).length} позиций
            </span>
          </div>
          <div className="table-wrapper">
            <table><thead><tr><th>Склад</th><th>Номенклатура</th><th>Количество</th></tr></thead>
              <tbody>
                {balances
                  .filter(b => (!balWhFilter || b.warehouse_id === balWhFilter) && (!balSearch || nomName(b.nomenclature_id).toLowerCase().includes(balSearch.toLowerCase())))
                  .map((b, i) => (<tr key={i}><td>{whName(b.warehouse_id)}</td><td>{nomName(b.nomenclature_id)}</td><td className="mono" style={{fontWeight:600}}>{b.quantity}</td></tr>))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'replacement' && <ReplacementTab />}
      {tab === 'insert' && <InsertTab />}
    </div>
  );
};

const ReplacementTab: React.FC = () => {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', verification_date: '', verification_interval_months: '', verification_expiry: '', taken_by_id: '', location_id: '', return_date: '', passport_scan: '' });
  const [users, setUsers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/replacement-devices'),
      api.get('/users/list'),
      api.get('/locations'),
    ]).then(([d, u, l]) => {
      setDevices(d.data); setUsers(u.data); setLocations(l.data); setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openForm = (d?: any) => {
    if (d) { setEditId(d.id); setForm({ name: d.name, verification_date: d.verification_date || '', verification_expiry: d.verification_expiry || '', verification_interval_months: d.verification_interval_months?.toString() || '', taken_by_id: d.taken_by_id?.toString() || '', location_id: d.location_id?.toString() || '', return_date: d.return_date || '', passport_scan: d.passport_scan || '' }); }
    else { setEditId(null); setForm({ name: '', verification_date: '', verification_expiry: '', verification_interval_months: '', taken_by_id: '', location_id: '', return_date: '', passport_scan: '' }); }
    setShowForm(true); setError('');
  };

  const submit = async () => {
    if (!form.name.trim()) { setError('Название обязательно'); return; }
    try {
      const expiry = form.verification_date && form.verification_interval_months
        ? new Date(new Date(form.verification_date).setMonth(new Date(form.verification_date).getMonth() + Number(form.verification_interval_months))).toISOString().slice(0, 10)
        : form.verification_expiry || null;
      const body: any = { name: form.name, verification_date: form.verification_date || null, verification_interval_months: form.verification_interval_months ? Number(form.verification_interval_months) : null, verification_expiry: expiry, taken_by_id: form.taken_by_id ? Number(form.taken_by_id) : null, location_id: form.location_id ? Number(form.location_id) : null, return_date: form.return_date || null, passport_scan: form.passport_scan || null };
      if (editId) await api.patch(`/replacement-devices/${editId}`, body);
      else await api.post('/replacement-devices', body);
      setShowForm(false); load();
    } catch (e: any) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  const remove = async (id: number) => { if (!confirm('Удалить?')) return; try { await api.delete(`/replacement-devices/${id}`); load(); } catch {} };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <div className="page-header"><h2>Подменный фонд</h2><button className="btn btn-primary" onClick={() => openForm()}>+ Добавить прибор</button></div>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>Название</th><th>Дата поверки</th><th>Интервал</th><th>Поверка до</th><th>Кто взял</th><th>Объект</th><th>Возврат</th><th></th></tr></thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.verification_date ? new Date(d.verification_date).toLocaleDateString('ru-RU') : '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{d.verification_interval_months ? `${d.verification_interval_months} мес` : '—'}</td>
                <td style={{ fontSize: 12, color: d.verification_expiry && new Date(d.verification_expiry) < new Date() ? 'var(--danger)' : 'var(--text-secondary)' }}>{d.verification_expiry ? new Date(d.verification_expiry).toLocaleDateString('ru-RU') : '—'}</td>
                <td>{d.taken_by_name || '—'}</td>
                <td style={{ fontSize: 12 }}>{d.location_name || '—'}</td>
                <td style={{ fontSize: 12 }}>{d.return_date ? new Date(d.return_date).toLocaleDateString('ru-RU') : '—'}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => openForm(d)} style={{ padding: '3px 8px', fontSize: 10 }}>✎</button>
                  <button className="btn btn-danger" onClick={() => remove(d.id)} style={{ padding: '3px 8px', fontSize: 10, marginLeft: 4 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{editId ? 'Редактировать' : 'Добавить'} прибор</h3>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
            <label>Название прибора *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Манометр МП-160" />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><label>Дата поверки</label><input type="date" value={form.verification_date} onChange={e => setForm({ ...form, verification_date: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Межповерочный интервал (мес)</label><input type="number" value={form.verification_interval_months} onChange={e => setForm({ ...form, verification_interval_months: e.target.value })} placeholder="12" /></div>
            </div>
            {form.verification_date && form.verification_interval_months && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>
                Поверка до: {new Date(new Date(form.verification_date).setMonth(new Date(form.verification_date).getMonth() + Number(form.verification_interval_months))).toLocaleDateString('ru-RU')}
              </p>
            )}
            {form.verification_expiry && !form.verification_date && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>
                Поверка до: {new Date(form.verification_expiry).toLocaleDateString('ru-RU')}
              </p>
            )}
            <label>ФИО кто взял прибор</label>
            <select value={form.taken_by_id} onChange={e => setForm({ ...form, taken_by_id: e.target.value })}><option value="">— На складе —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <label>На какой объект взят прибор</label>
            <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}><option value="">— Не выбран —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.customer_name})</option>)}</select>
            <label>Примерная дата возврата</label>
            <input type="date" value={form.return_date} onChange={e => setForm({ ...form, return_date: e.target.value })} />
            <label>Фото/скан паспорта (ссылка)</label>
            <input value={form.passport_scan} onChange={e => setForm({ ...form, passport_scan: e.target.value })} placeholder="https://..." />
            <div className="modal-actions"><button className="btn btn-primary" onClick={submit}>{editId ? 'Сохранить' : 'Добавить'}</button><button className="btn btn-secondary" onClick={() => setShowForm(false)}>Отмена</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const DocumentsTab: React.FC<{
  docs: Doc[]; warehouses: Warehouse[]; nomenclatures: NomenclatureItem[];
  nomName: (id: number) => string; whName: (id: number | null) => string;
  doAction: (id: number, action: string) => void; onRefresh: () => void;
}> = ({ docs, warehouses, nomenclatures, nomName, whName, doAction, onRefresh }) => {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="page-header">
        <h2>Складские документы</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Новый документ</button>
      </div>
      <div className="table-wrapper">
        <table><thead><tr><th>ID</th><th>Тип</th><th>Статус</th><th>Откуда</th><th>Куда</th><th>Строк</th><th>Действия</th></tr></thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id}>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>#{d.id}</td>
                <td>{DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES] || d.doc_type}</td>
                <td><DocStatusBadge status={d.status} /></td>
                <td style={{ color: 'var(--text-secondary)' }}>{whName(d.source_warehouse_id)}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{whName(d.target_warehouse_id)}</td>
                <td className="mono">{d.lines?.length || 0}</td>
                <td>
                  {d.status === 'DRAFT' && <button className="btn btn-secondary" onClick={() => doAction(d.id, 'approve')} style={{ padding: '4px 10px', fontSize: 11 }}>Согласовать</button>}
                  {d.status === 'APPROVAL' && <button className="btn btn-secondary" onClick={() => doAction(d.id, 'deliver')} style={{ padding: '4px 10px', fontSize: 11 }}>Доставить</button>}
                  {d.status === 'DELIVERY' && <button className="btn btn-success" onClick={() => doAction(d.id, 'account')} style={{ padding: '4px 10px', fontSize: 11 }}>Учесть</button>}
                  {d.status === 'ACCOUNTED' && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>✓ Учтён</span>}
                </td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Нет документов</td></tr>}
          </tbody>
        </table>
      </div>
      {showCreate && <CreateDocModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onRefresh(); }} warehouses={warehouses} nomenclatures={nomenclatures} />}
    </div>
  );
};

const DocStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cssMap: Record<string, string> = {
    DRAFT: 'st-on_the_way',
    APPROVAL: 'st-review',
    DELIVERY: 'st-in_progress',
    ACCOUNTED: 'st-completed',
  };
  return <span className={`status-pill ${cssMap[status] || ''}`}>{DOC_STATUS[status] || status}</span>;
};

const CreateDocModal: React.FC<{
  onClose: () => void; onCreated: () => void; warehouses: Warehouse[]; nomenclatures: NomenclatureItem[];
}> = ({ onClose, onCreated, warehouses, nomenclatures }) => {
  const [docType, setDocType] = useState('INFLOW');
  const [sourceId, setSourceId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [lines, setLines] = useState<{ nomId: string; qty: string }[]>([{ nomId: '', qty: '1' }]);
  const [error, setError] = useState('');

  const addLine = () => setLines([...lines, { nomId: '', qty: '1' }]);

  const submit = async () => {
    setError('');
    try {
      await api.post('/warehouse-documents', {
        doc_type: docType,
        source_warehouse_id: sourceId ? Number(sourceId) : null,
        target_warehouse_id: targetId ? Number(targetId) : null,
        lines: lines.filter(l => l.nomId).map(l => ({ nomenclature_id: Number(l.nomId), quantity: Number(l.qty) || 1 })),
      });
      onCreated();
    } catch (e: any) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflow: 'auto' }}>
        <h3>Новый складской документ</h3>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
        <label>Тип документа</label>
        <select value={docType} onChange={e => setDocType(e.target.value)}>
          <option value="INFLOW">Приход</option>
          <option value="TRANSFER">Перемещение</option>
          <option value="WRITE_OFF">Списание</option>
        </select>
        {(docType === 'TRANSFER' || docType === 'WRITE_OFF') && (
          <>
            <label>Откуда</label>
            <select value={sourceId} onChange={e => setSourceId(e.target.value)}>
              <option value="">— Выберите склад —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}
        {(docType === 'INFLOW' || docType === 'TRANSFER') && (
          <>
            <label>Куда</label>
            <select value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">— Выберите склад —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}
        <label>Позиции</label>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <select value={l.nomId} onChange={e => { const copy = [...lines]; copy[i].nomId = e.target.value; setLines(copy); }} style={{ flex: 2 }}>
              <option value="">— Номенклатура —</option>
              {nomenclatures.map(n => <option key={n.id} value={n.id}>{n.name} ({n.unit})</option>)}
            </select>
            <input value={l.qty} onChange={e => { const copy = [...lines]; copy[i].qty = e.target.value; setLines(copy); }} style={{ width: 70 }} placeholder="Кол-во" type="number" min="1" />
          </div>
        ))}
        <button className="btn btn-secondary" onClick={addLine} style={{ padding: '5px 12px', fontSize: 12, marginBottom: 8 }}>+ Строка</button>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>Создать</button>
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
};

const InsertTab: React.FC = () => {
  const [tab, setTab] = useState<'catalog' | 'journal' | 'balance' | 'documents'>('catalog');
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', diameter: '', length: '', flange_type: '', quantity: '1', type: 'incoming', product_id: '', taken_by_id: '', location_id: '', comment: '', document: '' });
  const [error, setError] = useState('');
  const [quick, setQuick] = useState<{ prodId: number; action: string; qty: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/insert/products').catch(() => ({ data: [] })),
      api.get('/insert/transactions').catch(() => ({ data: [] })),
    ]).then(([p, t]) => { setProducts(p.data); setTransactions(t.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/users/list').then(r => setUsers(r.data)).catch(() => {});
    api.get('/locations').then(r => setLocations(r.data)).catch(() => {});
  }, []);

  const prodName = (id: number) => products.find(p => p.id === id)?.name || `#${id}`;

  const openProductForm = (p?: any) => {
    if (p) { setEditId(p.id); setForm({ ...form, name: p.name, diameter: p.diameter || '', length: p.length || '', flange_type: p.flange_type || '' }); }
    else { setEditId(null); setForm({ name: '', diameter: '', length: '', flange_type: '', quantity: '1', type: 'incoming', product_id: '', taken_by_id: '', location_id: '', comment: '', document: '' }); }
    setShowForm(true); setError('');
  };

  const openTxForm = () => {
    const now = new Date();
    const doc = `ДОК-${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    setEditId(null); setForm({ name: '', diameter: '', length: '', flange_type: '', type: 'outgoing', quantity: '1', product_id: '', taken_by_id: '', location_id: '', comment: '', document: doc });
    setShowForm(true); setError('');
  };

  const submit = async () => {
    try {
      if (tab === 'catalog') {
        if (!form.name.trim()) { setError('Название обязательно'); return; }
        const body = { name: form.name, diameter: form.diameter || null, length: form.length || null, flange_type: form.flange_type || null };
        let prodId = editId;
        if (editId) {
          await api.patch(`/insert/products/${editId}`, body);
        } else {
          const existing = products.find(p => p.name.toLowerCase() === form.name.trim().toLowerCase());
          if (existing) {
            prodId = existing.id;
          } else {
            const resp = await api.post('/insert/products', body);
            prodId = resp.data.id;
          }
        }
        const qty = parseInt(form.quantity);
        if (qty > 0) {
          await api.post('/insert/transactions', { type: 'incoming', product_id: prodId, quantity: qty });
        }
      } else {
        if (!form.product_id || !form.quantity) { setError('Выберите продукт и укажите количество'); return; }
        await api.post('/insert/transactions', {
          type: form.type, product_id: Number(form.product_id), quantity: Number(form.quantity),
          taken_by_id: form.taken_by_id ? Number(form.taken_by_id) : null,
          location_id: form.location_id ? Number(form.location_id) : null,
          comment: form.comment || null, document: form.document || null,
        });
      }
      setShowForm(false); load();
    } catch (e: any) { setError(e.response?.data?.detail || e.message || 'Ошибка'); }
  };

  const delProduct = async (id: number) => { if (!confirm('Удалить продукт и все его транзакции?')) return; try { await api.delete(`/insert/products/${id}`); load(); } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка удаления'); } };
  const delTx = async (id: number) => { if (!confirm('Удалить транзакцию?')) return; try { await api.delete(`/insert/transactions/${id}`); load(); } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка удаления'); } };

  if (loading) return <div className="loading">Загрузка...</div>;

  const txLabels: Record<string, string> = { incoming: 'Приход', outgoing: 'Выдача', return: 'Возврат' };
  const txColors: Record<string, string> = { incoming: 'var(--success)', outgoing: 'var(--warning)', return: 'var(--info)' };

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 12, display: 'inline-flex' }}>
        {(['catalog', 'journal', 'documents', 'balance'] as const).map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'catalog' ? 'Каталог' : t === 'journal' ? 'Движения' : t === 'documents' ? 'Документы' : 'Остатки'}
          </button>
        ))}
      </div>
      <div className="page-header" style={{ marginTop: 0 }}>
        {tab === 'catalog' && <button className="btn btn-primary" onClick={() => { setTab('catalog'); openProductForm(undefined); }}>+ Продукт</button>}
        {tab === 'journal' && <button className="btn btn-primary" onClick={() => openTxForm()}>+ Операция</button>}
        {tab === 'balance' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Баланс рассчитывается из транзакций</span>}
      </div>

        {tab === 'catalog' && (
        <div>
          <div className="table-wrapper">
          <table><thead><tr><th>Название</th><th>Диаметр</th><th>Длина</th><th>Фланец</th><th>Остаток</th><th></th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.diameter || '—'}</td>
                  <td>{p.length || '—'}</td>
                  <td>{p.flange_type || '—'}</td>
                  <td className="mono" style={{ fontWeight: 700, color: p.balance > 0 ? 'var(--success)' : p.balance < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{p.balance}</td>
                  <td>
                    <button className="btn btn-success" onClick={() => setQuick({ prodId: p.id, action: 'incoming', qty: '1' })} style={{ padding: '2px 6px', fontSize: 11, marginRight: 2 }} title="Приход">+</button>
                    <button className="btn btn-secondary" onClick={() => setQuick({ prodId: p.id, action: 'outgoing', qty: '1' })} style={{ padding: '2px 6px', fontSize: 11, marginRight: 2 }} title="Выдача">−</button>
                    <button className="btn btn-secondary" onClick={() => openProductForm(p)} style={{ padding: '2px 6px', fontSize: 11 }}>✎</button>
                    <button className="btn btn-danger" onClick={() => delProduct(p.id)} style={{ padding: '2px 6px', fontSize: 11, marginLeft: 2 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {quick && (
          <div className="modal-overlay" onClick={() => setQuick(null)}>
            <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 320 }}>
              <h3>{quick.action === 'incoming' ? 'Приход' : 'Выдача'}</h3>
              <label>Количество</label>
              <input type="number" value={quick.qty} onChange={e => setQuick({ ...quick, qty: e.target.value })} min="1" step="1" autoFocus />
              {quick.action === 'outgoing' && (
                <>
                  <label>Кто взял</label>
                  <select value={form.taken_by_id} onChange={e => setForm({ ...form, taken_by_id: e.target.value })}>
                    <option value="">— Выберите —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </>
              )}
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={async () => {
                  const qty = parseInt(quick.qty);
                  if (!qty || qty < 1) return;
                  try {
                    await api.post('/insert/transactions', {
                      type: quick.action, product_id: quick.prodId, quantity: qty,
                      taken_by_id: quick.action === 'outgoing' ? (form.taken_by_id ? Number(form.taken_by_id) : null) : null,
                    });
                    setQuick(null);
                    load();
                  } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка'); }
                }}>OK</button>
                <button className="btn btn-secondary" onClick={() => setQuick(null)}>Отмена</button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}

      {tab === 'journal' && (
        <div className="table-wrapper">
          <table><thead><tr><th>Дата</th><th>Тип</th><th>Продукт</th><th>Кол-во</th><th>Кто</th><th>Куда</th><th></th></tr></thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                  <td><span className="status-pill" style={{ background: `${txColors[t.type]}18`, color: txColors[t.type] }}>{txLabels[t.type] || t.type}</span></td>
                  <td>{t.product_name}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{t.quantity}</td>
                  <td>{t.taken_by_name || '—'}</td>
                  <td>{t.location_name || '—'}</td>
                  <td><button className="btn btn-danger" onClick={() => delTx(t.id)} style={{ padding: '3px 8px', fontSize: 10 }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'documents' && (() => {
        const docs = transactions.reduce((acc: Record<string, any[]>, t: any) => {
          const key = t.document || 'Без документа';
          if (!acc[key]) acc[key] = [];
          acc[key].push(t);
          return acc;
        }, {});
        const docList = Object.entries(docs).sort(([a], [b]) => b.localeCompare(a));
        return (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Документ</th><th>Операций</th><th>Приход</th><th>Выдача</th><th>Возврат</th><th>Дата</th></tr></thead>
              <tbody>
                {docList.map(([doc, txs]) => {
                  const incoming = txs.filter((t: any) => t.type === 'incoming').reduce((s: number, t: any) => s + t.quantity, 0);
                  const outgoing = txs.filter((t: any) => t.type === 'outgoing').reduce((s: number, t: any) => s + t.quantity, 0);
                  const returns = txs.filter((t: any) => t.type === 'return').reduce((s: number, t: any) => s + t.quantity, 0);
                  const lastDate = txs[txs.length - 1].created_at;
                  return (
                    <tr key={doc}>
                      <td style={{ fontWeight: 600 }}>{doc}</td>
                      <td className="mono">{txs.length}</td>
                      <td className="mono" style={{ color: 'var(--success)' }}>{incoming || '—'}</td>
                      <td className="mono" style={{ color: 'var(--warning)' }}>{outgoing || '—'}</td>
                      <td className="mono" style={{ color: 'var(--info)' }}>{returns || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(lastDate).toLocaleDateString('ru-RU')}</td>
                    </tr>
                  );
                })}
                {docList.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Нет документов</td></tr>}
              </tbody>
            </table>
          </div>
        );
      })()}

      {tab === 'balance' && (
        <div className="table-wrapper">
          <table><thead><tr><th>Продукт</th><th>Выдано</th><th>Остаток</th></tr></thead>
            <tbody>
              {products.map(p => {
                const out = transactions.filter(t => t.product_id === p.id && t.type === 'outgoing').reduce((s, t) => s + t.quantity, 0);
                const bal = p.balance;
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="mono" style={{ color: out > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{out || 0}</td>
                    <td className="mono" style={{ fontWeight: 700, color: bal > 0 ? 'var(--success)' : bal < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{bal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{tab === 'catalog' ? (editId ? 'Редактировать' : 'Новый') : 'Новая операция'}</h3>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{error}</p>}
            {tab === 'catalog' ? (
              <>
                <label>Название *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Вставка 50 мм" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}><label>Диаметр</label><input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} /></div>
                  <div style={{ flex: 1 }}><label>Длина</label><input value={form.length} onChange={e => setForm({ ...form, length: e.target.value })} /></div>
                </div>
                <label>Тип</label>
                <select value={form.flange_type} onChange={e => setForm({ ...form, flange_type: e.target.value })}><option value="">—</option><option value="Фланцевый">Фланцевый</option><option value="Сэндвич">Сэндвич</option></select>
                <label>Начальное количество</label>
                <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} min="0" step="1" placeholder="0" />
              </>
            ) : (
              <>
                <label>Тип операции</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="incoming">Приход</option><option value="outgoing">Выдача</option><option value="return">Возврат</option>
                </select>
                <label>Продукт</label>
                <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })}>
                  <option value="">— Выберите —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (остаток: {p.balance})</option>)}
                </select>
                <label>Количество</label>
                <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} min="1" step="1" />
                {form.type !== 'incoming' && (
                  <>
                    <label>Кто взял</label>
                    <select value={form.taken_by_id} onChange={e => setForm({ ...form, taken_by_id: e.target.value })}>
                      <option value="">— Не выбран —</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <label>Объект</label>
                     <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
                       <option value="">— Не выбран —</option>
                       {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.customer_name})</option>)}
                      </select>
                  </>
                )}
                <label>Комментарий</label>
                <textarea value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} rows={2} placeholder="Дополнительная информация" style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
                <label>Документ</label>
                <input value={form.document} onChange={e => setForm({ ...form, document: e.target.value })} placeholder="Накладная / Заявка #..." />
              </>
            )}
            <div className="modal-actions"><button className="btn btn-primary" onClick={submit}>{editId ? 'Сохранить' : 'Создать'}</button><button className="btn btn-secondary" onClick={() => setShowForm(false)}>Отмена</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
