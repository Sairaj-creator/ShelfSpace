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

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading manifest metrics...</div>;
  if (!metrics) return <div className="alert alert-danger">Failed to load metrics</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h2>Dashboard</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Real-time inventory ledger and monthly revenue summary</p>
        </div>
        
        {metrics.plan === 'free' && (
          <button onClick={handleUpgrade} className="btn-primary">
            Upgrade to Pro
          </button>
        )}
        {metrics.plan === 'pro' && (
          <span style={{ 
            padding: '0.375rem 0.875rem', 
            backgroundColor: 'var(--bg-paper)', 
            border: '1px solid var(--accent-ledger)', 
            color: 'var(--accent-ledger)', 
            borderRadius: '0.25rem', 
            fontWeight: 700, 
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            PRO PLAN ACTIVE
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
            Revenue This Month
          </div>
          <p style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-ink)' }} className="number-tabular">
            ${(metrics.revenue_cents / 100).toFixed(2)}
          </p>
        </div>
        
        <div className="card">
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
            Low Stock Alerts
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <p style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: metrics.low_stock_products.length > 0 ? 'var(--accent-rust)' : 'var(--text-ink)' }} className="number-tabular">
              {metrics.low_stock_products.length}
            </p>
            {metrics.low_stock_products.length > 0 && (
              <span className="stamp-warning">⚠ REQUIRES ACTION</span>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Items Needing Attention</h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            THRESHOLD: Stock &lt; 5
          </span>
        </div>
        
        {metrics.low_stock_products.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>All products are well-stocked in the current manifest.</p>
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
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><code style={{ fontSize: '0.8125rem' }}>{p.sku}</code></td>
                  <td className="number-tabular" style={{ color: 'var(--accent-rust)', fontWeight: 700 }}>
                    {p.stock_qty}
                    <span className="stamp-warning">⚠ LOW</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
