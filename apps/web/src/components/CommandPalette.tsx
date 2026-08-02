import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { clearTokens } from '../lib/api';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Toggle the menu when ⌘K is pressed
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-dialog" onClick={(e) => e.stopPropagation()}>
        <Command label="Global Command Menu">
          <Command.Input placeholder="Type a command or search..." autoFocus />
          
          <Command.List>
            <Command.Empty>No results found.</Command.Empty>
            
            <Command.Group heading="Navigation">
              <Command.Item onSelect={() => runCommand(() => navigate('/dashboard'))}>
                Dashboard
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => navigate('/products'))}>
                Products
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => navigate('/orders'))}>
                Orders
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => navigate('/settings'))}>
                Settings & Team
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Account">
              <Command.Item onSelect={() => runCommand(() => {
                clearTokens();
                navigate('/login');
              })}>
                Log Out
              </Command.Item>
            </Command.Group>
            
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
