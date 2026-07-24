import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, TicketResponse } from '../api/client';

interface Task {
  id: number; title: string; description: string; column: string;
  position: number; ticket_id: number | null;
  ticket_subject: string | null; ticket_status: string | null;
  created_at: string;
}

interface UserInfo { id: number; name: string; role: string; }

const COLUMNS = [
  { key: 'project', label: 'В проекте', color: '#34d399', bg: 'rgba(52,211,153,.08)' },
  { key: 'todo', label: 'Дела', color: '#fbbf24', bg: 'rgba(251,191,36,.08)' },
  { key: 'in_progress', label: 'В работе', color: '#ec4899', bg: 'rgba(236,72,153,.08)' },
  { key: 'done', label: 'Завершённые', color: '#60a5fa', bg: 'rgba(96,165,250,.08)' },
];

export const KanbanPage: React.FC<{ role?: string; users?: UserInfo[]; onDetail?: (ticket: TicketResponse) => void; onStatusChange?: (ticket: TicketResponse, target: string) => Promise<void>; currentUserId?: number; viewingEngineerId?: number | null; refreshKey?: number }> = ({ role, users = [], onDetail, onStatusChange, currentUserId, viewingEngineerId, refreshKey }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [addingCol, setAddingCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const selfUserId = Number(localStorage.getItem('currentUserId') || 0);
  const abortRef = useRef<AbortController | null>(null);

  const loadTasks = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const tgtUserId = viewingEngineerId || currentUserId || selfUserId;
    const ptParams: any = {};
    if (viewingEngineerId && (role === 'admin' || role === 'director')) ptParams.user_id = viewingEngineerId;
    try {
      const ptPromise = api.get('/personal-tasks', { params: ptParams, signal: controller.signal });
      const allTickets: TicketResponse[] = [];
      let offset = 0;
      const LIMIT = 200;
      while (!controller.signal.aborted) {
        const { data } = await api.get('/tickets', { params: { assignee_id: tgtUserId, limit: LIMIT, offset }, signal: controller.signal });
        allTickets.push(...data);
        if (data.length < LIMIT) break;
        offset += LIMIT;
      }
      const pt = await ptPromise;
      if (!controller.signal.aborted) {
        setTasks(pt.data);
        setTickets(allTickets);
        setLoadError('');
        setLoading(false);
      }
    } catch (e: any) {
      if (!controller.signal.aborted) {
        setLoadError(e.response?.data?.detail || 'Ошибка загрузки данных');
        setLoading(false);
      }
    }
  }, [currentUserId, selfUserId, viewingEngineerId, role]);

  useEffect(() => {
    setLoading(true);
    setTasks([]);
    setTickets([]);
    loadTasks();
  }, [loadTasks, refreshKey]);

  const ticketToColumn = (status: string) => {
    if (status === 'ASSIGNED') return 'project';
    if (status === 'ACCEPTED') return 'todo';
    if (status === 'IN_PROGRESS') return 'in_progress';
    if (status === 'COMPLETED') return 'done';
    return 'project';
  };

  const addTask = async (column: string) => {
    if (!newTitle.trim() || taskLoading) return;
    setTaskLoading(true);
    try {
      const body: any = { title: newTitle, column };
      if ((role === 'admin' || role === 'director') && viewingEngineerId) body.user_id = viewingEngineerId;
      await api.post('/personal-tasks', body);
      setNewTitle('');
      setAddingCol(null);
      loadTasks();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка создания задачи');
    } finally {
      setTaskLoading(false);
    }
  };

  const moveTask = async (taskId: number, toColumn: string) => {
    setTaskLoading(true);
    try {
      await api.patch(`/personal-tasks/${taskId}`, { column: toColumn });
      loadTasks();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка перемещения задачи');
    } finally {
      setTaskLoading(false);
    }
  };

  const deleteTask = async (taskId: number) => {
    setTaskLoading(true);
    try {
      await api.delete(`/personal-tasks/${taskId}`);
      loadTasks();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка удаления задачи');
    } finally {
      setTaskLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData('taskId', String(taskId));
  };

  const columnToStatus: Record<string, string> = {
    project: 'ASSIGNED', todo: 'ACCEPTED', in_progress: 'IN_PROGRESS', done: 'COMPLETED',
  };

  const handleDrop = async (e: React.DragEvent, column: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = Number(e.dataTransfer.getData('taskId'));
    const ticketId = Number(e.dataTransfer.getData('ticketId'));
    if (taskId) {
      await moveTask(taskId, column);
    } else if (ticketId) {
      const targetStatus = columnToStatus[column];
      const ticket = tickets.find(t => t.id === ticketId);
      if (targetStatus && ticket && ticket.status !== targetStatus) {
        if (targetStatus === 'COMPLETED' && onStatusChange) {
          onStatusChange(ticket, 'COMPLETED');
        } else {
          try {
            await api.patch(`/tickets/${ticketId}/status`, { status: targetStatus });
            setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: targetStatus } : t));
          } catch (e: any) {
            alert(e.response?.data?.detail || 'Ошибка смены статуса');
          }
        }
      }
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;
  if (loadError) return <div style={{ padding: 24, color: 'var(--danger)', textAlign: 'center' }}>{loadError}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Моя доска</h2>
        {viewingEngineerId && (role === 'admin' || role === 'director') && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Доска: {users.find(u => u.id === viewingEngineerId)?.name || `#${viewingEngineerId}`}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {COLUMNS.map(col => (
          <div
            key={col.key}
            style={{
              background: col.bg, borderRadius: 10, padding: 12,
              border: dragOverCol === col.key ? '2px dashed var(--primary)' : '2px solid transparent',
              minHeight: 200,
            }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(col.key); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => handleDrop(e, col.key)}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: col.color }}>
              {col.label} ({tasks.filter(t => t.column === col.key).length + tickets.filter(t => ticketToColumn(t.status) === col.key).length})
            </div>
            {tickets.filter(t => ticketToColumn(t.status) === col.key).map(t => (
              <div
                key={`ticket-${t.id}`}
                draggable
                onDragStart={e => e.dataTransfer.setData('ticketId', String(t.id))}
                onClick={() => onDetail?.(t)}
                style={{
                  background: 'var(--bg-card)', borderRadius: 7, padding: 10, marginBottom: 8,
                  border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer',
                  borderLeft: `3px solid ${t.priority === 'critical' ? '#f87171' : t.priority === 'high' ? '#fbbf24' : 'var(--border)'}`,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>#{t.number}</span> {t.subject}
                </div>
                {(t.location_name || t.location_address) && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {t.location_name || ''}{t.location_address ? ` — ${t.location_address}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.priority === 'critical' ? 'Критический' : t.priority === 'high' ? 'Высокий' : t.priority === 'medium' ? 'Средний' : 'Низкий'}</div>
              </div>
            ))}
            {tasks.filter(t => t.column === col.key).map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={e => handleDragStart(e, t.id)}
                style={{
                  background: 'var(--bg-card)', borderRadius: 7, padding: 10, marginBottom: 8,
                  cursor: 'grab', border: '1px solid var(--border)', fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.title}</div>
                {t.ticket_subject && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    #{t.ticket_id} {t.ticket_subject}
                  </div>
                )}
                {t.description && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{t.description}</div>
                )}
                <button
                  onClick={() => deleteTask(t.id)}
                  style={{ marginTop: 6, padding: '0 4px', fontSize: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >удалить</button>
              </div>
            ))}
            {addingCol === col.key ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !taskLoading) addTask(col.key); if (e.key === 'Escape') setAddingCol(null); }}
                  placeholder="Название задачи"
                  disabled={taskLoading}
                  style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-surface)', color: 'var(--text)' }}
                />
                <button onClick={() => addTask(col.key)} disabled={taskLoading} style={{ padding: '2px 6px', fontSize: 11 }}>✓</button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingCol(col.key); setNewTitle(''); }}
                style={{ padding: '4px 8px', fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', width: '100%', textAlign: 'left' }}
              >+ добавить</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
