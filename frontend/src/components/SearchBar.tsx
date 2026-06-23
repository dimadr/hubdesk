import React, { useState } from 'react';
import { useDebounce } from '../hooks/useDebounce';

export const SearchBar: React.FC = () => {
  const [q, setQ] = useState('');

  const handleSearch = useDebounce((value: string) => {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
      return;
    }
    if (/^\d+$/.test(trimmedValue)) {
      window.location.hash = `/tickets/${trimmedValue}`;
      return;
    }
    window.location.search = `?q=${encodeURIComponent(trimmedValue)}`;
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
