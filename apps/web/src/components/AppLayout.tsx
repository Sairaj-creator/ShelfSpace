import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clearTokens, apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { CommandPalette } from './CommandPalette';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isInitializing, setIsInitializing] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change for mobile
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    // Attempt to verify session (this will trigger a silent refresh if needed)
    apiFetch('/auth/me')
      .catch((e) => console.error('Session verification failed', e))
      .finally(() => setIsInitializing(false));
  }, []);

  const { data: metrics } = useQuery({
    queryKey: queryKeys.dashboardMetrics,
    queryFn: async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000, // Reuse fresh data across AppLayout and Dashboard
  });

  const subscriptionStatus = metrics?.subscription_status || null;

  const handleLogout = () => {
    clearTokens();
    navigate('/login');
  };

  if (isInitializing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg-paper)' }}>
        <div style={{ color: 'var(--text-muted)' }}>Verifying secure session...</div>
      </div>
    );
  }

  return (
    <div className="manifest-layout">
      <CommandPalette />
      
      {/* Mobile Sidebar Overlay */}
      <div 
        className={`manifest-sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Manifest Shipping-Label Sidebar */}
      <aside className={`manifest-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="manifest-brand">
          <div className="manifest-brand-title">SHELFSPACE</div>
          <div className="manifest-brand-sub">Inventory Manifest</div>
        </div>
        
        <nav className="manifest-nav">
          <Link 
            to="/dashboard" 
            className={`manifest-nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}
          >
            <span className="manifest-nav-num">01.</span>
            <span>Dashboard</span>
          </Link>
          <Link 
            to="/products" 
            className={`manifest-nav-item ${location.pathname === '/products' ? 'active' : ''}`}
          >
            <span className="manifest-nav-num">02.</span>
            <span>Products</span>
          </Link>
          <Link 
            to="/orders" 
            className={`manifest-nav-item ${location.pathname === '/orders' ? 'active' : ''}`}
          >
            <span className="manifest-nav-num">03.</span>
            <span>Orders</span>
          </Link>
          <Link 
            to="/settings" 
            className={`manifest-nav-item ${location.pathname === '/settings' ? 'active' : ''}`}
          >
            <span className="manifest-nav-num">04.</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="manifest-footer">
          <button 
            onClick={handleLogout} 
            className="btn-outline" 
            style={{ width: '100%', textAlign: 'center' }}
          >
            Log Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* Mobile Header */}
        <header className="mobile-header">
          <div className="manifest-brand-title" style={{ fontSize: '1.2rem', marginBottom: 0 }}>
            ShelfSpace
          </div>
          <button 
            className="btn-outline" 
            style={{ padding: '0.4rem' }}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
        </header>

        {/* Past Due Warning Banner */}
        {subscriptionStatus === 'past_due' && (
          <div className="alert alert-warning alert-banner-fullwidth">
            <strong>Payment Required:</strong> Your subscription is past due. Please update billing to maintain active ledger access.
          </div>
        )}

        {/* Page Container */}
        <main className="manifest-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
