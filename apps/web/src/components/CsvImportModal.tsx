import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Upload, FileText, AlertCircle, X, CheckCircle } from 'lucide-react';

interface ParsedProduct {
  name: string;
  sku: string;
  price: number; // in cents
  stock_qty: number;
  low_stock_threshold: number;
}

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CsvImportModal({ isOpen, onClose }: CsvImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedProduct[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (products: ParsedProduct[]) => {
      const res = await apiFetch('/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to import products');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Successfully imported ${data.created_count} products!`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardMetrics'] });
      handleReset();
      onClose();
    },
    onError: (err: Error) => {
      setParseError(err.message);
    },
  });

  const handleReset = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 1) {
          setParseError('CSV file must contain a header row and at least one data row.');
          return;
        }

        // Parse Header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
        const nameIdx = header.findIndex(h => h.includes('name'));
        const skuIdx = header.findIndex(h => h.includes('sku'));
        const priceIdx = header.findIndex(h => h.includes('price'));
        const stockIdx = header.findIndex(h => h.includes('stock'));
        const thresholdIdx = header.findIndex(h => h.includes('threshold'));

        if (nameIdx === -1 || skuIdx === -1 || priceIdx === -1) {
          setParseError('CSV header must contain "Name", "SKU", and "Price" columns.');
          return;
        }

        const items: ParsedProduct[] = [];
        for (let i = 1; i < lines.length; i++) {
          // Basic CSV line splitting respecting quotes
          const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
          const cleanCols = cols.map(c => c.trim().replace(/^["']|["']$/g, ''));

          const name = cleanCols[nameIdx] || '';
          const sku = cleanCols[skuIdx] || '';
          const priceRaw = parseFloat(cleanCols[priceIdx] || '0');
          const stock_qty = stockIdx !== -1 ? parseInt(cleanCols[stockIdx] || '0', 10) : 0;
          const low_stock_threshold = thresholdIdx !== -1 ? parseInt(cleanCols[thresholdIdx] || '5', 10) : 5;

          if (!name || !sku || isNaN(priceRaw)) continue;

          items.push({
            name,
            sku,
            price: Math.round(priceRaw * 100), // convert dollars to cents
            stock_qty: isNaN(stock_qty) ? 0 : stock_qty,
            low_stock_threshold: isNaN(low_stock_threshold) ? 5 : low_stock_threshold,
          });
        }

        if (items.length === 0) {
          setParseError('No valid product rows found in CSV file.');
          return;
        }

        setParsedData(items);
      } catch (err) {
        setParseError('Failed to parse CSV file. Please verify format.');
      }
    };
    reader.readAsText(selected);
  };

  if (!isOpen) return null;

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="card" style={{ maxWidth: '600px', width: '90%', margin: 'auto', zIndex: 1000 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Upload size={18} /> Bulk Import Products (CSV)
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {parseError && (
          <div className="alert alert-danger" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} /> {parseError}
          </div>
        )}

        {!file ? (
          <div style={{ border: '2px dashed var(--border-tan)', padding: '2rem', textAlign: 'center', borderRadius: '0.5rem', backgroundColor: 'var(--bg-paper)' }}>
            <FileText size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Upload CSV File</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '1rem' }}>
              Required columns: <code>Name</code>, <code>SKU</code>, <code>Price</code> (optional: <code>Stock Qty</code>, <code>Threshold</code>)
            </p>
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleFileChange} 
              id="csv-file-input" 
              style={{ display: 'none' }} 
            />
            <label htmlFor="csv-file-input" className="btn-primary" style={{ cursor: 'pointer', display: 'inline-block' }}>
              Choose CSV File
            </label>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', backgroundColor: 'var(--bg-paper)', padding: '0.75rem 1rem', borderRadius: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={16} style={{ color: 'var(--accent-ledger)' }} />
                <span style={{ fontWeight: 600 }}>{file.name}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({parsedData.length} valid rows)</span>
              </div>
              <button onClick={handleReset} className="btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                Change File
              </button>
            </div>

            {parsedData.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Preview (First 5 Rows):</h4>
                <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '1.25rem', border: '1px solid var(--border-tan)', borderRadius: '4px' }}>
                  <table style={{ width: '100%', fontSize: '0.8125rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-paper)' }}>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>Name</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>SKU</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>Price ($)</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.slice(0, 5).map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{item.name}</td>
                          <td style={{ padding: '0.4rem 0.6rem' }}><code>{item.sku}</code></td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>${(item.price / 100).toFixed(2)}</td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>{item.stock_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={onClose} className="btn-outline">Cancel</button>
                  <button 
                    onClick={() => importMutation.mutate(parsedData)} 
                    className="btn-primary" 
                    disabled={importMutation.isPending}
                  >
                    {importMutation.isPending ? 'Importing...' : `Import ${parsedData.length} Products`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
