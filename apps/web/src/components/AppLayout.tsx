import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clearTokens, apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <div className="manifest-layout">
      {/* Manifest Shipping-Label Sidebar */}
      <aside className="manifest-sidebar">
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
