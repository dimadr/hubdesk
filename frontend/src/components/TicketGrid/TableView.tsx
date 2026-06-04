import React, { useState, useCallback } from 'react';
import { api, TicketResponse } from '../../api/client';
import { RowStyle } from './RowStyles';
import { ColumnHeader } from './ColumnHeader';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

interface UserInfo {
  id: number; email: string; name: string; role: string;
}

interface Props {
  tickets: TicketResponse[];
  users: UserInfo[];
}

interface ColumnDef {
  key: string; label: string; sticky?: boolean; width?: number;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'number', label: '№', sticky: true, width: 60 },
  { key: 'subject', label: 'Тема', sticky: true, width: 300 },
  { key: 'status', label: 'Статус', width: 140 },
  { key: 'priority', label: 'Приоритет', width: 100 },
  { key: 'customer', label: 'Заказчик', width: 160 },
  { key: 'assignee', label: 'Исполнитель', width: 180 },
  { key: 'created_at', label: 'Создано', width: 140 },
  { key: 'deadline', label: 'Крайний срок', width: 140 },
];

const STATUS_MAP: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', ON_THE_WAY: 'В пути',
  ARRIVED: 'На месте', IN_PROGRESS: 'В работе', REVIEW: 'Проверка', COMPLETED: 'Завершена',
};

const STATUS_CSS: Record<string, string> = {
  ASSIGNED: 'st-assigned', ACCEPTED: 'st-accepted', ON_THE_WAY: 'st-on_the_way',
  ARRIVED: 'st-arrived', IN_PROGRESS: 'st-in_progress', REVIEW: 'st-review', COMPLETED: 'st-completed',
};

const PRIORITY_MAP: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный',
};

export const TableView: React.FC<Props> = ({ tickets, users }) => {
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem('ticket-columns');
      return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
    } catch { return DEFAULT_COLUMNS; }
  });

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const handleReorder = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = columns.findIndex(c => c.key === active.id);
    const newIdx = columns.findIndex(c => c.key === over.id);
    const next = arrayMove(columns, oldIdx, newIdx);
    setColumns(next);
    localStorage.setItem('ticket-columns', JSON.stringify(next));
  };

  const handleResize = useCallback((key: string, width: number) => {
    setColWidths(prev => ({ ...prev, [key]: Math.max(50, width) }));
  }, []);

  const getUserName = (id: number | null) => {
    if (!id) return '—';
    const u = users.find(u => u.id === id);
    return u ? u.name : `#${id}`;
  };

  const handleAssign = async (ticket: TicketResponse, e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const assigneeId = val === '' ? null : Number(val);
    try {
      await api.patch(`/tickets/${ticket.id}/assign`, { assignee_id: assigneeId });
    } catch {}
  };

  const renderCell = (ticket: TicketResponse, col: ColumnDef) => {
    if (col.key === 'subject') {
      return (
        <span className="cell-subject" style={{ fontWeight: ticket.status === 'ASSIGNED' || ticket.response_overdue ? 700 : 400 }}>
          {ticket.subject}
        </span>
      );
    }
    if (col.key === 'status') {
      return <span className={`status-pill ${STATUS_CSS[ticket.status] || ''}`}>{STATUS_MAP[ticket.status] || ticket.status}</span>;
    }
    if (col.key === 'priority') return PRIORITY_MAP[ticket.priority] || ticket.priority;
    if (col.key === 'number') return <span className="mono" style={{ color: 'var(--text-muted)' }}>#{ticket.number}</span>;
    if (col.key === 'created_at') return new Date(ticket.created_at).toLocaleDateString('ru-RU');
    if (col.key === 'customer') return ticket.customer_id;
    if (col.key === 'assignee') return (
      <select
        className="assignee-select"
        value={ticket.assignee_id ?? ''}
        onChange={e => handleAssign(ticket, e)}
        onClick={e => e.stopPropagation()}
      >
        <option value="">— Не назначен —</option>
        {users.filter(u => u.role === 'engineer' || u.role === 'admin').map(u => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    );
    if (col.key === 'deadline') return ticket.response_deadline ? new Date(ticket.response_deadline).toLocaleDateString('ru-RU') : '—';
    return '';
  };

  if (tickets.length === 0) return <div className="loading">Нет заявок</div>;

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <DndContext collisionDetection={closestCenter} onDragEnd={handleReorder}>
              <SortableContext items={columns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
                {columns.map(col => (
                  <ColumnHeader key={col.key} id={col.key} label={col.label} sticky={col.sticky}
                    width={colWidths[col.key] ?? col.width ?? 150} onResize={w => handleResize(col.key, w)} />
                ))}
              </SortableContext>
            </DndContext>
          </tr>
        </thead>
        <tbody>
          {tickets.map(ticket => (
            <RowStyle key={ticket.id} ticket={ticket}>
              {columns.map(col => (
                <td key={col.key} style={{ width: colWidths[col.key] ?? col.width }}>
                  {renderCell(ticket, col)}
                </td>
              ))}
            </RowStyle>
          ))}
        </tbody>
      </table>
    </div>
  );
};
