import React, { useEffect, useState } from 'react';
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
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', ON_THE_WAY: 'В пути',
  ARRIVED: 'На месте', IN_PROGRESS: 'В работе', REVIEW: 'Проверка', COMPLETED: 'Завершена',
};

export const CalendarPage: React.FC = () => {
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [current, setCurrent] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTickets, setSelectedTickets] = useState<TicketResponse[]>([]);

  useEffect(() => {
    api.get('/tickets', { params: { limit: 200 } })
      .then(r => {
        const open = r.data.filter((t: TicketResponse) => t.status !== 'COMPLETED');
        setTickets(open);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const year = current.getFullYear();
  const month = current.getMonth();

  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const ticketsByDate: Record<string, TicketResponse[]> = {};
  for (const t of tickets) {
    if (t.resolution_deadline) {
      const d = t.resolution_deadline.substring(0, 10);
      if (!ticketsByDate[d]) ticketsByDate[d] = [];
      ticketsByDate[d].push(t);
    }
  }

  const prevMonth = () => setCurrent(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrent(new Date(year, month + 1, 1));

  const today = new Date().toISOString().substring(0, 10);
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
      <div className="cal-header">
        <button className="btn btn-secondary" onClick={prevMonth}>←</button>
        <h2 style={{ margin: '0 16px', fontSize: 18, fontWeight: 700 }}>{MONTHS[month]} {year}</h2>
        <button className="btn btn-secondary" onClick={nextMonth}>→</button>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{tickets.length} заявок</span>
      </div>
      <div className="cal-grid">
        {DAYS.map(d => <div key={d} className="cal-weekday">{d}</div>)}
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
                  <span className="cal-dot" style={{ background: PRIORITY_COLORS[t.priority] || 'var(--text-muted)' }} />
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
                    <tr key={t.id}>
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
