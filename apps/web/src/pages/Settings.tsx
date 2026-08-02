import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { queryClient } from '../lib/queryClient';
import { Copy, Trash2, Mail, ShieldCheck, UserPlus, History, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditLogEntry {
  id: string;
  actor_id: string;
  action: string;
  target_id: string | null;
  details: string | null;
  created_at: string;
}

interface User {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export function Settings() {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  const toggleTheme = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    toast.success(`Theme switched to ${newTheme} mode`);
  };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Fetch current user details
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/auth/me');
      if (!res.ok) throw new Error('Failed to load user session');
      return res.json();
    },
  });

  const currentUser = meData?.user;
  const isOwner = currentUser?.role === 'owner';

  // Fetch team members
  const { data: usersData, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiFetch('/users');
      if (!res.ok) throw new Error('Failed to load team members');
      return res.json();
    },
  });

  const users: User[] = usersData?.users || [];

  // Fetch Org metrics / billing
  const { data: metrics } = useQuery({
    queryKey: queryKeys.dashboardMetrics,
    queryFn: async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      return res.json();
    },
  });

  // Fetch Audit Logs (Owner only)
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['auditLogs', auditPage],
    queryFn: async () => {
      const res = await apiFetch(`/audit-logs?page=${auditPage}&limit=10`);
      if (!res.ok) throw new Error('Failed to load audit logs');
      return res.json();
    },
    enabled: isOwner,
  });

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiFetch('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send invite');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success('Invite created!');
      setInviteEmail('');
      if (data.token) {
        setInviteToken(data.token);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Delete user mutation
  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiFetch(`/users/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to remove user');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('User removed from organization');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleUpgrade = async () => {
    const res = await apiFetch('/billing/create-checkout-session', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      toast.error('Failed to start checkout process');
    }
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate(inviteEmail);
  };

  const copyInviteLink = () => {
    if (!inviteToken) return;
    const link = `${window.location.origin}/signup?invite=${inviteToken}`;
    navigator.clipboard.writeText(link);
    toast.success('Invite link copied to clipboard!');
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2>Settings & Team</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Manage team members, roles, and organization subscription</p>
      </div>

      {/* Subscription Card */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Subscription Plan</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Current Plan: <strong style={{ textTransform: 'uppercase', color: 'var(--accent-ledger)' }}>{metrics?.plan || 'Free'}</strong>
            </p>
          </div>
          {metrics?.plan === 'free' && (
            <button onClick={handleUpgrade} className="btn-primary">
              Upgrade to Pro
            </button>
          )}
          {metrics?.plan === 'pro' && (
            <span style={{ 
              padding: '0.375rem 0.875rem', 
              backgroundColor: 'var(--bg-paper)', 
              border: '1px solid var(--accent-ledger)', 
              color: 'var(--accent-ledger)', 
              borderRadius: '0.25rem', 
              fontWeight: 700, 
              fontSize: '0.75rem',
              textTransform: 'uppercase'
            }}>
              PRO ACTIVE
            </span>
          )}
        </div>
      </div>

      {/* Invite Token Banner (One-time transient alert) */}
      {inviteToken && (
        <div className="alert alert-success" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Mail size={16} /> One-Time Staff Invite Token Generated
          </div>
          <p style={{ fontSize: '0.8125rem' }}>Share this link with your new team member (token expires in 24 hours):</p>
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'center' }}>
            <input 
              type="text" 
              readOnly 
              value={`${window.location.origin}/signup?invite=${inviteToken}`}
              style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.8125rem', border: '1px solid var(--border-tan)', borderRadius: '4px' }}
            />
            <button onClick={copyInviteLink} className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Copy size={14} /> Copy Link
            </button>
          </div>
        </div>
      )}

      {/* Owner-Only Invite Form */}
      {isOwner && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus size={18} /> Invite New Staff Member
          </h3>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.75rem', maxWidth: '500px' }}>
            <input 
              type="email" 
              placeholder="colleague@example.com" 
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              required
              style={{ flex: 1, padding: '0.625rem 0.75rem', border: '1px solid var(--border-tan)', borderRadius: '0.25rem' }}
            />
            <button type="submit" className="btn-primary" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
        </div>
      )}

      {/* Team Members List (Accessible to all authenticated users) */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} /> Organization Members
        </h3>

        {usersLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading members...</p>
        ) : usersError ? (
          <div className="alert alert-danger">Failed to load users</div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Email</th>
                  <th style={{ textAlign: 'left' }}>Role</th>
                  <th style={{ textAlign: 'left' }}>Joined</th>
                  {isOwner && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ fontWeight: 600, padding: '0.75rem 1rem' }}>
                      {u.email} {u.id === currentUser?.userId && <span style={{ fontSize: '0.75rem', color: 'var(--accent-ledger)' }}>(You)</span>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textTransform: 'capitalize' }}>
                      <span style={{ 
                        padding: '0.2rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: u.role === 'owner' ? '#FEF3C7' : '#E0E7FF',
                        color: u.role === 'owner' ? '#92400E' : '#3730A3'
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    {isOwner && (
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        {u.id !== currentUser?.userId && (
                          <button 
                            onClick={() => {
                              if (confirm(`Remove ${u.email} from organization?`)) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                            className="btn-outline"
                            style={{ color: 'var(--accent-rust)', border: '1px solid var(--accent-rust)', padding: '0.25rem 0.5rem' }}
                            title="Revoke user access"
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Theme Engine Settings */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />} Visual Theme Engine
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Customize your workspace interface aesthetic.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={() => toggleTheme('light')} 
            className={`btn-outline ${theme === 'light' ? 'btn-primary' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Sun size={16} /> Light Mode
          </button>
          <button 
            onClick={() => toggleTheme('dark')} 
            className={`btn-outline ${theme === 'dark' ? 'btn-primary' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Moon size={16} /> Dark Mode
          </button>
        </div>
      </div>

      {/* Audit Log Viewer (Owner Only) */}
      {isOwner && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <History size={18} /> Immutable Audit Logs
            </h3>
            {auditData && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Page {auditData.page} of {auditData.total_pages} ({auditData.total} total events)
              </span>
            )}
          </div>

          {auditLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading audit records...</p>
          ) : !auditData || auditData.audit_logs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No audit events recorded yet.</p>
          ) : (
            <div>
              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-paper)' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Timestamp</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Action</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Actor ID</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData.audit_logs.map((log: AuditLogEntry) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <code style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-ledger)' }}>
                            {log.action}
                          </code>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <code style={{ fontSize: '0.75rem' }}>{log.actor_id.slice(0, 8)}...</code>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>
                          {log.details || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Audit Log Pagination Controls */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button 
                  disabled={auditPage <= 1} 
                  onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                  className="btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <button 
                  disabled={auditData && auditPage >= auditData.total_pages} 
                  onClick={() => setAuditPage(p => p + 1)}
                  className="btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
