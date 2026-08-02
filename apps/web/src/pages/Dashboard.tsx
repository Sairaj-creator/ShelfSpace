import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { queryClient } from '../lib/queryClient';
import { RevenueChart } from '../components/RevenueChart';
import { EditableStockCell } from '../components/EditableStockCell';

interface DashboardMetrics {
  plan: string;
  subscription_status: string | null;
  low_stock_products: Array<{ id: string; name: string; sku: string; stock_qty: number, low_stock_threshold: number }>;
  revenue_cents: number;
  daily_revenue: Array<{ date: string; revenue_cents: number }>;
}

export function Dashboard() {
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: queryKeys.dashboardMetrics,
    queryFn: async () => {
      const res = await apiFetch('/dashboard/metrics');
      if (!res.ok) throw new Error('Failed to load metrics');
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, stock_qty }: { id: string, stock_qty: number }) => {
      const res = await apiFetch(`/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_qty })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update stock');
      }
      return res.json();
    },
    onMutate: async (newUpdate) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboardMetrics });
      const previousMetrics = queryClient.getQueryData<DashboardMetrics>(queryKeys.dashboardMetrics);
      if (previousMetrics) {
        queryClient.setQueryData<DashboardMetrics>(queryKeys.dashboardMetrics, {
          ...previousMetrics,
          low_stock_products: previousMetrics.low_stock_products.map(p =>
            p.id === newUpdate.id ? { ...p, stock_qty: newUpdate.stock_qty } : p
          )
        });
      }
      return { previousMetrics };
    },
    onSuccess: () => {
      toast.success('Stock updated');
    },
    onError: (err: Error, _newUpdate, context) => {
      toast.error(err.message || 'Failed to update stock');
      if (context?.previousMetrics) {
        queryClient.setQueryData(queryKeys.dashboardMetrics, context.previousMetrics);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
    }
  });

  const handleUpgrade = async () => {
    const res = await apiFetch('/billing/create-checkout-session', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      toast.error('Failed to start upgrade process');
    }
  };

  if (isLoading) return <div style={{ color: 'var(--text-muted)' }}>Loading manifest metrics...</div>;
  if (error) return <div className="alert alert-danger">Failed to load metrics</div>;
  if (!metrics) return null;

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
          <p style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-ink)', marginBottom: '1.5rem' }} className="number-tabular">
            ${(metrics.revenue_cents / 100).toFixed(2)}
          </p>
          <div style={{ marginLeft: '-1rem', marginRight: '-1rem' }}>
            {metrics.daily_revenue && <RevenueChart data={metrics.daily_revenue} />}
          </div>
        </div>
        
        <div className="card">
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
            Low Stock Alerts
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: metrics.low_stock_products.length > 0 ? 'var(--accent-rust)' : 'var(--text-ink)' }} className="number-tabular">
              {metrics.low_stock_products.length}
            </p>
            {metrics.low_stock_products.length > 0 && (
              <span className="stamp-warning">⚠ REQUIRES ACTION</span>
            )}
          </div>

          <div style={{ marginTop: 'auto' }}>
            <h4 style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>Items Below Custom Thresholds</h4>
            {metrics.low_stock_products.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>All products are well-stocked.</p>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '0.5rem 0', textAlign: 'left' }}>Product</th>
                      <th style={{ padding: '0.5rem 0', textAlign: 'left' }}>Stock</th>
                      <th style={{ padding: '0.5rem 0', textAlign: 'left' }}>Threshold</th>
                      <th style={{ padding: '0.5rem 0' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.low_stock_products.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.75rem 0', fontWeight: 600 }}>{p.name} <br/><code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.sku}</code></td>
                        <td style={{ padding: '0.75rem 0' }} className="number-tabular">
                          <span style={{ fontWeight: 600, color: 'var(--accent-rust)' }}>
                            <EditableStockCell 
                              value={p.stock_qty} 
                              onSave={(val) => updateStockMutation.mutate({ id: p.id, stock_qty: val })} 
                            />
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0' }} className="number-tabular">
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            &lt; {p.low_stock_threshold ?? 5}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0', textAlign: 'right' }}>
                          <Link to="/products" style={{ color: 'var(--accent-ledger)', fontSize: '0.75rem', textDecoration: 'none', fontWeight: 600 }}>
                            View in Ledger →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
