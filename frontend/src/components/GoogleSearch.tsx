import { useState } from 'react';
import type { FormEvent } from 'react';

type GoogleSearchProps = {
  onSearch: (query: string) => void;
};

export function GoogleSearch({ onSearch }: GoogleSearchProps) {
  const [query, setQuery] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(query.trim());
  }

  return (
    <form className="search-bar" aria-label="Google search bar" onSubmit={handleSubmit}>
      <span className="search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M21.53 20.47 17.2 16.14a8 8 0 1 0-1.06 1.06l4.33 4.33a.75.75 0 1 0 1.06-1.06ZM4.5 11a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" />
        </svg>
      </span>
      <input
        className="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Google"
        aria-label="Search Google"
        type="search"
      />
      <span className="search-mic" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M12 14.75a3.75 3.75 0 0 0 3.75-3.75V6.75a3.75 3.75 0 1 0-7.5 0V11a3.75 3.75 0 0 0 3.75 3.75Zm5.5-3.75a.75.75 0 0 0-1.5 0 4 4 0 0 1-8 0 .75.75 0 0 0-1.5 0 5.5 5.5 0 0 0 5 5.47V19h-2.5a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H12.75v-2.53a5.5 5.5 0 0 0 4.75-5.47Z" />
        </svg>
      </span>
    </form>
  );
}
