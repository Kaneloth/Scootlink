// src/components/gigs/AddressAutocompleteInput.jsx
//
// destination: src/components/gigs/AddressAutocompleteInput.jsx
//
// Debounced (400ms), min-3-char live suggestions via searchLocationSuggestions()
// (Photon-only, new — see lib/geocode.js). Selecting a suggestion sets coords
// directly from that response, no second lookup needed.
//
// Fallback: if the user types and blurs WITHOUT picking a suggestion (e.g.
// Photon had nothing, or they typed faster than the debounce), falls back to
// the original geocodeLocation() full 3-service chain on blur — same
// robustness as before, live suggestions are an enhancement on top, not a
// replacement for the fallback chain's reliability.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import { geocodeLocation, searchLocationSuggestions } from '@/lib/geocode';

export default function AddressAutocompleteInput({ value, onChange, onResolved, placeholder, className = '' }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  // True only when the user has typed since the value was last resolved.
  // Picking a suggestion, or the parent setting the value itself (e.g.
  // "Use current location" with GPS coords), leaves it false, so blur
  // won't re-geocode and overwrite coordinates that are already right.
  const typedSinceResolveRef = useRef(false);
  // Latest text, so a slow lookup can tell whether the user kept typing.
  const latestTextRef = useRef(value);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTextChange = (text) => {
    onChange(text);
    onResolved(null); // typing invalidates any previously-resolved coords
    typedSinceResolveRef.current = true;
    latestTextRef.current = text;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchLocationSuggestions(text);
        // Ignore results for text the user has since changed or resolved.
        if (latestTextRef.current !== text || !typedSinceResolveRef.current) return;
        setSuggestions(results);
        setShowDropdown(results.length > 0);
      } catch (err) {
        console.error('[AddressAutocompleteInput] suggestion search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const handleSelect = (suggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    typedSinceResolveRef.current = false;
    latestTextRef.current = suggestion.displayName;
    onChange(suggestion.displayName);
    onResolved(suggestion);
    setShowDropdown(false);
    setSuggestions([]);
  };

  const handleBlur = useCallback(async () => {
    // Delay so a click on a dropdown item registers before blur closes it
    setTimeout(async () => {
      setShowDropdown(false);
    }, 150);

    if (!value || value.trim().length === 0) return;
    // Nothing typed since the last resolve (suggestion picked, or coords set
    // by the parent): keep the coordinates we already have.
    if (!typedSinceResolveRef.current) return;
    const text = value;
    setResolving(true);
    try {
      const coords = await geocodeLocation(text);
      // Only apply if the user hasn't typed something else meanwhile.
      if (coords && latestTextRef.current === text) {
        typedSinceResolveRef.current = false;
        onResolved(coords);
      }
    } catch (err) {
      console.error('[AddressAutocompleteInput] fallback geocode failed:', err);
    } finally {
      setResolving(false);
    }
  }, [value, onResolved]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          className={className}
          value={value}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
        />
        {(searching || resolving) && (
          <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              // onMouseDown fires before the input's onBlur — needed so the
              // click registers before the blur handler closes the dropdown
              onMouseDown={() => handleSelect(s)}
              className="flex items-start gap-2 w-full px-3 py-2.5 text-sm text-left hover:bg-accent transition-colors"
            >
              <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
              <span>{s.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
