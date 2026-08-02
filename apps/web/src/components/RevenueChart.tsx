import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface DailyRevenue {
  date: string;
  revenue_cents: number;
}

interface RevenueChartProps {
  data: DailyRevenue[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  // Format data for chart (convert cents to dollars, format date to MMM D)
  const chartData = data.map(item => {
    // item.date is 'YYYY-MM-DD'
    const [year, month, day] = item.date.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    
    return {
      date: item.date,
      displayDate: `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`,
      revenue: item.revenue_cents / 100,
    };
  });

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E0E0E0" />
          <XAxis 
            dataKey="displayDate" 
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            dy={10}
          />
          <YAxis 
            tickFormatter={formatCurrency}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            dx={-10}
          />
          <Tooltip 
            formatter={(value: any) => [formatCurrency(Number(value) || 0), 'Revenue']}
            labelStyle={{ color: 'var(--text-main)', fontWeight: 'bold' }}
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          />
          <Line 
            type="monotone" 
            dataKey="revenue" 
            stroke="var(--accent-ledger, #3b82f6)" 
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6, fill: "var(--accent-ledger, #3b82f6)", stroke: "white", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
