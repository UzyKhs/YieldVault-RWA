import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardShortcutContext } from '../context/KeyboardShortcutContext';
import { useTranslation } from '../i18n';
import type { ShortcutDefinition } from '../hooks/useKeyboardShortcuts';

/** Simple fuzzy match: every char in `query` appears in `text` in order. */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    ti = t.indexOf(q[qi], ti);
    if (ti === -1) return false;
    ti++;
  }
  return true;
}

const CommandPalette: React.FC = () => {
  const { shortcuts, isPaletteOpen, closePalette, formatShortcut } = useKeyboardShortcutContext();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Actionable shortcuts: exclude Escape and the palette-open shortcut itself
  const actionable = shortcuts.filter(
    (s) => s.key !== 'Escape' && !(s.key === 'k' && s.metaKey),
  );

  const filtered = actionable.filter((s) =>
    fuzzyMatch(s.description, query) || fuzzyMatch(s.scope ?? '', query),
  );

  // Reset state when palette opens
  useEffect(() => {
    if (isPaletteOpen) {
      setQuery('');
      setActiveIndex(0);
      // Focus input after portal renders
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isPaletteOpen]);

  // Keep activeIndex in bounds when filtered list changes
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const runItem = useCallback(
    (shortcut: ShortcutDefinition) => {
      closePalette();
      shortcut.action();
    },
    [closePalette],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) runItem(filtered[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'Tab') {
        // Simple focus trap: the only focusable element is the input
        e.preventDefault();
        inputRef.current?.focus();
      }
    },
    [filtered, activeIndex, runItem, closePalette],
  );

  if (!isPaletteOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.open')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 1100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '560px',
          margin: '0 1rem',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-glass)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="palette-listbox"
            aria-activedescendant={filtered[activeIndex] ? `palette-item-${activeIndex}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.placeholder')}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '1rem',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Results */}
        <ul
          id="palette-listbox"
          ref={listRef}
          role="listbox"
          aria-label={t('palette.placeholder')}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '8px',
            maxHeight: '320px',
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <li
              style={{
                padding: '12px 16px',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                textAlign: 'center',
              }}
            >
              {t('palette.noResults')}
            </li>
          ) : (
            filtered.map((shortcut, index) => (
              <li
                key={`${shortcut.key}-${shortcut.scope ?? ''}`}
                id={`palette-item-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => runItem(shortcut)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: index === activeIndex ? 'var(--bg-card)' : 'transparent',
                  border: index === activeIndex ? '1px solid var(--accent-cyan-dim)' : '1px solid transparent',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                    {shortcut.description}
                  </span>
                  {shortcut.scope && (
                    <span style={{ marginLeft: '8px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {shortcut.scope}
                    </span>
                  )}
                </div>
                <kbd style={{
                  padding: '2px 6px',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '4px',
                  color: 'var(--accent-cyan)',
                  flexShrink: 0,
                }}>
                  {formatShortcut(shortcut)}
                </kbd>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-glass)',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          textAlign: 'center',
        }}>
          {t('palette.hint')}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CommandPalette;
