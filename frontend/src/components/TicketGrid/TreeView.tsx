import React from 'react';
import { TicketResponse } from '../../api/client';

interface Props {
  tickets: TicketResponse[];
  onDetail?: (ticket: TicketResponse) => void;
}

export const TreeView: React.FC<Props> = ({ tickets, onDetail }) => {
  if (tickets.length === 0) return <div className="loading">Нет заявок</div>;
  return (
    <div className="tree-view">
      {tickets.map((ticket) => (
        <div key={ticket.id} className="tree-node" style={{ cursor: onDetail ? 'pointer' : undefined }}
          onClick={onDetail ? () => onDetail(ticket) : undefined}>
          {ticket.is_internal && '🔒 '}
          <span className="mono" style={{ color: 'var(--text-muted)' }}>#{ticket.number}</span>
          {' '}{ticket.subject}
          {' '}<span style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{ticket.status}]</span>
        </div>
      ))}
    </div>
  );
};
