export const queryKeys = {
  dashboardMetrics: ['dashboardMetrics'] as const,
  products: ['products'] as const,
  product: (id: string) => ['product', id] as const,
  orders: ['orders'] as const,
};
