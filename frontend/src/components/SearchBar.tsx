import React, { useState } from 'react';
import { useDebounce } from '../hooks/useDebounce';

export const SearchBar: React.FC = () => {
  const [q, setQ] = useState('');

  const handleSearch = useDebounce((value: string) => {
    if (!value.trim()) return;
    if (/^\d+$/.test(value.trim())) {
      window.location.hash = `/tickets/${value.trim()}`;
      return;
    }
    window.location.search = `?q=${encodeURIComponent(value)}`;
  }, 300);

  return (
    <input
      type="text"
      className="search-bar"
      placeholder="Search by number or subject..."
      value={q}
      onChange={(e) => { setQ(e.target.value); handleSearch(e.target.value); }}
    />
  );
};
