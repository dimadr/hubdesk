import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { api, TicketResponse } from '../../api/client';
import { RowStyle } from './RowStyles';
import { ColumnHeader } from './ColumnHeader';
import { useTicketStore } from '../../store/tickets';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

interface UserInfo {
  id: number; email: string; name: string; patronymic?: string; role: string;
}

interface Props {
  tickets: TicketResponse[];
  users: UserInfo[];
  onEdit?: (ticket: TicketResponse) => void;
  onDetail?: (ticket: TicketResponse) => void;
  onStatusChange?: (ticket: TicketResponse, targetStatus: string) => Promise<void>;
  onDelete?: (ticket: TicketResponse) => void;
  currentUserId?: number;
  role?: string;
  colFilter?: Record<string, string | undefined>;
  onFilter?: (key: string, value: string) => void;
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
  { key: 'actions', label: '', width: 40, sticky: true },
];

const STATUS_MAP: Record<string, string> = {
  ASSIGNED: 'Назначена', ACCEPTED: 'Принята', IN_PROGRESS: 'В работе', COMPLETED: 'Завершена',
};

const STATUS_CSS: Record<string, string> = {
  ASSIGNED: 'st-assigned', ACCEPTED: 'st-accepted', IN_PROGRESS: 'st-in_progress', COMPLETED: 'st-completed',
};

const PRIORITY_MAP: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный',
};

const FILTERABLE_COLUMNS = ['status', 'priority', 'created_at', 'deadline'];

const NEXT_STATUS: Record<string, string> = {
  ASSIGNED: 'ACCEPTED', ACCEPTED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED',
};
const STATUS_BUTTON_LABELS: Record<string, string> = {
  ACCEPTED: 'Принять', IN_PROGRESS: 'В работу', COMPLETED: 'Завершить',
};
const CAN_ACCEPT = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

interface CellProps {
  ticket: TicketResponse;
  col: ColumnDef;
  width: number;
  userMap: Map<number, string>;
  engineerIds: number[];
  onEdit?: (ticket: TicketResponse) => void;
  onStatusChange?: (ticket: TicketResponse, targetStatus: string) => Promise<void>;
  onDelete?: (ticket: TicketResponse) => void;
  currentUserId?: number;
  role?: string;
  onFilter?: (key: string, value: string) => void;
  onAssigneeChanged: (ticketId: number, assigneeId: number | null) => void;
  stickyLeft?: number;
  stickyRight?: boolean;
}

const Cell = React.memo<CellProps>(({ ticket, col, width, userMap, engineerIds, onEdit, onStatusChange, onDelete, currentUserId, role, onFilter, onAssigneeChanged, stickyLeft, stickyRight }) => {
  const content = renderCellContent(ticket, col, userMap, engineerIds, onEdit, onStatusChange, onDelete, currentUserId, role, onAssigneeChanged);
  const isFilterable = FILTERABLE_COLUMNS.includes(col.key);

  const clickHandler = isFilterable ? () => {
    if (col.key === 'status') onFilter?.('status', ticket.status);
    else if (col.key === 'priority') onFilter?.('priority', ticket.priority);
    else if (col.key === 'created_at') {
      const d = ticket.created_at?.substring?.(0, 10);
      if (d) onFilter?.('created', d);
    } else if (col.key === 'deadline') {
      const d = ticket.resolution_deadline?.substring?.(0, 10);
      if (d) onFilter?.('deadline', d);
    }
  } : undefined;

  const handleActionsClick = col.key === 'actions' ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  const isSticky = stickyLeft !== undefined || stickyRight;
  const tdStyle: React.CSSProperties = {
    width,
    position: isSticky ? 'sticky' : undefined,
    left: stickyLeft !== undefined ? stickyLeft : undefined,
    right: stickyRight ? 0 : undefined,
    zIndex: isSticky ? 1 : undefined,
    background: 'var(--bg-surface)',
  };

  return (
    <td style={tdStyle} onClick={handleActionsClick}>
      {isFilterable ? (
        <button
          className="cell-filter-btn"
          onClick={clickHandler}
          title="Фильтр по значению"
          style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', width: '100%', display: 'block', cursor: 'pointer', textAlign: 'left' }}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </td>
  );
});

function renderCellContent(ticket: TicketResponse, col: ColumnDef, userMap: Map<number, string>, engineerIds: number[], onEdit?: (ticket: TicketResponse) => void, onStatusChange?: (ticket: TicketResponse, targetStatus: string) => void, onDelete?: (ticket: TicketResponse) => void, currentUserId?: number, role?: string, onAssigneeChanged?: (ticketId: number, assigneeId: number | null) => void) {
  if (col.key === 'subject') {
    return (
      <span className="cell-subject" style={{ fontWeight: ticket.status === 'ASSIGNED' || ticket.response_overdue ? 700 : 400 }}>
        {ticket.subject}
      </span>
    );
  }
  if (col.key === 'status') {
    return (
      <span className={`status-pill ${STATUS_CSS[ticket.status] || ''}`}>
        {STATUS_MAP[ticket.status] || ticket.status}
      </span>
    );
  }
  if (col.key === 'priority') return PRIORITY_MAP[ticket.priority] || ticket.priority;
  if (col.key === 'number') return <span className="mono" style={{ color: 'var(--text-muted)' }}>#{ticket.number}</span>;
  if (col.key === 'created_at') {
    try { return new Date(ticket.created_at).toLocaleDateString('ru-RU'); }
    catch { return ticket.created_at?.substring(0, 10) || '—'; }
  }
  if (col.key === 'customer') return ticket.customer_name || ticket.customer_id;
  if (col.key === 'assignee') {
    const canAssign = role === 'admin' || role === 'director' || role === 'dispatcher';
    if (!canAssign) return <span>{userMap.get(ticket.assignee_id!) || ticket.assignee_id || '—'}</span>;
    return (
    <select
      className="assignee-select"
      value={ticket.assignee_id ?? ''}
      onChange={async (e) => {
        const val = e.target.value;
        const assigneeId = val === '' ? null : Number(val);
        try {
          await api.patch(`/tickets/${ticket.id}/assign`, { assignee_id: assigneeId });
          onAssigneeChanged?.(ticket.id, assigneeId);
        } catch {
          alert('Ошибка назначения исполнителя');
        }
      }}
      onClick={e => e.stopPropagation()}
    >
      <option value="">— Не назначен —</option>
      {engineerIds.map(id => (
        <option key={id} value={id}>{userMap.get(id) || `#${id}`}</option>
      ))}
    </select>
  );
  }
  if (col.key === 'deadline') {
    try { return ticket.resolution_deadline ? new Date(ticket.resolution_deadline).toLocaleDateString('ru-RU') : '—'; }
    catch { return ticket.resolution_deadline?.substring(0, 10) || '—'; }
  }
  if (col.key === 'actions') return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {ticket.status !== 'COMPLETED' && NEXT_STATUS[ticket.status] &&
        CAN_ACCEPT.includes(ticket.status) && currentUserId === ticket.assignee_id &&
        onStatusChange && (
        <button
          className="btn btn-success"
          style={{ padding: '2px 6px', fontSize: 10, lineHeight: 1.2 }}
          onClick={async e => {
            e.stopPropagation();
            try {
              await onStatusChange(ticket, NEXT_STATUS[ticket.status]);
            } catch (err: any) {
              alert(err.response?.data?.detail || err.message || 'Ошибка смены статуса');
            }
          }}
          title={`Перевести в ${NEXT_STATUS[ticket.status]}`}
        >→ {STATUS_BUTTON_LABELS[NEXT_STATUS[ticket.status]]}</button>
      )}
      <button
        className="btn btn-secondary"
        style={{ padding: '2px 6px', fontSize: 11, lineHeight: 1 }}
        onClick={e => { e.stopPropagation(); onEdit?.(ticket); }}
        title="Редактировать"
      >✎</button>
      {(role === 'admin' || role === 'director') && onDelete && (
        <button
          className="btn btn-danger"
          style={{ padding: '2px 6px', fontSize: 11, lineHeight: 1 }}
          onClick={e => { e.stopPropagation(); onDelete(ticket); }}
          title="Удалить"
        >✕</button>
      )}
    </span>
  );
  return '';
}

export const TableView: React.FC<Props> = ({ tickets, users, onEdit, onDetail, onStatusChange, onDelete, currentUserId, role, colFilter, onFilter }) => {
  const updateTicket = useTicketStore(s => s.updateTicket);
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem('ticket-columns-v2');
      return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
    } catch { return DEFAULT_COLUMNS; }
  });

  useEffect(() => {
    const applyColumns = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail;
      if (!Array.isArray(keys)) return;
      const next = keys
        .map(key => DEFAULT_COLUMNS.find(column => column.key === key))
        .filter((column): column is ColumnDef => Boolean(column));
      if (next.length === 0) return;
      setColumns(next);
      localStorage.setItem('ticket-columns-v2', JSON.stringify(next));
    };
    window.addEventListener('ticket-columns-change', applyColumns);
    return () => window.removeEventListener('ticket-columns-change', applyColumns);
  }, []);

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const userMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) m.set(u.id, [u.name, u.patronymic].filter(Boolean).join(' '));
    return m;
  }, [users]);

  const engineerIds = useMemo(
    () => users.filter(u => u.role === 'engineer').map(u => u.id),
    [users]
  );

  const handleReorder = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = columns.findIndex(c => c.key === active.id);
    const newIdx = columns.findIndex(c => c.key === over.id);
    const next = arrayMove(columns, oldIdx, newIdx);
    setColumns(next);
    localStorage.setItem('ticket-columns-v2', JSON.stringify(next));
  }, [columns]);

  const handleResize = useCallback((key: string, width: number) => {
    setColWidths(prev => ({ ...prev, [key]: Math.max(50, width) }));
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter(c => c.key !== 'actions' || onEdit),
    [columns, onEdit]
  );

  const stickyOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let cumLeft = 0;
    for (const col of visibleColumns) {
      if (col.sticky && col.key !== 'actions') {
        offsets[col.key] = cumLeft;
        cumLeft += colWidths[col.key] ?? col.width ?? 150;
      }
    }
    return offsets;
  }, [visibleColumns, colWidths]);

  if (tickets.length === 0) return <div className="loading">Нет заявок</div>;

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleReorder}>
      <SortableContext items={visibleColumns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {visibleColumns.map(col => (
                  <ColumnHeader key={col.key} id={col.key} label={col.label} sticky={col.sticky}
                    colKey={col.key} width={colWidths[col.key] ?? col.width ?? 150} onResize={handleResize}
                    stickyLeft={stickyOffsets[col.key]}
                    stickyRight={col.key === 'actions'} />
                ))}
              </tr>
            </thead>
        <tbody>
          {tickets.map(ticket => (
            <RowStyle key={ticket.id} ticket={ticket} onClick={() => onDetail?.(ticket)}>
              {visibleColumns.map(col => (
                  <Cell
                    key={col.key}
                    ticket={ticket}
                    col={col}
                    width={colWidths[col.key] ?? col.width ?? 100}
                    userMap={userMap}
                    engineerIds={engineerIds}
                    onEdit={onEdit}
                    onStatusChange={onStatusChange}
                    onDelete={onDelete}
                    currentUserId={currentUserId}
                    role={role}
                    onFilter={onFilter}
                    onAssigneeChanged={(ticketId, assigneeId) => updateTicket(ticketId, { assignee_id: assigneeId })}
                    stickyLeft={stickyOffsets[col.key]}
                    stickyRight={col.key === 'actions'}
                />
              ))}
            </RowStyle>
          ))}
        </tbody>
      </table>
    </div>
      </SortableContext>
    </DndContext>
  );
};
