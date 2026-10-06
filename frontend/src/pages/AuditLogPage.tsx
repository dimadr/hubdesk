import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  detail: string;
  meta: string | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  ticket_created: 'Заявка создана',
  ticket_updated: 'Заявка изменена',
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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = (p = 1, append = false) => {
    setLoading(true);
    const params: Record<string, any> = { page: p, limit: 50 };
    if (q.trim()) params.q = q.trim();
    if (action) params.action = action;

    api.get<AuditLog[]>('/audit-log', { params })
      .then(r => {
        const data = r.data;
        if (append) {
          setLogs(prev => [...prev, ...data]);
        } else {
          setLogs(data);
        }
        setHasMore(data.length === 50);
        setPage(p);
      })
      .catch((err) => {
        console.error("Ошибка загрузки логов:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    load(1, false);
  }, [action]);

  const handleSearch = () => {
    load(1, false);
  };

  return (
    <div>
      <div className="cal-header">
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Журнал действий</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
          <input
            type="text"
            placeholder="Поиск..."
            value={q}
            onChange={e => setQ(e.target.value)}
            disabled={loading}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12, width: 180 }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            disabled={loading}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12 }}
          >
            <option value="">Все действия</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={handleSearch}
            disabled={loading}
          >
            Найти
          </button>
        </div>
      </div>

      <div className="table-wrapper" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Дата</th>
              <th>Пользователь</th>
              <th style={{ width: 180 }}>Действие</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(l.created_at).toLocaleString('ru-RU')}
                </td>
                <td>{l.user_name}</td>
                <td>
                  <span className="status-pill" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)', fontSize: 12 }}>
                    {ACTION_LABELS[l.action] || l.action}
                  </span>
                </td>
                <td style={{ fontSize: 13 }}>{l.detail}</td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                  Записей нет
                </td>
              </tr>
            )}
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
