import React, { useState, useRef, useEffect } from 'react';

interface EditableStockCellProps {
  value: number;
  onSave: (newValue: number) => void;
}

export function EditableStockCell({ value, onSave }: EditableStockCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentValue, setCurrentValue] = useState<number | string>(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    setIsEditing(false);
    const num = typeof currentValue === 'string' ? parseInt(currentValue, 10) : currentValue;
    if (!isNaN(num) && num >= 0 && num !== value) {
      onSave(num);
    } else {
      setCurrentValue(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setCurrentValue(value);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        className="input-group"
        style={{ width: '80px', padding: '0.25rem', margin: 0 }}
        value={currentValue}
        onChange={(e) => setCurrentValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div 
      style={{ cursor: 'pointer', padding: '0.25rem', borderRadius: '4px' }}
      onClick={() => setIsEditing(true)}
      title="Click to edit stock"
    >
      {value}
    </div>
  );
}
