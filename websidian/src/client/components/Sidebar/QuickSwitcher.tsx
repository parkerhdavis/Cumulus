import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSearch } from "../../hooks/useSearch";

interface QuickSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickSwitcher({ isOpen, onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Debounce query
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const { data } = useSearch(debouncedQuery);
  const results = data?.results ?? [];

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  const navigateToResult = useCallback(
    (path: string) => {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      navigate(`/note/${encoded}`);
      onClose();
    },
    [navigate, onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          navigateToResult(results[selectedIndex].path);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  if (!isOpen) return null;

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div
        className="quick-switcher"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder="Search notes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="quick-switcher-results">
            {results.map((result, i) => (
              <button
                key={result.path}
                className={`quick-switcher-item ${i === selectedIndex ? "quick-switcher-item-selected" : ""}`}
                onClick={() => navigateToResult(result.path)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="quick-switcher-title">{result.title}</span>
                <span className="quick-switcher-path">{result.path}</span>
                {result.match && (
                  <span className="quick-switcher-match">{result.match}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {debouncedQuery.length >= 2 && results.length === 0 && (
          <div className="quick-switcher-empty">No results found</div>
        )}
      </div>
    </div>
  );
}
