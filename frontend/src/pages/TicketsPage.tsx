import React from 'react';
import { TicketGrid } from '../components/TicketGrid/TicketGrid';

interface UserInfo {
  id: number; email: string; name: string; role: string;
}

export const TicketsPage: React.FC<{ users: UserInfo[] }> = ({ users }) => {
  return <TicketGrid users={users} />;
};
