import React from 'react';
import { TicketResponse } from '../api/client';

export const isTicketOverdue = (ticket: TicketResponse): boolean => (
  ticket.status !== 'COMPLETED' && (ticket.response_overdue || ticket.resolution_overdue)
);

export const TicketOverdue: React.FC<{ ticket: TicketResponse }> = ({ ticket }) => {
  if (!isTicketOverdue(ticket)) return null;
  const reasons = [
    ticket.response_overdue ? 'Просрочен срок ответа' : '',
    ticket.resolution_overdue ? 'Просрочен срок выполнения' : '',
  ].filter(Boolean).join('; ');
  return <span className="ticket-overdue-label" title={reasons}>Просрочена</span>;
};
