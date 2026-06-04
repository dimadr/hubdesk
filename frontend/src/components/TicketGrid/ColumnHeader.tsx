import React, { useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';

interface Props {
  id: string; label: string; sticky?: boolean;
  width: number; onResize: (w: number) => void;
}

export const ColumnHeader: React.FC<Props> = ({ id, label, sticky, width, onResize }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => onResize(startWidth + (ev.clientX - startX));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, onResize]);

  return (
    <th
      ref={setNodeRef}
      style={{
        width,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? 0 : undefined,
        zIndex: sticky ? 2 : 1,
        background: 'var(--bg-surface)',
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {label}
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </th>
  );
};
