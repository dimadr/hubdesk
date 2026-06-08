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
  const [tab, setTab] = useState<'warehouses' | 'nomenclature' | 'docs' | 'balances'>('docs');
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
        {(['docs', 'warehouses', 'nomenclature', 'balances'] as const).map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'docs' ? 'Документы' : t === 'warehouses' ? 'Склады' : t === 'nomenclature' ? 'Номенклатура' : 'Остатки'}
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
