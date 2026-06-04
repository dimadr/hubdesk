import React from 'react';
import { TicketResponse } from '../../api/client';

interface RowStyleProps {
  ticket: TicketResponse;
  children: React.ReactNode;
}

export const RowStyle: React.FC<RowStyleProps> = ({ ticket, children }) => {
  const cls: string[] = ['ticket-row'];

  if (ticket.response_overdue || ticket.resolution_overdue) {
    cls.push('row-overdue');
  }
  if (ticket.is_internal) {
    cls.push('row-internal');
  }
  cls.push(`row-priority-${ticket.priority}`);

  return <tr className={cls.join(' ')}>{children}</tr>;
};
