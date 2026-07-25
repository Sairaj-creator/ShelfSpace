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

  if (loading) return <div>Loading orders...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold' }}>Orders</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : 'Create Order'}
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Create New Order</h3>
          {formError && <div className="alert alert-danger">{formError}</div>}
          
          {availableProducts.length === 0 ? (
            <div className="alert alert-warning">You need to create products before you can create an order.</div>
          ) : (
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>Customer Name</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label>Product</label>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.375rem' }}>
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
              <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>Submit Order</button>
            </form>
          )}
        </div>
      )}

      <div className="card">
        {orders.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No orders found.</p>
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
                  <td>{o.customer_name}</td>
                  <td>
                    <span style={{ 
                      padding: '0.25rem 0.5rem', 
                      borderRadius: '9999px', 
                      fontSize: '0.75rem', 
                      fontWeight: 500,
                      backgroundColor: o.status === 'fulfilled' ? '#dcfce7' : o.status === 'cancelled' ? '#fee2e2' : '#fef9c3',
                      color: o.status === 'fulfilled' ? '#166534' : o.status === 'cancelled' ? '#991b1b' : '#854d0e'
                    }}>
                      {o.status.toUpperCase()}
                    </span>
                  </td>
                  <td>${(o.total / 100).toFixed(2)}</td>
                  <td>{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
