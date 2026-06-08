import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

interface ObjectRow { location_id: number; location_name: string; total: number; open: number; closed: number; overdue: number; avg_resolution_hours: number; }
interface TicketStats { total: number; by_status: { label: string; count: number }[]; by_priority: { label: string; count: number }[]; by_type: { label: string; count: number }[]; avg_resolution_hours: number; sla_percent: number; }
interface EngineerRow { engineer_id: number; engineer_name: string; total: number; completed: number; in_progress: number; overdue: number; avg_resolution_hours: number; }

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', ON_THE_WAY: 'В пути',
  ARRIVED: 'На месте', IN_PROGRESS: 'В работе', REVIEW: 'Проверка', COMPLETED: 'Завершена',
};
const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий',
};
const TYPE_LABELS: Record<string, string> = {
  repair: 'Ремонт', installation: 'Монтаж', maintenance: 'ТО', inspection: 'Инспекция', emergency: 'Авария',
};

function valColor(v: number, good: number, warn: number): string {
  if (v <= good) return 'var(--success)';
  if (v <= warn) return 'var(--warning)';
  return 'var(--danger)';
}

export const ReportsPage: React.FC = () => {
  const [tab, setTab] = useState<'objects' | 'tickets' | 'engineers'>('tickets');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [loading, setLoading] = useState(false);

  const params = () => {
    const p: any = {};
    if (from) p.date_from = new Date(from).toISOString();
    if (to) p.date_to = new Date(to).toISOString();
    return p;
  };

  useEffect(() => { loadAll(); }, []);

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      api.get('/reports/objects', { params: params() }).catch(() => ({ data: [] })),
      api.get('/reports/tickets', { params: params() }).catch(() => ({ data: null })),
      api.get('/reports/engineers', { params: params() }).catch(() => ({ data: [] })),
    ]).then(([o, t, e]) => {
      setObjects(o.data);
      setTicketStats(t.data);
      setEngineers(e.data);
      setLoading(false);
    });
  };

  return (
    <div>
      <div className="cal-header">
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Отчёты</h2>
        <span className="text-muted" style={{ marginLeft: 16, fontSize: 13 }}>с</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ margin: '0 6px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12 }} />
        <span className="text-muted" style={{ fontSize: 13 }}>по</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ margin: '0 6px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12 }} />
        <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={loadAll}>Обновить</button>
      </div>

      <div className="tabs" style={{ marginTop: 16, marginBottom: 16, display: 'inline-flex' }}>
        {([
          { key: 'tickets', label: 'Заявки' },
          { key: 'objects', label: 'Объекты' },
          { key: 'engineers', label: 'Инженеры' },
        ] as const).map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div className="loading">Загрузка...</div> : (
        <>
          {tab === 'objects' && (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Объект</th><th>Всего</th><th>Открыто</th><th>Закрыто</th><th>Просрочено</th><th>Ср. время (ч)</th></tr></thead>
                <tbody>
                  {objects.map(o => (
                    <tr key={o.location_id}>
                      <td style={{ fontWeight: 600 }}>{o.location_name}</td>
                      <td className="mono">{o.total}</td>
                      <td className="mono" style={{ color: o.open > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{o.open}</td>
                      <td className="mono" style={{ color: o.closed > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{o.closed}</td>
                      <td className="mono" style={{ color: o.overdue > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{o.overdue}</td>
                      <td className="mono">{o.avg_resolution_hours}</td>
                    </tr>
                  ))}
                  {objects.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Нет данных</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'tickets' && ticketStats && (
            <div>
              <div className="kpi-row">
                <div className="kpi"><div className="kpi-lab">Всего</div><div className="kpi-val">{ticketStats.total}</div></div>
                <div className="kpi"><div className="kpi-lab">Ср. время (ч)</div><div className="kpi-val" style={{ color: valColor(ticketStats.avg_resolution_hours, 24, 72) }}>{ticketStats.avg_resolution_hours}</div></div>
                <div className="kpi"><div className="kpi-lab">SLA %</div><div className="kpi-val" style={{ color: valColor(100 - ticketStats.sla_percent, 20, 50) }}>{ticketStats.sla_percent}%</div></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 16 }}>
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Статус</th><th>Кол-во</th></tr></thead>
                    <tbody>
                      {ticketStats.by_status.map(s => (
                        <tr key={s.label}><td>{STATUS_LABELS[s.label] || s.label}</td><td className="mono">{s.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Приоритет</th><th>Кол-во</th></tr></thead>
                    <tbody>
                      {ticketStats.by_priority.map(s => (
                        <tr key={s.label}><td>{PRIORITY_LABELS[s.label] || s.label}</td><td className="mono">{s.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Тип</th><th>Кол-во</th></tr></thead>
                    <tbody>
                      {ticketStats.by_type.map(s => (
                        <tr key={s.label}><td>{TYPE_LABELS[s.label] || s.label}</td><td className="mono">{s.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {tab === 'tickets' && !ticketStats && <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Нет данных</div>}

          {tab === 'engineers' && (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Инженер</th><th>Всего</th><th>Выполнено</th><th>В работе</th><th>Просрочено</th><th>Ср. время (ч)</th></tr></thead>
                <tbody>
                  {engineers.map(e => (
                    <tr key={e.engineer_id}>
                      <td style={{ fontWeight: 600 }}>{e.engineer_name}</td>
                      <td className="mono">{e.total}</td>
                      <td className="mono" style={{ color: 'var(--success)' }}>{e.completed}</td>
                      <td className="mono" style={{ color: e.in_progress > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{e.in_progress}</td>
                      <td className="mono" style={{ color: e.overdue > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{e.overdue}</td>
                      <td className="mono">{e.avg_resolution_hours}</td>
                    </tr>
                  ))}
                  {engineers.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Нет данных</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};
