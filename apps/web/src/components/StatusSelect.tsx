import React, { useState, useRef, useEffect } from 'react';
import { StatusBadge } from './StatusBadge';

interface StatusSelectProps {
  status: string;
  onChange: (newStatus: string) => void;
  disabled?: boolean;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function StatusSelect({ status, onChange, disabled }: StatusSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const isTerminal = status === 'cancelled' || disabled;

  // Filter allowed options based on state machine:
  // - pending: can become fulfilled or cancelled
  // - fulfilled: can become cancelled, but CANNOT go back to pending
  // - cancelled: terminal
  const allowedOptions = STATUS_OPTIONS.filter((opt) => {
    if (status === 'fulfilled' && opt.value === 'pending') return false;
    return true;
  });

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isTerminal) return;

    if (!isOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setIsOpen(true);
        const idx = allowedOptions.findIndex((opt) => opt.value === status);
        setFocusedIndex(idx >= 0 ? idx : 0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % allowedOptions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + allowedOptions.length) % allowedOptions.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        const selected = allowedOptions[focusedIndex];
        if (selected && selected.value !== status) {
          onChange(selected.value);
        }
        setIsOpen(false);
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  if (isTerminal) {
    return (
      <div 
        style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.85 }} 
        title="Terminal status cannot be changed"
        aria-disabled="true"
      >
        <StatusBadge status={status} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Change order status"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          outlineOffset: '2px',
        }}
      >
        <StatusBadge status={status} />
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>▾</span>
      </button>

      {isOpen && (
        <ul
          role="listbox"
          aria-label="Order status options"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            marginTop: '0.25rem',
            padding: '0.25rem 0',
            backgroundColor: 'var(--bg-white)',
            border: '1px solid var(--border-tan)',
            borderRadius: '0.25rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            listStyle: 'none',
            minWidth: '110px',
          }}
        >
          {allowedOptions.map((opt, idx) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === status}
              onClick={() => {
                if (opt.value !== status) onChange(opt.value);
                setIsOpen(false);
              }}
              onMouseEnter={() => setFocusedIndex(idx)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: opt.value === status ? 700 : 500,
                cursor: 'pointer',
                backgroundColor: idx === focusedIndex ? 'var(--bg-card)' : 'transparent',
                color: 'var(--text-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{opt.label}</span>
              {opt.value === status && <span style={{ fontSize: '0.75rem' }}>✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
