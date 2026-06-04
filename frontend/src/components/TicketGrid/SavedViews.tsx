import React, { useEffect, useState } from 'react';
import { api, SavedViewResponse } from '../../api/client';
import { useTicketStore } from '../../store/tickets';

export const SavedViews: React.FC = () => {
  const [views, setViews] = useState<SavedViewResponse[]>([]);
  const { setViewType, fetchTickets } = useTicketStore();

  useEffect(() => {
    api.get('/views').then(({ data }) => setViews(data)).catch(() => {});
  }, []);

  const applyView = (view: SavedViewResponse) => {
    setViewType(view.view_type as any);
    fetchTickets(view.filters);
  };

  return (
    <select onChange={(e) => {
      const view = views.find((v) => v.id === Number(e.target.value));
      if (view) applyView(view);
    }} defaultValue="">
      <option value="">Сохранённые представления...</option>
      {views.map((v) => (
        <option key={v.id} value={v.id}>{v.name}</option>
      ))}
    </select>
  );
};
