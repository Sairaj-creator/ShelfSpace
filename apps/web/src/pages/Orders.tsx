import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { queryClient } from '../lib/queryClient';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonRow } from '../components/SkeletonRow';
import { StatusSelect } from '../components/StatusSelect';
import { ChevronDown, ChevronRight, Plus, Trash2, Download } from 'lucide-react';

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
  const [orderItems, setOrderItems] = useState<Array<{ product_id: string; qty: string }>>([
    { product_id: '', qty: '1' }
  ]);
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
    if (availableProducts.length > 0) {
      setOrderItems(prev => prev.map(item => item.product_id ? item : { ...item, product_id: availableProducts[0].id }));
    }
  }, [availableProducts]);

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
      setOrderItems([{ product_id: availableProducts[0]?.id || '', qty: '1' }]);
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

  const handleAddItem = () => {
    setOrderItems(prev => [...prev, { product_id: availableProducts[0]?.id || '', qty: '1' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (orderItems.length === 1) return;
    setOrderItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: 'product_id' | 'qty', value: string) => {
    setOrderItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleExportCsv = async () => {
    const res = await apiFetch('/orders/export');
    if (!res.ok) {
      toast.error('Failed to export order manifest');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orders_manifest.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!customerName.trim()) {
      setFormError('Customer name is required');
      return;
    }

    const invalidItem = orderItems.find(item => !item.product_id || parseInt(item.qty, 10) <= 0 || isNaN(parseInt(item.qty, 10)));
    if (invalidItem) {
      setFormError('Please select valid products and positive quantities for all lines.');
      return;
    }

    // UX Enhancement: Merge duplicate product_ids before submission
    const mergedItems = orderItems.reduce((acc, current) => {
      const existing = acc.find(i => i.product_id === current.product_id);
      const qtyNum = parseInt(current.qty, 10);
      if (existing) {
        existing.qty += qtyNum;
      } else {
        acc.push({ product_id: current.product_id, qty: qtyNum });
      }
      return acc;
    }, [] as Array<{ product_id: string; qty: number }>);

    createMutation.mutate({
      customer_name: customerName,
      items: mergedItems
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleExportCsv} className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Download size={16} /> Export Manifest CSV
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? 'Cancel' : 'Create Order'}
          </button>
        </div>
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
              <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                <label>Customer Name</label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: 'var(--text-muted)' }}>
                    Line Items
                  </label>
                  <button type="button" onClick={handleAddItem} className="btn-outline" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Plus size={14} /> Add Line
                  </button>
                </div>

                {orderItems.map((item, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ flex: 2 }}>
                      <select 
                        value={item.product_id} 
                        onChange={e => handleItemChange(index, 'product_id', e.target.value)} 
                        required
                        style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid var(--border-tan)', borderRadius: '0.25rem' }}
                      >
                        {availableProducts.map(p => (
                          <option key={p.id} value={p.id}>{p.name} (${(p.price / 100).toFixed(2)})</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <input 
                        type="number" 
                        min="1" 
                        value={item.qty} 
                        onChange={e => handleItemChange(index, 'qty', e.target.value)} 
                        required 
                        style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid var(--border-tan)', borderRadius: '0.25rem' }}
                      />
                    </div>
                    {orderItems.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => handleRemoveItem(index)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-rust)', cursor: 'pointer', padding: '0.4rem' }}
                        title="Remove line item"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}
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
                      <StatusSelect 
                        status={o.status}
                        onChange={(newStatus) => updateStatusMutation.mutate({ id: o.id, status: newStatus })}
                        disabled={updateStatusMutation.isPending}
                      />
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
