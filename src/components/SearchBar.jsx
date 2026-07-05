// src/components/SearchBar.jsx
// Floating product search bar rendered above the map.
// Controlled component — parent owns the query state.
// Debounced so rapid keystrokes don't hammer the filter function.
// Minimum 48 × 48 px touch targets throughout.

import React, { useRef, useEffect, useCallback } from "react";
import { Search, X, MapPin } from "lucide-react";

const DEBOUNCE_MS = 280;

/**
 * @typedef {Object} SearchBarProps
 * @property {string}   value           — controlled query value
 * @property {Function} onChange        — (query: string) => void
 * @property {number}   resultCount     — number of stores matching current query
 * @property {boolean}  loading
 */

/**
 * SearchBar
 * A frosted-glass floating bar with a clear button and animated result count.
 *
 * @param {SearchBarProps} props
 */
export default function SearchBar({
  value = "",
  onChange,
  resultCount = 0,
  loading = false,
}) {
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounce the upstream onChange so the map doesn't re-filter on every keystroke
  const handleInput = useCallback(
    (e) => {
      const raw = e.target.value;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange?.(raw);
      }, DEBOUNCE_MS);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange?.("");
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }, [onChange]);

  // Keep native input in sync when value is cleared externally
  useEffect(() => {
    if (inputRef.current && value === "") {
      inputRef.current.value = "";
    }
  }, [value]);

  // Clean up debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const hasQuery = value.trim().length > 0;

  return (
    <div className="searchbar-wrapper" role="search">
      <div className="searchbar-container">
        {/* Search icon / loading spinner */}
        <span className="searchbar-icon" aria-hidden="true">
          {loading ? (
            <span className="searchbar-spinner" />
          ) : (
            <Search size={20} strokeWidth={2} />
          )}
        </span>

        <input
          ref={inputRef}
          type="search"
          className="searchbar-input"
          placeholder="Search for a product near you…"
          defaultValue={value}
          onInput={handleInput}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Search for a product"
          enterKeyHint="search"
        />

        {/* Clear button — only visible when query is active */}
        {hasQuery && (
          <button
            className="searchbar-clear-btn"
            onClick={handleClear}
            aria-label="Clear search"
            type="button"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Subtle results badge below the search pill */}
      {hasQuery && !loading && (
        <div className="searchbar-results-hint">
          <MapPin size={12} />
          <span>
            {resultCount > 0
              ? `${resultCount} store${resultCount !== 1 ? "s" : ""} found nearby`
              : "No stores found — try a different product name"}
          </span>
        </div>
      )}
    </div>
  );
}
