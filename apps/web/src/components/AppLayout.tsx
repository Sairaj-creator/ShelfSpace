import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { apiFetch, clearTokens } from '../lib/api';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  useEffect(() => {
    // We can fetch metrics here just to get the subscription status for the banner,
    // or rely on child components to pass it up. For simplicity, we fetch it here.
    const fetchStatus = async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (res.ok) {
        const data = await res.json();
        setSubscriptionStatus(data.subscription_status);
      }
    };
    fetchStatus();
  }, [location.pathname]); // refetch on navigation

  const handleLogout = () => {
    clearTokens();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ width: '250px', backgroundColor: 'white', borderRight: '1px solid var(--border-color)', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', color: 'var(--primary-color)' }}>ShelfSpace</h1>
        
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flexGrow: 1 }}>
          <Link to="/dashboard" style={{ padding: '0.75rem', borderRadius: '0.375rem', backgroundColor: location.pathname === '/dashboard' ? 'var(--background-color)' : 'transparent', color: location.pathname === '/dashboard' ? 'var(--primary-color)' : 'var(--text-primary)' }}>Dashboard</Link>
          <Link to="/products" style={{ padding: '0.75rem', borderRadius: '0.375rem', backgroundColor: location.pathname === '/products' ? 'var(--background-color)' : 'transparent', color: location.pathname === '/products' ? 'var(--primary-color)' : 'var(--text-primary)' }}>Products</Link>
          <Link to="/orders" style={{ padding: '0.75rem', borderRadius: '0.375rem', backgroundColor: location.pathname === '/orders' ? 'var(--background-color)' : 'transparent', color: location.pathname === '/orders' ? 'var(--primary-color)' : 'var(--text-primary)' }}>Orders</Link>
        </nav>

        <button onClick={handleLogout} style={{ padding: '0.75rem', backgroundColor: 'transparent', border: 'none', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Log Out
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* Banner */}
        {subscriptionStatus === 'past_due' && (
          <div className="alert alert-warning" style={{ borderRadius: 0, margin: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
            <strong>Payment Failed!</strong> Your subscription is past due. Please update your billing information to avoid service interruption.
          </div>
        )}

        {/* Page Content */}
        <div style={{ padding: '2rem', flexGrow: 1 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
