import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface SearchOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

// Searchable single-select combobox for long lists (markets/coins) where a native
// <select> would be unwieldy. Type to filter; arrow keys + Enter / click to select;
// Esc or outside-click to close. Keyboard-accessible (combobox/listbox roles).
export function SearchSelect({ value, options, onChange, placeholder = 'search…', disabled, style }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : (selected?.label ?? (value ? value.toUpperCase() : ''))}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={openList}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
        style={{ width: '100%', cursor: disabled ? 'not-allowed' : 'text' }}
      />
      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            maxHeight: '220px', overflowY: 'auto',
            background: 'var(--bg-secondary)', border: '1px solid var(--text-secondary)', borderTop: 'none',
          }}
        >
          {filtered.length === 0 ? (
            <div className="text-ter" style={{ padding: '4px 8px', fontSize: '12px' }}>no match</div>
          ) : filtered.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()} // keep input focused
              onClick={() => choose(o.value)}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '3px 8px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap',
                background: i === active ? 'var(--bg-tertiary)' : 'transparent',
                color: o.value === value ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
