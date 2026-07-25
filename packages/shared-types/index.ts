export interface User {
  id: string;
  org_id: string;
  email: string;
  role: 'owner' | 'staff';
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: 'free' | 'pro';
  subscription_status: 'active' | 'past_due' | 'canceled' | null;
  created_at: string;
}

export interface Product {
  id: string;
  org_id: string;
  name: string;
  sku: string;
  price: number;
  stock_qty: number;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
}

export interface Order {
  id: string;
  org_id: string;
  customer_name: string;
  total: number;
  status: 'pending' | 'fulfilled' | 'cancelled';
  created_at: string;
  items?: OrderItem[];
}

export interface DashboardMetrics {
  revenue_this_month: number;
  low_stock_products: Product[];
}
