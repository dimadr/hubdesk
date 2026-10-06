import React from 'react';
import { useTicketStore } from '../../store/tickets';

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'ASSIGNED', label: 'Назначены' },
  { key: 'IN_PROGRESS', label: 'В работе' },
  { key: 'overdue', label: 'Просрочены' },
  { key: 'archive', label: 'Архив' },
];

export const Tabs: React.FC = () => {
  const { activeTab, setActiveTab } = useTicketStore();

  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`tab ${activeTab === tab.key ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
