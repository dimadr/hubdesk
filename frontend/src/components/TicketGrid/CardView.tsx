import React from 'react';
import { TicketResponse } from '../../api/client';

interface UserInfo {
  id: number; email: string; name: string; role: string;
}

interface Props {
  tickets: TicketResponse[];
  users: UserInfo[];
  onDetail?: (ticket: TicketResponse) => void;
}

const STATUS_MAP: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', IN_PROGRESS: 'В работе', COMPLETED: 'Завершена',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--critical)',
  high: 'var(--high-priority)',
  medium: 'var(--medium-priority)',
  low: 'var(--low-priority)',
};

const PRIORITY_MAP: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный' };

export const CardView: React.FC<Props> = ({ tickets, users, onDetail }) => {
  const getUserName = (id: number | null) => {
    if (!id) return '—';
    const u = users.find(u => u.id === id);
    return u ? u.name : `#${id}`;
  };

  if (tickets.length === 0) return <div className="loading">Нет заявок</div>;

  return (
    <div className="card-grid">
      {tickets.map((ticket) => (
        <div key={ticket.id} className="ticket-card"
          style={{ borderLeft: `3px solid ${PRIORITY_COLORS[ticket.priority] || 'var(--border)'}`, cursor: onDetail ? 'pointer' : undefined }}
          onClick={onDetail ? () => onDetail(ticket) : undefined}>
          <div className="card-header">
            {ticket.is_internal && '🔒 '}
            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>#{ticket.number}</span>
            {' '}{ticket.subject}
          </div>
          {(ticket.location_name || ticket.location_address) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {ticket.location_name || ''}{ticket.location_address ? ` — ${ticket.location_address}` : ''}
            </div>
          )}
          <div className="card-meta">
            <StatusBadge status={ticket.status} />
            <span>{PRIORITY_MAP[ticket.priority]}</span>
            <span>👤 {getUserName(ticket.assignee_id)}</span>
          </div>
          {ticket.response_overdue && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '4px 10px', borderRadius: 4 }}>
              ⚠ Просрочена
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cssMap: Record<string, string> = {
    ASSIGNED: 'st-assigned', ACCEPTED: 'st-accepted', IN_PROGRESS: 'st-in_progress', COMPLETED: 'st-completed',
  };
  return <span className={`status-pill ${cssMap[status] || ''}`}>{STATUS_MAP[status] || status}</span>;
};
