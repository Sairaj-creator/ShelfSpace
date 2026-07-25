import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { apiFetch, clearTokens } from '../lib/api';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (res.ok) {
        const data = await res.json();
        setSubscriptionStatus(data.subscription_status);
      }
    };
    fetchStatus();
  }, [location.pathname]);

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
          <div className="alert alert-warning" style={{ borderRadius: 0, margin: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
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
