import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

export default function CourseSearch({ onSelect, placeholder = 'Search for a course…', autoFocus = false }) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState([]);
  const [open,      setOpen]      = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get(`/courses/search?q=${encodeURIComponent(q)}`);
        setResults(data.courses ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (course) => {
    const name = course.course_name || course.club_name;
    setQuery(name);
    onSelect(name, course.id);
    setOpen(false);
    setResults([]);
  };

  return (
    <div ref={wrapRef} className="course-search-wrap">
      <input
        className="form-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {searching && <span className="course-search-spinner" />}
      {open && results.length > 0 && (
        <ul className="course-dropdown">
          {results.slice(0, 8).map((c) => {
            const name = c.course_name || c.club_name;
            const loc  = [c.location?.city, c.location?.country].filter(Boolean).join(', ');
            return (
              <li key={c.id} className="course-dropdown-item" onMouseDown={() => select(c)}>
                <span className="course-dropdown-name">{name}</span>
                {loc && <span className="course-dropdown-loc">{loc}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
