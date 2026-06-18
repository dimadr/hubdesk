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
  const [nomenclature, setNomenclature] = useState<NomenclatureItem[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);

  const [showWhModal, setShowWhModal] = useState(false);
  const [whForm, setWhForm] = useState({ id: null as number | null, name: '', type: 'physical' });

  const [showNomModal, setShowNomModal] = useState(false);
  const [nomForm, setNomForm] = useState({ id: null as number | null, name: '', type: 'material', unit: 'шт' });

  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({
    doc_type: 'INFLOW',
    source_warehouse_id: '',
    target_warehouse_id: '',
    lines: [{ nomenclature_id: '', quantity: 1 }]
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [whRes, nomRes, docRes, balRes] = await Promise.all([
        api.get('/warehouses'),
        api.get('/nomenclature'),
        api.get('/warehouse-documents'),
        api.get('/balances')
      ]);
      setWarehouses(whRes.data);
      setNomenclature(nomRes.data);
      setDocs(docRes.data);
      setBalances(balRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveWarehouse = async () => {
    if (!whForm.name) return;
    try {
      if (whForm.id) {
        await api.put(`/warehouses/${whForm.id}`, { name: whForm.name, type: whForm.type });
      } else {
        await api.post('/warehouses', { name: whForm.name, type: whForm.type });
      }
      setShowWhModal(false);
      loadData();
    } catch (e) { alert('Ошибка сохранения склада'); }
  };

  const handleSaveNomenclature = async () => {
    if (!nomForm.name) return;
    try {
      if (nomForm.id) {
        await api.put(`/nomenclature/${nomForm.id}`, { name: nomForm.name, type: nomForm.type, unit: nomForm.unit });
      } else {
        await api.post('/nomenclature', { name: nomForm.name, type: nomForm.type, unit: nomForm.unit });
      }
      setShowNomModal(false);
      loadData();
    } catch (e) { alert('Ошибка сохранения номенклатуры'); }
  };

  const handleCreateDoc = async () => {
    try {
      const payload = {
        doc_type: docForm.doc_type,
        source_warehouse_id: docForm.source_warehouse_id ? Number(docForm.source_warehouse_id) : null,
        target_warehouse_id: docForm.target_warehouse_id ? Number(docForm.target_warehouse_id) : null,
        lines: docForm.lines.map(l => ({
          nomenclature_id: Number(l.nomenclature_id),
          quantity: Number(l.quantity)
        }))
      };
      await api.post('/warehouse-documents', payload);
      setShowDocModal(false);
      loadData();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка создания документа');
    }
  };

  const handleAccountDoc = async (id: number) => {
    try {
      await api.post(`/warehouse-docs/${id}/account`);
      loadData();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка проведения документа');
    }
  };

  if (loading) return <div className="loading">Загрузка данных склада...</div>;

  return (
    <div className="card">
      <div className="tabs">
        <button className={`tab ${tab === 'docs' ? 'active' : ''}`} onClick={() => setTab('docs')}>Документы</button>
        <button className={`tab ${tab === 'balances' ? 'active' : ''}`} onClick={() => setTab('balances')}>Остатки</button>
        <button className={`tab ${tab === 'warehouses' ? 'active' : ''}`} onClick={() => setTab('warehouses')}>Склады</button>
        <button className={`tab ${tab === 'nomenclature' ? 'active' : ''}`} onClick={() => setTab('nomenclature')}>Номенклатура</button>
        <button className={`tab ${tab === 'replacement' ? 'active' : ''}`} onClick={() => setTab('replacement')}>Подменный фонд</button>
        <button className={`tab ${tab === 'insert' ? 'active' : ''}`} onClick={() => setTab('insert')}>Вставки</button>
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'warehouses' && (
          <div>
            <div className="page-header" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" onClick={() => { setWhForm({ id: null, name: '', type: 'physical' }); setShowWhModal(true); }}>+ Склад</button>
            </div>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Действия</th></tr></thead>
                <tbody>
                  {warehouses.map(w => (
                    <tr key={w.id}>
                      <td>{w.id}</td>
                      <td>{w.name}</td>
                      <td>{WAREHOUSE_TYPES[w.type] || w.type}</td>
                      <td>
                        <button className="btn btn-secondary" onClick={() => { setWhForm({ id: w.id, name: w.name, type: w.type }); setShowWhModal(true); }} style={{ padding: '2px 6px', fontSize: 11 }}>✎</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'nomenclature' && (
          <div>
            <div className="page-header" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" onClick={() => { setNomForm({ id: null, name: '', type: 'material', unit: 'шт' }); setShowNomModal(true); }}>+ Номенклатура</button>
            </div>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Ед. изм.</th><th>Действия</th></tr></thead>
                <tbody>
                  {nomenclature.map(n => (
                    <tr key={n.id}>
                      <td>{n.id}</td>
                      <td>{n.name}</td>
                      <td>{NOM_TYPES[n.type] || n.type}</td>
                      <td>{n.unit}</td>
                      <td>
                        <button className="btn btn-secondary" onClick={() => { setNomForm({ id: n.id, name: n.name, type: n.type, unit: n.unit }); setShowNomModal(true); }} style={{ padding: '2px 6px', fontSize: 11 }}>✎</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div>
            <div className="page-header" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" onClick={() => {
                setDocForm({ doc_type: 'INFLOW', source_warehouse_id: '', target_warehouse_id: '', lines: [{ nomenclature_id: '', quantity: 1 }] });
                setShowDocModal(true);
              }}>+ Создать документ</button>
            </div>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>ID</th><th>Тип</th><th>Статус</th><th>Откуда</th><th>Куда</th><th>Позиций</th><th>Дата</th><th>Действия</th></tr></thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id}>
                      <td>{d.id}</td>
                      <td>{DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES] || d.doc_type}</td>
                      <td><span className={`status-pill status-${d.status.toLowerCase()}`}>{DOC_STATUS[d.status] || d.status}</span></td>
                      <td>{warehouses.find(w => w.id === d.source_warehouse_id)?.name || '—'}</td>
                      <td>{warehouses.find(w => w.id === d.target_warehouse_id)?.name || '—'}</td>
                      <td>{d.lines?.length || 0}</td>
                      <td>{new Date(d.created_at).toLocaleString()}</td>
                      <td>
                        {d.status === 'DRAFT' && (
                          <button className="btn btn-success" onClick={() => handleAccountDoc(d.id)} style={{ padding: '2px 6px', fontSize: 11 }}>Провести</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'balances' && (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Склад</th><th>Номенклатура</th><th>Доступный остаток</th></tr></thead>
              <tbody>
                {balances.map((b, idx) => (
                  <tr key={idx}>
                    <td>{warehouses.find(w => w.id === b.warehouse_id)?.name || `Склад ID ${b.warehouse_id}`}</td>
                    <td>{nomenclature.find(n => n.id === b.nomenclature_id)?.name || `Номенклатура ID ${b.nomenclature_id}`}</td>
                    <td className="mono" style={{ fontWeight: 'bold' }}>{b.quantity}</td>
                  </tr>
                ))}
                {balances.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>На складах пусто</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'replacement' && <ReplacementTab />}
        {tab === 'insert' && <InsertTab />}
      </div>

      {showWhModal && (
        <div className="modal-overlay" onClick={() => setShowWhModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{whForm.id ? 'Редактировать склад' : 'Добавить склад'}</h3>
            <label>Название</label>
            <input value={whForm.name} onChange={e => setWhForm({ ...whForm, name: e.target.value })} placeholder="Основной склад" />
            <label>Тип склада</label>
            <select value={whForm.type} onChange={e => setWhForm({ ...whForm, type: e.target.value })}>
              <option value="physical">Физический объект / бокс</option>
              <option value="personal">Персональный (машина инженера)</option>
            </select>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleSaveWarehouse}>Сохранить</button>
              <button className="btn btn-secondary" onClick={() => setShowWhModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showNomModal && (
        <div className="modal-overlay" onClick={() => setShowNomModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{nomForm.id ? 'Редактировать позицию' : 'Добавить номенклатуру'}</h3>
            <label>Название</label>
            <input value={nomForm.name} onChange={e => setNomForm({ ...nomForm, name: e.target.value })} placeholder="Кабель КВВГ 4х1.5" />
            <label>Тип</label>
            <select value={nomForm.type} onChange={e => setNomForm({ ...nomForm, type: e.target.value })}>
              <option value="material">Материал</option>
              <option value="product">Оборудование / Продукт</option>
              <option value="service">Услуга</option>
              <option value="work">Работа</option>
            </select>
            <label>Единица измерения</label>
            <input value={nomForm.unit} onChange={e => setNomForm({ ...nomForm, unit: e.target.value })} placeholder="шт, м, кг" />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleSaveNomenclature}>Сохранить</button>
              <button className="btn btn-secondary" onClick={() => setShowNomModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showDocModal && (
        <div className="modal-overlay" onClick={() => setShowDocModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, width: '100%' }}>
            <h3>Новый складской документ</h3>
            <label>Тип документа</label>
            <select value={docForm.doc_type} onChange={e => setDocForm({ ...docForm, doc_type: e.target.value, source_warehouse_id: '', target_warehouse_id: '' })}>
              <option value="INFLOW">Приход на склад (от поставщика / произведено)</option>
              <option value="TRANSFER">Внутреннее перемещение между складами</option>
              <option value="WRITE_OFF">Списание (утилизация, брак, расход безвозвратный)</option>
            </select>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {docForm.doc_type !== 'INFLOW' && (
                <div style={{ flex: 1 }}>
                  <label>Склад-источник (Откуда)</label>
                  <select value={docForm.source_warehouse_id} onChange={e => setDocForm({ ...docForm, source_warehouse_id: e.target.value })}>
                    <option value="">— Выберите склад —</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              {docForm.doc_type !== 'WRITE_OFF' && (
                <div style={{ flex: 1 }}>
                  <label>Склад-получатель (Куда)</label>
                  <select value={docForm.target_warehouse_id} onChange={e => setDocForm({ ...docForm, target_warehouse_id: e.target.value })}>
                    <option value="">— Выберите склад —</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span>Спецификация (строки документа)</span>
                <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setDocForm({ ...docForm, lines: [...docForm.lines, { nomenclature_id: '', quantity: 1 }] })}>+ Добавить строку</button>
              </label>

              {docForm.lines.map((line, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <select style={{ flex: 2 }} value={line.nomenclature_id} onChange={e => {
                    const l = [...docForm.lines]; l[idx].nomenclature_id = e.target.value; setDocForm({ ...docForm, lines: l });
                  }}>
                    <option value="">— Выберите товар —</option>
                    {nomenclature.map(n => <option key={n.id} value={n.id}>{n.name} ({n.unit})</option>)}
                  </select>
                  <input style={{ flex: 1 }} type="number" min="1" value={line.quantity} onChange={e => {
                    const l = [...docForm.lines]; l[idx].quantity = Number(e.target.value); setDocForm({ ...docForm, lines: l });
                  }} />
                  <button type="button" className="btn btn-danger" style={{ padding: '4px 8px' }} onClick={() => {
                    if (docForm.lines.length === 1) return;
                    setDocForm({ ...docForm, lines: docForm.lines.filter((_, i) => i !== idx) });
                  }}>✕</button>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={handleCreateDoc}>Создать (черновик)</button>
              <button className="btn btn-secondary" onClick={() => setShowDocModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ReplacementTab: React.FC = () => {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', serial_number: '', verification_date: '', verification_interval_years: '', verification_expiry: '', taken_by_id: '', location_id: '', return_date: '', passport_scan: '' });
  const [users, setUsers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/replacement-devices'), api.get('/users/list'), api.get('/locations')])
      .then(([d, u, l]) => { setDevices(d.data); setUsers(u.data); setLocations(l.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openForm = (d?: any) => {
    if (d) { setEditId(d.id); setForm({ name: d.name, serial_number: d.serial_number || '', verification_date: d.verification_date || '', verification_expiry: d.verification_expiry || '', verification_interval_years: d.verification_interval_months ? String(d.verification_interval_months / 12) : '', taken_by_id: d.taken_by_id?.toString() || '', location_id: d.location_id?.toString() || '', return_date: d.return_date || '', passport_scan: d.passport_scan || '' }); }
    else { setEditId(null); setForm({ name: '', serial_number: '', verification_date: '', verification_expiry: '', verification_interval_years: '', taken_by_id: '', location_id: '', return_date: '', passport_scan: '' }); }
    setShowForm(true); setError('');
  };

  const submit = async () => {
    if (!form.name.trim()) { setError('Название обязательно'); return; }
    try {
      const months = form.verification_interval_years ? Number(form.verification_interval_years) * 12 : null;
      const expiry = form.verification_date && months
        ? new Date(new Date(form.verification_date).setMonth(new Date(form.verification_date).getMonth() + months)).toISOString().substring(0, 10)
        : form.verification_expiry || null;
      const body: any = { name: form.name, serial_number: form.serial_number, verification_date: form.verification_date || null, verification_interval_months: months, verification_expiry: expiry, taken_by_id: form.taken_by_id ? Number(form.taken_by_id) : null, location_id: form.location_id ? Number(form.location_id) : null, return_date: form.return_date || null, passport_scan: form.passport_scan || null };
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
          <thead><tr><th>Наименование</th><th>Серийный №</th><th>Дата поверки</th><th>Интервал</th><th>Поверка до</th><th>Кто взял</th><th>Объект</th><th>Возврат</th><th></th></tr></thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td className="mono" style={{ fontSize: 12 }}>{d.serial_number || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.verification_date ? d.verification_date.substring(0, 10) : '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{d.verification_interval_months ? `${d.verification_interval_months / 12} лет` : '—'}</td>
                <td style={{ fontSize: 12, color: d.verification_expiry && new Date(d.verification_expiry) < new Date() ? 'var(--danger)' : 'var(--text-secondary)' }}>{d.verification_expiry ? d.verification_expiry.substring(0, 10) : '—'}</td>
                <td>{d.taken_by_name || '—'}</td>
                <td style={{ fontSize: 12 }}>{d.location_name || '—'}</td>
                <td style={{ fontSize: 12 }}>{d.return_date ? d.return_date.substring(0, 10) : '—'}</td>
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
            <label>Наименование прибора *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Манометр МП-160" />
            <label>Серийный номер</label>
            <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="S/N: 2026-X991" />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><label>Дата поверки</label><input type="date" value={form.verification_date} onChange={e => setForm({ ...form, verification_date: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Межповерочный интервал (лет)</label><input type="number" value={form.verification_interval_years} onChange={e => setForm({ ...form, verification_interval_years: e.target.value })} placeholder="1" /></div>
            </div>
            <label>ФИО кто взял прибор</label>
            <select value={form.taken_by_id} onChange={e => setForm({ ...form, taken_by_id: e.target.value })}><option value="">— На складе —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <label>На какой объект взят прибор</label>
            <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}><option value="">— Не выбран —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <label>Примерная дата возврата</label>
            <input type="date" value={form.return_date} onChange={e => setForm({ ...form, return_date: e.target.value })} />
            <label>Фото/скан паспорта</label>
            <input type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploadingPhoto(true);
              const fd = new FormData();
              fd.append('file', file);
              try {
                const resp = await api.post('/attachments', fd);
                const url = resp.data?.file_url || resp.data?.url || '';
                setForm({ ...form, passport_scan: url || file.name });
              } catch { alert('Ошибка загрузки фото'); }
              setUploadingPhoto(false);
            }} style={{ fontSize: 12, color: 'var(--text-secondary)' }} disabled={uploadingPhoto} />
            {uploadingPhoto && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Загрузка...</span>}
            <label>Или ссылка на скан</label>
            <input value={form.passport_scan} onChange={e => setForm({ ...form, passport_scan: e.target.value })} placeholder="https://..." />
            <div className="modal-actions"><button className="btn btn-primary" onClick={submit}>{editId ? 'Сохранить' : 'Добавить'}</button><button className="btn btn-secondary" onClick={() => setShowForm(false)}>Отмена</button></div>
          </div>
        </div>
      )}
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

  const [quick, setQuick] = useState<{ prodId: number; action: string; qty: string; taken_by_id: string; location_id: string } | null>(null);

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

  const openProductForm = (p?: any) => {
    if (p) {
      setEditId(p.id);
      setForm({ ...form, name: p.name, diameter: p.diameter || '', length: p.length || '', flange_type: p.flange_type || '' });
    } else {
      setEditId(null);
      setForm({ name: '', diameter: '', length: '', flange_type: '', quantity: '1', type: 'incoming', product_id: '', taken_by_id: '', location_id: '', comment: '', document: '' });
    }
    setShowForm(true);
    setError('');
  };

  const openTxForm = () => {
    const now = new Date();
    const doc = `ДОК-${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    setEditId(null);
    setForm({ name: '', diameter: '', length: '', flange_type: '', type: 'outgoing', quantity: '1', product_id: '', taken_by_id: '', location_id: '', comment: '', document: doc });
    setShowForm(true);
    setError('');
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
        {tab === 'catalog' && <button className="btn btn-primary" onClick={() => openProductForm(undefined)}>+ Продукт</button>}
        {tab === 'journal' && <button className="btn btn-primary" onClick={() => openTxForm()}>+ Операция</button>}
        {tab === 'balance' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Баланс рассчитывается из транзакций</span>}
      </div>

      {tab === 'catalog' && (
        <div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Название</th><th>Диаметр</th><th>Длина</th><th>Фланец</th><th>Остаток</th><th></th></tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.diameter || '—'}</td>
                    <td>{p.length || '—'}</td>
                    <td>{p.flange_type || '—'}</td>
                    <td className="mono" style={{ fontWeight: 700, color: p.balance > 0 ? 'var(--success)' : p.balance < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{p.balance}</td>
                    <td>
                      <button className="btn btn-success" onClick={() => setQuick({ prodId: p.id, action: 'incoming', qty: '1', taken_by_id: '', location_id: '' })} style={{ padding: '2px 6px', fontSize: 11, marginRight: 2 }} title="Приход">+</button>
                      <button className="btn btn-secondary" onClick={() => setQuick({ prodId: p.id, action: 'outgoing', qty: '1', taken_by_id: '', location_id: '' })} style={{ padding: '2px 6px', fontSize: 11, marginRight: 2 }} title="Выдача">−</button>
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
              <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 340 }}>
                <h3>Быстрый {quick.action === 'incoming' ? 'приход' : 'расход'}</h3>
                <label>Количество</label>
                <input type="number" value={quick.qty} onChange={e => setQuick({ ...quick, qty: e.target.value })} min="1" step="1" autoFocus />

                {quick.action === 'outgoing' && (
                  <>
                    <label>Кто взял</label>
                    <select value={quick.taken_by_id} onChange={e => setQuick({ ...quick, taken_by_id: e.target.value })}>
                      <option value="">— Выберите сотрудника —</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>

                    <label>Объект назначения</label>
                    <select value={quick.location_id} onChange={e => setQuick({ ...quick, location_id: e.target.value })}>
                      <option value="">— Не выбран —</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.customer_name})</option>)}
                    </select>
                  </>
                )}
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={async () => {
                    const qty = parseInt(quick.qty);
                    if (!qty || qty < 1) return;
                    try {
                      await api.post('/insert/transactions', {
                        type: quick.action,
                        product_id: quick.prodId,
                        quantity: qty,
                        taken_by_id: quick.action === 'outgoing' && quick.taken_by_id ? Number(quick.taken_by_id) : null,
                        location_id: quick.action === 'outgoing' && quick.location_id ? Number(quick.location_id) : null,
                      });
                      setQuick(null);
                      load();
                    } catch (e: any) { alert(e.response?.data?.detail || 'Ошибка проведения'); }
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
                <label>Тип фланца</label>
                <select value={form.flange_type} onChange={e => setForm({ ...form, flange_type: e.target.value })}><option value="">—</option><option value="Фланцевый">Фланцевый</option><option value="Сэндвич">Сэндвич</option><option value="Резьбовой">Резьбовой</option><option value="Пластик">Пластик</option><option value="С заглушкой">С заглушкой</option></select>
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
