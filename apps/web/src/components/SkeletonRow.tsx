

interface SkeletonRowProps {
  columns: number;
}

export function SkeletonRow({ columns }: SkeletonRowProps) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i}>
          <div className="skeleton-cell" style={{ width: i === 0 ? '70%' : '50%' }}></div>
        </td>
      ))}
    </tr>
  );
}
