import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface DashboardMetrics {
  plan: string;
  subscription_status: string | null;
  low_stock_products: Array<{ id: string; name: string; sku: string; stock_qty: number }>;
  revenue_cents: number;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (res.ok) {
        setMetrics(await res.json());
      }
      setLoading(false);
    };
    fetchMetrics();
  }, []);

  const handleUpgrade = async () => {
    const res = await apiFetch('/billing/create-checkout-session', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      alert('Failed to start upgrade process');
    }
  };

  if (loading) return <div>Loading dashboard...</div>;
  if (!metrics) return <div>Failed to load metrics</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold' }}>Dashboard</h2>
        
        {metrics.plan === 'free' && (
          <button onClick={handleUpgrade} className="btn-primary" style={{ backgroundColor: '#10b981' }}>
            Upgrade to Pro
          </button>
        )}
        {metrics.plan === 'pro' && (
          <span style={{ padding: '0.5rem 1rem', backgroundColor: '#e0e7ff', color: '#4338ca', borderRadius: '9999px', fontWeight: 500, fontSize: '0.875rem' }}>
            Pro Plan Active
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Revenue This Month
          </h3>
          <p style={{ fontSize: '2.25rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            ${(metrics.revenue_cents / 100).toFixed(2)}
          </p>
        </div>
        
        <div className="card">
          <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Low Stock Alerts
          </h3>
          <p style={{ fontSize: '2.25rem', fontWeight: 'bold', color: metrics.low_stock_products.length > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {metrics.low_stock_products.length}
          </p>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Items Needing Attention</h3>
        {metrics.low_stock_products.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>All products are well-stocked.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>SKU</th>
                <th>Current Stock</th>
              </tr>
            </thead>
            <tbody>
              {metrics.low_stock_products.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.sku}</td>
                  <td style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>{p.stock_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
