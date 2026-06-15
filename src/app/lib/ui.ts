import type { CSSProperties, KeyboardEvent } from 'react';

// Make a non-button element (span/div) behave like an accessible button:
// keyboard-operable (Enter/Space) with the right ARIA role.
export function chipProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    },
  };
}

// Shared <select> styling to match the terminal inputs.
export const selectStyle: CSSProperties = {
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-light)',
  fontFamily: 'var(--font-family)',
  fontSize: 'var(--font-size)',
  padding: '2px 4px',
};
