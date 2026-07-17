import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useTicketStore } from '../../store/tickets';
import { Tabs } from './Tabs';
import { SavedViews } from './SavedViews';
import { TableView } from './TableView';
import { CardView } from './CardView';
import { TreeView } from './TreeView';

interface UserInfo {
  id: number; email: string; name: string; role: string;
}

type ColFilter = Record<string, string | undefined>;

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

export const TicketGrid: React.FC<{ users: UserInfo[]; onEdit?: (ticket: any) => void; onDetail?: (ticket: any) => void; onStatusChange?: (ticket: any, status: string) => void; onDelete?: (ticket: any) => void; currentUserId?: number; role?: string }> = ({ users, onEdit, onDetail, onStatusChange, onDelete, currentUserId, role }) => {
  const { tickets, activeTab, viewType, fetchTickets, loading } = useTicketStore();
  const [search, setSearch] = useState('');
  const [colFilter, setColFilter] = useState<ColFilter>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      if (search.length > 0 && search.length < 2) return;

      const filters: Record<string, any> = {};
      if (activeTab === 'overdue') filters.overdue = true;
      else if (activeTab === 'archive') { filters.archived = true; }
      else if (activeTab !== 'all') filters.status = activeTab;
      if (activeTab === 'all') filters.archived = false;
      if (search.trim()) filters.q = search.trim();
      const { created, deadline, ...apiFilters } = colFilter;
      Object.assign(filters, apiFilters);

      await fetchTickets(filters, controller.signal);
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, search, colFilter, fetchTickets]);

  const toggleFilter = useCallback((key: string, value: string) => {
    setColFilter(prev => prev[key as keyof ColFilter] === value ? { ...prev, [key]: undefined } : { ...prev, [key]: value });
  }, []);

  const clearFilter = useCallback(() => setColFilter({}), []);

  const filteredTickets = useMemo(() => {
    if (!colFilter.deadline && !colFilter.created) return tickets;
    return tickets.filter(t => {
      if (colFilter.deadline && t.resolution_deadline?.substring(0, 10) !== colFilter.deadline) return false;
      if (colFilter.created && t.created_at?.substring(0, 10) !== colFilter.created) return false;
      return true;
    });
  }, [tickets, colFilter.deadline, colFilter.created]);

  const filterLabels: { key: string; label: string }[] = [];
  if (colFilter.status) filterLabels.push({ key: 'status', label: `Статус: ${STATUS_LABELS[colFilter.status] || colFilter.status}` });
  if (colFilter.priority) filterLabels.push({ key: 'priority', label: `Приоритет: ${PRIORITY_LABELS[colFilter.priority] || colFilter.priority}` });
  if (colFilter.deadline) filterLabels.push({ key: 'deadline', label: `Срок: ${colFilter.deadline}` });
  if (colFilter.created) filterLabels.push({ key: 'created', label: `Создано: ${colFilter.created}` });

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
      {filterLabels.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {filterLabels.map(f => (
            <span key={f.key} className="status-pill" style={{ cursor: 'pointer', background: 'var(--primary-bg)', color: 'var(--primary)', fontSize: 11 }} onClick={() => setColFilter(prev => ({ ...prev, [f.key]: undefined }))}>
              {f.label} ✕
            </span>
          ))}
          <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={clearFilter}>Сбросить</button>
        </div>
      )}
      {loading ? <div className="loading">Загрузка...</div> : (
        viewType === 'table' ? <TableView tickets={filteredTickets} users={users} onEdit={onEdit} onDetail={onDetail} onStatusChange={onStatusChange} onDelete={onDelete} currentUserId={currentUserId} role={role} colFilter={colFilter} onFilter={toggleFilter} /> :
        viewType === 'card' ? <CardView tickets={filteredTickets} users={users} onDetail={onDetail} /> :
        <TreeView tickets={filteredTickets} onDetail={onDetail} />
      )}
    </div>
  );
};

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', IN_PROGRESS: 'В работе', COMPLETED: 'Завершена',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный',
};
