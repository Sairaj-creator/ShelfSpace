import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { queryClient } from '../lib/queryClient';
import { EditableStockCell } from '../components/EditableStockCell';
import { SkeletonRow } from '../components/SkeletonRow';
import { Trash2 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock_qty: number;
  low_stock_threshold: number;
}

export function Products() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'name' | 'sku' | 'stock_qty'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Form state
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: products = [], isLoading, error } = useQuery({
    queryKey: queryKeys.products,
    queryFn: async () => {
      const res = await apiFetch('/products');
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      return Array.isArray(data) ? data : (data.products || []) as Product[];
    },
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: async (newProduct: any) => {
      const res = await apiFetch('/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create product');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Product created successfully');
      setShowForm(false);
      setName('');
      setSku('');
      setPrice('');
      setStockQty('');
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    }
  });

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, stock_qty }: { id: string, stock_qty: number }) => {
      const res = await apiFetch(`/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_qty })
      });
      if (!res.ok) throw new Error('Failed to update stock');
      return res.json();
    },
    onMutate: async (newUpdate) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.products });
      const previousProducts = queryClient.getQueryData<Product[]>(queryKeys.products);
      if (previousProducts) {
        queryClient.setQueryData<Product[]>(queryKeys.products, old => 
          old?.map(p => p.id === newUpdate.id ? { ...p, stock_qty: newUpdate.stock_qty } : p)
        );
      }
      return { previousProducts };
    },
    onError: (_err, _newUpdate, context) => {
      toast.error('Failed to update stock');
      if (context?.previousProducts) {
        queryClient.setQueryData(queryKeys.products, context.previousProducts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
    },
    onSuccess: () => {
      toast.success('Stock updated');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/products/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete product');
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.products });
      const previousProducts = queryClient.getQueryData<Product[]>(queryKeys.products);
      if (previousProducts) {
        queryClient.setQueryData<Product[]>(queryKeys.products, old => old?.filter(p => p.id !== id));
      }
      return { previousProducts };
    },
    onError: (err: Error, _id, context) => {
      toast.error(err.message);
      if (context?.previousProducts) {
        queryClient.setQueryData(queryKeys.products, context.previousProducts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
    },
    onSuccess: () => {
      toast.success('Product deleted');
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    createMutation.mutate({
      name,
      sku,
      price: Math.round(parseFloat(price) * 100),
      stock_qty: parseInt(stockQty, 10) || 0
    });
  };

  const handleSort = (field: 'name' | 'sku' | 'stock_qty') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredAndSortedProducts = products
    .filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
      return 0;
    });

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

      {error && <div className="alert alert-danger">{(error as Error).message}</div>}

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
            <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving...' : 'Save Product'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div style={{ marginBottom: '1rem' }}>
          <input 
            type="text" 
            placeholder="Search products by name or SKU..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '100%', maxWidth: '400px', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        {isLoading ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRow columns={5} />
              <SkeletonRow columns={5} />
              <SkeletonRow columns={5} />
            </tbody>
          </table>
        ) : filteredAndSortedProducts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No products found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                  Name {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th onClick={() => handleSort('sku')} style={{ cursor: 'pointer' }}>
                  SKU {sortField === 'sku' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Price</th>
                <th onClick={() => handleSort('stock_qty')} style={{ cursor: 'pointer' }}>
                  Stock {sortField === 'stock_qty' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedProducts.map(p => {
                const threshold = p.low_stock_threshold ?? 5;
                const isLow = p.stock_qty < threshold;
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><code style={{ fontSize: '0.8125rem' }}>{p.sku}</code></td>
                    <td className="number-tabular">${(p.price / 100).toFixed(2)}</td>
                    <td className="number-tabular">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, color: isLow ? 'var(--accent-rust)' : 'var(--text-ink)' }}>
                          <EditableStockCell 
                            value={p.stock_qty} 
                            onSave={(val) => updateStockMutation.mutate({ id: p.id, stock_qty: val })} 
                          />
                        </span>
                        {isLow && <span className="stamp-warning">⚠ LOW</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this product?')) {
                            deleteMutation.mutate(p.id);
                          }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-rust)', padding: '0.25rem' }}
                        title="Delete product"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
