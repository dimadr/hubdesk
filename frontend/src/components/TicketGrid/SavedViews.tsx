import React, { useEffect, useState } from 'react';
import { api, SavedViewResponse } from '../../api/client';
import { useTicketStore } from '../../store/tickets';

export const SavedViews: React.FC = () => {
  const [views, setViews] = useState<SavedViewResponse[]>([]);
  const { setViewType, setActiveTab, setSearch, setColFilter, setLastFilters } = useTicketStore();

  useEffect(() => {
    api.get('/views').then(({ data }) => setViews(data)).catch(() => {});
  }, []);

  const applyView = (view: SavedViewResponse) => {
    if (view.view_type === 'table' || view.view_type === 'card') setViewType(view.view_type);
    if (view.columns.length > 0) {
      window.dispatchEvent(new CustomEvent('ticket-columns-change', { detail: view.columns }));
    }
    const f = view.filters || {};
    if (f.status) setActiveTab(f.status);
    else if (f.archived) setActiveTab('archive');
    else if (f.overdue) setActiveTab('overdue');
    else setActiveTab('all');
    setSearch(f.q || '');
    const colF: Record<string, string | undefined> = {};
    if (f.status) colF.status = f.status;
    if (f.priority) colF.priority = f.priority;
    setColFilter(colF);
    const filters = { ...f };
      if (view.sort_by && view.sort_dir) {
        filters.sort_by = view.sort_by;
        filters.sort_dir = view.sort_dir;
      }
      const automaticFilters: Record<string, any> = {};
      if (f.status) automaticFilters.status = f.status;
      else if (f.archived) automaticFilters.archived = true;
      else if (f.overdue) automaticFilters.overdue = true;
      else automaticFilters.archived = false;
      if (typeof f.q === 'string' && f.q.trim()) automaticFilters.q = f.q.trim();
      if (f.priority) automaticFilters.priority = f.priority;
      setLastFilters(filters);
      window.dispatchEvent(new CustomEvent('ticket-saved-view-apply', {
        detail: { filters, automaticFilters },
      }));
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
