import React, { useEffect, useState } from 'react';
import { useTicketStore } from '../../store/tickets';
import { Tabs } from './Tabs';
import { SavedViews } from './SavedViews';
import { TableView } from './TableView';
import { CardView } from './CardView';
import { TreeView } from './TreeView';

interface UserInfo {
  id: number; email: string; name: string; role: string;
}

const ViewSwitcher: React.FC = () => {
  const { viewType, setViewType } = useTicketStore();
  return (
    <div className="view-switcher">
      <button onClick={() => setViewType('table')} className={viewType === 'table' ? 'active' : ''}>Таблица</button>
      <button onClick={() => setViewType('card')} className={viewType === 'card' ? 'active' : ''}>Карточки</button>
      <button onClick={() => setViewType('tree')} className={viewType === 'tree' ? 'active' : ''}>Дерево</button>
    </div>
  );
};

export const TicketGrid: React.FC<{ users: UserInfo[] }> = ({ users }) => {
  const { tickets, activeTab, viewType, fetchTickets, loading } = useTicketStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    doFetch();
  }, [activeTab]);

  const doFetch = () => {
    const filters: any = {};
    if (activeTab === 'overdue') filters.overdue = true;
    else if (activeTab !== 'all') filters.status = activeTab;
    if (search) filters.q = search;
    fetchTickets(filters);
  };

  useEffect(() => {
    if (search && search.length < 2) return;
    const timer = setTimeout(doFetch, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const viewComponent = {
    table: <TableView tickets={tickets} users={users} />,
    card: <CardView tickets={tickets} users={users} />,
    tree: <TreeView tickets={tickets} />,
  }[viewType];

  return (
    <div className="ticket-grid">
      <div className="toolbar">
        <Tabs />
        <SavedViews />
        <ViewSwitcher />
      </div>
      <div style={{ marginBottom: 14 }}>
        <input type="text" className="search-bar" placeholder="Поиск по номеру или теме..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? <div className="loading">Загрузка...</div> : viewComponent}
    </div>
  );
};
