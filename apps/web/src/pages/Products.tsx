import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock_qty: number;
}

export function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchProducts = async () => {
    setLoading(true);
    const res = await apiFetch('/products');
    if (res.ok) {
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : (data.products || []));
    } else {
      setError('Failed to load products');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const res = await apiFetch('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        sku,
        price: Math.round(parseFloat(price) * 100),
        stock_qty: parseInt(stockQty, 10) || 0
      })
    });

    if (res.ok) {
      setShowForm(false);
      setName('');
      setSku('');
      setPrice('');
      setStockQty('');
      fetchProducts();
    } else {
      const errData = await res.json();
      setFormError(errData.error || 'Failed to create product');
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading inventory manifest...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h2>Products</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Active SKU listings and stock ledger</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : 'Add Product'}
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>Create New Product</h3>
          {formError && <div className="alert alert-danger">{formError}</div>}
          
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              <div className="input-group">
                <label>Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="input-group">
                <label>SKU</label>
                <input type="text" value={sku} onChange={e => setSku(e.target.value)} required />
              </div>
              <div className="input-group">
                <label>Price</label>
                <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} required />
              </div>
              <div className="input-group">
                <label>Initial Stock</label>
                <input type="number" min="0" value={stockQty} onChange={e => setStockQty(e.target.value)} required />
              </div>
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }}>Save Product</button>
          </form>
        </div>
      )}

      <div className="card">
        {products.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No products in manifest. Click "Add Product" to create one.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><code style={{ fontSize: '0.8125rem' }}>{p.sku}</code></td>
                  <td className="number-tabular">${(p.price / 100).toFixed(2)}</td>
                  <td className="number-tabular">
                    <span style={{ fontWeight: 600, color: p.stock_qty < 5 ? 'var(--accent-rust)' : 'var(--text-ink)' }}>
                      {p.stock_qty}
                    </span>
                    {p.stock_qty < 5 && <span className="stamp-warning">⚠ LOW</span>}
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
