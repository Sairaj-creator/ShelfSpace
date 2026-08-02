import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { queryClient } from '../lib/queryClient';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonRow } from '../components/SkeletonRow';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface OrderItem {
  id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  product: {
    name: string;
    sku: string;
  };
}

interface Order {
  id: string;
  customer_name: string;
  status: string;
  total: number;
  created_at: string;
  items: OrderItem[];
}

interface Product {
  id: string;
  name: string;
  price: number;
}

export function Orders() {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: queryKeys.orders,
    queryFn: async () => {
      const res = await apiFetch('/orders');
      if (!res.ok) throw new Error('Failed to load orders');
      const data = await res.json();
      return Array.isArray(data) ? data : (data.orders || []) as Order[];
    },
    refetchInterval: 15_000,
  });

  const { data: availableProducts = [] } = useQuery({
    queryKey: queryKeys.products,
    queryFn: async () => {
      const res = await apiFetch('/products');
      if (!res.ok) throw new Error('Failed to load products');
      const data = await res.json();
      const prods = Array.isArray(data) ? data : (data.products || []) as Product[];
      return prods;
    },
  });

  React.useEffect(() => {
    if (availableProducts.length > 0 && !selectedProductId) {
      setSelectedProductId(availableProducts[0].id);
    }
  }, [availableProducts, selectedProductId]);

  const createMutation = useMutation({
    mutationFn: async (newOrder: any) => {
      const res = await apiFetch('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create order');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Order created successfully');
      setShowForm(false);
      setCustomerName('');
      setQty('1');
      queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    },
    onError: (err: any) => {
      setFormError(err.message);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
      const res = await apiFetch(`/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update order status');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Order status updated');
      queryClient.invalidateQueries({ queryKey: queryKeys.orders });
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedProductId) {
      setFormError('Please select a product');
      return;
    }

    createMutation.mutate({
      customer_name: customerName,
      items: [
        { product_id: selectedProductId, qty: parseInt(qty, 10) }
      ]
    });
  };

  const toggleExpand = (orderId: string) => {
    setExpandedOrderId(prev => prev === orderId ? null : orderId);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h2>Orders</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Customer order log and fulfillments</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : 'Create Order'}
        </button>
      </div>

      {error && <div className="alert alert-danger">{(error as Error).message}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>Create New Order</h3>
          {formError && <div className="alert alert-danger">{formError}</div>}
          
          {availableProducts.length === 0 ? (
            <div className="alert alert-warning">You need to create products before you can create an order.</div>
          ) : (
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div className="input-group">
                  <label>Customer Name</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label>Product</label>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} required>
                    {availableProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (${(p.price / 100).toFixed(2)})</option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label>Quantity</label>
                  <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} required />
                </div>
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Submit Order'}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                <SkeletonRow columns={4} />
                <SkeletonRow columns={4} />
                <SkeletonRow columns={4} />
              </tbody>
            </table>
          </div>
        ) : orders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No orders in manifest.</p>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Status</th>
                <th>Total</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <React.Fragment key={o.id}>
                  <tr 
                    style={{ cursor: 'pointer', borderBottom: expandedOrderId === o.id ? 'none' : '1px solid #eee' }} 
                    onClick={() => toggleExpand(o.id)}
                  >
                    <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {expandedOrderId === o.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {o.customer_name}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <StatusBadge status={o.status} />
                        <select 
                          value={o.status}
                          onChange={(e) => updateStatusMutation.mutate({ id: o.id, status: e.target.value })}
                          style={{ padding: '0.1rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid #ccc' }}
                          disabled={updateStatusMutation.isPending}
                        >
                          <option value="pending">Pending</option>
                          <option value="fulfilled">Fulfilled</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </td>
                    <td className="number-tabular" style={{ fontWeight: 600 }}>${(o.total / 100).toFixed(2)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                  {expandedOrderId === o.id && (
                    <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #eee' }}>
                      <td colSpan={4} style={{ padding: '1rem 2rem' }}>
                        <h4 style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>Order Items</h4>
                        <table style={{ width: '100%', fontSize: '0.875rem' }}>
                          <thead>
                            <tr>
                              <th style={{ padding: '0.5rem' }}>Product</th>
                              <th style={{ padding: '0.5rem' }}>Quantity</th>
                              <th style={{ padding: '0.5rem' }}>Unit Price</th>
                              <th style={{ padding: '0.5rem' }}>Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.items.map(item => (
                              <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '0.5rem' }}>
                                  <div style={{ fontWeight: 600 }}>{item.product?.name || 'Unknown Product'}</div>
                                  <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.product?.sku || item.product_id}</code>
                                </td>
                                <td style={{ padding: '0.5rem' }}>{item.qty}</td>
                                <td style={{ padding: '0.5rem' }}>${(item.unit_price / 100).toFixed(2)}</td>
                                <td style={{ padding: '0.5rem', fontWeight: 600 }}>${((item.qty * item.unit_price) / 100).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
