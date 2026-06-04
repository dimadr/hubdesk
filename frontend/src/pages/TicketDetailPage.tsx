import React from 'react';

export const TicketDetailPage: React.FC<{ id: string }> = ({ id }) => {
  return <div className="ticket-detail">Ticket #{id}</div>;
};
