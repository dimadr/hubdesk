import React from 'react';
import { TicketResponse } from '../../api/client';
import { isTicketOverdue } from '../TicketOverdue';

interface RowStyleProps {
  ticket: TicketResponse;
  children: React.ReactNode;
  onClick?: () => void;
}

export const RowStyle: React.FC<RowStyleProps> = ({ ticket, children, onClick }) => {
  const cls: string[] = ['ticket-row'];

  if (isTicketOverdue(ticket)) {
    cls.push('row-overdue');
  }
  if (ticket.is_internal) {
    cls.push('row-internal');
  }
  cls.push(`row-priority-${ticket.priority}`);

  return <tr className={cls.join(' ')} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>{children}</tr>;
};
