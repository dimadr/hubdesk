import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const ACTION_LABELS: Record<string, string> = {
  ticket_created: 'Заявка создана',
  ticket_status_changed: 'Смена статуса',
  ticket_assigned: 'Назначение инженера',
  user_updated: 'Пользователь изменён',
  user_deleted: 'Пользователь удалён',
  product_created: 'Продукт добавлен',
  product_updated: 'Продукт изменён',
  product_deleted: 'Продукт удалён',
  insert_incoming: 'Приход вставки',
  insert_outgoing: 'Выдача вставки',
  insert_return: 'Возврат вставки',
  insert_transaction_deleted: 'Транзакция удалена',
  location_created: 'Объект создан',
  location_updated: 'Объект изменён',
  location_deleted: 'Объект удалён',
};

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = (p = 1, append = false) => {
    setLoading(true);
    const params: any = { page: p, limit: 50 };
    if (q.trim()) params.q = q.trim();
    if (action) params.action = action;
    api.get('/audit-log', { params })
      .then(r => {
        const data = r.data;
        if (append) { setLogs(prev => [...prev, ...data]); }
        else { setLogs(data); }
        setHasMore(data.length === 50);
        setPage(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [action]);

  const handleSearch = () => load();

  const handleClear = () => {
    const confirmed = confirm('Очистить весь журнал действий? Это действие необратимо.');
    if (!confirmed) return;
    const password = prompt('Введите пароль администратора для подтверждения:');
    if (!password) return;
    api.delete('/audit-log', { data: { password } })
      .then(() => { alert('Журнал очищен'); load(); })
      .catch((e: any) => alert(e.response?.data?.detail || 'Ошибка'));
  };

  return (
    <div>
      <div className="cal-header">
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Журнал действий</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
          <input type="text" placeholder="Поиск..." value={q} onChange={e => setQ(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12, width: 180 }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          <select value={action} onChange={e => setAction(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12 }}>
            <option value="">Все действия</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={handleSearch}>Найти</button>
          <button className="btn btn-danger" style={{ padding: '4px 12px', fontSize: 12, marginLeft: 8 }} onClick={handleClear}>Очистить</button>
        </div>
      </div>

      <div className="table-wrapper" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th style={{ width: 160 }}>Дата</th><th>Пользователь</th><th style={{ width: 180 }}>Действие</th><th>Детали</th></tr></thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(l.created_at).toLocaleString('ru-RU')}</td>
                <td>{l.user_name}</td>
                <td><span className="status-pill" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)', fontSize: 12 }}>{ACTION_LABELS[l.action] || l.action}</span></td>
                <td style={{ fontSize: 13 }}>{l.detail}</td>
              </tr>
            ))}
            {logs.length === 0 && !loading && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Записей нет</td></tr>}
          </tbody>
        </table>
      </div>

      {hasMore && logs.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn btn-secondary" disabled={loading} onClick={() => load(page + 1, true)}>
            {loading ? 'Загрузка...' : 'Ещё'}
          </button>
        </div>
      )}
    </div>
  );
};
