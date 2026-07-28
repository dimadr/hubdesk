import React, { useEffect, useState, useRef } from 'react';
import { api, TicketResponse } from '../api/client';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--danger)',
  high: 'var(--warning)',
  medium: 'var(--text-muted)',
  low: 'var(--success)',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий',
};

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', IN_PROGRESS: 'В работе', COMPLETED: 'Завершена',
};

const getTicketColor = (t: TicketResponse): string => {
  const now = new Date();
  const deadline = t.resolution_deadline || t.scheduled_end;
  if (deadline) {
    const dl = new Date(deadline);
    if (dl < now) return 'var(--danger)';
  }
  return 'var(--success)';
};

export const CalendarPage: React.FC<{ onOpenTicket?: (ticket: TicketResponse) => void }> = ({ onOpenTicket }) => {
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [current, setCurrent] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTickets, setSelectedTickets] = useState<TicketResponse[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchAllPages = async (params: Record<string, any>, signal: AbortSignal): Promise<TicketResponse[]> => {
    const all: TicketResponse[] = [];
    let offset = 0;
    const LIMIT = 200;
    while (!signal.aborted) {
      const { data } = await api.get('/tickets', { params: { ...params, limit: LIMIT, offset }, signal });
      all.push(...data);
      if (data.length < LIMIT) break;
      offset += LIMIT;
    }
    return all;
  };

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const dateFrom = `${monthKey}-01T00:00:00`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateTo = `${monthKey}-${String(lastDay).padStart(2, '0')}T23:59:59`;
    setLoading(true);
    setError('');
    Promise.all([
      fetchAllPages({ deadline_from: dateFrom, deadline_to: dateTo, archived: false }, controller.signal),
      fetchAllPages({ scheduled_from: dateFrom, scheduled_to: dateTo, archived: false }, controller.signal),
      fetchAllPages({ date_from: dateFrom, date_to: dateTo, archived: false }, controller.signal),
    ]).then(([deadlineTickets, scheduledTickets, createdTickets]) => {
      if (!controller.signal.aborted) {
        const merged = new Map<number, TicketResponse>();
        for (const t of [...deadlineTickets, ...scheduledTickets, ...createdTickets]) {
          if (t.status !== 'COMPLETED') merged.set(t.id, t);
        }
        setTickets(Array.from(merged.values()));
        setLoading(false);
      }
    }).catch((err: any) => {
      if (!controller.signal.aborted) {
        setError(err.response?.data?.detail || 'Ошибка загрузки календаря');
        setLoading(false);
      }
    });
  }, [current.getFullYear(), current.getMonth()]);

  const year = current.getFullYear();
  const month = current.getMonth();

  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const ticketsByDate: Record<string, TicketResponse[]> = {};
  const visibleMonthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  for (const t of tickets) {
    const candidateDates = [
      t.resolution_deadline,
      t.scheduled_end,
      t.created_at,
    ].filter((value): value is string => Boolean(value))
      .map(value => value.substring(0, 10));
    const d = candidateDates.find(value => value.startsWith(visibleMonthPrefix));
    if (d) {
      if (!ticketsByDate[d]) ticketsByDate[d] = [];
      ticketsByDate[d].push(t);
    }
  }

  const prevMonth = () => setCurrent(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrent(new Date(year, month + 1, 1));

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayParts = today.split('-').map(Number);
  const isToday = (d: number) =>
    todayParts[0] === year && todayParts[1] === month + 1 && todayParts[2] === d;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const openDay = (dateKey: string, dayTickets: TicketResponse[]) => {
    setSelectedDate(dateKey);
    setSelectedTickets(dayTickets);
  };

  const dateLabel = selectedDate ? new Date(selectedDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      <div className="cal-header">
        <button className="btn btn-secondary" onClick={prevMonth}>←</button>
        <h2 style={{ margin: '0 16px', fontSize: 18, fontWeight: 700 }}>{MONTHS[month]} {year}</h2>
        <button className="btn btn-secondary" onClick={nextMonth}>→</button>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{tickets.length} заявок</span>
      </div>
      <div className="cal-grid">
        {DAYS.map((d, i) => <div key={d} className="cal-weekday" style={i >= 5 ? { color: 'var(--danger)' } : undefined}>{d}</div>)}
        {cells.map((d, i) => {
          const dateKey = d ? `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
          const dayTickets = dateKey ? (ticketsByDate[dateKey] || []) : [];
          return (
            <div
              key={i}
              className={`cal-day ${d && isToday(d) ? 'cal-today' : ''} ${!d ? 'cal-empty' : ''} ${d && dayTickets.length > 0 ? 'cal-clickable' : ''}`}
              onClick={() => d && dayTickets.length > 0 && openDay(dateKey, dayTickets)}
            >
              {d && <div className="cal-day-num">{d}</div>}
              {dayTickets.map(t => (
                <div key={t.id} className="cal-ticket">
                  <span className="cal-dot" style={{ background: getTicketColor(t) }} />
                  <span className="cal-ticket-text">#{t.number} {t.subject}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3>{dateLabel} — {selectedTickets.length} заявок</h3>
            <div className="table-wrapper" style={{ marginTop: 12, maxHeight: '50vh', overflow: 'auto' }}>
              <table>
                <thead><tr><th>#</th><th>Тема</th><th>Статус</th><th>Приоритет</th></tr></thead>
                <tbody>
                  {selectedTickets.map(t => (
                    <tr key={t.id} onClick={() => { setSelectedDate(null); onOpenTicket?.(t); }} style={{ cursor: 'pointer' }}>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>#{t.number}</td>
                      <td style={{ fontWeight: 600 }}>{t.subject}</td>
                      <td>
                        <span className="status-pill" style={{
                          background: t.status === 'COMPLETED' ? 'var(--success-bg)' : t.status === 'IN_PROGRESS' ? 'var(--info-bg)' : 'var(--primary-bg)',
                          color: t.status === 'COMPLETED' ? 'var(--success)' : t.status === 'IN_PROGRESS' ? 'var(--info)' : 'var(--primary)',
                        }}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </td>
                      <td>
                        <span className="status-pill" style={{ background: `${PRIORITY_COLORS[t.priority]}18`, color: PRIORITY_COLORS[t.priority] }}>
                          {PRIORITY_LABELS[t.priority] || t.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedDate(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
