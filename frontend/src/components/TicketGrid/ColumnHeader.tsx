import React, { useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';

interface Props {
  id: string; label: string; sticky?: boolean;
  width: number; colKey: string; onResize: (key: string, w: number) => void;
  stickyLeft?: number;
  stickyRight?: boolean;
}

export const ColumnHeader: React.FC<Props> = ({ id, label, sticky, width, colKey, onResize, stickyLeft, stickyRight }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => onResize(colKey, startWidth + (ev.clientX - startX));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, colKey, onResize]);

  return (
    <th
      ref={setNodeRef}
      style={{
        width,
        position: sticky ? 'sticky' : undefined,
        left: sticky && !stickyRight ? (stickyLeft ?? 0) : undefined,
        right: sticky && stickyRight ? 0 : undefined,
        zIndex: sticky ? 2 : 1,
        background: 'var(--bg-surface)',
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
      {...attributes}
    >
      <span {...listeners}>{label}</span>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </th>
  );
};
