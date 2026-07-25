import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Order {
  id: string;
  customer_name: string;
  status: string;
  total: number;
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);

  const fetchOrders = async () => {
    setLoading(true);
    const res = await apiFetch('/orders');
    if (res.ok) {
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : (data.orders || []));
    } else {
      setError('Failed to load orders');
    }
    setLoading(false);
  };

  const fetchProductsForSelect = async () => {
    const res = await apiFetch('/products');
    if (res.ok) {
      const data = await res.json();
      const prods = Array.isArray(data) ? data : (data.products || []);
      setAvailableProducts(prods);
      if (prods.length > 0) {
        setSelectedProductId(prods[0].id);
      }
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchProductsForSelect();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedProductId) {
      setFormError('Please select a product');
      return;
    }

    const res = await apiFetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: customerName,
        items: [
          { product_id: selectedProductId, qty: parseInt(qty, 10) }
        ]
      })
    });

    if (res.ok) {
      setShowForm(false);
      setCustomerName('');
      setQty('1');
      fetchOrders();
    } else {
      const errData = await res.json();
      setFormError(errData.error || 'Failed to create order');
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading order manifest...</div>;

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

      {error && <div className="alert alert-danger">{error}</div>}

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
              <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }}>Submit Order</button>
            </form>
          )}
        </div>
      )}

      <div className="card">
        {orders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No orders in manifest.</p>
        ) : (
          <table>
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
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.customer_name}</td>
                  <td>
                    <span style={{ 
                      padding: '0.2rem 0.6rem', 
                      borderRadius: '0.25rem', 
                      fontSize: '0.7rem', 
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      backgroundColor: o.status === 'fulfilled' ? '#E6F4EA' : o.status === 'cancelled' ? '#FCE8E6' : '#FEF7E0',
                      color: o.status === 'fulfilled' ? '#137333' : o.status === 'cancelled' ? '#C5221F' : '#B06000',
                      border: `1px solid ${o.status === 'fulfilled' ? '#CEEAD6' : o.status === 'cancelled' ? '#FAD2CF' : '#FDE293'}`
                    }}>
                      {o.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="number-tabular" style={{ fontWeight: 600 }}>${(o.total / 100).toFixed(2)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
