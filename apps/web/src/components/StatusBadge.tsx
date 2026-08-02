

type Status = 'pending' | 'fulfilled' | 'cancelled';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase() as Status;
  
  const colors = {
    fulfilled: { bg: '#E6F4EA', text: '#137333', border: '#CEEAD6' },
    cancelled: { bg: '#FCE8E6', text: '#C5221F', border: '#FAD2CF' },
    pending: { bg: '#FEF7E0', text: '#B06000', border: '#FDE293' },
  };

  const scheme = colors[normalized] || colors.pending;

  return (
    <span style={{ 
      padding: '0.2rem 0.6rem', 
      borderRadius: '0.25rem', 
      fontSize: '0.7rem', 
      fontWeight: 700,
      letterSpacing: '0.05em',
      backgroundColor: scheme.bg,
      color: scheme.text,
      border: `1px solid ${scheme.border}`
    }}>
      {status.toUpperCase()}
    </span>
  );
}
